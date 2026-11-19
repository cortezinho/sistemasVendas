const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    getVendas: () => ipcRenderer.invoke('get-vendas'),
    saveVenda: (venda) => ipcRenderer.invoke('save-venda', venda),
    updateVenda: (venda) => ipcRenderer.invoke('update-venda', venda),
    deleteVenda: (id) => ipcRenderer.invoke('delete-venda', id),
    exportDB: () => ipcRenderer.invoke('export-db'),
    importDB: () => ipcRenderer.invoke('import-db'),

    // Google Drive
    gdriveStatus: () => ipcRenderer.invoke('gdrive-status'),
    gdriveLogin: () => ipcRenderer.invoke('gdrive-login'),
    gdriveLogout: () => ipcRenderer.invoke('gdrive-logout'),
    gdriveBackup: (modo) => ipcRenderer.invoke('gdrive-backup', modo),
    gdriveListBackups: () => ipcRenderer.invoke('gdrive-list-backups'),
    gdriveRestore: (fileId) => ipcRenderer.invoke('gdrive-restore', fileId)
});