# GDPR Education Audit Tool

## Overview
GDPR Compliance Audit Tool for Educational Institutions with External Legal Knowledge Base for Italian DPA compliance verification.

## Features
- **Legal Knowledge Base Integration**: Real-time access to updated GDPR documentation and DPA guidelines
- **Automated Violation Detection**: AI-powered scanning of educational processes
- **Biometric Data Analysis**: Specialized checks for biometric data usage in schools
- **Compliance Reporting**: Automated generation of detailed compliance reports
- **Google Docs Integration**: Direct analysis of policy documents from Google Drive

## Architecture
The tool uses a microservices architecture with:
- External vector database for legal knowledge (Pinecone)
- Google Cloud AI services for document analysis
- OpenAI for natural language processing
- Redis for caching and job queuing

## Installation

### Prerequisites
- Node.js >= 16.0.0
- Docker and Docker Compose
- Google Cloud Service Account
- Pinecone API Key
- OpenAI API Key

### Setup
1. Clone the repository
2. Copy `.env.example` to `.env` and configure all required variables
3. Run `npm install`
4. Start services with `docker-compose up -d`
5. Run `npm start` to start the application

## Configuration
See `.env.example` for all required environment variables.

## API Documentation
- **POST /api/audit/analyze** - Analyze institution for GDPR compliance
- **GET /api/legal/search** - Search legal knowledge base
- **POST /api/audit/report** - Generate compliance report

## Services Architecture
- **LegalKnowledgeService**: Manages external legal knowledge base
- **ViolationDetectionEngine**: Detects GDPR violations
- **ComplianceAnalysisService**: Analyzes overall compliance status
- **BiometricAnalyzer**: Specialized analysis for biometric data
- **ReportGenerationService**: Generates detailed reports

## License
MIT
