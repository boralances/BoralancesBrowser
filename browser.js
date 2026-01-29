// BoralancesBrowser - Main Browser Logic
// Real multi-tab system with independent webviews

class BrowserTab {
    constructor(id, homepage = null) {
        this.id = id;
        this.title = 'Yeni Sekme';
        this.url = '';
        this.webview = null;
        this.tabElement = null;
        this.contentElement = null;
        this.history = { canGoBack: false, canGoForward: false };
        this.homepage = homepage;
    }

    createTabElement() {
        const tab = document.createElement('div');
        tab.className = 'tab';
        tab.dataset.tabId = this.id;
        tab.innerHTML = `
            <span class="tab-title">${this.title}</span>
            <button class="tab-close" data-tab-id="${this.id}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        `;
        
        this.tabElement = tab;
        return tab;
    }

    createContentElement() {
        const content = document.createElement('div');
        content.className = 'tab-content';
        content.dataset.tabId = this.id;

        const webview = document.createElement('webview');
        webview.className = 'webview';
        webview.setAttribute('partition', 'persist:main');
        webview.setAttribute('allowpopups', '');
        
        // Direkt homepage'i yükle
        if (this.homepage) {
            webview.src = this.homepage;
        }
        
        content.appendChild(webview);
        this.webview = webview;
        this.setupWebviewListeners();

        this.contentElement = content;
        return content;
    }

    setupWebviewListeners() {
        if (!this.webview) return;

        this.webview.addEventListener('did-start-loading', () => {
            browser.updateStatus('Yükleniyor...', this.id);
        });

        this.webview.addEventListener('did-stop-loading', () => {
            this.history.canGoBack = this.webview.canGoBack();
            this.history.canGoForward = this.webview.canGoForward();
            if (browser.activeTabId === this.id) {
                browser.updateNavigationButtons();
            }
        });

        this.webview.addEventListener('did-finish-load', () => {
            this.url = this.webview.getURL();
            this.title = this.webview.getTitle() || this.url;
            this.updateTabTitle();
            if (browser.activeTabId === this.id) {
                browser.updateStatus(this.url, this.id);
                browser.updateAddressBar(this.url);
                browser.updateSecurityIndicator(this.url);
            }
        });

        this.webview.addEventListener('did-fail-load', (event) => {
            if (event.errorCode !== -3) {
                console.error('Load failed:', event.errorDescription);
                browser.updateStatus('Yükleme başarısız', this.id);
            }
        });

        this.webview.addEventListener('page-title-updated', (event) => {
            this.title = event.title || this.url;
            this.updateTabTitle();
        });

        this.webview.addEventListener('new-window', (event) => {
            this.loadURL(event.url);
        });
    }

    loadURL(url) {
        if (!this.webview) return;
        this.url = url;
        this.webview.loadURL(url);
    }

    updateTabTitle() {
        if (this.tabElement) {
            const titleSpan = this.tabElement.querySelector('.tab-title');
            if (titleSpan) {
                titleSpan.textContent = this.title.length > 25 ? this.title.substring(0, 25) + '...' : this.title;
            }
        }
    }

    goBack() {
        if (this.webview && this.webview.canGoBack()) {
            this.webview.goBack();
        }
    }

    goForward() {
        if (this.webview && this.webview.canGoForward()) {
            this.webview.goForward();
        }
    }

    reload() {
        if (this.webview) {
            this.webview.reload();
        }
    }

    destroy() {
        if (this.webview) {
            this.webview.remove();
        }
        if (this.tabElement) {
            this.tabElement.remove();
        }
        if (this.contentElement) {
            this.contentElement.remove();
        }
    }
}

class Browser {
    constructor() {
        this.tabs = new Map();
        this.activeTabId = null;
        this.nextTabId = 1;
        this.currentMode = 'normal';
        this.searchEngines = null;
        
        this.initElements();
        this.init();
    }

    initElements() {
        this.searchInput = document.getElementById('searchInput');
        this.clearBtn = document.getElementById('clearBtn');
        this.backBtn = document.getElementById('backBtn');
        this.forwardBtn = document.getElementById('forwardBtn');
        this.refreshBtn = document.getElementById('refreshBtn');
        this.homeBtn = document.getElementById('homeBtn');
        this.newTabBtn = document.getElementById('newTabBtn');
        this.tabsContainer = document.getElementById('tabsContainer');
        this.contentArea = document.getElementById('contentArea');
        this.modeToggle = document.getElementById('modeToggle');
        this.modeIndicator = document.getElementById('modeIndicator');
        this.modeText = document.getElementById('modeText');
        this.statusMode = document.getElementById('statusMode');
        this.statusUrl = document.getElementById('statusUrl');
        this.statusSecurity = document.getElementById('statusSecurity');
        this.modeNotification = document.getElementById('modeNotification');
        this.notificationText = document.getElementById('notificationText');
        this.torError = document.getElementById('torError');
        this.logoutBtn = document.getElementById('logoutBtn');
    }

    async init() {
        await this.loadSettings();
        this.updateModeUI(false);
        this.updateSearchPlaceholder();
        this.setupEventListeners();
        await this.checkTorConnection();
        
        // İlk sekmeyi homepage ile oluştur
        const homepage = this.searchEngines[this.currentMode].homepage;
        console.log('Opening homepage:', homepage);
        this.createTab(homepage);
    }

    async loadSettings() {
        this.currentMode = await window.electronAPI.getMode();
        this.searchEngines = await window.electronAPI.getSearchEngines();
        console.log('Current mode:', this.currentMode);
        console.log('Search engines:', this.searchEngines);
    }

    updateSearchPlaceholder() {
        const currentEngine = this.searchEngines[this.currentMode];
        if (currentEngine && this.searchInput) {
            this.searchInput.placeholder = `${currentEngine.name}'da ara veya URL girin...`;
        }
    }

    async checkTorConnection() {
        if (this.currentMode === 'tor') {
            const result = await window.electronAPI.checkTorConnection();
            if (!result.success || !result.connected) {
                this.showTorError(result.error || 'Tor bağlantısı kurulamadı');
            }
        }
    }

    showTorError(message) {
        document.getElementById('torErrorMessage').textContent = message;
        this.torError.style.display = 'flex';
    }

    hideTorError() {
        this.torError.style.display = 'none';
    }

    setupEventListeners() {
        // Search input
        this.searchInput.addEventListener('input', (e) => {
            this.clearBtn.style.display = e.target.value ? 'flex' : 'none';
        });

        this.searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleSearch(this.searchInput.value.trim());
            }
        });

        this.clearBtn.addEventListener('click', () => {
            this.searchInput.value = '';
            this.clearBtn.style.display = 'none';
            this.searchInput.focus();
        });

        // Navigation buttons
        this.backBtn.addEventListener('click', () => this.goBack());
        this.forwardBtn.addEventListener('click', () => this.goForward());
        this.refreshBtn.addEventListener('click', () => this.reload());
        this.homeBtn.addEventListener('click', () => this.goHome());

        // New tab - yeni sekme de homepage ile açılsın
        this.newTabBtn.addEventListener('click', () => {
            const homepage = this.searchEngines[this.currentMode].homepage;
            this.createTab(homepage);
        });

        // Mode toggle
        this.modeToggle.addEventListener('click', () => this.switchMode());

        // Logout
        this.logoutBtn.addEventListener('click', () => this.logout());

        // Retry Tor connection
        document.getElementById('retryTorBtn')?.addEventListener('click', async () => {
            this.hideTorError();
            await this.checkTorConnection();
        });
    }

    createTab(url = null) {
        const id = this.nextTabId++;
        
        // Eğer URL verilmemişse, homepage kullan
        if (!url) {
            url = this.searchEngines[this.currentMode].homepage;
        }
        
        const tab = new BrowserTab(id, url);
        
        // Create and add tab element
        const tabElement = tab.createTabElement();
        this.tabsContainer.appendChild(tabElement);
        
        // Create and add content element
        const contentElement = tab.createContentElement();
        this.contentArea.appendChild(contentElement);
        
        // Setup tab click
        tabElement.addEventListener('click', (e) => {
            if (!e.target.closest('.tab-close')) {
                this.switchTab(id);
            }
        });
        
        // Setup tab close
        const closeBtn = tabElement.querySelector('.tab-close');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeTab(id);
        });
        
        this.tabs.set(id, tab);
        this.switchTab(id);
        
        return id;
    }

    switchTab(id) {
        if (this.activeTabId === id) return;

        // Deactivate current tab
        if (this.activeTabId) {
            const currentTab = this.tabs.get(this.activeTabId);
            if (currentTab) {
                currentTab.tabElement.classList.remove('active');
                currentTab.contentElement.classList.remove('active');
            }
        }

        // Activate new tab
        const newTab = this.tabs.get(id);
        if (newTab) {
            newTab.tabElement.classList.add('active');
            newTab.contentElement.classList.add('active');
            this.activeTabId = id;

            // Update UI
            this.updateAddressBar(newTab.url);
            this.updateStatus(newTab.url || 'BoralancesBrowser', id);
            this.updateNavigationButtons();
            this.updateSecurityIndicator(newTab.url);
            
            this.searchInput.focus();
        }
    }

    closeTab(id) {
        const tab = this.tabs.get(id);
        if (!tab) return;

        // Don't close last tab
        if (this.tabs.size === 1) {
            return;
        }

        // Find next tab to activate
        let nextTabId = null;
        const tabIds = Array.from(this.tabs.keys());
        const currentIndex = tabIds.indexOf(id);
        
        if (currentIndex > 0) {
            nextTabId = tabIds[currentIndex - 1];
        } else if (currentIndex < tabIds.length - 1) {
            nextTabId = tabIds[currentIndex + 1];
        }

        // Destroy tab
        tab.destroy();
        this.tabs.delete(id);

        // Switch to next tab if this was active
        if (this.activeTabId === id && nextTabId) {
            this.switchTab(nextTabId);
        }
    }

    handleSearch(query) {
        if (!query) return;

        let url = query;

        // Check if it's a URL or search query
        if (query.startsWith('http://') || query.startsWith('https://')) {
            url = query;
        } else if (query.includes('.') && !query.includes(' ')) {
            // Check if it's .onion for Tor mode
            if (query.endsWith('.onion')) {
                url = 'http://' + query;
            } else {
                url = 'https://' + query;
            }
        } else {
            // It's a search query - use appropriate search engine
            const engine = this.searchEngines[this.currentMode];
            if (engine && engine.url) {
                url = engine.url.replace('%s', encodeURIComponent(query));
                console.log('Search URL:', url);
            }
        }

        this.loadURL(url);
    }

    loadURL(url, tabId = null) {
        const id = tabId || this.activeTabId;
        const tab = this.tabs.get(id);
        if (tab) {
            tab.loadURL(url);
            this.hideTorError();
        }
    }

    goBack() {
        const tab = this.tabs.get(this.activeTabId);
        if (tab) tab.goBack();
    }

    goForward() {
        const tab = this.tabs.get(this.activeTabId);
        if (tab) tab.goForward();
    }

    reload() {
        const tab = this.tabs.get(this.activeTabId);
        if (tab) tab.reload();
    }

    goHome() {
        const tab = this.tabs.get(this.activeTabId);
        if (tab && this.searchEngines) {
            const homepage = this.searchEngines[this.currentMode].homepage;
            console.log('Going home:', homepage);
            tab.loadURL(homepage);
        }
    }

    updateAddressBar(url) {
        this.searchInput.value = url || '';
        this.clearBtn.style.display = url ? 'flex' : 'none';
    }

    updateStatus(text, tabId) {
        if (tabId === this.activeTabId) {
            this.statusUrl.textContent = text;
        }
    }

    updateNavigationButtons() {
        const tab = this.tabs.get(this.activeTabId);
        if (tab) {
            this.backBtn.disabled = !tab.history.canGoBack;
            this.forwardBtn.disabled = !tab.history.canGoForward;
        } else {
            this.backBtn.disabled = true;
            this.forwardBtn.disabled = true;
        }
    }

    updateSecurityIndicator(url) {
        if (!url) {
            this.statusSecurity.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Hazır';
        } else if (url.startsWith('https://')) {
            this.statusSecurity.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Güvenli';
        } else if (url.includes('.onion')) {
            this.statusSecurity.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="11"/></svg> Tor Anonim';
        } else {
            this.statusSecurity.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Güvensiz';
        }
    }

    async switchMode() {
        const newMode = this.currentMode === 'normal' ? 'tor' : 'normal';
        this.updateModeUI(true);
        
        try {
            await window.electronAPI.switchMode(newMode);
        } catch (error) {
            console.error('Mode switch failed:', error);
        }
    }

    updateModeUI(showNotification = false) {
        const isTor = this.currentMode === 'tor';
        
        this.modeToggle.classList.toggle('tor-active', isTor);
        this.modeIndicator.classList.toggle('tor-mode', isTor);
        this.modeText.textContent = isTor ? 'Tor' : 'Normal';
        this.statusMode.textContent = isTor ? 'Tor Mod' : 'Normal Mod';
        this.statusMode.classList.toggle('tor-status', isTor);
        
        if (showNotification) {
            this.notificationText.textContent = isTor ? 'Tor Moduna Geçiliyor...' : 'Normal Moda Geçiliyor...';
            this.modeNotification.classList.add('show');
            setTimeout(() => {
                this.modeNotification.classList.remove('show');
            }, 2500);
        }
    }

    async logout() {
        if (confirm('Çıkış yapmak istediğinizden emin misiniz?')) {
            await window.electronAPI.auth.logout();
        }
    }
}

// Initialize browser
const browser = new Browser();