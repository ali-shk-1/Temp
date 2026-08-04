const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const config = require('./config.json');

let mainWindow;
let backendProcess;

const BACKEND_ENTRY = path.join(__dirname, '..', 'school-backend', 'backend', 'server.js');
const BACKEND_CWD   = path.dirname(BACKEND_ENTRY);

function startBackend() {
  backendProcess = spawn(process.execPath, [BACKEND_ENTRY], {
    cwd: BACKEND_CWD,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: 'inherit'
  });

  backendProcess.on('error', (err) => {
    console.error('Failed to start backend:', err);
  });

  backendProcess.on('exit', (code) => {
    console.log('Backend process exited with code', code);
  });
}

function waitForServer(url, cb) {
  const check = () => {
    http.get(url, () => cb()).on('error', () => setTimeout(check, 1000));
  }; 
  check();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: config.windowTitle,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }
    ]},
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] }
  ]));

  mainWindow.loadFile('waiting.html');

  waitForServer(config.appUrl, () => {
    mainWindow.loadURL(config.appUrl);
  });
}

app.whenReady().then(() => {
  startBackend();
  createWindow();
});

app.on('window-all-closed', () => {
  if (backendProcess) backendProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (backendProcess) backendProcess.kill();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});