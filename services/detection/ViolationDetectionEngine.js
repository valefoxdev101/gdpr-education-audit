const puppeteer = require('puppeteer');
const winston = require('winston');

class ViolationDetectionEngine {
  constructor(legalKnowledgeService) {
    this.legalKnowledge = legalKnowledgeService;
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [
        new winston.transports.File({ filename: 'violation-detection.log' })
      ]
    });
  }

  async scanPlatform(url, options = {}) {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
      // Fetch current legal requirements from knowledge base
      const requirements = await this.legalKnowledge.getLegalRequirement(
        'biometric_detection_patterns',
        { 
          platform_type: options.platformType || 'education',
          jurisdiction: 'Italy' 
        }
      );
      
      // Deep scan the platform
      const scanResults = await this.deepScan(browser, url, options);
      
      // Detect violations based on legal knowledge
      const violations = await this.detectViolations(scanResults, requirements);
      
      // Enrich violations with severity and legal references
      const enrichedViolations = await this.enrichViolations(violations);
      
      return {
        url,
        scanDate: new Date().toISOString(),
        platformType: options.platformType || 'education',
        violations: enrichedViolations,
        summary: this.generateSummary(enrichedViolations),
        legalSources: requirements.sources
      };
    } finally {
      await browser.close();
    }
  }

  async deepScan(browser, url, options) {
    const page = await browser.newPage();
    const scanResults = {
      cookies: [],
      localStorage: {},
      scripts: [],
      forms: [],
      privacyPolicy: null,
      dataProcessing: [],
      thirdPartyServices: [],
      biometricIndicators: []
    };
    
    try {
      // Set up request interception
      await page.setRequestInterception(true);
      const interceptedRequests = [];
      
      page.on('request', (request) => {
        interceptedRequests.push({
          url: request.url(),
          method: request.method(),
          headers: request.headers(),
          resourceType: request.resourceType()
        });
        request.continue();
      });
      
      // Navigate to the page
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Scan for cookies
      scanResults.cookies = await page.cookies();
      
      // Scan localStorage
      scanResults.localStorage = await page.evaluate(() => {
        const items = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          items[key] = localStorage.getItem(key);
        }
        return items;
      });
      
      // Scan for forms and input fields
      scanResults.forms = await page.evaluate(() => {
        const forms = [];
        document.querySelectorAll('form').forEach(form => {
          const inputs = [];
          form.querySelectorAll('input, select, textarea').forEach(input => {
            inputs.push({
              type: input.type || input.tagName.toLowerCase(),
              name: input.name,
              id: input.id,
              placeholder: input.placeholder,
              required: input.required,
              autocomplete: input.autocomplete
            });
          });
          forms.push({
            action: form.action,
            method: form.method,
            inputs
          });
        });
        return forms;
      });
      
      // Look for privacy policy
      const privacyLinks = await page.evaluate(() => {
        const links = [];
        document.querySelectorAll('a').forEach(link => {
          const text = link.textContent.toLowerCase();
          if (text.includes('privacy') || text.includes('data protection')) {
            links.push(link.href);
          }
        });
        return links;
      });
      
      if (privacyLinks.length > 0) {
        scanResults.privacyPolicy = privacyLinks[0];
      }
      
      // Detect biometric indicators
      scanResults.biometricIndicators = await this.detectBiometricIndicators(page, interceptedRequests);
      
      // Analyze third-party services
      scanResults.thirdPartyServices = this.analyzeThirdPartyServices(interceptedRequests);
      
      // Detect specific patterns for educational platforms
      if (options.platformType === 'education') {
        scanResults.educationFeatures = await this.detectEducationFeatures(page);
      }
      
      return scanResults;
    } catch (error) {
      this.logger.error(`Failed to scan ${url}:`, error);
      throw error;
    } finally {
      await page.close();
    }
  }

  async detectBiometricIndicators(page, requests) {
    const indicators = [];
    
    // Check for webcam access
    const hasWebcamAccess = await page.evaluate(() => {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    });
    
    if (hasWebcamAccess) {
      indicators.push({
        type: 'webcam_capability',
        description: 'Platform can access webcam'
      });
    }
    
    // Check for known proctoring services
    const proctoringServices = [
      'proctorio', 'examity', 'honorlock', 'respondus',
      'proctorexam', 'smowl', 'proctortrack'
    ];
    
    requests.forEach(req => {
      proctoringServices.forEach(service => {
        if (req.url.toLowerCase().includes(service)) {
          indicators.push({
            type: 'proctoring_service',
            service: service,
            url: req.url
          });
        }
      });
    });
    
    // Check page content for biometric keywords
    const biometricKeywords = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      const keywords = [
        'facial recognition', 'face detection', 'emotion detection',
        'eye tracking', 'gaze detection', 'biometric', 'proctoring',
        'identity verification', 'liveness detection'
      ];
      
      return keywords.filter(keyword => text.includes(keyword));
    });
    
    if (biometricKeywords.length > 0) {
      indicators.push({
        type: 'biometric_keywords',
        keywords: biometricKeywords
      });
    }
    
    // Check for canvas fingerprinting
    const hasCanvasFingerprinting = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      return !!(ctx && typeof ctx.getImageData === 'function');
    });
    
    if (hasCanvasFingerprinting) {
      indicators.push({
        type: 'canvas_fingerprinting',
        description: 'Potential device fingerprinting capability'
      });
    }
    
    return indicators;
  }

  analyzeThirdPartyServices(requests) {
    const services = new Map();
    
    const knownServices = {
      'google-analytics.com': 'Google Analytics',
      'googletagmanager.com': 'Google Tag Manager',
      'facebook.com': 'Facebook',
      'doubleclick.net': 'Google Ads',
      'youtube.com': 'YouTube',
      'vimeo.com': 'Vimeo',
      'zoom.us': 'Zoom',
      'teams.microsoft.com': 'Microsoft Teams'
    };
    
    requests.forEach(req => {
      Object.entries(knownServices).forEach(([domain, service]) => {
        if (req.url.includes(domain)) {
          if (!services.has(service)) {
            services.set(service, []);
          }
          services.get(service).push(req.url);
        }
      });
    });
    
    return Array.from(services.entries()).map(([service, urls]) => ({
      service,
      urls: [...new Set(urls)].slice(0, 3) // Limit to 3 examples
    }));
  }

  async detectEducationFeatures(page) {
    const features = {
      hasExams: false,
      hasVideoConferencing: false,
      hasStudentProfiles: false,
      hasGrading: false,
      collectsMinorData: false
    };
    
    const pageText = await page.evaluate(() => document.body.innerText.toLowerCase());
    
    // Detect exam/test features
    const examKeywords = ['exam', 'test', 'quiz', 'assessment', 'proctoring'];
    features.hasExams = examKeywords.some(keyword => pageText.includes(keyword));
    
    // Detect video conferencing
    const videoKeywords = ['video', 'webcam', 'conference', 'meeting', 'lecture'];
    features.hasVideoConferencing = videoKeywords.some(keyword => pageText.includes(keyword));
    
    // Detect student profiles
    const profileKeywords = ['profile', 'student', 'learner', 'account'];
    features.hasStudentProfiles = profileKeywords.some(keyword => pageText.includes(keyword));
    
    // Detect grading
    const gradingKeywords = ['grade', 'score', 'marks', 'evaluation'];
    features.hasGrading = gradingKeywords.some(keyword => pageText.includes(keyword));
    
    // Check for age-related fields
    const ageFields = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input');
      return Array.from(inputs).some(input => 
        input.name?.toLowerCase().includes('age') ||
        input.name?.toLowerCase().includes('birth') ||
        input.placeholder?.toLowerCase().includes('age') ||
        input.placeholder?.toLowerCase().includes('birth')
      );
    });
    
    features.collectsMinorData = ageFields || pageText.includes('minor') || pageText.includes('parent');
    
    return features;
  }

  async detectViolations(scanResults, requirements) {
    const violations = [];
    
    // Check for biometric data processing without proper consent
    if (scanResults.biometricIndicators.length > 0) {
      const biometricViolations = await this.checkBiometricCompliance(
        scanResults.biometricIndicators,
        scanResults
      );
      violations.push(...biometricViolations);
    }
    
    // Check for cookie compliance
    const cookieViolations = this.checkCookieCompliance(scanResults.cookies);
    violations.push(...cookieViolations);
    
    // Check for third-party data sharing
    const thirdPartyViolations = this.checkThirdPartyCompliance(
      scanResults.thirdPartyServices
    );
    violations.push(...thirdPartyViolations);
    
    // Check education-specific requirements
    if (scanResults.educationFeatures) {
      const educationViolations = await this.checkEducationCompliance(
        scanResults.educationFeatures,
        scanResults
      );
      violations.push(...educationViolations);
    }
    
    return violations;
  }

  async checkBiometricCompliance(indicators, scanResults) {
    const violations = [];
    
    // Check each biometric indicator against legal requirements
    for (const indicator of indicators) {
      if (indicator.type === 'proctoring_service') {
        violations.push({
          type: 'unauthorized_biometric_processing',
          severity: 'critical',
          description: `Proctoring service detected (${indicator.service}) without explicit consent mechanism`,
          evidence: indicator,
          affectsMinors: scanResults.educationFeatures?.collectsMinorData || false
        });
      }
      
      if (indicator.type === 'webcam_capability' && !scanResults.privacyPolicy) {
        violations.push({
          type: 'missing_privacy_policy',
          severity: 'high',
          description: 'Webcam access capability without accessible privacy policy',
          evidence: indicator
        });
      }
    }
    
    return violations;
  }

  checkCookieCompliance(cookies) {
    const violations = [];
    
    // Check for non-essential cookies without consent
    const nonEssentialCookies = cookies.filter(cookie => 
      !this.isEssentialCookie(cookie.name)
    );
    
    if (nonEssentialCookies.length > 0) {
      violations.push({
        type: 'cookie_consent_violation',
        severity: 'medium',
        description: `${nonEssentialCookies.length} non-essential cookies set without explicit consent`,
        evidence: nonEssentialCookies.map(c => c.name)
      });
    }
    
    return violations;
  }

  isEssentialCookie(name) {
    const essentialPatterns = [
      'session', 'csrf', 'auth', 'security'
    ];
    
    return essentialPatterns.some(pattern => 
      name.toLowerCase().includes(pattern)
    );
  }

  checkThirdPartyCompliance(services) {
    const violations = [];
    
    const riskyServices = ['Google Analytics', 'Facebook', 'Google Ads'];
    
    services.forEach(service => {
      if (riskyServices.includes(service.service)) {
        violations.push({
          type: 'unauthorized_data_transfer',
          severity: 'high',
          description: `Data potentially transferred to ${service.service} without explicit consent`,
          evidence: service
        });
      }
    });
    
    return violations;
  }

  async checkEducationCompliance(features, scanResults) {
    const violations = [];
    
    if (features.collectsMinorData && features.hasExams) {
      const minorRequirements = await this.legalKnowledge.getLegalRequirement(
        'minor_protection_requirements',
        { context: 'online_exams' }
      );
      
      violations.push({
        type: 'minor_data_processing',
        severity: 'critical',
        description: 'Processing minor data in exam context without parental consent mechanism',
        legalRequirement: minorRequirements.synthesizedContent
      });
    }
    
    return violations;
  }

  async enrichViolations(violations) {
    const enriched = [];
    
    for (const violation of violations) {
      // Get severity assessment from knowledge base
      const severity = await this.legalKnowledge.getLegalRequirement(
        'violation_severity',
        { 
          violation_type: violation.type,
          affects_minors: violation.affectsMinors || false
        }
      );
      
      // Get relevant precedents
      const precedents = await this.legalKnowledge.searchLegalPrecedents(
        violation.type,
        { jurisdiction: 'Italy' }
      );
      
      enriched.push({
        ...violation,
        severityDetails: severity,
        precedents: precedents.slice(0, 3),
        remediationRequired: this.getRemediationRequirements(violation.type)
      });
    }
    
    return enriched;
  }

  getRemediationRequirements(violationType) {
    const remediationMap = {
      'unauthorized_biometric_processing': {
        timeline: '30 days',
        actions: [
          'Cease biometric data processing immediately',
          'Delete all collected biometric data',
          'Implement explicit consent mechanism',
          'Update privacy policy'
        ]
      },
      'missing_privacy_policy': {
        timeline: '14 days',
        actions: [
          'Create comprehensive privacy policy',
          'Make privacy policy easily accessible',
          'Include all required GDPR information'
        ]
      },
      'cookie_consent_violation': {
        timeline: '7 days',
        actions: [
          'Implement cookie consent banner',
          'Allow granular consent choices',
          'Block non-essential cookies by default'
        ]
      },
      'unauthorized_data_transfer': {
        timeline: '30 days',
        actions: [
          'Document all data transfers',
          'Implement appropriate safeguards',
          'Obtain explicit consent for transfers'
        ]
      },
      'minor_data_processing': {
        timeline: 'Immediate',
        actions: [
          'Implement age verification',
          'Add parental consent mechanism',
          'Create child-friendly privacy notice'
        ]
      }
    };
    
    return remediationMap[violationType] || {
      timeline: '30 days',
      actions: ['Review and remediate violation']
    };
  }

  generateSummary(violations) {
    const summary = {
      totalViolations: violations.length,
      criticalViolations: violations.filter(v => v.severity === 'critical').length,
      highViolations: violations.filter(v => v.severity === 'high').length,
      mediumViolations: violations.filter(v => v.severity === 'medium').length,
      affectsMinors: violations.some(v => v.affectsMinors),
      estimatedFineRange: this.estimateFineRange(violations),
      complianceScore: this.calculateComplianceScore(violations)
    };
    
    return summary;
  }

  estimateFineRange(violations) {
    // Simplified estimation - in production, use legal knowledge base
    const baseFines = {
      critical: { min: 100000, max: 500000 },
      high: { min: 50000, max: 200000 },
      medium: { min: 10000, max: 50000 }
    };
    
    let minTotal = 0;
    let maxTotal = 0;
    
    violations.forEach(v => {
      const range = baseFines[v.severity] || baseFines.medium;
      minTotal += range.min;
      maxTotal += range.max;
    });
    
    return { min: minTotal, max: maxTotal };
  }

  calculateComplianceScore(violations) {
    // Simple scoring system (0-100)
    const baseScore = 100;
    const penalties = {
      critical: 25,
      high: 15,
      medium: 5
    };
    
    let score = baseScore;
    
    violations.forEach(v => {
      score -= penalties[v.severity] || 5;
    });
    
    return Math.max(0, score);
  }
}

module.exports = ViolationDetectionEngine;