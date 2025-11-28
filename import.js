// Ждем загрузки DOM
document.addEventListener('DOMContentLoaded', function() {
    // Находим элементы
    const fileInput = document.getElementById('fileInput');
    const closeButton = document.getElementById('closeButton');
    
    // Добавляем обработчики
    fileInput.addEventListener('change', handleFileImport);
    closeButton.addEventListener('click', closeTab);
});

async function handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const importData = JSON.parse(text);
        
        // Проверяем формат файла
        if (!importData.blockedPatterns || !Array.isArray(importData.blockedPatterns)) {
            throw new Error('Invalid file format: missing blockedPatterns array');
        }
        
        // Получаем текущие блокированные паттерны
        const currentData = await browser.storage.local.get({ blockedPatterns: [] });
        const existingPatterns = new Set(currentData.blockedPatterns);
        
        let importedCount = 0;
        let skippedCount = 0;
        
        // Добавляем только новые паттерны
        for (const pattern of importData.blockedPatterns) {
            if (existingPatterns.has(pattern)) {
                skippedCount++;
                continue;
            }
            
            existingPatterns.add(pattern);
            importedCount++;
        }
        
        // Сохраняем объединенный список
        await browser.storage.local.set({ 
            blockedPatterns: Array.from(existingPatterns) 
        });
        
        let statusMessage = `Успешно импортировано: ${importedCount} паттернов`;
        if (skippedCount > 0) {
            statusMessage += `<br>Пропущено дублей: ${skippedCount} паттернов`;
        }
        
        showStatus(statusMessage, 'success');
        
    } catch (error) {
        showStatus('Ошибка: ' + error.message, 'error');
    }
}

function closeTab() {
    browser.tabs.getCurrent().then(tab => {
        browser.tabs.remove(tab.id);
    });
}

function showStatus(message, type) {
    const statusEl = document.getElementById('status');
    statusEl.innerHTML = message;
    statusEl.className = `status ${type}`;
}
