// InterviewMate — preload
// Exposes ONLY the narrow, named API below via contextBridge.
// Never expose ipcRenderer, Node.js, the filesystem, or any API key.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('interviewMate', {
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  initialTheme: process.argv.includes('--im-theme=light') ? 'light' : 'dark',
  setTheme: (theme) => ipcRenderer.invoke('app:setTheme', theme),

  credentials: {
    list: () => ipcRenderer.invoke('credentials:list'),
    add: (payload) => ipcRenderer.invoke('credentials:add', payload),
    test: (id) => ipcRenderer.invoke('credentials:test', id),
    remove: (id) => ipcRenderer.invoke('credentials:remove', id),
    setDisabled: (idOrPayload, disabled) => ipcRenderer.invoke(
      'credentials:setDisabled',
      idOrPayload && typeof idOrPayload === 'object' ? idOrPayload : { id: idOrPayload, disabled }),
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },

  gemini: {
    mintLiveToken: (payload) => ipcRenderer.invoke('gemini:mintLiveToken', payload),
    reportLiveQuota: (payload) => ipcRenderer.invoke('gemini:reportLiveQuota', payload),
    analyzeFrame: (arg) => ipcRenderer.invoke(
      'gemini:analyzeFrame',
      typeof arg === 'string' ? { jpegBase64: arg } : arg),
    generateFeedback: (payload) => ipcRenderer.invoke('gemini:generateFeedback', payload),
    translateTranscript: (payload) => ipcRenderer.invoke('gemini:translateTranscript', payload),
    summarizeReport: (payload) => ipcRenderer.invoke('gemini:summarizeReport', payload),
  },

  vocab: {
    paragraph: (payload) => ipcRenderer.invoke('vocab:paragraph', payload),
    explain: (payload) => ipcRenderer.invoke('vocab:explain', payload),
    speak: (payload) => ipcRenderer.invoke('vocab:speak', payload),
  },

  schedule: {
    list: () => ipcRenderer.invoke('schedule:list'),
    save: (item) => ipcRenderer.invoke('schedule:save', item),
    remove: (id) => ipcRenderer.invoke('schedule:remove', id),
    // Main -> page events. Each returns an unsubscribe function.
    onReminder: (cb) => {
      const h = (_e, data) => cb(data);
      ipcRenderer.on('schedule:reminder', h);
      return () => ipcRenderer.removeListener('schedule:reminder', h);
    },
    onOpen: (cb) => {
      const h = (_e, data) => cb(data);
      ipcRenderer.on('schedule:open', h);
      return () => ipcRenderer.removeListener('schedule:open', h);
    },
  },

  words: {
    list: () => ipcRenderer.invoke('words:list'),
    save: (word) => ipcRenderer.invoke('words:save', word),
    remove: (id) => ipcRenderer.invoke('words:remove', id),
  },

  reports: {
    exportPdf: (payload) => ipcRenderer.invoke('reports:exportPdf', payload),
    showExportedFile: () => ipcRenderer.invoke('reports:showExportedFile'),
  },

  sessions: {
    save: (session) => ipcRenderer.invoke('sessions:save', session),
    list: () => ipcRenderer.invoke('sessions:list'),
    remove: (id) => ipcRenderer.invoke('sessions:remove', id),
  },

  clearAllData: () => ipcRenderer.invoke('data:clearAll'),
});
