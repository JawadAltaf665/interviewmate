# Segment 0 — Discovery and project setup

Date: 2026-10-22. Status: built and verified on the build machine (Linux VM); Windows acceptance is the user's step below.

## Goal
Runnable empty desktop app: Angular + Electron scaffold, secure shell, dev scripts, Git, and verified Gemini constraints. No product features (dashboard is Segment 1).

## Environment inspected
- Workspace was empty for this project (no prior InterviewMate code).
- Node v24.20.0, npm 10.9.4, Git 2.43.0, Angular CLI 22.2.4 (via npx), Electron 45, electron-builder 26.
- User target: Windows (PowerShell commands in README).

## What was delivered
- `ui/` — generated Angular 22 app (standalone, routing, SCSS), placeholder shell page titled "InterviewMate / Segment 0 — scaffold running", feature folders stubbed: core, shared, features/{dashboard, interview-setup, interview-room, resume, settings, feedback}.
- `electron/main.cjs` — secure window: contextIsolation true, nodeIntegration false, sandbox true, webSecurity true; navigation locked to app/dev URL; external links https-only via system browser; CSP header for packaged renderer; one validated IPC channel (`app:info`); smoke-test mode (`INTERVIEWMATE_SMOKE=1`).
- `electron/preload.cjs` — contextBridge exposing only `window.interviewMate.getAppInfo()`. No ipcRenderer/Node/fs exposed.
- `electron/services/`, `electron/security/` — empty, reserved for later segments.
- Root `package.json` — scripts: setup, dev, dev:ui, build:ui, start, smoke, dist:win (electron-builder NSIS config stub for Segment 11).
- `.gitignore` — node_modules, dist, and secret patterns (.env, credentials, api-key files).
- `docs/GEMINI_VERIFICATION.md` — official-doc findings and design consequences.

## Verification actually performed
- `npm run build:ui` — production Angular build succeeded (output `ui/dist/ui/browser/index.html`, title "InterviewMate").
- Angular unit tests: 2/2 passed (`ng test --watch=false`).
- Electron smoke test under Xvfb: `SMOKE_OK title="InterviewMate" body="InterviewMate Segment 0 — scaffold running..."`, exit 0. (Linux container required `--no-sandbox` at the CLI; not needed on Windows.)
- NOT verified here: Windows run, webcam/mic, Gemini Live with a real key (Segment 6/7, user's key entered in-app only).

## Acceptance checklist (user, on Windows)
- [ ] Extract the zip, open PowerShell in the `interviewmate` folder.
- [ ] Run `npm run setup` — completes without errors.
- [ ] Run `npm run dev` — a desktop window opens showing "InterviewMate — Segment 0 — scaffold running"; Angular dev server runs at http://localhost:4200.
- [ ] Close the window — the app exits cleanly.
- [ ] Run `npm start` — production build opens in the desktop window without the dev server.
- [ ] Optional: `npm run smoke` — prints `SMOKE_OK` (on Windows it still opens/closes the app automatically).
- [ ] Reply confirming Segment 0 works (or paste any error) before Segment 1 starts.
