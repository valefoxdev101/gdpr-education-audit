const { google } = require("googleapis");
const path = require("path");

class GoogleDriveConfig {
  constructor() {
    this.auth = null;
    this.drive = null;
    this.docs = null;
    this.scopes = [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/documents.readonly",
      "https://www.googleapis.com/auth/drive.metadata.readonly"
    ];
  }

  async initialize() {
    if (\!this.auth) {
      // OAuth2 client setup
      this.auth = new google.auth.OAuth2(
        process.env.GOOGLE_DRIVE_CLIENT_ID,
        process.env.GOOGLE_DRIVE_CLIENT_SECRET,
        process.env.GOOGLE_DRIVE_REDIRECT_URI
      );

      // Service account authentication for backend operations
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        const auth = new google.auth.GoogleAuth({
          keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
          scopes: this.scopes
        });
        this.serviceAuth = await auth.getClient();
      }
    }

    // Initialize Google APIs
    if (\!this.drive) {
      this.drive = google.drive({ version: "v3", auth: this.serviceAuth || this.auth });
    }
    if (\!this.docs) {
      this.docs = google.docs({ version: "v1", auth: this.serviceAuth || this.auth });
    }

    return { auth: this.auth, drive: this.drive, docs: this.docs };
  }

  generateAuthUrl() {
    return this.auth.generateAuthUrl({
      access_type: "offline",
      scope: this.scopes,
      prompt: "consent"
    });
  }

  async getTokens(code) {
    const { tokens } = await this.auth.getToken(code);
    this.auth.setCredentials(tokens);
    return tokens;
  }

  setTokens(tokens) {
    this.auth.setCredentials(tokens);
  }

  getSupportedMimeTypes() {
    return {
      GOOGLE_DOC: "application/vnd.google-apps.document",
      GOOGLE_SHEET: "application/vnd.google-apps.spreadsheet",
      GOOGLE_SLIDE: "application/vnd.google-apps.presentation",
      PDF: "application/pdf",
      WORD: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      TEXT: "text/plain"
    };
  }

  getExportFormats() {
    return {
      "application/vnd.google-apps.document": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.google-apps.spreadsheet": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.google-apps.presentation": "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    };
  }
}

module.exports = new GoogleDriveConfig();
