import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import dotenv from 'dotenv';
import started from 'electron-squirrel-startup';
import { initDatabase, closeDatabase } from './db';
import { PROD_MIGRATIONS } from './db/migrations';
import { StorageService } from './services/Storage';
import { PipelineService } from './services/Pipeline';
import { PipelineOrchestrator } from './services/Orchestrator';
import { registerPipelineHandlers } from './ipc/pipeline';
import { EventEmitter } from './services/EventEmitter';
import { initOpenRouter } from './agents/shared/config';
import { setStorageBasePathResolver } from './agents/shared/storageSandbox';

// Load .env from the project root before anything reads process.env.
// `app.getAppPath()` is unavailable until the app is ready, so use cwd in dev
// and the resources path in packaged builds.
dotenv.config({ path: path.join(process.cwd(), '.env') });

if (started) {
  app.quit();
}

if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
}

const createWindow = (): BrowserWindow => {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: '#272e33',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  return mainWindow;
};

app.on('ready', async () => {
  const sql = await initDatabase(PROD_MIGRATIONS);
  initOpenRouter();

  const mainWindow = createWindow();
  const eventEmitter = new EventEmitter(mainWindow);

  const storageService = new StorageService(
    path.join(app.getPath('userData'), 'papers')
  );
  setStorageBasePathResolver(() => storageService.getBasePath());

  const pipelineService = new PipelineService(sql, storageService, eventEmitter);
  const orchestrator = new PipelineOrchestrator(sql, pipelineService, eventEmitter);

  registerPipelineHandlers(sql, orchestrator);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Close the postgres pool cleanly so it doesn't leave a zombie connection
// holding a row-level lock the next time the app starts.
app.on('before-quit', async (event) => {
  event.preventDefault();
  try {
    await closeDatabase();
  } catch (err) {
    console.error('failed to close database cleanly:', err);
  }
  app.exit(0);
});
