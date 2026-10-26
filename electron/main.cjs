// InterviewMate — Electron main process
// Security posture (brief §2/§12): contextIsolation on, nodeIntegration off,
// sandbox on, narrow validated IPC only, navigation locked down.
// All Gemini keys and calls live here; the renderer only ever receives
// short-lived Live tokens and results — never a long-lived key.
const { app, BrowserWindow, dialog, ipcMain, Notification, shell, session, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const { createCredentialStore } = require('./services/credential-store.cjs');
const { createSessionStore } = require('./services/session-store.cjs');
const { createSettingsStore, VOCAB_CHOICES } = require('./services/settings-store.cjs');
const { createWordStore } = require('./services/word-store.cjs');
const { createScheduleStore } = require('./services/schedule-store.cjs');
const { createGeminiClient, assertFreeModel, FREE_MODELS } = require('./services/gemini.cjs');

const isDev = !app.isPackaged;
const DEV_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:4200';
const SMOKE = process.env.INTERVIEWMATE_SMOKE === '1';
const LEVELS = ['Intern', 'Junior', 'Senior'];
const LANGUAGES = ['English', 'Urdu'];
function optionalLanguage(v) {
  if (v === undefined || v === null) return 'English';
  if (!LANGUAGES.includes(v)) throw new Error(`language must be one of: ${LANGUAGES.join(', ')}.`);
  return v;
}

// ---------------------------------------------------------------- stores
let credentialStore = null;
let sessionStore = null;
let settingsStore = null;
let wordStore = null;
let scheduleStore = null;
let gemini = null;

function initStores() {
  if (credentialStore) return;
  const userData = app.getPath('userData');
  const encryptionAvailable = safeStorage.isEncryptionAvailable();

  credentialStore = createCredentialStore({
    filePath: path.join(userData, 'credentials.json'),
    encryptionAvailable,
    encryptString: (plain) => safeStorage.encryptString(plain),
    decryptString: (buffer) => safeStorage.decryptString(buffer),
  });
  sessionStore = createSessionStore({ filePath: path.join(userData, 'sessions.json') });
  settingsStore = createSettingsStore({ filePath: path.join(userData, 'settings.json') });
  wordStore = createWordStore({ filePath: path.join(userData, 'words.json') });
  scheduleStore = createScheduleStore({ filePath: path.join(userData, 'schedule.json') });

  gemini = createGeminiClient({
    // Enabled credentials, in stored order. The gemini client itself skips
    // credentials that are on its in-memory cooldown.
    getCredentialsInOrder: () =>
      credentialStore.list()
        .filter((meta) => !meta.disabled)
        .map((meta) => {
          try { return { id: meta.id, name: meta.name, secret: credentialStore.getSecret(meta.id) }; }
          catch { return null; } // undecryptable entry -> skip it
        })
        .filter(Boolean),
    onStatus: (id, status, kind) => credentialStore.setStatus(id, status, kind),
  });
}

// ------------------------------------------------------------- validation
function requireObject(v, label) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${label} must be an object.`);
  return v;
}
function optionalString(v, label, max) {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || v.length > max) throw new Error(`${label} must be a string of at most ${max} characters.`);
  return v;
}
function requireId(v) {
  if (typeof v !== 'string' || !v || v.length > 200) throw new Error('A valid id is required.');
  return v;
}

// ---------------------------------------------------------------- window
function isAllowedUrl(url) {
  if (isDev && url.startsWith(DEV_URL)) return true;
  return url.startsWith('file://');
}

const THEME_COLORS = {
  dark: { bg: '#0c0d11', bar: '#111218', symbols: '#a4a6b6' },
  light: { bg: '#f4f5f8', bar: '#ffffff', symbols: '#4a4d5c' },
};

function createWindow() {
  const theme = settingsStore.get().theme === 'light' ? 'light' : 'dark';
  const colors = THEME_COLORS[theme];
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: colors.bg,
    title: 'InterviewMate',
    autoHideMenuBar: true,
    // Modern frameless look: the renderer draws the title strip, Windows keeps
    // its native min/max/close buttons via the overlay.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.bar, symbolColor: colors.symbols, height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // Saved theme for the first paint (preload exposes it as initialTheme).
      additionalArguments: [`--im-theme=${theme}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  win.once('ready-to-show', () => { if (!SMOKE) win.show(); });

  // Lock navigation: no in-app navigation to arbitrary URLs, ever.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault();
  });
  // External links: https only, opened in the user's browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'ui', 'dist', 'ui', 'browser', 'index.html'));
  }

  if (SMOKE) {
    win.webContents.once('did-finish-load', async () => {
      try {
        const title = await win.webContents.executeJavaScript('document.title');
        const text = await win.webContents.executeJavaScript('document.body.innerText.slice(0, 200)');
        const bridge = await win.webContents.executeJavaScript(
          `(async () => {
             const b = window.interviewMate;
             if (!b) return 'BRIDGE_MISSING';
             const info = await b.getAppInfo();
             const creds = await b.credentials.list();
             const settings = await b.settings.get();
             const sessions = await b.sessions.list();
             return 'bridge=' + Object.keys(b).sort().join(',') +
               ' app=' + info.name + ' safeStorage=' + info.safeStorageAvailable +
               ' creds=' + creds.length + ' freeTierOnly=' + settings.freeTierOnly +
               ' sessions=' + sessions.length;
           })()`);
        console.log(`SMOKE_OK title="${title}" body="${text.replace(/\s+/g, ' ').trim()}" ${bridge}`);
      } catch (err) {
        console.error(`SMOKE_FAIL bridge check: ${err && err.message ? err.message : err}`);
        app.exit(1);
        return;
      }
      app.quit();
    });
    win.webContents.once('did-fail-load', (_e, code, desc) => {
      console.error(`SMOKE_FAIL load error ${code}: ${desc}`);
      app.exit(1);
    });
    setTimeout(() => { console.error('SMOKE_FAIL timeout'); app.exit(1); }, 20000);
  }
  return win;
}

// Content Security Policy for the packaged (file://) renderer.
function applyCsp() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          // 'wasm-unsafe-eval' lets the on-device background model (MediaPipe WebAssembly) run; it does not allow JS eval.
          "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; " +
          "connect-src 'self' https://generativelanguage.googleapis.com wss://generativelanguage.googleapis.com",
        ],
      },
    });
  });
}

// ------------------------------------------------------------------- IPC
// Narrow, validated IPC. Only the channels registered here exist.
function registerIpc() {
  ipcMain.handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    safeStorageAvailable: safeStorage.isEncryptionAvailable(),
  }));
  // Light/dark: recolour the native window buttons to match the page.
  ipcMain.handle('app:setTheme', (e, theme) => {
    if (theme !== 'light' && theme !== 'dark') throw new Error('Theme must be "light" or "dark".');
    settingsStore.set({ theme }); // in the settings file, so the next launch opens in it
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    const colors = THEME_COLORS[theme];
    win.setBackgroundColor(colors.bg);
    if (process.platform !== 'darwin') {
      win.setTitleBarOverlay({ color: colors.bar, symbolColor: colors.symbols, height: 40 });
    }
  });

  // Credentials — the renderer sees metadata only, never secrets.
  ipcMain.handle('credentials:list', () => credentialStore.list());
  ipcMain.handle('credentials:add', (_e, payload) => {
    requireObject(payload, 'Credential');
    credentialStore.add({
      name: payload.name,
      projectLabel: optionalString(payload.projectLabel, 'Project label', 100) || '',
      apiKey: payload.apiKey,
    });
    return credentialStore.list(); // UI contract: mutations return the full list
  });
  ipcMain.handle('credentials:test', async (_e, id) => {
    requireId(id);
    const secret = credentialStore.getSecret(id); // throws if unknown
    const result = await gemini.testCredential(secret);
    credentialStore.setStatus(id, result.ok ? 'ok' : 'error', result.ok ? null : result.kind || 'unknown');
    return result;
  });
  ipcMain.handle('credentials:remove', (_e, id) => {
    requireId(id);
    credentialStore.remove(id);
    return credentialStore.list();
  });
  ipcMain.handle('credentials:setDisabled', (_e, payload) => {
    requireObject(payload, 'Payload');
    requireId(payload.id);
    if (typeof payload.disabled !== 'boolean') throw new Error('disabled must be a boolean.');
    credentialStore.setDisabled(payload.id, payload.disabled);
    return credentialStore.list();
  });

  // Settings
  ipcMain.handle('settings:get', () => settingsStore.get());
  ipcMain.handle('settings:set', (_e, patch) => {
    requireObject(patch, 'Settings');
    return settingsStore.set(patch);
  });

  // Gemini
  ipcMain.handle('gemini:mintLiveToken', async (_e, payload) => {
    const p = payload === undefined ? {} : requireObject(payload, 'Payload');
    const model = optionalString(p.model, 'Model', 100) || FREE_MODELS.live[0];
    // Live interviews always use the free-tier allowlist, regardless of
    // the paid opt-in (the opt-in covers text models only, below).
    settingsStore.get();
    assertFreeModel('live', model);
    return gemini.mintLiveToken({ model });
  });
  ipcMain.handle('gemini:reportLiveQuota', (_e, payload) => {
    requireObject(payload, 'Payload');
    gemini.markLiveQuota(requireId(payload.credentialId));
    return { ok: true };
  });
  ipcMain.handle('gemini:analyzeFrame', async (_e, payload) => {
    requireObject(payload, 'Payload');
    if (typeof payload.jpegBase64 !== 'string') throw new Error('jpegBase64 must be a string.');
    // The model comes from the user's own settings, never from the
    // renderer payload — a forged payload cannot enable a paid model.
    const s = settingsStore.get();
    return gemini.analyzeFrame({ jpegBase64: payload.jpegBase64, textModel: s.textModel, allowPaidUsage: s.allowPaidUsage });
  });
  ipcMain.handle('gemini:generateFeedback', async (_e, payload) => {
    requireObject(payload, 'Payload');
    // The UI uses lowercase levels ('junior'); accept either casing.
    const level = payload.level === undefined
      ? 'Junior'
      : LEVELS.find((l) => l.toLowerCase() === String(payload.level).toLowerCase());
    if (!level) throw new Error(`level must be one of: ${LEVELS.join(', ')}.`);
    const s = settingsStore.get();
    return gemini.generateFeedback({
      transcript: payload.transcript,
      level,
      cvSummary: optionalString(payload.cvSummary, 'CV summary', 20000),
      language: optionalLanguage(payload.language),
      textModel: s.textModel, allowPaidUsage: s.allowPaidUsage,
    });
  });
  ipcMain.handle('gemini:translateTranscript', async (_e, payload) => {
    requireObject(payload, 'Payload');
    if (!Array.isArray(payload.transcript)) throw new Error('transcript must be an array.');
    const s = settingsStore.get();
    return gemini.translateTranscript({
      transcript: payload.transcript,
      targetLanguage: optionalLanguage(payload.targetLanguage),
      textModel: s.textModel, allowPaidUsage: s.allowPaidUsage,
    });
  });

  ipcMain.handle('gemini:summarizeReport', async (_e, payload) => {
    requireObject(payload, 'Payload');
    const s = settingsStore.get();
    return gemini.summarizeReport({
      digest: optionalString(payload.digest, 'Report digest', 30000),
      textModel: s.textModel, allowPaidUsage: s.allowPaidUsage,
    });
  });

  // Vocabulary tab
  ipcMain.handle('vocab:paragraph', async (_e, payload) => {
    requireObject(payload, 'Payload');
    const pick = (key) => (VOCAB_CHOICES[key].includes(payload[key]) ? payload[key] : undefined);
    if (payload.includeWords !== undefined && !Array.isArray(payload.includeWords)) throw new Error('includeWords must be an array.');
    return gemini.vocabParagraph({
      topic: pick('topic'), level: pick('level'), length: pick('length'),
      includeWords: (payload.includeWords || []).filter((w) => typeof w === 'string' && w.length <= 80).slice(0, 6),
      urdu: payload.urdu === true,
      avoidTitle: optionalString(payload.avoidTitle, 'Previous title', 200),
    });
  });
  ipcMain.handle('vocab:explain', async (_e, payload) => {
    requireObject(payload, 'Payload');
    return gemini.explainText({
      text: optionalString(payload.text, 'Selection', 600),
      context: optionalString(payload.context, 'Paragraph', 3000),
      urdu: payload.urdu === true,
    });
  });
  ipcMain.handle('vocab:speak', async (_e, payload) => {
    requireObject(payload, 'Payload');
    return gemini.speak({
      text: optionalString(payload.text, 'Text', 2000),
      voice: VOCAB_CHOICES.voice.includes(payload.voice) ? payload.voice : undefined,
    });
  });
  // Scheduled interviews
  ipcMain.handle('schedule:list', () => scheduleStore.list());
  ipcMain.handle('schedule:save', (_e, item) => {
    scheduleStore.save(item);
    checkReminders(); // a time that is already due reminds right away
    return scheduleStore.list();
  });
  ipcMain.handle('schedule:remove', (_e, id) => {
    requireId(id);
    scheduleStore.remove(id);
    return scheduleStore.list();
  });

  ipcMain.handle('words:list', () => wordStore.list());
  ipcMain.handle('words:save', (_e, word) => {
    wordStore.save(word);
    return wordStore.list();
  });
  ipcMain.handle('words:remove', (_e, id) => {
    requireId(id);
    wordStore.remove(id);
    return wordStore.list();
  });

  // Reports: print the current page (print CSS shows only the report) to a PDF the user picks.
  let lastExportPath = null;
  ipcMain.handle('reports:exportPdf', async (e, payload) => {
    requireObject(payload, 'Payload');
    const name = String(payload.fileName || 'InterviewMate-report.pdf').replace(/[\\/:*?"<>|]/g, '-').slice(0, 120);
    const win = BrowserWindow.fromWebContents(e.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save report as PDF',
      defaultPath: path.join(app.getPath('documents'), name.endsWith('.pdf') ? name : `${name}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { saved: false };
    const pdf = await e.sender.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
    await fs.promises.writeFile(filePath, pdf);
    lastExportPath = filePath;
    return { saved: true, path: filePath };
  });
  // Only ever reveals the file this app just wrote.
  ipcMain.handle('reports:showExportedFile', () => {
    if (lastExportPath) shell.showItemInFolder(lastExportPath);
  });

  // Sessions
  ipcMain.handle('sessions:save', (_e, sessionPayload) => {
    requireObject(sessionPayload, 'Session');
    sessionStore.save(sessionPayload);
    return sessionStore.list();
  });
  ipcMain.handle('sessions:list', () => sessionStore.list());
  ipcMain.handle('sessions:remove', (_e, id) => {
    requireId(id);
    sessionStore.remove(id);
    return sessionStore.list();
  });

  // Clear ALL local data: sessions + saved words + credentials + settings.
  ipcMain.handle('data:clearAll', () => {
    sessionStore.clear();
    wordStore.clear();
    scheduleStore.clear();
    credentialStore.clear();
    settingsStore.clear();
    return { ok: true };
  });
}

// ------------------------------------------------------------- reminders
// Scheduled-interview reminders while the app is open (it may be minimised):
// a Windows notification 10 minutes before and at the time, plus an in-app
// banner. Clicking the notification brings the window back on the Interview tab.
function mainWindow() {
  return BrowserWindow.getAllWindows()[0] || null;
}

function showWindow(win) {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function checkReminders() {
  if (!scheduleStore) return;
  for (const { kind, item } of scheduleStore.takeReminders(Date.now())) {
    const win = mainWindow();
    const time = new Date(item.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const mins = Math.max(1, Math.round((Date.parse(item.at) - Date.now()) / 60_000));
    if (win) {
      win.webContents.send('schedule:reminder', { kind, id: item.id });
      if (!win.isFocused()) win.flashFrame(true);
    }
    if (!SMOKE && Notification.isSupported()) {
      const note = new Notification({
        title: kind === 'due' ? 'Your mock interview starts now' : `Mock interview in ${mins} minute${mins > 1 ? 's' : ''}`,
        body: `${item.title} · ${time}. Click to open InterviewMate.`,
      });
      note.on('click', () => {
        const w = mainWindow();
        if (!w) return;
        showWindow(w);
        w.webContents.send('schedule:open', { id: item.id });
      });
      note.show();
    }
  }
}

app.whenReady().then(() => {
  // Windows shows notifications only for an app with an AppUserModelID.
  if (process.platform === 'win32') app.setAppUserModelId('local.interviewmate.app');
  initStores();
  registerIpc();
  applyCsp();
  createWindow();
  setInterval(checkReminders, 20_000);
  setTimeout(checkReminders, 3_000); // soon after launch, once the page can listen
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
