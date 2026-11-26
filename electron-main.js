import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import { startServer } from './server.js';

let mainWindow = null;
let serverHandle = null;

async function createWindow() {
  const userDataDir = path.join(app.getPath('userData'), 'data');
  serverHandle = await startServer({
    port: 0, // Automatically pick an available local port
    host: '127.0.0.1',
    dataDir: userDataDir,
  });

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: '세특 수집기 · Speciality',
    autoHideMenuBar: true,
    backgroundColor: '#f6f5f0',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Open target="_blank" links (e.g., student preview or external docs) in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(serverHandle.url);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow).catch((err) => {
  console.error('Electron startup error:', err);
  app.quit();
});

app.on('window-all-closed', () => {
  if (serverHandle?.server) {
    try {
      serverHandle.server.close();
    } catch {
      // ignore
    }
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
