# Development

## Requirements

- **Windows 10/11.** The app is developed and packaged on Windows. It should also run on macOS and Linux, but that isn't tested.
- **Node.js ≥ 22.22.3**, which the Angular CLI requires. Node 24 is recommended.
- **npm** (bundled with Node).
- **Git.**

If your installed Node is older, you can run any command through a newer Node without installing it:

```bash
npx -y -p node@24 -- node --version
```

## Get the code and install

```bash
git clone https://github.com/JawadAltaf665/interviewmate.git
```

```bash
cd interviewmate
```

```bash
npm run setup
```

`npm run setup` installs the root packages (Electron, electron-builder) and the Angular app's packages in `ui/`.

## Run

| Command | What it does |
|---|---|
| `npm run dev` | Angular dev server on http://localhost:4200, plus an Electron window with live reload |
| `npm start` | Builds the UI, then opens the production build in Electron |
| `npm run smoke` | Builds, opens the app, checks it loaded, and closes it (prints `SMOKE_OK`) |

You'll need a Google AI Studio key in **Settings** to try the Gemini features. Simulation mode works without one.

## Test

```bash
npm test
```

This runs both suites:

| Suite | Command | Count |
|---|---|---|
| Electron services | `npm run test:electron` (Node's built-in test runner, `electron/**/*.test.cjs`) | 59 tests |
| Angular | `npm run test:ui` (Vitest via the Angular CLI, `ui/src/**/*.spec.ts`) | 67 tests |

`npm run verify` runs all tests and then a production build.

## Package a Windows build

```bash
npm run build:ui
```

Then build either the **portable** folder (used for the GitHub releases):

```bash
npx electron-builder --win --dir
```

This writes `dist/win-unpacked/`. Zip that folder as `InterviewMate-Windows-Portable-<version>.zip`.

Or build the **NSIS installer**:

```bash
npm run dist:win
```

This writes `dist/InterviewMate Setup <version>.exe`.

The build isn't code-signed (`signAndEditExecutable: false`), so Windows SmartScreen shows a warning the first time it runs.

## Release checklist

1. Bump `version` in `package.json`. The sidebar shows it.
2. Add a section to `CHANGELOG.md`.
3. `npm run verify`.
4. Package, then smoke-test the packaged `InterviewMate.exe`.
5. Commit, then tag `v<version>`.
6. Create a GitHub release with the zip attached and the changelog section as the notes.

## Code map

```text
interviewmate/
├── electron/
│   ├── main.cjs                # window, CSP, IPC handlers, reminders, PDF export
│   ├── preload.cjs             # window.interviewmate bridge
│   └── services/
│       ├── gemini.cjs          # all Gemini REST calls, model allow-list, fallback, failover
│       ├── errors.cjs          # error classification
│       ├── credential-store.cjs
│       ├── settings-store.cjs
│       ├── session-store.cjs
│       ├── word-store.cjs
│       ├── schedule-store.cjs
│       ├── chat-store.cjs
│       └── *.test.cjs
├── ui/
│   └── src/app/
│       ├── app.ts / app.html   # shell: sidebar, banners, hosted interview room
│       ├── app.routes.ts
│       ├── core/               # live-session, prompt, cv, feedback-local, report,
│       │                       # vocab, speech, schedule, session-state, bridge, theme,
│       │                       # coach (loop), coach-tools (functions), coach.service
│       ├── features/           # dashboard, interview-setup, interview-hub, interview-room,
│       │                       # feedback, reports, vocabulary, coach, settings
│       └── shared/             # avatar, bg-picker, coach-chat
├── docs/                       # this documentation + screenshots + history/
├── CHANGELOG.md
└── package.json                # scripts + electron-builder config
```

## Conventions

- **Only the main process talks to the Gemini REST API with a real key.** New AI features need:
  - a function in `gemini.cjs`;
  - a validated `ipcMain.handle` in `main.cjs`;
  - a method in `preload.cjs`;
  - types in `interviewmate-api.ts`;
  - a wrapper in `bridge.service.ts`.
- **Add new model names to `FREE_MODELS`** (or `PAID_MODELS`). Anything else is rejected.
- **Angular code** uses standalone components and signals, and the new control flow (`@if`, `@for`, `@defer`).
- **Styling** uses the theme tokens in `ui/src/styles.scss`. Don't hard-code colours, so light and dark themes stay in sync.
- **Never commit** keys, `.env` files, real session data or exported PDFs. `.gitignore` covers the usual cases.
