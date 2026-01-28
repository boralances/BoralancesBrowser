const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { BrowserWindow } = require('electron');

const USERS_FILE = path.join(__dirname, 'users.json');
const SALT_ROUNDS = 10;

// Google OAuth Configuration (Free tier - no paid services)
const GOOGLE_OAUTH = {
  clientId: '535447868577-4o4sbsrhptttdjb0v2okoe14kuor2085.apps.googleusercontent.com', // User must configure this
  redirectUri: 'http://localhost:3000/auth/callback',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scope: 'openid profile email'
};

class AuthManager {
  constructor() {
    this.initUsersFile();
  }

  // Initialize users file if it doesn't exist
  initUsersFile() {
    if (!fs.existsSync(USERS_FILE)) {
      const defaultUsers = {
        users: [],
        sessions: {}
      };
      fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
    }
  }

  // Load users from file
  loadUsers() {
    try {
      const data = fs.readFileSync(USERS_FILE, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading users:', error);
      return { users: [], sessions: {} };
    }
  }

  // Save users to file
  saveUsers(data) {
    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error('Error saving users:', error);
      return false;
    }
  }

  // Register new local user
  async registerUser(username, password, email) {
    const data = this.loadUsers();
    
    // Check if username already exists
    if (data.users.find(u => u.username === username)) {
      throw new Error('Kullanıcı adı zaten kullanımda');
    }

    // Check if email already exists
    if (data.users.find(u => u.email === email)) {
      throw new Error('E-posta adresi zaten kullanımda');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user
    const user = {
      id: Date.now().toString(),
      username,
      email,
      password: hashedPassword,
      createdAt: new Date().toISOString(),
      type: 'local'
    };

    data.users.push(user);
    this.saveUsers(data);

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      type: user.type
    };
  }

  // Login with local credentials
  async loginLocal(username, password) {
    const data = this.loadUsers();
    const user = data.users.find(u => u.username === username && u.type === 'local');

    if (!user) {
      throw new Error('Kullanıcı bulunamadı');
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      throw new Error('Hatalı şifre');
    }

    // Create session
    const sessionId = this.createSession(user.id);

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      type: user.type,
      sessionId
    };
  }

  // Login with Google OAuth
  async loginGoogle(parentWindow) {
    return new Promise((resolve, reject) => {
      // Create OAuth window
      const authWindow = new BrowserWindow({
        width: 500,
        height: 600,
        parent: parentWindow,
        modal: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      // Build OAuth URL
      const authUrl = `${GOOGLE_OAUTH.authUrl}?client_id=${GOOGLE_OAUTH.clientId}&redirect_uri=${encodeURIComponent(GOOGLE_OAUTH.redirectUri)}&response_type=code&scope=${encodeURIComponent(GOOGLE_OAUTH.scope)}`;

      authWindow.loadURL(authUrl);

      // Handle redirect
      authWindow.webContents.on('will-redirect', async (event, url) => {
        if (url.startsWith(GOOGLE_OAUTH.redirectUri)) {
          const urlParams = new URL(url).searchParams;
          const code = urlParams.get('code');

          if (code) {
            try {
              // Exchange code for token (simplified - in production use proper OAuth library)
              const userInfo = await this.exchangeCodeForToken(code);
              
              // Check if user exists, create if not
              let user = this.findOrCreateGoogleUser(userInfo);
              
              // Create session
              const sessionId = this.createSession(user.id);

              authWindow.close();
              resolve({
                id: user.id,
                username: user.username,
                email: user.email,
                type: user.type,
                sessionId
              });
            } catch (error) {
              authWindow.close();
              reject(error);
            }
          }
        }
      });

      authWindow.on('closed', () => {
        reject(new Error('Google giriş penceresi kapatıldı'));
      });
    });
  }

  // Exchange OAuth code for user info (simplified)
  async exchangeCodeForToken(code) {
    // NOTE: In production, this should use proper OAuth flow with token exchange
    // For this implementation, we'll simulate it
    // User needs to configure Google OAuth credentials in Google Cloud Console
    return {
      id: 'google_' + Date.now(),
      email: 'user@gmail.com',
      name: 'Google User'
    };
  }

  // Find or create Google user
  findOrCreateGoogleUser(userInfo) {
    const data = this.loadUsers();
    let user = data.users.find(u => u.email === userInfo.email && u.type === 'google');

    if (!user) {
      user = {
        id: userInfo.id,
        username: userInfo.name,
        email: userInfo.email,
        type: 'google',
        createdAt: new Date().toISOString()
      };
      data.users.push(user);
      this.saveUsers(data);
    }

    return user;
  }

  // Create session
  createSession(userId) {
    const data = this.loadUsers();
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    
    data.sessions[sessionId] = {
      userId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
    };

    this.saveUsers(data);
    return sessionId;
  }

  // Validate session
  validateSession(sessionId) {
    const data = this.loadUsers();
    const session = data.sessions[sessionId];

    if (!session) {
      return null;
    }

    // Check if expired
    if (new Date(session.expiresAt) < new Date()) {
      delete data.sessions[sessionId];
      this.saveUsers(data);
      return null;
    }

    // Get user
    const user = data.users.find(u => u.id === session.userId);
    if (!user) {
      return null;
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      type: user.type
    };
  }

  // Logout
  logout(sessionId) {
    const data = this.loadUsers();
    delete data.sessions[sessionId];
    this.saveUsers(data);
  }

  // Get all users (for admin purposes)
  getAllUsers() {
    const data = this.loadUsers();
    return data.users.map(u => ({
      id: u.id,
      username: u.username,
      email: u.email,
      type: u.type,
      createdAt: u.createdAt
    }));
  }
}

module.exports = AuthManager;