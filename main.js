const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { google } = require('googleapis');

// ==========================================
// CONFIGURAÇÃO GOOGLE DRIVE (OAuth Desktop)
// ==========================================
const GOOGLE_CLIENT_ID = 'COLE_SEU_CLIENT_ID_AQUI.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = 'COLE_SEU_CLIENT_SECRET_AQUI';
const DRIVE_FOLDER_NAME = 'Toda Chic Modas - Backups';
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const baseDir = process.env.PORTABLE_EXECUTABLE_DIR || __dirname;
const dbPath = path.join(baseDir, 'banco_de_vendas.json');
const tokenPath = path.join(baseDir, 'gdrive_token.json');

// ==========================================
// BANCO DE DADOS LOCAL
// ==========================================
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

// ==========================================
// CLIENTE E AUTENTICAÇÃO GOOGLE DRIVE
// ==========================================
function getOAuthClient(redirectUri = 'http://127.0.0.1') {
    const client = new google.auth.OAuth2(
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
        redirectUri
    );

    if (fs.existsSync(tokenPath)) {
        try {
            const savedTokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
            client.setCredentials(savedTokens);
        } catch (e) {
            console.error('Erro ao ler token do Drive:', e);
        }
    }

    // Atualiza o arquivo local sempre que o token for renovado automaticamente
    client.on('tokens', (newTokens) => {
        let current = {};
        if (fs.existsSync(tokenPath)) {
            try { current = JSON.parse(fs.readFileSync(tokenPath, 'utf-8')); } catch {}
        }
        const merged = { ...current, ...newTokens };
        fs.writeFileSync(tokenPath, JSON.stringify(merged, null, 2), 'utf-8');
    });

    return client;
}

function isDriveAuthenticated() {
    if (!fs.existsSync(tokenPath)) return false;
    try {
        const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
        return Boolean(tokens && (tokens.refresh_token || tokens.access_token));
    } catch {
        return false;
    }
}

async function getOrCreateBackupFolder(drive) {
    const res = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and name='${DRIVE_FOLDER_NAME}' and trashed=false`,
        fields: 'files(id, name)',
        spaces: 'drive'
    });

    if (res.data.files && res.data.files.length > 0) {
        return res.data.files[0].id;
    }

    const folder = await drive.files.create({
        requestBody: {
            name: DRIVE_FOLDER_NAME,
            mimeType: 'application/vnd.google-apps.folder'
        },
        fields: 'id'
    });

    return folder.data.id;
}

async function uploadBackupToDrive(modo = 'snapshot') {
    if (!isDriveAuthenticated()) {
        throw new Error('Conta do Google Drive não conectada.');
    }

    const auth = getOAuthClient();
    const drive = google.drive({ version: 'v3', auth });
    const folderId = await getOrCreateBackupFolder(drive);

    if (modo === 'sync') {
        // Modo sincronização automática: sobrescreve sempre o mesmo arquivo para não poluir o Drive
        const nomeSync = 'banco_de_vendas_sincronizado.json';
        const busca = await drive.files.list({
            q: `name='${nomeSync}' and '${folderId}' in parents and trashed=false`,
            fields: 'files(id)'
        });

        const media = {
            mimeType: 'application/json',
            body: fs.createReadStream(dbPath)
        };

        if (busca.data.files && busca.data.files.length > 0) {
            const fileId = busca.data.files[0].id;
            await drive.files.update({ fileId, media });
            return { nome: nomeSync, atualizado: true };
        } else {
            await drive.files.create({
                requestBody: { name: nomeSync, parents: [folderId] },
                media,
                fields: 'id, name'
            });
            return { nome: nomeSync, atualizado: false };
        }
    } else {
        // Modo manual: cria um backup datado com histórico
        const agora = new Date();
        const stamp = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}_${String(agora.getHours()).padStart(2, '0')}-${String(agora.getMinutes()).padStart(2, '0')}-${String(agora.getSeconds()).padStart(2, '0')}`;
        const fileName = `backup_todachic_${stamp}.json`;

        const criado = await drive.files.create({
            requestBody: {
                name: fileName,
                parents: [folderId]
            },
            media: {
                mimeType: 'application/json',
                body: fs.createReadStream(dbPath)
            },
            fields: 'id, name'
        });

        return { id: criado.data.id, nome: criado.data.name };
    }
}

// ==========================================
// JANELA PRINCIPAL
// ==========================================
function createWindow() {
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

// ==========================================
// HANDLERS IPC - VENDAS E ARQUIVOS LOCAIS
// ==========================================
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

// ==========================================
// HANDLERS IPC - GOOGLE DRIVE
// ==========================================
ipcMain.handle('gdrive-status', () => {
    return { conectado: isDriveAuthenticated() };
});

ipcMain.handle('gdrive-login', () => {
    return new Promise((resolve, reject) => {
        const server = http.createServer();

        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            const redirectUri = `http://127.0.0.1:${port}`;
            const oauth2Client = getOAuthClient(redirectUri);

            const authUrl = oauth2Client.generateAuthUrl({
                access_type: 'offline',
                prompt: 'consent',
                scope: SCOPES
            });

            server.on('request', async (req, res) => {
                try {
                    const reqUrl = new URL(req.url, redirectUri);
                    const code = reqUrl.searchParams.get('code');
                    const error = reqUrl.searchParams.get('error');

                    if (error) {
                        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end('<h2>Autenticação cancelada ou negada. Você pode fechar esta aba.</h2>');
                        server.close();
                        return reject(new Error('Autenticação negada pelo usuário.'));
                    }

                    if (code) {
                        const { tokens } = await oauth2Client.getToken(code);
                        fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), 'utf-8');

                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end('<h2 style="font-family:sans-serif;color:#27ae60;">✅ Google Drive conectado com sucesso!</h2><p style="font-family:sans-serif;">Pode fechar esta janela e voltar ao sistema Toda Chic Modas.</p>');
                        server.close();
                        return resolve(true);
                    }
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end('<h2>Erro ao concluir autenticação.</h2>');
                    server.close();
                    reject(err);
                }
            });

            shell.openExternal(authUrl);
        });
    });
});

ipcMain.handle('gdrive-logout', () => {
    if (fs.existsSync(tokenPath)) {
        fs.unlinkSync(tokenPath);
    }
    return true;
});

ipcMain.handle('gdrive-backup', async (event, modo = 'snapshot') => {
    return await uploadBackupToDrive(modo);
});

ipcMain.handle('gdrive-list-backups', async () => {
    if (!isDriveAuthenticated()) {
        throw new Error('Conta do Google Drive não conectada.');
    }
    const auth = getOAuthClient();
    const drive = google.drive({ version: 'v3', auth });
    const folderId = await getOrCreateBackupFolder(drive);

    const res = await drive.files.list({
        q: `'${folderId}' in parents and mimeType='application/json' and trashed=false`,
        orderBy: 'createdTime desc',
        pageSize: 15,
        fields: 'files(id, name, createdTime, modifiedTime, size)'
    });

    return res.data.files || [];
});

ipcMain.handle('gdrive-restore', async (event, fileId) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Sim, Restaurar Backup', 'Cancelar'],
        defaultId: 1,
        title: 'Restaurar do Google Drive',
        message: 'Isso vai substituir os dados locais atuais pelo backup selecionado na nuvem.\nDeseja continuar?'
    });

    if (response !== 0) return false;

    const auth = getOAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'text' }
    );

    const conteudo = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
    JSON.parse(conteudo); // Valida se é um JSON íntegro antes de sobrescrever
    fs.writeFileSync(dbPath, conteudo, 'utf-8');

    dialog.showMessageBox(win, {
        type: 'info',
        title: 'Sucesso',
        message: 'Banco de dados restaurado do Google Drive com sucesso!'
    });
    return true;
});