class NetworkMonitorPopup {
  constructor() {
    this.currentTabId = null;
    this.currentTabUrl = null;
    this.currentTabHostname = null;
    this.blockedPatterns = [];
    this.currentTab = 'requests';
    this.autoRefreshEnabled = true;
    this.autoRefreshInterval = null;
    this.lastRequestCount = 0;
    this.isUserScrolled = false;
    this.scrollPosition = 0;
    this.newRequestsAvailable = false;
    this.autoBlockExternalEnabled = false;
    this.init();
  }
  
  async init() {
    await this.forceUpdateCurrentTab();
    await this.loadBlockedPatterns();
    await this.loadAutoBlockSettings();
    this.setupEventListeners();
    this.setupTabs();
    this.setupAutoRefresh();
    await this.loadLogs();
  }
  
  async loadAutoBlockSettings() {
    try {
      const result = await browser.storage.local.get({ autoBlockExternal: false });
      this.autoBlockExternalEnabled = result.autoBlockExternal;
      this.updateAutoBlockToggle();
    } catch (error) {
      console.error('Error loading auto-block settings:', error);
    }
  }
  
  async saveAutoBlockSettings() {
    try {
      await browser.storage.local.set({ autoBlockExternal: this.autoBlockExternalEnabled });
    } catch (error) {
      console.error('Error saving auto-block settings:', error);
    }
  }
  
  updateAutoBlockToggle() {
    const toggleSwitch = document.getElementById('autoBlockToggleSwitch');
    if (toggleSwitch) {
      if (this.autoBlockExternalEnabled) {
        toggleSwitch.classList.add('active');
      } else {
        toggleSwitch.classList.remove('active');
      }
    }
  }
  
  async toggleAutoBlockExternal() {
    this.autoBlockExternalEnabled = !this.autoBlockExternalEnabled;
    this.updateAutoBlockToggle();
    await this.saveAutoBlockSettings();
    
    if (this.autoBlockExternalEnabled) {
      await this.autoBlockExternalDomains();
    }
    
    console.log('🛡️ Auto-block external:', this.autoBlockExternalEnabled ? 'ENABLED' : 'DISABLED');
  }
  
  extractMainDomain(hostname) {
    if (!hostname) return '';
    
    // Удаляем www и другие субдомены, оставляя основной домен
    const parts = hostname.split('.');
    
    // Для обычных доменов (example.com, example.ru) - берем последние 2 части
    if (parts.length <= 2) {
        return hostname;
    }
    
    // Проверяем специальные домены (co.uk, com.br, etc.)
    const specialDomains = ['co', 'com', 'org', 'net', 'gov', 'edu', 'mil'];
    const lastTwoParts = parts.slice(-2);
    
    // Если предпоследняя часть является специальным доменом, берем 3 части
    if (specialDomains.includes(lastTwoParts[0]) && parts.length >= 3) {
        return parts.slice(-3).join('.');
    }
    
    // Для всех остальных случаев берем последние 2 части
    return lastTwoParts.join('.');
  }
  
  async autoBlockExternalDomains() {
    if (!this.currentTabHostname) {
      this.showStatus('Cannot determine current website domain', 'error');
      return;
    }
    
    try {
      const requests = await browser.runtime.sendMessage({
        action: 'getCurrentTabRequests',
        limit: 1000
      });
      
      const mainDomain = this.extractMainDomain(this.currentTabHostname);
      console.log('🔍 Current main domain:', mainDomain, 'from hostname:', this.currentTabHostname);
      
      let blockedCount = 0;
      let skippedCount = 0;
      const domainsToBlock = new Set();
      
      // Сначала собираем все внешние домены
      for (const request of requests) {
        try {
          const requestUrl = new URL(request.url);
          const requestDomain = requestUrl.hostname;
          const requestMainDomain = this.extractMainDomain(requestDomain);
          
          // Блокируем если основной домен отличается от текущего
          if (requestMainDomain !== mainDomain) {
            domainsToBlock.add(requestMainDomain);
          }
        } catch (e) {
          continue;
        }
      }
      
      // Блокируем каждый домен с wildcard
      for (const domain of domainsToBlock) {
        const wildcardPattern = `*.${domain}/*`;
        
        if (!this.isPatternBlocked(wildcardPattern)) {
          await browser.runtime.sendMessage({
            action: 'blockScript',
            pattern: wildcardPattern
          });
          blockedCount++;
          console.log('🚫 Blocked domain with wildcard:', wildcardPattern);
        } else {
          skippedCount++;
        }
      }
      
      if (blockedCount > 0) {
        await this.loadBlockedPatterns();
        this.showStatus(`Automatically blocked: ${blockedCount} external domains with wildcards (${skippedCount} already blocked)`, 'success');
      } else {
        this.showStatus(`No new external domains to block (${skippedCount} already blocked)`, 'info');
      }
      
    } catch (error) {
      console.error('Error auto-blocking external domains:', error);
      this.showStatus('Error auto-blocking external domains: ' + error.message, 'error');
    }
  }
  
  setupAutoRefresh() {
    this.loadAutoRefreshSettings();
    this.updateAutoRefresh();
    this.setupScrollListener();
  }
  
  setupScrollListener() {
    const content = document.querySelector('.content');
    if (content) {
      content.addEventListener('scroll', () => {
        const scrollTop = content.scrollTop;
        
        if (scrollTop < this.scrollPosition && scrollTop > 100) {
          this.isUserScrolled = true;
        }
        
        if (scrollTop === 0) {
          this.isUserScrolled = false;
          this.hideNewRequestsBadge();
        }
        
        this.scrollPosition = scrollTop;
      });
    }
  }
  
  loadAutoRefreshSettings() {
    try {
      const saved = localStorage.getItem('networkMonitor_autoRefresh');
      this.autoRefreshEnabled = saved !== null ? JSON.parse(saved) : true;
      this.updateToggleSwitch();
    } catch (error) {
      console.error('Error loading auto-refresh settings:', error);
      this.autoRefreshEnabled = true;
    }
  }
  
  saveAutoRefreshSettings() {
    try {
      localStorage.setItem('networkMonitor_autoRefresh', JSON.stringify(this.autoRefreshEnabled));
    } catch (error) {
      console.error('Error saving auto-refresh settings:', error);
    }
  }
  
  updateAutoRefresh() {
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
      this.autoRefreshInterval = null;
    }
    
    if (this.autoRefreshEnabled) {
      this.autoRefreshInterval = setInterval(() => {
        this.loadLogs();
      }, 2000);
    }
  }
  
  toggleAutoRefresh() {
    this.autoRefreshEnabled = !this.autoRefreshEnabled;
    this.updateToggleSwitch();
    this.updateAutoRefresh();
    this.saveAutoRefreshSettings();
    
    console.log('🔄 Auto-refresh:', this.autoRefreshEnabled ? 'ENABLED' : 'DISABLED');
  }
  
  updateToggleSwitch() {
    const toggleSwitch = document.getElementById('toggleSwitch');
    if (toggleSwitch) {
      if (this.autoRefreshEnabled) {
        toggleSwitch.classList.add('active');
      } else {
        toggleSwitch.classList.remove('active');
      }
    }
  }
  
  async forceUpdateCurrentTab() {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        this.currentTabId = tabs[0].id;
        this.currentTabUrl = tabs[0].url;
        
        try {
          const urlObj = new URL(tabs[0].url);
          this.currentTabHostname = urlObj.hostname;
        } catch (e) {
          this.currentTabHostname = null;
        }
        
        document.getElementById('tabInfo').innerHTML = `
          <strong>URL:</strong> ${this.shortenUrl(tabs[0].url)} | 
          <strong>Title:</strong> ${tabs[0].title || 'N/A'} |
          <strong>ID:</strong> ${tabs[0].id} |
          <strong>Status:</strong> ${tabs[0].status || 'unknown'}
        `;
      } else {
        this.showError('No active tab found');
      }
    } catch (error) {
      console.error('Error forcing tab update:', error);
      this.showError('Error getting tab info: ' + error.message);
    }
  }
  
  async loadBlockedPatterns() {
    try {
      this.blockedPatterns = await browser.runtime.sendMessage({
        action: 'getBlockedPatterns'
      });
      this.updateBlockedStats();
    } catch (error) {
      console.error('Error loading blocked patterns:', error);
    }
  }
  
  setupEventListeners() {
    document.getElementById('refresh').addEventListener('click', () => {
      this.loadLogs();
    });
    
    document.getElementById('clear').addEventListener('click', () => {
      this.clearLogs();
    });
    
    document.getElementById('export').addEventListener('click', () => {
      this.exportLogs();
    });
    
    document.getElementById('exportBlocked').addEventListener('click', () => {
      this.exportBlockedPatterns();
    });
    
    document.getElementById('importBlocked').addEventListener('click', () => {
      this.importBlockedPatterns();
    });
    
    document.getElementById('clearBlocked').addEventListener('click', () => {
      this.clearAllBlocked();
    });
    
    document.getElementById('runDiagnostics').addEventListener('click', () => {
      this.runDiagnostics();
    });
    
    document.getElementById('autoRefreshToggle').addEventListener('click', () => {
      this.toggleAutoRefresh();
    });
    
    document.getElementById('autoBlockToggle').addEventListener('click', () => {
      this.toggleAutoBlockExternal();
    });
    
    document.getElementById('newRequestsBadge').addEventListener('click', () => {
      this.scrollToTop();
    });

    // Новая кнопка для блокировки домена с wildcard
    document.getElementById('blockDomain').addEventListener('click', () => {
      this.blockDomainWithWildcard();
    });
  }
  
  setupTabs() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        this.currentTab = tab.dataset.tab;
        this.showTab(this.currentTab);
        
        this.isUserScrolled = false;
        this.hideNewRequestsBadge();
      });
    });
  }
  
  showTab(tabName) {
    document.getElementById('requestsTab').classList.add('hidden');
    document.getElementById('blockedTab').classList.add('hidden');
    document.getElementById('diagnosticsTab').classList.add('hidden');
    
    document.getElementById(tabName + 'Tab').classList.remove('hidden');
    
    if (tabName === 'blocked') {
      this.loadBlockedList();
    } else if (tabName === 'diagnostics') {
      this.loadDiagnosticsInfo();
    }
  }
  
  async loadLogs() {
    try {
      await this.forceUpdateCurrentTab();
      
      const requests = await browser.runtime.sendMessage({
        action: 'getCurrentTabRequests',
        limit: 200
      });
      
      console.log('📥 Loaded requests:', requests.length);
      
      const hasNewRequests = requests.length > this.lastRequestCount;
      this.lastRequestCount = requests.length;
      
      this.displayLogs(requests, hasNewRequests);
      this.updateRequestStats(requests.length);
      
    } catch (error) {
      console.error('Error loading logs:', error);
      this.showError('Failed to load requests: ' + error.message);
    }
  }
  
  displayLogs(requests, hasNewRequests = false) {
    const container = document.getElementById('requestsContainer');
    const content = document.querySelector('.content');
    const wasEmpty = container.querySelector('.empty-state') !== null;
    
    const oldScrollHeight = content.scrollHeight;
    const oldScrollTop = content.scrollTop;
    
    if (requests.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          No network requests detected in current tab...<br>
          <small>Navigate or refresh the page to see requests</small>
        </div>
      `;
      this.isUserScrolled = false;
      this.hideNewRequestsBadge();
      return;
    }
    
    const existingIds = new Set();
    container.querySelectorAll('.log-entry').forEach(entry => {
      const id = entry.dataset.requestId;
      if (id) existingIds.add(id);
    });
    
    const trulyNewRequests = requests.filter(req => !existingIds.has(req.id));
    
    container.innerHTML = requests.map(log => this.createLogEntry(log)).join('');
    
    if (this.isUserScrolled && !wasEmpty) {
      const newScrollHeight = content.scrollHeight;
      const heightDiff = newScrollHeight - oldScrollHeight;
      content.scrollTop = oldScrollTop + heightDiff;
    } else if (wasEmpty) {
      content.scrollTop = 0;
      this.isUserScrolled = false;
    }
    
    if (trulyNewRequests.length > 0 && content.scrollTop > 100) {
      this.showNewRequestsBadge(trulyNewRequests.length);
    } else {
      this.hideNewRequestsBadge();
    }
    
    container.querySelectorAll('.block-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = e.target.dataset.url;
        this.blockScript(url);
      });
    });

    container.querySelectorAll('.block-domain-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = e.target.dataset.url;
        this.blockDomainWithUrl(url);
      });
    });
  }
  
  createLogEntry(log) {
    const statusClass = log.status === 'error' ? 'error' : 
                       log.status === 'started' ? 'pending' : '';
    
    const statusDisplay = log.status === 'started' ? 'Pending' : 
                         (log.statusCode || log.status);
    
    const statusBadgeClass = this.getStatusBadgeClass(log);
    
    const isBlocked = this.isUrlBlocked(log.url);
    const blockBtnClass = isBlocked ? 'block-btn blocked' : 'block-btn';
    const blockBtnText = isBlocked ? '🚫 Blocked' : '🚫 Block';
    
    // Определяем является ли запрос внешним
    let externalBadge = '';
    let domain = '';
    if (this.currentTabHostname) {
      try {
        const requestUrl = new URL(log.url);
        const requestDomain = requestUrl.hostname;
        const requestMainDomain = this.extractMainDomain(requestDomain);
        const currentDomain = this.extractMainDomain(this.currentTabHostname);
        domain = requestMainDomain;
        
        if (requestMainDomain !== currentDomain) {
          externalBadge = '<span class="external-badge" title="External domain">🌐</span>';
        }
      } catch (e) {
        // Невалидный URL
      }
    }
    
    return `
      <div class="log-entry ${statusClass}" style="border-left-color: ${log.statusColor || '#4CAF50'}" data-request-id="${log.id}">
        <div class="url">${externalBadge} ${log.url}</div>
        <div class="block-buttons">
          <button class="${blockBtnClass}" data-url="${log.url}">
            ${blockBtnText}
          </button>
          ${domain && domain !== this.extractMainDomain(this.currentTabHostname) ? 
            `<button class="block-domain-btn" data-url="${log.url}" title="Block entire domain *.${domain}/*">
              🚫 Block Domain
            </button>` : ''}
        </div>
        <div class="details">
          <span class="method">${log.method}</span>
          <span class="${statusBadgeClass}">${statusDisplay}</span>
          <span class="type">${log.type}</span>
          ${log.duration ? `<span>⏱️ ${log.duration}ms</span>` : ''}
          ${log.responseSize ? `<span>📦 ${this.formatBytes(log.responseSize)}</span>` : ''}
          ${log.ip ? `<span>🌐 ${log.ip}</span>` : ''}
        </div>
        <div class="details">
          <span>🕒 ${new Date(log.timestamp).toLocaleTimeString()}</span>
          ${log.initiator ? `<span>🔗 From: ${this.shortenUrl(log.initiator)}</span>` : ''}
        </div>
      </div>
    `;
  }
  
  showNewRequestsBadge(count) {
    const badge = document.getElementById('newRequestsBadge');
    badge.textContent = `${count} new request${count > 1 ? 's' : ''} available ↑`;
    badge.classList.remove('hidden');
    this.newRequestsAvailable = true;
  }
  
  hideNewRequestsBadge() {
    const badge = document.getElementById('newRequestsBadge');
    badge.classList.add('hidden');
    this.newRequestsAvailable = false;
  }
  
  scrollToTop() {
    const content = document.querySelector('.content');
    content.scrollTop = 0;
    this.isUserScrolled = false;
    this.hideNewRequestsBadge();
  }
  
  getStatusBadgeClass(log) {
    if (log.status === 'error') return 'status error';
    if (log.status === 'started') return 'status warning';
    
    const statusCode = log.statusCode;
    if (statusCode >= 200 && statusCode < 300) {
      return 'status';
    } else if (statusCode >= 400) {
      return 'status error';
    } else {
      return 'status warning';
    }
  }
  
  isUrlBlocked(url) {
    return this.blockedPatterns.some(pattern => this.matchPattern(url, pattern));
  }

  isPatternBlocked(pattern) {
    return this.blockedPatterns.some(p => p === pattern);
  }

  matchPattern(url, pattern) {
    if (pattern.includes('*')) {
      // Wildcard matching
      const regexPattern = pattern
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(url);
    } else {
      // Simple substring matching
      return url.includes(pattern);
    }
  }
  
  async blockScript(url) {
    let pattern = this.extractBlockPattern(url);
    
    if (this.isUrlBlocked(url)) {
      await this.unblockScript(pattern);
    } else {
      if (confirm(`Block all requests containing:\n${pattern}`)) {
        try {
          await browser.runtime.sendMessage({
            action: 'blockScript',
            pattern: pattern
          });
          
          await this.loadBlockedPatterns();
          await this.loadLogs();
          
        } catch (error) {
          console.error('Error blocking script:', error);
          alert('Error blocking script');
        }
      }
    }
  }

  async blockDomainWithUrl(url) {
    try {
      const urlObj = new URL(url);
      const domain = this.extractMainDomain(urlObj.hostname);
      const wildcardPattern = `*.${domain}/*`;
      
      if (confirm(`Block entire domain with wildcard?\n${wildcardPattern}\n\nThis will block ALL requests to ${domain} and its subdomains`)) {
        await browser.runtime.sendMessage({
          action: 'blockScript',
          pattern: wildcardPattern
        });
        
        await this.loadBlockedPatterns();
        await this.loadLogs();
        this.showStatus(`Blocked domain: ${wildcardPattern}`, 'success');
      }
    } catch (error) {
      console.error('Error blocking domain:', error);
      alert('Error blocking domain');
    }
  }

  async blockDomainWithWildcard() {
    const domain = prompt('Enter domain to block (e.g., mail.ru):');
    if (domain) {
      const cleanDomain = domain.replace(/https?:\/\//, '').replace(/\/.*$/, '');
      const wildcardPattern = `*.${cleanDomain}/*`;
      
      if (confirm(`Block entire domain with wildcard?\n${wildcardPattern}\n\nThis will block ALL requests to ${cleanDomain} and its subdomains`)) {
        try {
          await browser.runtime.sendMessage({
            action: 'blockScript',
            pattern: wildcardPattern
          });
          
          await this.loadBlockedPatterns();
          await this.loadBlockedList();
          this.showStatus(`Blocked domain: ${wildcardPattern}`, 'success');
        } catch (error) {
          console.error('Error blocking domain:', error);
          alert('Error blocking domain');
        }
      }
    }
  }
  
  async unblockScript(pattern) {
    try {
      await browser.runtime.sendMessage({
        action: 'unblockScript',
        pattern: pattern
      });
      
      await this.loadBlockedPatterns();
      await this.loadLogs();
      await this.loadBlockedList();
      
    } catch (error) {
      console.error('Error unblocking script:', error);
    }
  }
  
  extractBlockPattern(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname + urlObj.pathname;
    } catch {
      return url.split('?')[0].substring(0, 100);
    }
  }
  
  async loadBlockedList() {
    const container = document.getElementById('blockedList');
    
    if (this.blockedPatterns.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          No scripts blocked yet...<br>
          <small>Click the block button on any request to add it to blocklist</small>
        </div>
      `;
      return;
    }
    
    container.innerHTML = this.blockedPatterns.map(pattern => `
      <div class="blocked-item">
        <div class="blocked-pattern ${pattern.includes('*') ? 'wildcard' : ''}" title="${pattern.includes('*') ? 'Wildcard pattern' : 'Exact pattern'}">
          ${pattern}
          ${pattern.includes('*') ? ' <span class="wildcard-badge">*</span>' : ''}
        </div>
        <button class="unblock-btn" data-pattern="${pattern}">Unblock</button>
      </div>
    `).join('');
    
    container.querySelectorAll('.unblock-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const pattern = e.target.dataset.pattern;
        await this.unblockScript(pattern);
        await this.loadBlockedList();
      });
    });
  }
  
  async clearAllBlocked() {
    if (this.blockedPatterns.length === 0) return;
    
    if (confirm(`Clear all ${this.blockedPatterns.length} blocked patterns?`)) {
      try {
        await browser.runtime.sendMessage({
          action: 'clearBlockedPatterns'
        });
        
        await this.loadBlockedPatterns();
        await this.loadBlockedList();
        
      } catch (error) {
        console.error('Error clearing blocked patterns:', error);
      }
    }
  }
  
  async exportBlockedPatterns() {
    try {
      const exportData = {
        exportTime: new Date().toISOString(),
        version: '1.0',
        description: 'Blocked patterns export from Network Monitor',
        blockedPatterns: this.blockedPatterns
      };
      
      const data = JSON.stringify(exportData, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `blocked-patterns-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      
      URL.revokeObjectURL(url);
      
    } catch (error) {
      console.error('Error exporting blocked patterns:', error);
      alert('Export failed: ' + error.message);
    }
  }
  
  importBlockedPatterns() {
    browser.tabs.create({
      url: browser.runtime.getURL('import.html')
    });
  }
  
  async loadDiagnosticsInfo() {
    try {
      const diagnostics = await browser.runtime.sendMessage({
        action: 'diagnose'
      });
      
      document.getElementById('diagnosticsInfo').innerHTML = `
        <strong>Current Tab ID:</strong> ${diagnostics.currentTabId || 'None'}<br>
        <strong>Current Hostname:</strong> ${this.currentTabHostname || 'None'}<br>
        <strong>Blocked Patterns:</strong> ${diagnostics.blockedPatternsCount}<br>
        <strong>Tabs with Requests:</strong> ${diagnostics.requestsByTabSize}<br>
        <strong>Auto-refresh:</strong> ${this.autoRefreshEnabled ? 'Enabled' : 'Disabled'}<br>
        <strong>Auto-block External:</strong> ${this.autoBlockExternalEnabled ? 'Enabled' : 'Disabled'}<br>
        <strong>Popup Tab:</strong> ${this.currentTab}
      `;
    } catch (error) {
      document.getElementById('diagnosticsInfo').innerHTML = `Error: ${error.message}`;
    }
  }
  
  async runDiagnostics() {
    try {
      const results = document.getElementById('diagnosticsResults');
      results.innerHTML = '<div class="empty-state">Running diagnostics...</div>';
      
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const currentTab = tabs[0];
      
      const requests = await browser.runtime.sendMessage({
        action: 'getCurrentTabRequests',
        limit: 10
      });
      
      const blocked = await browser.runtime.sendMessage({
        action: 'getBlockedPatterns'
      });
      
      results.innerHTML = `
        <div class="diagnostics">
          <h4>✅ Diagnostics Results</h4>
          <strong>Current Tab:</strong> ${currentTab.id} - ${this.shortenUrl(currentTab.url)}<br>
          <strong>Tab Status:</strong> ${currentTab.status}<br>
          <strong>Requests Found:</strong> ${requests.length}<br>
          <strong>Blocked Patterns:</strong> ${blocked.length}<br>
          <strong>Auto-refresh:</strong> ${this.autoRefreshEnabled ? 'Enabled' : 'Disabled'}<br>
          <strong>Auto-block External:</strong> ${this.autoBlockExternalEnabled ? 'Enabled' : 'Disabled'}<br>
          <strong>Sample Requests:</strong><br>
          <div style="font-size: 10px; margin-top: 5px;">
            ${requests.slice(0, 3).map(req => `• ${this.shortenUrl(req.url)} (${req.status})`).join('<br>')}
          </div>
        </div>
      `;
      
    } catch (error) {
      document.getElementById('diagnosticsResults').innerHTML = `
        <div class="diagnostics" style="background: #f8d7da; border-color: #f5c6cb;">
          <h4>❌ Diagnostics Failed</h4>
          Error: ${error.message}
        </div>
      `;
    }
  }
  
  updateRequestStats(count) {
    document.getElementById('requestStats').textContent = `Requests: ${count}`;
  }
  
  updateBlockedStats() {
    document.getElementById('blockedStats').textContent = `Blocked: ${this.blockedPatterns.length}`;
  }
  
  async clearLogs() {
    if (confirm('Clear all network logs for current tab?')) {
      try {
        const success = await browser.runtime.sendMessage({ 
          action: 'clearCurrentTabLogs' 
        });
        
        if (success) {
          await this.loadLogs();
        }
      } catch (error) {
        console.error('Error clearing logs:', error);
      }
    }
  }
  
  async exportLogs() {
    try {
      const requests = await browser.runtime.sendMessage({
        action: 'getCurrentTabRequests',
        limit: 1000
      });
      
      const exportData = {
        exportTime: new Date().toISOString(),
        tabId: this.currentTabId,
        tabUrl: this.currentTabUrl,
        blockedPatterns: this.blockedPatterns,
        requests: requests
      };
      
      const data = JSON.stringify(exportData, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `network-logs-tab-${this.currentTabId}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting logs:', error);
      alert('Export failed: ' + error.message);
    }
  }
  
  showStatus(message, type = 'info') {
    const statusEl = document.createElement('div');
    statusEl.className = `status-message ${type}`;
    statusEl.textContent = message;
    statusEl.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0,0,0,0.8);
      color: white;
      padding: 15px 25px;
      border-radius: 8px;
      z-index: 1000;
      font-size: 14px;
      max-width: 300px;
      text-align: center;
    `;
    
    document.body.appendChild(statusEl);
    
    setTimeout(() => {
      if (statusEl.parentNode) {
        statusEl.parentNode.removeChild(statusEl);
      }
    }, 3000);
  }
  
  showError(message) {
    const container = document.getElementById('requestsContainer');
    container.innerHTML = `
      <div class="empty-state" style="color: #f44336;">
        ❌ ${message}<br>
        <small>Try refreshing the page or check console for errors</small>
      </div>
    `;
  }
  
  shortenUrl(url) {
    if (!url) return 'N/A';
    try {
      const urlObj = new URL(url);
      return urlObj.hostname + (urlObj.pathname !== '/' ? urlObj.pathname.substring(0, 15) + '...' : '');
    } catch {
      return url.substring(0, 30) + (url.length > 30 ? '...' : '');
    }
  }
  
  formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  destroy() {
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
    }
  }
}

let popupMonitor;

document.addEventListener('DOMContentLoaded', () => {
  popupMonitor = new NetworkMonitorPopup();
});

window.addEventListener('unload', () => {
  if (popupMonitor) {
    popupMonitor.destroy();
  }
});
