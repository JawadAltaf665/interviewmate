# InterviewMate — Final build report (Segments 1–11 built in one pass)

## v1.1 (2026-10-24) — Tailwind redesign, virtual background, paid option

- **UI redesign (Tailwind v4, proven in built CSS):** glass top bar with nav pills, gradient dashboard hero, hover-lift cards, step indicator on setup, chat-bubble transcript and gradient avatar panel in the room. Routes, logic, IPC contracts and text meanings unchanged; legacy `.btn/.card/.field/.badge/.notice/.radio-card` classes kept working. Initial bundle 279 kB (main 261 kB, styles 16 kB), inside existing budgets.
- **Virtual camera background (interview room only):** None / Blur / Solid colour (Indigo, Teal, Charcoal) / Custom image (in-memory only, never saved or sent). On-device MediaPipe selfie segmentation, ≤640×360 at ~20 fps; raw video shows when off. Mode 2 coaching stills are taken from the processed canvas when an effect is active. Model-load failure shows 'Background effect unavailable — showing your original camera' and reverts to None. Only the mode is persisted (localStorage `interviewmate.bg.mode`). The background effect is applied to the preview you see and to coaching stills — it is NOT sent into the Live voice stream.
- **Paid option (Settings, off by default):** 'Allow paid usage' with a confirmation dialog. When on, the text-model picker unlocks Gemini 3.1 Pro Preview and Gemini 4 Argon for Mode 2 coaching notes and end-of-interview feedback only; voice interviews still use the free Live model. The choice is enforced in the main process (settings-store clamps a paid model back to Flash when the opt-in is off; a forged renderer payload cannot enable a paid model). The app never enables billing — the user links a billing account in Google AI Studio themselves, and a Google AI Pro / Google One subscription does NOT pay for API calls. If the key's project already has billing linked, even 'free' models may be billed per token — check the project's tier in AI Studio.
- **Verification (this machine):** backend tests 36/36 (34 + 2 new paid-gate tests), Angular tests 22/22 (18 + 4 virtual-background helper tests), production build OK, Electron smoke SMOKE_OK with the new dashboard. Live segmentation was proven in Electron on this VM with software WebGL (Xvfb blocklists GPU WebGL); real-webcam edge quality, frame rate on the user's hardware, and custom-image upload with a real photo remain his Windows-side checks.


Date: 2026-10-22. Built at the user's direction to complete the entire app and test it on the build side before reporting.

## What was built

- **Segment 1 — UI foundation:** dark charcoal + indigo theme, app shell with top navigation (Dashboard / New Interview / Settings), dashboard with Start Mock Interview, recent sessions, free-tier and privacy notes.
- **Segment 2 — Interview setup:** Intern/Junior/Senior cards, the two mode cards (Mode 2 requires an explicit consent checkbox), target role, duration (10/15/20/30 min), language, validation.
- **Segment 3 — Webcam/microphone:** local preview and mic/camera tests in setup, full preview + mic level meter in the interview room, all tracks stopped on exit.
- **Segment 4 — CV upload:** PDF (pdf.js) and DOCX (mammoth) extracted locally in the renderer, 5 MB limit, skills/projects summary shown for review and editing before use. Question grounding is enforced in the system prompt: with a CV summary, questions may only reference its skills/projects. Skill extraction is lexicon-based and only returns terms actually present in the text (unit-tested: an Angular/.NET CV does not yield Kubernetes/React/AWS).
- **Segment 5 — Avatar:** SVG interviewer with idle/speaking/listening/thinking/connecting/error states driven by real playback/connection state; `prefers-reduced-motion` respected. Lightweight mouth animation — not phoneme lip-sync.
- **Segment 6 — Credentials:** Settings screen with named credentials, test/disable/delete, per-project quota explanation. Keys are encrypted in the Electron main process with `safeStorage` and never returned to the renderer; if OS encryption is unavailable the app refuses to store keys and says so.
- **Segment 7 — Live voice:** Gemini Live via ephemeral tokens minted in the main process (token locked to the Live model, single-use). Renderer connects with `@google/genai` (v1beta) using only the short-lived token. Mic PCM 16 kHz in, PCM 24 kHz playback queue, input/output transcripts, session-resumption handle with reconnect attempts, states incl. reconnecting, end-on-duration. A clearly labeled **Simulation mode** (local questions + speech synthesis/recognition, NOT Gemini) is included so the full loop can be practiced/tested without a key.
- **Segment 8 — Webcam coaching (Mode 2):** still frame every coaching interval (default 25 s, configurable 15–120 s) sent through the main process to Gemini vision; persistent "Camera analysis ON" badge, pause/resume; feedback restricted to framing/lighting/face-in-frame/gaze; failures are non-blocking. Frames are never saved.
- **Segment 9 — Quota-aware failover:** errors classified (auth/permission/quota/rate-limit/billing/server/network/model); transient-only bounded retry (500 ms/1500 ms, max 2 per credential), 60 s cooldowns, failover across credentials from different projects; quotas are per project, never per key; free-tier model allowlist enforced in the main process — there is no paid path in the app.
- **Segment 10 — Feedback & history:** post-interview feedback from the actual transcript — Gemini when a key works, otherwise an honestly labeled local heuristic (it explicitly cannot judge technical accuracy). Sessions are saved ONLY when the user clicks Save. Clear-local-data wipes sessions, credentials and settings.
- **Segment 11 — Hardening & packaging:** CSP, navigation lockdown, validated IPC, secret scan, electron-builder packaging. **Produced artifact: a complete Windows portable build** (`InterviewMate.exe` + `resources/app.asar`, verified to contain the built UI and all Electron services) delivered as `InterviewMate-Windows-Portable-1.0.0.zip` — unzip and run, no installation. The NSIS *installer* could not be finished on this Linux machine: electron-builder's final step runs the installer under Wine, and this VM lacks the 32-bit Wine runtime (`syswow64/ntdll.dll` load failure) — the partial 186 KB setup stub was discarded, not shipped. On the user's Windows PC, `npm run dist:win` produces the real NSIS installer natively with no Wine involved; the portable build is functionally identical.

## Verification performed on the build machine (Linux VM)

- Electron backend unit tests (`node --test "electron/**/*.test.cjs"`): **34/34 passed** — error classification, encrypted credential store (asserts the raw key never appears in the persisted file), session store cap/ordering, settings clamping, Gemini failover (quota on credential 1 → success on credential 2), token request shape, feedback JSON parsing, free-model allowlist rejection with zero network calls.
- Angular unit tests (`ng test`): **18/18 passed** — CV grounding prompt rules, CV extraction (including negative cases), local feedback honesty, app shell.
- Angular production build: **passed** (initial bundle ~266 kB; pdf.js, mammoth and @google/genai are lazy chunks).
- Integrated Electron smoke test (Xvfb): **SMOKE_OK** — the packaged-style build loads, the dashboard renders, and live IPC round-trips succeed through the real preload bridge (`getAppInfo`, `credentials.list` = 0, `settings.get` freeTierOnly = true, `sessions.list` = 0).
- Secret scan over the source: no API keys or credentials (only an obviously fake key string inside a unit test).
- Integration fix found and fixed during verification: credential/session mutation IPC now returns the full updated list, matching the UI contract.

## Not verifiable on this machine (needs the user's Windows PC + own API key)

- A real Gemini Live interview (needs the user's own key, entered in Settings — keys are never handled in chat).
- Windows webcam/microphone devices and permissions, Windows `safeStorage` (DPAPI) availability — this Linux VM has no OS keyring, so it correctly reported `safeStorageAvailable: false` and would refuse to store keys here; Windows should report true.
- The Windows installer's install/run experience and SmartScreen behavior (unsigned installer — expect a SmartScreen warning; code signing needs a paid certificate, out of scope per the brief).
- Speech recognition availability in Simulation mode depends on the Chromium build/online speech service; a text-answer fallback is provided.

## Known limitations

- Avatar speaking animation is playback-state driven, not true lip-sync (per brief §6).
- Barge-in: already-queued short audio chunks (≤ ~100 ms) cannot be individually cancelled.
- CV project/role extraction is heuristic; the user reviews and edits the summary before it is used — that review step is the grounding guarantee's human check.
- Live sessions are capped by Google (15 min audio-only); resumption is implemented, but very long interviews still depend on Google accepting reconnects.
