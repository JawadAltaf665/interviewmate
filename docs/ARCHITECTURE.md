# Architecture

InterviewMate is an **Electron** desktop app with an **Angular** user interface. It has no server of its own. The app talks directly to Google's Gemini API, and everything it stores is plain JSON on your computer (API keys are encrypted).

## Overview

```text
┌───────────────────────────────── Electron app ─────────────────────────────────┐
│                                                                                │
│  Renderer (Angular 22, sandboxed)      Preload           Main process (Node)   │
│  ui/src/app                            electron/          electron/main.cjs    │
│                                        preload.cjs                             │
│  ┌──────────────────────────┐        ┌────────────┐     ┌─────────────────────┐│
│  │ features/                │        │ contextBridge     │ services/           ││
│  │  dashboard               │ invoke │ window.        ───►│  credential-store   ││
│  │  interview-setup         │───────►│ interviewmate │    │  settings-store     ││
│  │  interview-hub           │        │  .credentials │    │  session-store      ││
│  │  interview-room ──┐      │◄───────│  .gemini      │    │  word-store         ││
│  │  feedback         │      │ events │  .sessions    │    │  schedule-store     ││
│  │  reports          │      │        │  .vocab/.words│    │  gemini (REST)      ││
│  │  vocabulary       │      │        │  .schedule    │    │  errors             ││
│  │  settings         │      │        └────────────┘     └──────────┬──────────┘│
│  └───────────────────┼──────┘                                      │           │
│        core/live-session.ts (Gemini Live over WebSocket,           │           │
│        using a short-lived token from the main process)            │           │
└────────────────────────┼───────────────────────────────────────────┼───────────┘
                         ▼                                           ▼
          wss://generativelanguage.googleapis.com      https://generativelanguage.googleapis.com
          (Live voice)                                 (tokens, feedback, TTS, vision, vocab)
```

## The three layers

### 1. Main process: `electron/main.cjs`
This layer has full Node.js access and owns everything sensitive:

- **Window:** frameless, with `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`. Navigation is locked to the app; external links open in the system browser and must be https.
- **Content-Security-Policy:**
  - scripts come only from the app itself (plus `wasm-unsafe-eval` for MediaPipe);
  - network access goes only to `generativelanguage.googleapis.com` over https and wss.
- **IPC handlers:** each `ipcMain.handle(...)` validates its input. The channels are:
  - `credentials:*`
  - `settings:*`
  - `sessions:*`
  - `gemini:*`
  - `vocab:*`
  - `words:*`
  - `schedule:*`
  - `reports:exportPdf`
  - `data:clearAll`
- **Reminders:** a 20-second timer checks `schedule.json`. Due reminders trigger an Electron `Notification`, a taskbar flash, and an event to the page.
- **PDF export:** `webContents.printToPDF` writes the A4 report.

### 2. Preload: `electron/preload.cjs`
The preload is a narrow, typed bridge. It exposes `window.interviewmate` through `contextBridge`, and each method maps to exactly one IPC channel. The page never gets `ipcRenderer`, Node, or the file system. The matching TypeScript types are in `ui/src/app/core/interviewmate-api.ts`, and `bridge.service.ts` wraps them for Angular.

### 3. Renderer: `ui/`
The renderer is an Angular 22 app built from standalone components, signals and SCSS.

| Folder | Contents |
|---|---|
| `core/` | Logic with no UI: the Live session client, prompt builder, CV reader, local feedback, report maths, vocabulary helpers, speech service, schedule logic, theme and shared session state |
| `features/` | One folder per sidebar page |
| `shared/` | The avatar and the background picker |

`app.html` is the shell. It holds the sidebar, the banners, and **the interview room itself**. The room is created when an interview opens and only hidden (not destroyed) when you switch tabs, so the microphone, camera, WebSocket and timer survive navigation.

## Gemini models and fallback

All model names live in one place: `FREE_MODELS` in `electron/services/gemini.cjs`. The main process rejects any model that isn't on the allow-list.

| Use | Models, in fallback order |
|---|---|
| Live voice interview | `gemini-3.8-live` → `gemini-3.1-flash-live-preview` |
| Feedback, translation, report summary, coaching notes | selected text model → `gemini-3.8-flash` → `gemini-3.5-flash-lite` |
| Vocabulary paragraphs and meanings (speed first) | `gemini-3.5-flash-lite` → `gemini-3.8-flash` |
| Read-aloud (TTS) | `gemini-3.8-flash-tts` → `gemini-3.8-flash-lite-tts` → `gemini-3.1-flash-tts-preview` → Windows offline voice |

Paid models are only allowed when **Allow paid usage** is on in Settings. The main process enforces this, so a forged request from the page can't switch it on.

### Error handling and key failover
`electron/services/errors.cjs` sorts every failure into one of these types: auth, permission, quota, rate-limit, billing, server, network or model.

- **Temporary errors** (server, network, short rate limits) are retried at most twice per key, after 500 ms and then 1500 ms.
- **Quota and server failures** put that key on a 60-second cooldown, and the next enabled key is tried. Quotas belong to Google *projects*, so this only helps when keys come from different projects.
- **A Live session closed for quota** parks its key for 30 minutes, and the interview reconnects with the next key.
- **When every key is exhausted**, the app stops and says so. It never loops.

### The Live voice session
`ui/src/app/core/live-session.ts` runs the voice session:

1. The renderer asks the main process for a token (`gemini:mintLiveToken`). The main process calls the `auth_tokens` endpoint with your key and returns a **single-use, short-lived** token, locked to the Live model.
2. The renderer connects with `@google/genai` using only that token. It sends:
   - the system instruction built by `prompt.ts` (level, CV summary, persona, language, answer-pacing rules);
   - a kickoff turn, so the interviewer speaks first.
3. Microphone audio goes up as 16 kHz PCM. The interviewer's audio comes back as 24 kHz PCM and is played through a queue. Input and output transcriptions build the transcript.
4. **Answer pacing:**
   - **Automatic mode:** low end-of-speech sensitivity plus your chosen silence length.
   - **Manual mode:** voice detection is turned off, and the app sends `activityStart`/`activityEnd` itself.
   - **Space/Enter:** sends `audioStreamEnd` and mutes the mic until the reply arrives.
5. **Reconnects** use the session-resumption handle.

## Storage

Everything is stored in Electron's `userData` folder, `%APPDATA%\interviewmate`:

| File | Contents | Written by |
|---|---|---|
| `credentials.json` | API keys, **encrypted** with `safeStorage` (Windows DPAPI), plus names, labels and enabled flags | `credential-store.cjs` |
| `settings.json` | Theme, text model, paid opt-in, coaching interval, vocabulary preferences | `settings-store.cjs` |
| `sessions.json` | Saved interviews: setup, transcript, feedback, scores, translations | `session-store.cjs` |
| `words.json` | Saved vocabulary words (max 500) | `word-store.cjs` |
| `schedule.json` | Scheduled interviews with their full setup and reminder flags (max 50) | `schedule-store.cjs` |

The stores write atomically (to a temporary file, then rename), validate shapes on load, and cap their sizes. **Clear local data** deletes all of them.

Some things are deliberately kept **only in memory** and never written to disk:

- microphone audio;
- camera frames;
- custom background images;
- generated speech clips (an in-memory cache of up to 40 blob URLs).

## Testing

- **Electron services:** Node's built-in test runner (`electron/**/*.test.cjs`), 53 tests. They cover:
  - the stores;
  - error classification;
  - the model allow-list and paid gate;
  - fallback chains;
  - parsing of vocabulary replies;
  - reminder timing.
- **Angular:** Vitest via the Angular CLI (`*.spec.ts`), 45 tests. They cover:
  - prompt building;
  - CV extraction;
  - local feedback;
  - report maths;
  - vocabulary helpers;
  - schedule buckets;
  - the virtual-background helpers;
  - the shell, including "the interview room stays alive while switching tabs".

How to run them is in [DEVELOPMENT.md](DEVELOPMENT.md).
