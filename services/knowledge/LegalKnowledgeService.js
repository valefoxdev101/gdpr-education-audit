const { google } = require('googleapis');
const { ChromaClient } = require('chromadb');
const { createClient } = require('redis');
const winston = require('winston');
const LegalKnowledgeVectorizer = require('./LegalKnowledgeVectorizer');

class LegalKnowledgeService {
  constructor() {
    this.googleDrive = null;
    this.vectorizer = new LegalKnowledgeVectorizer();
    this.redis = null;
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [
        new winston.transports.File({ filename: 'legal-knowledge.log' })
      ]
    });
  }

  async initialize() {
    try {
      // Initialize Google Drive API
      const auth = await this.authenticateGoogle();
      this.googleDrive = google.drive({ version: 'v3', auth });
      
      // Initialize Redis cache
      this.redis = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });
      await this.redis.connect();
      
      // Load and vectorize all legal documents on startup
      await this.vectorizer.initializeKnowledgeBase();
      
      // Set up document watch for updates
      await this.watchLegalDocuments();
      
      this.logger.info('Legal Knowledge Service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Legal Knowledge Service:', error);
      throw error;
    }
  }

  async authenticateGoogle() {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });
    return auth.getClient();
  }

  async watchLegalDocuments() {
    const folderId = process.env.LEGAL_KNOWLEDGE_FOLDER_ID;
    
    // Set up webhook for folder changes
    try {
      const res = await this.googleDrive.files.watch({
        fileId: folderId,
        requestBody: {
          id: `legal-docs-watch-${Date.now()}`,
          type: 'web_hook',
          address: `${process.env.WEBHOOK_URL}/api/legal-docs/update`,
          expiration: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
        }
      });
      
      this.logger.info('Document watch webhook created:', res.data);
    } catch (error) {
      this.logger.error('Failed to set up document watch:', error);
      // Fall back to polling
      setInterval(() => this.checkForUpdates(), 5 * 60 * 1000); // Check every 5 minutes
    }
  }

  async getLegalRequirement(requirementType, context) {
    const cacheKey = `legal:${requirementType}:${JSON.stringify(context)}`;
    
    try {
      // Check cache first
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        this.logger.info(`Cache hit for ${requirementType}`);
        return JSON.parse(cached);
      }
      
      // Query vectorized knowledge base
      const requirement = await this.vectorizer.queryLegalRequirement(
        requirementType,
        context
      );
      
      // Cache for 24 hours
      await this.redis.setEx(cacheKey, 86400, JSON.stringify(requirement));
      
      return requirement;
    } catch (error) {
      this.logger.error(`Failed to get legal requirement ${requirementType}:`, error);
      throw error;
    }
  }

  async checkForUpdates() {
    const folderId = process.env.LEGAL_KNOWLEDGE_FOLDER_ID;
    
    try {
      const res = await this.googleDrive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(id, name, modifiedTime, mimeType)',
        orderBy: 'modifiedTime desc'
      });
      
      for (const file of res.data.files) {
        const lastSync = await this.redis.get(`file:lastsync:${file.id}`);
        
        if (!lastSync || new Date(file.modifiedTime) > new Date(lastSync)) {
          await this.updateDocument(file.id);
        }
      }
    } catch (error) {
      this.logger.error('Failed to check for document updates:', error);
    }
  }

  async updateDocument(docId) {
    try {
      this.logger.info(`Updating document ${docId}`);
      
      // Get document content
      const doc = await this.getDocumentContent(docId);
      
      // Re-vectorize updated document
      await this.vectorizer.updateDocument(doc);
      
      // Clear related cache entries
      const pattern = `legal:*`;
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(keys);
      }
      
      // Update last sync time
      await this.redis.set(`file:lastsync:${docId}`, new Date().toISOString());
      
      this.logger.info(`Document ${docId} updated successfully`);
    } catch (error) {
      this.logger.error(`Failed to update document ${docId}:`, error);
    }
  }

  async getDocumentContent(docId) {
    try {
      // Get document metadata
      const metadataRes = await this.googleDrive.files.get({
        fileId: docId,
        fields: 'id, name, mimeType, modifiedTime, parents'
      });
      
      // Export Google Doc as plain text
      const contentRes = await this.googleDrive.files.export({
        fileId: docId,
        mimeType: 'text/plain'
      });
      
      return {
        id: docId,
        name: metadataRes.data.name,
        content: contentRes.data,
        modifiedTime: metadataRes.data.modifiedTime,
        folder: await this.getFolderName(metadataRes.data.parents[0])
      };
    } catch (error) {
      this.logger.error(`Failed to get document content for ${docId}:`, error);
      throw error;
    }
  }

  async getFolderName(folderId) {
    try {
      const res = await this.googleDrive.files.get({
        fileId: folderId,
        fields: 'name'
      });
      return res.data.name;
    } catch (error) {
      return 'Unknown';
    }
  }

  async searchLegalPrecedents(violationType, context) {
    const query = `Find legal precedents for ${violationType} in Italian educational institutions`;
    
    const results = await this.vectorizer.searchSimilar(query, {
      filter: {
        category: 'Enforcement_Precedents',
        jurisdiction: 'Italy'
      },
      topK: 5
    });
    
    return results.map(r => ({
      case: r.metadata.caseName,
      decision: r.content,
      fine: r.metadata.fineAmount,
      date: r.metadata.decisionDate,
      similarity: r.score
    }));
  }

  async calculatePotentialFine(violations) {
    // Get fine calculation matrix from knowledge base
    const fineMatrix = await this.getLegalRequirement('fine_calculation_matrix', {
      violations: violations.map(v => v.type),
      jurisdiction: 'Italy'
    });
    
    let totalFine = 0;
    let calculation = [];
    
    for (const violation of violations) {
      const baseAmount = fineMatrix.baseFines[violation.type] || 0;
      const multiplier = violation.severity === 'critical' ? 2 : 1;
      const amount = baseAmount * multiplier;
      
      totalFine += amount;
      calculation.push({
        violation: violation.type,
        baseAmount,
        multiplier,
        amount
      });
    }
    
    return {
      totalFine,
      calculation,
      legalBasis: fineMatrix.legalReferences
    };
  }
}

module.exports = LegalKnowledgeService;