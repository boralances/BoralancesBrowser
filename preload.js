const { contextBridge, ipcRenderer } = require('electron');

// Expose secure API to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // ===== AUTHENTICATION =====
  auth: {
    register: async (username, password, email) => {
      return await ipcRenderer.invoke('auth:register', { username, password, email });
    },
    loginLocal: async (username, password) => {
      return await ipcRenderer.invoke('auth:login-local', { username, password });
    },
    loginGoogle: async () => {
      return await ipcRenderer.invoke('auth:login-google');
    },
    logout: async () => {
      return await ipcRenderer.invoke('auth:logout');
    },
    validate: async (sessionId) => {
      return await ipcRenderer.invoke('auth:validate', sessionId);
    }
  },

  // ===== SETTINGS =====
  getMode: async () => {
    return await ipcRenderer.invoke('get-mode');
  },
  
  switchMode: async (mode) => {
    return await ipcRenderer.invoke('set-mode', mode);
  },

  getSearchEngines: async () => {
    return await ipcRenderer.invoke('get-search-engines');
  },

  updateSearchEngine: async (mode, engine) => {
    return await ipcRenderer.invoke('update-search-engine', { mode, engine });
  },

  // ===== TOR CONNECTION CHECK =====
  checkTorConnection: async () => {
    return await ipcRenderer.invoke('check-tor-connection');
  }
});

console.log('Preload script loaded - API exposed securely');