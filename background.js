class NetworkMonitorWithBlocker {
  constructor() {
    this.requestsByTab = new Map();
    this.requestCount = 0;
    this.currentTabId = null;
    this.blockedPatterns = new Set();
    this.init();
  }
  
  async init() {
    await this.loadBlockedPatterns();
    await this.updateCurrentTab();
    
    browser.tabs.onActivated.addListener((activeInfo) => {
      this.handleTabChange(activeInfo.tabId);
    });
    
    browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab.active) {
        this.handleTabChange(tabId);
      }
    });
    
    this.setupRequestMonitoring();
    
    console.log('🔍 Network Monitor with Blocker initialized');
  }
  
  async loadBlockedPatterns() {
    try {
      const result = await browser.storage.local.get({ blockedPatterns: [] });
      this.blockedPatterns = new Set(result.blockedPatterns);
      console.log('🚫 Loaded blocked patterns:', this.blockedPatterns.size);
    } catch (error) {
      console.error('Error loading blocked patterns:', error);
    }
  }
  
  async saveBlockedPatterns() {
    try {
      await browser.storage.local.set({ 
        blockedPatterns: Array.from(this.blockedPatterns) 
      });
    } catch (error) {
      console.error('Error saving blocked patterns:', error);
    }
  }
  
  async updateCurrentTab() {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        this.currentTabId = tabs[0].id;
        console.log('📑 Current tab updated:', this.currentTabId);
      }
    } catch (error) {
      console.error('Error updating current tab:', error);
    }
  }
  
  handleTabChange(tabId) {
    this.currentTabId = tabId;
    console.log('🔄 Tab changed to:', tabId);
  }
  
  setupRequestMonitoring() {
    const allUrls = { urls: ["<all_urls>"] };
    
    browser.webRequest.onBeforeRequest.addListener(
      (details) => {
        if (this.shouldBlockRequest(details)) {
          console.log('🚫 BLOCKED request:', this.shortenUrl(details.url));
          return { cancel: true };
        }
        
        this.handleRequestStart(details);
        return {};
      },
      allUrls,
      ["blocking"]
    );
    
    browser.webRequest.onBeforeSendHeaders.addListener(
      (details) => {
        if (!this.shouldBlockRequest(details)) {
          this.handleRequestHeaders(details);
        }
        return { requestHeaders: details.requestHeaders };
      },
      allUrls,
      ["blocking", "requestHeaders"]
    );
    
    browser.webRequest.onCompleted.addListener(
      (details) => {
        if (!this.shouldBlockRequest(details)) {
          this.handleRequestComplete(details);
        }
      },
      allUrls
    );
    
    browser.webRequest.onErrorOccurred.addListener(
      (details) => {
        if (!this.shouldBlockRequest(details)) {
          this.handleRequestError(details);
        }
      },
      allUrls
    );
  }
  
  shouldBlockRequest(details) {
    for (const pattern of this.blockedPatterns) {
      if (this.matchPattern(details.url, pattern)) {
        return true;
      }
    }
    return false;
  }

  matchPattern(url, pattern) {
    try {
      // Если паттерн содержит wildcards
      if (pattern.includes('*') || pattern.includes('?')) {
        // Экранируем специальные символы regex, кроме * и ?
        let regexPattern = pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');
        
        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(url);
      } else {
        // Простое сравнение для точных паттернов
        return url.includes(pattern);
      }
    } catch (error) {
      console.error('Error matching pattern:', pattern, error);
      return false;
    }
  }
  
  handleRequestStart(details) {
    const requestId = details.requestId || `req_${Date.now()}_${this.requestCount++}`;
    
    const requestInfo = {
      id: requestId,
      url: details.url,
      method: details.method,
      type: details.type,
      tabId: details.tabId,
      frameId: details.frameId,
      timeStamp: details.timeStamp,
      startTime: Date.now(),
      headers: {},
      status: 'started',
      initiator: details.initiator,
      originUrl: details.originUrl || details.documentUrl,
      isBlocked: false,
      statusColor: '#FF9800'
    };
    
    if (!this.requestsByTab.has(details.tabId)) {
      this.requestsByTab.set(details.tabId, new Map());
    }
    this.requestsByTab.get(details.tabId).set(requestId, requestInfo);
    
    console.log('🚀 Request started:', {
      tabId: details.tabId,
      method: details.method,
      url: this.shortenUrl(details.url),
      type: details.type
    });
    
    this.saveRequest(requestInfo);
  }
  
  handleRequestHeaders(details) {
    const tabRequests = this.requestsByTab.get(details.tabId);
    if (tabRequests) {
      const request = tabRequests.get(details.requestId);
      if (request) {
        request.headers = this.parseHeaders(details.requestHeaders);
        request.requestSize = details.requestSize;
      }
    }
  }
  
  handleRequestComplete(details) {
    const tabRequests = this.requestsByTab.get(details.tabId);
    if (tabRequests) {
      const request = tabRequests.get(details.requestId);
      if (request) {
        request.status = 'completed';
        request.statusCode = details.statusCode;
        request.statusLine = details.statusLine;
        request.responseSize = details.responseSize;
        request.completeTime = Date.now();
        request.duration = request.completeTime - request.startTime;
        request.ip = details.ip;
        request.fromCache = details.fromCache;
        request.statusColor = this.getStatusColor(request.statusCode);
        
        console.log(`%c✅ Request completed: ${details.statusCode} ${this.shortenUrl(details.url)}`, 
                   `color: ${request.statusColor}; font-weight: bold;`);
        
        this.saveRequest(request);
      }
    }
  }
  
  handleRequestError(details) {
    const tabRequests = this.requestsByTab.get(details.tabId);
    if (tabRequests) {
      const request = tabRequests.get(details.requestId);
      if (request) {
        request.status = 'error';
        request.error = details.error;
        request.completeTime = Date.now();
        request.duration = request.completeTime - request.startTime;
        request.statusColor = '#f44336';
        
        console.log(`%c❌ Request error: ${details.error} ${this.shortenUrl(details.url)}`, 
                   'color: #f44336; font-weight: bold;');
        
        this.saveRequest(request);
      }
    }
  }
  
  async blockScript(pattern) {
    this.blockedPatterns.add(pattern);
    await this.saveBlockedPatterns();
    console.log('🚫 Added to blocklist:', pattern);
  }
  
  async unblockScript(pattern) {
    this.blockedPatterns.delete(pattern);
    await this.saveBlockedPatterns();
    console.log('✅ Removed from blocklist:', pattern);
  }
  
  async getBlockedPatterns() {
    return Array.from(this.blockedPatterns);
  }
  
  async clearBlockedPatterns() {
    this.blockedPatterns.clear();
    await this.saveBlockedPatterns();
    console.log('🗑️ Cleared all blocked patterns');
  }
  
  parseHeaders(headersArray) {
    const headers = {};
    if (headersArray) {
      headersArray.forEach(header => {
        headers[header.name.toLowerCase()] = header.value;
      });
    }
    return headers;
  }
  
  getStatusColor(statusCode) {
    if (!statusCode) return '#FF9800';
    
    if (statusCode >= 200 && statusCode < 300) {
      return '#4CAF50';
    } else if (statusCode >= 400 && statusCode < 600) {
      return '#f44336';
    } else {
      return '#FF9800';
    }
  }
  
  shortenUrl(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname + urlObj.pathname.substring(0, 20) + (urlObj.pathname.length > 20 ? '...' : '');
    } catch {
      return url.substring(0, 30) + (url.length > 30 ? '...' : '');
    }
  }
  
  async saveRequest(request) {
    try {
      const storageKey = `tab_${request.tabId}_requests`;
      const result = await browser.storage.local.get({[storageKey]: []});
      const requests = result[storageKey];
      
      const logEntry = {
        id: request.id,
        timestamp: new Date(request.startTime).toISOString(),
        method: request.method,
        url: request.url,
        type: request.type,
        status: request.status,
        statusCode: request.statusCode,
        statusColor: request.statusColor,
        duration: request.duration,
        requestSize: request.requestSize,
        responseSize: request.responseSize,
        ip: request.ip,
        initiator: request.initiator,
        originUrl: request.originUrl,
        tabId: request.tabId,
        fromCache: request.fromCache,
        error: request.error,
        isBlocked: request.isBlocked
      };
      
      const existingIndex = requests.findIndex(req => req.id === request.id);
      if (existingIndex !== -1) {
        requests[existingIndex] = logEntry;
      } else {
        requests.unshift(logEntry);
      }
      
      if (requests.length > 500) {
        requests.splice(500);
      }
      
      await browser.storage.local.set({[storageKey]: requests});
      
    } catch (error) {
      console.error('Error saving request:', error);
    }
  }
  
  async getCurrentTabRequests(limit = 200) {
    try {
      if (!this.currentTabId) {
        await this.updateCurrentTab();
      }
      
      const storageKey = `tab_${this.currentTabId}_requests`;
      const result = await browser.storage.local.get({[storageKey]: []});
      const requests = result[storageKey].slice(0, limit);
      
      console.log(`📊 Found ${requests.length} requests for tab ${this.currentTabId}`);
      
      return requests;
      
    } catch (error) {
      console.error('Error getting current tab requests:', error);
      return [];
    }
  }
  
  async clearCurrentTabLogs() {
    try {
      if (!this.currentTabId) {
        await this.updateCurrentTab();
      }
      
      const storageKey = `tab_${this.currentTabId}_requests`;
      await browser.storage.local.set({[storageKey]: []});
      
      // Очищаем memory cache
      if (this.requestsByTab.has(this.currentTabId)) {
        this.requestsByTab.get(this.currentTabId).clear();
      }
      
      return true;
    } catch (error) {
      console.error('Error clearing current tab logs:', error);
      return false;
    }
  }
}

const monitor = new NetworkMonitorWithBlocker();

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'getCurrentTabRequests':
      monitor.getCurrentTabRequests(message.limit).then(sendResponse);
      return true;
      
    case 'clearCurrentTabLogs':
      monitor.clearCurrentTabLogs().then(sendResponse);
      return true;
      
    case 'blockScript':
      monitor.blockScript(message.pattern).then(() => sendResponse({success: true}));
      return true;
      
    case 'unblockScript':
      monitor.unblockScript(message.pattern).then(() => sendResponse({success: true}));
      return true;
      
    case 'getBlockedPatterns':
      monitor.getBlockedPatterns().then(sendResponse);
      return true;
      
    case 'clearBlockedPatterns':
      monitor.clearBlockedPatterns().then(() => sendResponse({success: true}));
      return true;
  }
});
