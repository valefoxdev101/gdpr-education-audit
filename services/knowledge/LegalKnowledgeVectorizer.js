const { ChromaClient } = require('chromadb');
const { OpenAI } = require('openai');
const winston = require('winston');

class LegalKnowledgeVectorizer {
  constructor() {
    this.chroma = new ChromaClient({
      path: process.env.CHROMA_DB_PATH || 'http://localhost:8000'
    });
    
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    this.collection = null;
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [
        new winston.transports.File({ filename: 'vectorizer.log' })
      ]
    });
  }

  async initializeKnowledgeBase() {
    try {
      // Create or get collection
      this.collection = await this.chroma.getOrCreateCollection({
        name: 'legal_knowledge_base',
        metadata: { 
          description: 'GDPR and Italian legal documents for education compliance' 
        }
      });
      
      this.logger.info('Vector database collection initialized');
    } catch (error) {
      this.logger.error('Failed to initialize vector database:', error);
      throw error;
    }
  }

  async processDocuments(documents) {
    const processedDocs = [];
    
    for (const doc of documents) {
      try {
        // Chunk document with legal citation preservation
        const chunks = await this.chunkDocument(doc, {
          chunkSize: 1000,
          overlap: 200,
          preserveLegalCitations: true
        });
        
        // Generate embeddings
        const embeddings = await this.generateEmbeddings(chunks);
        
        // Prepare documents for insertion
        const ids = chunks.map((_, index) => `${doc.id}_chunk_${index}`);
        const metadatas = chunks.map((chunk, index) => ({
          source: doc.name,
          docId: doc.id,
          chunkIndex: index,
          lastUpdated: doc.modifiedTime,
          category: doc.folder,
          legalReferences: this.extractLegalReferences(chunk)
        }));
        
        // Add to vector database
        await this.collection.add({
          ids: ids,
          embeddings: embeddings,
          documents: chunks,
          metadatas: metadatas
        });
        
        processedDocs.push(doc.id);
        this.logger.info(`Processed document: ${doc.name}`);
      } catch (error) {
        this.logger.error(`Failed to process document ${doc.name}:`, error);
      }
    }
    
    return processedDocs;
  }

  async chunkDocument(doc, options) {
    const { chunkSize, overlap, preserveLegalCitations } = options;
    const content = doc.content;
    const chunks = [];
    
    if (preserveLegalCitations) {
      // Smart chunking that preserves legal citations
      const sections = this.splitByLegalSections(content);
      
      for (const section of sections) {
        if (section.length <= chunkSize) {
          chunks.push(section);
        } else {
          // Split large sections while preserving context
          const subChunks = this.splitWithOverlap(section, chunkSize, overlap);
          chunks.push(...subChunks);
        }
      }
    } else {
      // Simple chunking with overlap
      chunks.push(...this.splitWithOverlap(content, chunkSize, overlap));
    }
    
    return chunks;
  }

  splitByLegalSections(content) {
    // Split by common legal document patterns
    const patterns = [
      /\n(?=Article\s+\d+)/gi,
      /\n(?=Section\s+\d+)/gi,
      /\n(?=§\s*\d+)/gi,
      /\n(?=\d+\.\s+[A-Z])/g
    ];
    
    let sections = [content];
    
    for (const pattern of patterns) {
      const newSections = [];
      for (const section of sections) {
        const splits = section.split(pattern);
        newSections.push(...splits.filter(s => s.trim().length > 0));
      }
      sections = newSections;
    }
    
    return sections;
  }

  splitWithOverlap(text, chunkSize, overlap) {
    const chunks = [];
    let start = 0;
    
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      chunks.push(text.slice(start, end));
      start += chunkSize - overlap;
    }
    
    return chunks;
  }

  async generateEmbeddings(texts) {
    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: texts
      });
      
      return response.data.map(item => item.embedding);
    } catch (error) {
      this.logger.error('Failed to generate embeddings:', error);
      throw error;
    }
  }

  extractLegalReferences(text) {
    const references = [];
    
    // GDPR Articles
    const gdprPattern = /Article\s+(\d+)(?:\((\d+)\))?(?:\(([a-z])\))?\s+(?:of\s+)?(?:the\s+)?GDPR/gi;
    let match;
    while ((match = gdprPattern.exec(text)) !== null) {
      references.push({
        type: 'GDPR',
        article: match[1],
        paragraph: match[2] || null,
        subparagraph: match[3] || null,
        text: match[0]
      });
    }
    
    // AI Act Articles
    const aiActPattern = /Article\s+(\d+)\s+(?:of\s+)?(?:the\s+)?AI\s+Act/gi;
    while ((match = aiActPattern.exec(text)) !== null) {
      references.push({
        type: 'AI_Act',
        article: match[1],
        text: match[0]
      });
    }
    
    // Italian Legislative Decrees
    const dlgsPattern = /D\.?\s*Lgs\.?\s+(?:n\.?\s*)?(\d+)\/(\d{4})/gi;
    while ((match = dlgsPattern.exec(text)) !== null) {
      references.push({
        type: 'Italian_Decree',
        number: match[1],
        year: match[2],
        text: match[0]
      });
    }
    
    // Garante Decisions
    const garantePattern = /(?:Provvedimento|Decisione)\s+(?:del\s+)?Garante\s+(?:n\.?\s*)?(\d+)(?:\/(\d{4}))?/gi;
    while ((match = garantePattern.exec(text)) !== null) {
      references.push({
        type: 'Garante_Decision',
        number: match[1],
        year: match[2] || null,
        text: match[0]
      });
    }
    
    return references;
  }

  async queryLegalRequirement(requirementType, context) {
    try {
      // Build query based on requirement type and context
      const query = this.buildQuery(requirementType, context);
      
      // Search in vector database
      const results = await this.searchSimilar(query, {
        filter: this.buildFilter(context),
        topK: 10
      });
      
      // Synthesize response from results
      return this.synthesizeResponse(results, requirementType);
    } catch (error) {
      this.logger.error(`Failed to query legal requirement ${requirementType}:`, error);
      throw error;
    }
  }

  buildQuery(requirementType, context) {
    const queryTemplates = {
      'biometric_detection_patterns': `What biometric data processing systems should be detected in educational platforms according to GDPR and AI Act? Focus on ${context.platform_type} platforms in ${context.jurisdiction}.`,
      'violation_severity': `What is the severity level and potential fine for ${context.violation_type} violations${context.affects_minors ? ' affecting minors' : ''} under Italian GDPR enforcement?`,
      'fine_calculation_matrix': `How are GDPR fines calculated for ${context.violations.join(', ')} violations in ${context.jurisdiction}? Include base amounts and multipliers.`,
      'biometric_legal_framework': `What are the legal requirements for processing ${context.data_types.join(', ')} biometric data for ${context.processing_purposes.join(', ')} purposes in educational settings?`,
      'enforcement_precedents': `Find enforcement cases similar to ${context.similar_violations.join(', ')} in Italian educational institutions.`,
      'report_template': `Provide a ${context.report_type} report template in ${context.language} for GDPR compliance violations.`
    };
    
    return queryTemplates[requirementType] || `Legal requirements for ${requirementType} in context: ${JSON.stringify(context)}`;
  }

  buildFilter(context) {
    const filter = {};
    
    if (context.category) {
      filter.category = context.category;
    }
    
    if (context.jurisdiction) {
      filter['$or'] = [
        { jurisdiction: context.jurisdiction },
        { jurisdiction: 'EU' }
      ];
    }
    
    return filter;
  }

  async searchSimilar(query, options = {}) {
    try {
      // Generate embedding for query
      const queryEmbedding = await this.generateEmbeddings([query]);
      
      // Search in collection
      const results = await this.collection.query({
        queryEmbeddings: queryEmbedding,
        nResults: options.topK || 5,
        where: options.filter || {}
      });
      
      // Format results
      return results.ids[0].map((id, index) => ({
        id: id,
        content: results.documents[0][index],
        metadata: results.metadatas[0][index],
        score: results.distances ? results.distances[0][index] : null
      }));
    } catch (error) {
      this.logger.error('Failed to search similar documents:', error);
      throw error;
    }
  }

  synthesizeResponse(results, requirementType) {
    // Combine relevant information from search results
    const response = {
      requirement: requirementType,
      synthesizedContent: '',
      sources: [],
      legalReferences: [],
      confidence: 0
    };
    
    // Extract and combine content
    const contents = results.map(r => r.content);
    response.synthesizedContent = this.combineContents(contents, requirementType);
    
    // Collect sources
    response.sources = [...new Set(results.map(r => ({
      documentId: r.metadata.docId,
      documentName: r.metadata.source,
      relevance: r.score
    })))];
    
    // Collect legal references
    results.forEach(r => {
      if (r.metadata.legalReferences) {
        response.legalReferences.push(...r.metadata.legalReferences);
      }
    });
    
    // Calculate confidence based on relevance scores
    response.confidence = this.calculateConfidence(results);
    
    return response;
  }

  combineContents(contents, requirementType) {
    // Simple combination for now - in production, use LLM for synthesis
    return contents.join('\n\n---\n\n');
  }

  calculateConfidence(results) {
    if (!results.length) return 0;
    
    // Average of similarity scores (converted from distance)
    const avgDistance = results.reduce((sum, r) => sum + (r.score || 0), 0) / results.length;
    
    // Convert distance to similarity (assumes cosine distance)
    return Math.max(0, 1 - avgDistance);
  }

  async updateDocument(doc) {
    try {
      // Delete old chunks
      const oldIds = await this.collection.get({
        where: { docId: doc.id }
      });
      
      if (oldIds.ids.length > 0) {
        await this.collection.delete({
          ids: oldIds.ids
        });
      }
      
      // Process and add updated document
      await this.processDocuments([doc]);
      
      this.logger.info(`Updated document ${doc.name} in vector database`);
    } catch (error) {
      this.logger.error(`Failed to update document ${doc.name}:`, error);
      throw error;
    }
  }
}

module.exports = LegalKnowledgeVectorizer;