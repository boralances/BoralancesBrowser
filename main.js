const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const AuthManager = require('./auth');



// DOSYA YOLU AYARI
const torPath = app.isPackaged
  ? path.join(process.resourcesPath, 'tor-files', 'tor.exe')
  : path.join(__dirname, 'bin', 'tor', 'tor.exe');

// TOR'U BAŞLATMA ÖRNEĞİ (Kendi kodunla kıyasla)
function startTor() {
  const torProcess = spawn(torPath, ['-f', path.join(path.dirname(torPath), 'torrc')], {
    detached: false
  });

  torProcess.stdout.on('data', (data) => {
    console.log(`Tor: ${data}`);
  });
}

// Initialize auth manager
const authManager = new AuthManager();

// Settings file path
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

// Global state
let loginWindow = null;
let mainWindow = null;
let currentSession = null;
let torProcess = null;
let torReady = false;

// ===== SETTINGS MANAGEMENT (MUST BE FIRST) =====

/**
 * Load settings or create default
 * @returns {Object}
 */
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

/**
 * Save settings to disk
 * @param {Object} settings
 */
function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (error) {
    console.error('Settings save error:', error);
  }
}

// Global settings - LOAD FIRST
let settings = loadSettings();

// ===== CRITICAL: APPLY TOR PROXY BEFORE APP READY =====
if (settings.mode === 'tor') {
  console.log('=== TOR MODE ENABLED (PRE-BOOT) ===');
  console.log('Applying Tor proxy: socks5://127.0.0.1:9050');
  
  // Set proxy before app is ready
  app.commandLine.appendSwitch('proxy-server', 'socks5://127.0.0.1:9050');
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND , EXCLUDE 127.0.0.1');
  
  // Disable WebRTC
  app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
  
  console.log('✓ Tor proxy configured at startup');
} else {
  console.log('=== NORMAL MODE ENABLED ===');
}

// ===== TOR MANAGEMENT =====

/**
 * Start embedded Tor process
 * @returns {Promise<void>}
 */
async function startTor() {
  return new Promise((resolve, reject) => {
    // BURADAKİ torPath TANIMINI SİLDİK, ÜSTTEKİ GLOBAL torPath'İ KULLANIYORUZ
    
    // GeoIP dosyaları için de dinamik yol tanımı:
    const torDir = path.dirname(torPath);
    const geoIpPath = path.join(torDir, 'geoip');
    const geoIPv6Path = path.join(torDir, 'geoip6');
    
    const torDataDir = path.join(app.getPath('userData'), 'tor-data');

    if (!fs.existsSync(torPath)) {
      return reject(new Error(`Tor bulunamadı: ${torPath}`));
    }

    if (!fs.existsSync(torDataDir)) {
      fs.mkdirSync(torDataDir, { recursive: true });
    }

    // Spawn Tor process
    torProcess = spawn(torPath, [
      '--SocksPort', '9050',
      '--DataDirectory', torDataDir,
      '--GeoIPFile', geoIpPath,
      '--GeoIPv6File', geoIPv6Path
    ]);

    // Track startup timeout
    const startupTimeout = setTimeout(() => {
      console.error('❌ Tor startup timeout (60s exceeded)');
      if (torProcess) {
        torProcess.kill();
      }
      reject(new Error('Tor failed to start within 60 seconds'));
    }, 60000);

    // Listen to Tor stdout for bootstrap progress
    torProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[Tor]', output.trim());

      // Check for bootstrap completion
      if (output.includes('Bootstrapped 100%')) {
        clearTimeout(startupTimeout);
        torReady = true;
        console.log('===========================================');
        console.log('✓ Tor is READY! SOCKS proxy: 127.0.0.1:9050');
        console.log('===========================================');
        resolve();
      }
    });

    // Listen to Tor stderr for errors
    torProcess.stderr.on('data', (data) => {
      const error = data.toString();
      console.error('[Tor Error]', error.trim());

      // Check for port conflict
      if (error.includes('already in use') || error.includes('bind')) {
        clearTimeout(startupTimeout);
        torProcess.kill();
        reject(new Error('Port 9050 is already in use. Another Tor instance may be running.'));
      }
    });

    // Handle Tor process errors
    torProcess.on('error', (error) => {
      clearTimeout(startupTimeout);
      console.error('Failed to start Tor process:', error);
      reject(error);
    });

    // Handle unexpected Tor exit
    torProcess.on('close', (code) => {
      console.log(`Tor process exited with code ${code}`);
      torReady = false;
      if (code !== 0 && code !== null) {
        clearTimeout(startupTimeout);
        reject(new Error(`Tor exited unexpectedly with code ${code}`));
      }
    });
  });
}

/**
 * Stop Tor process gracefully
 */
function stopTor() {
  if (torProcess) {
    console.log('Stopping Tor process...');
    torProcess.kill('SIGTERM');
    torProcess = null;
    torReady = false;
  }
}

// ===== WINDOW CREATION =====

/**
 * Create login window
 */
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

/**
 * Create main browser window (only after Tor is ready in Tor mode)
 */
async function createMainWindow() {
  // Wait for Tor if in Tor mode
  if (settings.mode === 'tor' && !torReady) {
    console.log('⏳ Waiting for Tor to be ready before creating main window...');
    return;
  }

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
      enableRemoteModule: false,
      disableBlinkFeatures: settings.mode === 'tor' ? 'WebRTC' : '',
      enableWebSQL: false
    },
    autoHideMenuBar: true,
    show: false
  });

  // Additional session-level settings for Tor
  if (settings.mode === 'tor') {
    const ses = mainWindow.webContents.session;
    
    // Block WebRTC and geolocation for privacy
    ses.setPermissionRequestHandler((webContents, permission, callback) => {
      if (['geolocation', 'media', 'mediaKeySystem'].includes(permission)) {
        console.log(`Tor Mode: Blocked permission request for ${permission}`);
        callback(false);
      } else {
        callback(true);
      }
    });

    // Clear storage on startup for privacy
    await ses.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'websql']
    });

    console.log('✓ Session privacy settings applied');
  }

  mainWindow.loadFile('index.html');

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    console.log('✓ Main window displayed');
  });

  // Save window bounds on resize
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
    await createMainWindow();
    
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
    await createMainWindow();
    
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
  
  console.log(`🔄 Switching mode from ${settings.mode} to ${newMode}`);
  
  settings.mode = newMode;
  saveSettings(settings);
  
  // Stop Tor if switching away from Tor mode
  if (newMode === 'normal' && torProcess) {
    stopTor();
  }
  
  // Restart app to apply proxy changes
  console.log('🔄 Restarting application...');
  app.relaunch();
  app.exit(0);
  
  return { success: true, mode: newMode };
});

// Check Tor connection status
ipcMain.handle('check-tor-connection', async () => {
  if (settings.mode !== 'tor') {
    return { success: true, connected: true };
  }

  return { 
    success: true, 
    connected: torReady,
    message: torReady ? 'Tor bağlantısı aktif' : 'Tor başlatılıyor...'
  };
});

// Get Tor status
ipcMain.handle('get-tor-status', async () => {
  return {
    isRunning: torProcess !== null,
    isReady: torReady,
    mode: settings.mode
  };
});

// ===== APP LIFECYCLE =====

app.whenReady().then(async () => {
  console.log('==============================================');
  console.log('🚀 BoralancesBrowser starting...');
  console.log('📋 Mode:', settings.mode.toUpperCase());
  console.log('==============================================');

  // Start Tor if in Tor mode
  if (settings.mode === 'tor') {
    try {
      console.log('🔧 Starting Tor process...');
      await startTor();
      console.log('✅ Tor is fully operational!');
    } catch (error) {
      console.error('❌ Failed to start Tor:', error.message);
      
      // Show error dialog
      const { dialog } = require('electron');
      const result = await dialog.showMessageBox({
        type: 'error',
        title: 'Tor Başlatma Hatası',
        message: 'Tor başlatılamadı',
        detail: error.message + '\n\nNormal modda devam etmek ister misiniz?',
        buttons: ['Normal Modda Devam Et', 'Çıkış'],
        defaultId: 0,
        cancelId: 1
      });

      if (result.response === 0) {
        // Switch to normal mode and restart
        console.log('⚠️ Switching to normal mode...');
        settings.mode = 'normal';
        saveSettings(settings);
        app.relaunch();
        app.exit(0);
        return;
      } else {
        app.quit();
        return;
      }
    }
  }

  // Start with login window
  console.log('📂 Opening login window...');
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

// Cleanup on quit
app.on('before-quit', () => {
  console.log('🛑 Application shutting down...');
  stopTor();
});

app.on('will-quit', () => {
  stopTor();
});

// Handle errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
});

console.log('✅ Application initialized');