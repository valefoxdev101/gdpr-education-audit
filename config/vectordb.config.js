const { Pinecone } = require("@pinecone-database/pinecone");

class VectorDBConfig {
  constructor() {
    this.pinecone = null;
    this.indexName = process.env.PINECONE_INDEX_NAME || "legal-knowledge";
  }

  async initialize() {
    if (\!this.pinecone) {
      this.pinecone = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY,
        environment: process.env.PINECONE_ENVIRONMENT
      });
    }
    return this.pinecone;
  }

  async getIndex() {
    const pc = await this.initialize();
    return pc.index(this.indexName);
  }

  getEmbeddingDimension() {
    // OpenAI text-embedding-ada-002 dimension
    return 1536;
  }

  getNamespaces() {
    return {
      GDPR_ARTICLES: "gdpr-articles",
      DPA_GUIDELINES: "dpa-guidelines",
      EDUCATION_POLICIES: "education-policies",
      CASE_LAW: "case-law",
      BIOMETRIC_RULES: "biometric-rules"
    };
  }

  getMetadataSchema() {
    return {
      source: "string", // Document source
      type: "string", // Document type (article, guideline, policy, etc.)
      language: "string", // Document language
      date: "string", // Publication/update date
      authority: "string", // Issuing authority
      keywords: "array", // Relevant keywords
      section: "string", // Section/chapter reference
      relevance_score: "number" // Relevance score for ranking
    };
  }
}

module.exports = new VectorDBConfig();
