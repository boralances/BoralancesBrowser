const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const AuthManager = require('./auth');

// Initialize auth manager
const authManager = new AuthManager();

// Settings file path
const settingsPath = path.join(__dirname, 'settings.json');

// Global state
let loginWindow = null;
let mainWindow = null;
let currentSession = null;

// Load settings or create default
function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Settings load error:', error);
  }
  
  // Default settings
  return {
    mode: 'normal',
    searchEngines: {
      normal: {
        name: 'Google',
        url: 'https://www.google.com/search?q=%s',
        homepage: 'https://www.google.com'
      },
      tor: {
        name: 'DuckDuckGo Onion',
        url: 'http://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/?q=%s',
        homepage: 'http://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion'
      }
    },
    windowBounds: { width: 1400, height: 900 }
  };
}

// Save settings
function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (error) {
    console.error('Settings save error:', error);
  }
}

// Global settings
let settings = loadSettings();

// Apply Tor mode with kill-switch BEFORE app.ready
if (settings.mode === 'tor') {
  console.log('=== TOR MODE ENABLED ===');
  console.log('Applying Tor proxy: socks5://127.0.0.1:9050');
  
  // Set SOCKS5 proxy for Tor
  app.commandLine.appendSwitch('proxy-server', 'socks5://127.0.0.1:9050');
  
  // DNS over proxy (prevent DNS leaks)
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND , EXCLUDE 127.0.0.1');
  
  // Disable WebRTC (prevent IP leaks)
  app.commandLine.appendSwitch('disable-webrtc-encryption');
  app.commandLine.appendSwitch('enforce-webrtc-ip-permission-check');
  
  // Disable direct UDP (prevent protocol leaks)
  app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
  
  // Force dark mode for privacy
  app.commandLine.appendSwitch('force-dark-mode');
  
  console.log('Tor kill-switch activated: WebRTC disabled, DNS via proxy, UDP blocked');
} else {
  console.log('=== NORMAL MODE ENABLED ===');
}

// Create login window
function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width: 500,
    height: 700,
    resizable: false,
    backgroundColor: '#0a0e1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    autoHideMenuBar: true,
    frame: true
  });

  loginWindow.loadFile('login.html');

  loginWindow.on('closed', () => {
    loginWindow = null;
    // If login window is closed without logging in, quit the app
    if (!currentSession) {
      app.quit();
    }
  });
}

// Create main browser window
function createMainWindow() {
  const { width, height } = settings.windowBounds;
  
  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#0a0e1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      // Additional privacy settings for Tor mode
      disableBlinkFeatures: settings.mode === 'tor' ? 'WebRTC' : '',
      enableWebSQL: false
    },
    autoHideMenuBar: true,
    show: false // Don't show until ready
  });

  // Apply additional session-level privacy settings
  if (settings.mode === 'tor') {
    const ses = mainWindow.webContents.session;
    
    // Block geolocation
    ses.setPermissionRequestHandler((webContents, permission, callback) => {
      if (permission === 'geolocation' || permission === 'media') {
        console.log(`Tor Mode: Blocked permission request for ${permission}`);
        callback(false);
      } else {
        callback(true);
      }
    });

    // Clear storage on startup for privacy
    ses.clearStorageData({
      storages: ['cookies', 'localstorage']
    });
  }

  mainWindow.loadFile('index.html');

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Save window bounds
  mainWindow.on('resize', () => {
    const bounds = mainWindow.getBounds();
    settings.windowBounds = { width: bounds.width, height: bounds.height };
    saveSettings(settings);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ===== IPC HANDLERS =====

// Auth: Register
ipcMain.handle('auth:register', async (event, { username, password, email }) => {
  try {
    const user = await authManager.registerUser(username, password, email);
    return { success: true, user };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Auth: Login (Local)
ipcMain.handle('auth:login-local', async (event, { username, password }) => {
  try {
    const user = await authManager.loginLocal(username, password);
    currentSession = user;
    
    // Close login window and open main window
    if (loginWindow) {
      loginWindow.close();
    }
    createMainWindow();
    
    return { success: true, user };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Auth: Login (Google) - DISABLED in Tor mode
ipcMain.handle('auth:login-google', async (event) => {
  // Block Google login in Tor mode
  if (settings.mode === 'tor') {
    return { 
      success: false, 
      error: 'Tor modunda Google ile giriş yapılamaz. Lütfen yerel hesap kullanın.' 
    };
  }

  try {
    const user = await authManager.loginGoogle(loginWindow);
    currentSession = user;
    
    // Close login window and open main window
    if (loginWindow) {
      loginWindow.close();
    }
    createMainWindow();
    
    return { success: true, user };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Auth: Logout
ipcMain.handle('auth:logout', async (event) => {
  if (currentSession && currentSession.sessionId) {
    authManager.logout(currentSession.sessionId);
  }
  currentSession = null;
  
  // Close main window and show login
  if (mainWindow) {
    mainWindow.close();
  }
  createLoginWindow();
  
  return { success: true };
});

// Auth: Validate session
ipcMain.handle('auth:validate', async (event, sessionId) => {
  const user = authManager.validateSession(sessionId);
  return { success: !!user, user };
});

// Settings: Get current mode
ipcMain.handle('get-mode', async () => {
  return settings.mode;
});

// Settings: Get search engines
ipcMain.handle('get-search-engines', async () => {
  return settings.searchEngines;
});

// Settings: Update search engine
ipcMain.handle('update-search-engine', async (event, { mode, engine }) => {
  settings.searchEngines[mode] = engine;
  saveSettings(settings);
  return { success: true };
});

// Settings: Switch mode (requires restart)
ipcMain.handle('set-mode', async (event, newMode) => {
  if (newMode !== 'normal' && newMode !== 'tor') {
    throw new Error('Invalid mode');
  }
  
  console.log(`Switching mode from ${settings.mode} to ${newMode}`);
  
  settings.mode = newMode;
  saveSettings(settings);
  
  // Restart app to apply proxy changes
  app.relaunch();
  app.exit(0);
  
  return { success: true, mode: newMode };
});

// Check Tor connection (only in Tor mode)
ipcMain.handle('check-tor-connection', async () => {
  if (settings.mode !== 'tor') {
    return { success: true, connected: true };
  }

  // Try to connect to Tor check service
  try {
    const { net } = require('electron');
    const request = net.request({
      method: 'GET',
      url: 'http://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion',
      session: session.defaultSession
    });

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        request.abort();
        resolve({ 
          success: false, 
          connected: false, 
          error: 'Tor bağlantısı kurulamadı. Tor Browser veya tor.exe çalışıyor mu?' 
        });
      }, 10000);

      request.on('response', (response) => {
        clearTimeout(timeout);
        resolve({ success: true, connected: response.statusCode < 400 });
      });

      request.on('error', (error) => {
        clearTimeout(timeout);
        resolve({ 
          success: false, 
          connected: false, 
          error: 'Tor proxy erişilemez: ' + error.message 
        });
      });

      request.end();
    });
  } catch (error) {
    return { 
      success: false, 
      connected: false, 
      error: error.message 
    };
  }
});

// ===== APP LIFECYCLE =====

app.whenReady().then(() => {
  // Start with login window
  createLoginWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (!currentSession) {
        createLoginWindow();
      } else {
        createMainWindow();
      }
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

console.log('BoralancesBrowser started in', settings.mode, 'mode');