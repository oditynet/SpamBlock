// Content script - отображает информацию на странице
class ContentNetworkMonitor {
  constructor() {
    this.requests = new Map();
    this.widget = null;
    this.isVisible = false;
    this.init();
  }
  
  init() {
    console.log('🔍 Content Network Monitor started');
    
    // Слушаем сообщения от background script
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleBackgroundMessage(message);
    });
    
    // Вставляем стили
    this.injectStyles();
    
    // Создаем кнопку для отображения монитора
    this.createToggleButton();
  }
  
  handleBackgroundMessage(message) {
    switch (message.action) {
      case 'requestStarted':
        this.logRequest('started', message.request);
        break;
        
      case 'requestCompleted':
        this.logRequest('completed', message.request);
        break;
        
      case 'requestError':
        this.logRequest('error', message.request);
        break;
    }
  }
  
  logRequest(type, request) {
    console.group(`🌐 ${type.toUpperCase()} ${request.method} ${request.url}`);
    console.log('Request details:', request);
    
    if (type === 'completed') {
      console.log(`Status: ${request.statusCode}, Duration: ${request.duration}ms, Size: ${request.responseSize} bytes`);
    } else if (type === 'error') {
      console.log(`Error: ${request.error}`);
    }
    
    console.groupEnd();
    
    // Обновляем виджет если он видим
    if (this.isVisible && this.widget) {
      this.updateWidget(request);
    }
  }
  
  createToggleButton() {
    const button = document.createElement('div');
    button.innerHTML = '🌐';
    button.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      width: 40px;
      height: 40px;
      background: #4CAF50;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      cursor: pointer;
      z-index: 10000;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      user-select: none;
    `;
    
    button.addEventListener('click', () => {
      this.toggleWidget();
    });
    
    document.body.appendChild(button);
  }
  
  toggleWidget() {
    if (this.isVisible) {
      this.hideWidget();
    } else {
      this.showWidget();
    }
  }
  
  showWidget() {
    if (this.widget) {
      this.widget.style.display = 'block';
    } else {
      this.createWidget();
    }
    this.isVisible = true;
  }
  
  hideWidget() {
    if (this.widget) {
      this.widget.style.display = 'none';
    }
    this.isVisible = false;
  }
  
  createWidget() {
    this.widget = document.createElement('div');
    this.widget.style.cssText = `
      position: fixed;
      top: 60px;
      right: 10px;
      width: 500px;
      height: 400px;
      background: white;
      border: 2px solid #4CAF50;
      border-radius: 8px;
      z-index: 9999;
      font-family: Arial, sans-serif;
      font-size: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      display: flex;
      flex-direction: column;
    `;
    
    this.widget.innerHTML = `
      <div style="padding: 10px; background: #4CAF50; color: white; border-radius: 6px 6px 0 0;">
        <strong>Network Monitor</strong>
        <button id="close-monitor" style="float: right; background: transparent; border: none; color: white; cursor: pointer;">✕</button>
      </div>
      <div id="network-logs" style="flex: 1; overflow-y: auto; padding: 10px; font-size: 11px;"></div>
    `;
    
    document.body.appendChild(this.widget);
    
    // Обработчик закрытия
    this.widget.querySelector('#close-monitor').addEventListener('click', () => {
      this.hideWidget();
    });
  }
  
  updateWidget(request) {
    if (!this.widget) return;
    
    const logsContainer = this.widget.querySelector('#network-logs');
    const logEntry = document.createElement('div');
    logEntry.style.cssText = `
      border-left: 3px solid ${this.getStatusColor(request.status)};
      padding: 5px;
      margin: 2px 0;
      background: #f5f5f5;
      border-radius: 3px;
    `;
    
    logEntry.innerHTML = `
      <div style="font-weight: bold;">${request.method} ${this.shortenUrl(request.url)}</div>
      <div style="color: #666; font-size: 10px;">
        Status: ${request.statusCode || request.status} | 
        Duration: ${request.duration || '?'}ms |
        Size: ${request.responseSize || '?'} bytes
      </div>
      <div style="color: #888; font-size: 9px; word-break: break-all;">
        From: ${request.initiator || request.originUrl || 'unknown'}
      </div>
    `;
    
    logsContainer.insertBefore(logEntry, logsContainer.firstChild);
    
    // Ограничиваем количество записей
    if (logsContainer.children.length > 50) {
      logsContainer.removeChild(logsContainer.lastChild);
    }
  }
  
  getStatusColor(status) {
    switch (status) {
      case 'completed': return '#4CAF50';
      case 'error': return '#f44336';
      case 'started': return '#FF9800';
      default: return '#9E9E9E';
    }
  }
  
  shortenUrl(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname + urlObj.pathname.substring(0, 30) + (urlObj.pathname.length > 30 ? '...' : '');
    } catch {
      return url.substring(0, 50) + (url.length > 50 ? '...' : '');
    }
  }
  
  injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .network-monitor-log {
        transition: all 0.3s ease;
      }
    `;
    document.head.appendChild(style);
  }
}

// Инициализация
if (document.contentType === 'text/html') {
  new ContentNetworkMonitor();
}
