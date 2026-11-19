const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.PORTABLE_EXECUTABLE_DIR 
    ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'banco_de_vendas.json') 
    : path.join(__dirname, 'banco_de_vendas.json');

function readDB() {
    if (!fs.existsSync(dbPath)) {
        fs.writeFileSync(dbPath, JSON.stringify({}), 'utf-8');
    }
    let parsed = {};
    try {
        const data = fs.readFileSync(dbPath, 'utf-8');
        parsed = JSON.parse(data || "{}");
    } catch (erro) {
        parsed = {};
    }

    if (typeof parsed !== 'object' || parsed === null) parsed = {};

    if (Array.isArray(parsed)) {
        const novoDb = {};
        parsed.forEach(v => {
            if (v && typeof v === 'object') {
                const c = (v.cliente || "Desconhecido").trim();
                if (!novoDb[c]) novoDb[c] = [];
                novoDb[c].push(v);
            }
        });
        parsed = novoDb;
        writeDB(parsed);
    }
    return parsed;
}

function writeDB(data) {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf-8');
}

function createWindow () {
    const win = new BrowserWindow({
        width: 1260,
        height: 820,
        autoHideMenuBar: true,
        icon: path.join(__dirname, 'logo.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-vendas', () => readDB());

ipcMain.handle('save-venda', (event, v) => {
    const db = readDB();
    if (!db[v.cliente]) db[v.cliente] = [];
    db[v.cliente].push(v);
    writeDB(db);
    return true;
});

ipcMain.handle('update-venda', (event, v) => {
    const db = readDB();
    for (const cliente in db) {
        db[cliente] = db[cliente].filter(item => item.id !== v.id);
        if (db[cliente].length === 0) delete db[cliente];
    }
    if (!db[v.cliente]) db[v.cliente] = [];
    db[v.cliente].push(v);
    writeDB(db);
    return true;
});

ipcMain.handle('delete-venda', async (event, id) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Excluir Venda', 'Cancelar'],
        defaultId: 1,
        title: 'Confirmação',
        message: 'Deseja excluir permanentemente esta venda do Banco de Dados?'
    });

    if (response !== 0) return false;

    const db = readDB();
    for (const cliente in db) {
        db[cliente] = db[cliente].filter(item => item.id !== id);
        if (db[cliente].length === 0) delete db[cliente];
    }
    writeDB(db);
    return true;
});

ipcMain.handle('export-db', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: `backup_todachic_${Date.now()}.json`,
        filters: [{ name: 'JSON DB', extensions: ['json'] }]
    });
    
    if (!canceled && filePath) {
        fs.copyFileSync(dbPath, filePath);
        dialog.showMessageBox(win, { type: 'info', title: 'Sucesso', message: 'Backup salvo com sucesso!' });
        return true;
    }
    return false;
});

ipcMain.handle('import-db', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    
    const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Sim, Substituir Tudo', 'Cancelar'],
        defaultId: 1,
        title: 'Atenção',
        message: 'A importação vai apagar e substituir todo o banco de dados atual pelo arquivo escolhido.\nDeseja continuar?'
    });

    if (response !== 0) return false;

    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'JSON DB', extensions: ['json'] }]
    });
    
    if (!canceled && filePaths.length > 0) {
        fs.copyFileSync(filePaths[0], dbPath);
        dialog.showMessageBox(win, { type: 'info', title: 'Sucesso', message: 'Banco de dados importado com sucesso!' });
        return true;
    }
    return false;
});