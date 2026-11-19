const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    getVendas: () => ipcRenderer.invoke('get-vendas'),
    saveVenda: (venda) => ipcRenderer.invoke('save-venda', venda),
    updateVenda: (venda) => ipcRenderer.invoke('update-venda', venda),
    deleteVenda: (id) => ipcRenderer.invoke('delete-venda', id),
    exportDB: () => ipcRenderer.invoke('export-db'),
    importDB: () => ipcRenderer.invoke('import-db')
});