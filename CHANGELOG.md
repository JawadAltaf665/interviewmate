# Changelog

Every version listed here has a Windows portable build on the [Releases](../../releases) page.

## v1.11.0: Coach chat
- **New Coach chat** that helps you understand your feedback and decide what to improve, using your real results.
  - **Ask Coach** button on every page opens a side panel; the new **Coach** tab shows the chat full width with your saved chats.
  - **Discuss with Coach** buttons on Feedback (latest result and each saved interview) and Reports.
  - Answers in English, Urdu or Roman Urdu. Type, or use the **microphone** (up to 60 s, turned into text you can check). **Listen** reads a reply aloud.
- **Reads your data through functions.** It lists and reads saved interviews (the transcript only when needed), builds progress reports with recurring strengths and weaknesses, and checks your schedule and saved words. Chips under each reply show what it read.
- **Acts only after you confirm.** Open a page, prepare an interview (fills in New Interview), schedule, reschedule or remove an interview, save words, practise words in Vocabulary, or save a report as PDF. Each shows a **Confirm / Cancel** card first.
- **Deliberately can't:** see API keys, delete interviews, clear data, turn on paid usage, change settings, or start the microphone or camera.
- **Practice focus** field on New Interview: topics the interviewer should lean towards. The Coach can fill it in; it is saved with scheduled interviews.
- Chats are saved in `chats.json` (latest 50). **Clear local data** removes them too.
- Uses the same free models and key failover as feedback (Gemini 3.8 Flash, then 3.5 Flash-Lite).

## v1.10.0: interviews survive tab switches, plus scheduled interviews
- **Fix: switching tabs no longer ends a running interview.**
  - Cause: the interview room was a normal page. Leaving the page destroyed it, and its clean-up closed the Gemini Live connection, the microphone and the camera.
  - Fix: the room now lives in the app shell and is only hidden on other tabs. The voice, timer and transcript keep running.
  - A red **"Interview in progress · 12:31 left"** banner and a **LIVE** badge in the sidebar take you back to the room.
  - Space and Enter only send an answer while the room is on screen.
- **New Interview tab** in the sidebar. It shows the running interview room, or your schedule when no interview is running:
  - **Due card:** shown from 10 minutes before an interview's time until 1 hour after, with **Start interview**.
  - **Upcoming:** date, time and countdown, with **Start now**, **Change time** and **Remove**.
  - **Missed:** interviews whose time has passed, with **Start now** and **Reschedule**.
  - **Empty state:** "No interview scheduled".
- **Schedule for later** on the New Interview page. Set up the interview as usual (CV, level, language, mode…), then pick an exact date and time. The whole setup is saved in `schedule.json` and starts in one click. The sidebar badge counts scheduled interviews.
- **Reminders** 10 minutes before and at the scheduled time, while the app is open (minimised is fine):
  - a Windows notification (click it to open the Interview tab);
  - an in-app banner with a chime, plus **Start now** and **Later** buttons;
  - a flashing taskbar icon.
  - Windows notifications only appear if they are switched on in Windows Settings → System → Notifications.
- "Clear local data" also removes scheduled interviews.

## v1.9.0: Vocabulary practice tab
- New **Vocabulary** tab in the sidebar, below Reports. It uses the same Gemini keys and moves to your next key when one runs out.
- **⟳ New paragraph** writes a fresh practice paragraph. You choose:
  - **Topic:** Job interview, Tech & IT, Office, Daily life or Surprise me.
  - **Level:** Easy, Medium or Advanced.
  - **Length:** Short or Medium.
  - **Key words:** 6–8 per paragraph, underlined in the text. Each has a meaning, word type, example sentence, a "say it" syllable guide and, if you turn it on, an **Urdu meaning**.
- **Listen** reads the paragraph aloud with a Gemini voice (Kore, Aoede, Puck or Charon):
  - **Speed:** Slow (0.75×), Medium (1×) or Fast (1.25×). You can change it while it plays, and the voice keeps its natural pitch.
  - **Highlight:** the sentence being read is highlighted. With Gemini voices this follows the audio closely but not perfectly, because Gemini doesn't report word timings.
  - **Saved audio:** once a clip has been created it is kept in memory, so replays and speed changes don't use quota. The first play of a paragraph takes about 10–20 s; a single word takes about 3–4 s.
- **Select any word or sentence** to get a small bar with:
  - **Speak:** reads exactly what you selected.
  - **Meaning:** a meaning card. This also works for whole sentences, which are rewritten in simple English.
  - **Save:** adds the selection to My words.
  - Double-clicking a word speaks it straight away.
- **My words:** saved words stay on your computer (`words.json`) until you press ×. **Practise my saved words** works some of them into the next paragraph.
- **Windows voice (offline):** choose it in the voice list for instant, free speech. The app also switches to it automatically if the Gemini voice is unavailable (no quota or no network). With this voice it highlights exactly the sentence being read.
- Paragraphs and meanings use the fast free model `gemini-3.5-flash-lite` first (about 2–3 s), because Flash was often overloaded and timed out. Voice models, in order: `gemini-3.8-flash-tts`, `gemini-3.8-flash-lite-tts`, `gemini-3.1-flash-tts-preview`.
- Settings → **Clear local data** now also removes saved words.

## v1.8.0: combined progress reports and PDF export
- New **Reports** tab in the sidebar, below Feedback. It combines every saved interview in a period: **1 day, 3 days, 7 days, 30 days, 3 months**, or a **custom** From/To range. A reversed range is swapped automatically.
- The report shows:
  - **KPI tiles:** interviews, practice time, average and best score, and the change from the first to the last interview.
  - **Score trend line:** hover over a point to see its date and title.
  - **Average per skill area:** relevance, clarity and technical depth.
  - **Strengths and areas to improve:** dated, newest first, with duplicates removed.
  - **Table of the interviews included.**
- All of this is calculated on your computer, without a Gemini call. Interviews saved without scores are counted but left out of the averages, and the report says so.
- **AI summary** (optional button) sends only the saved scores and feedback text to Gemini; transcripts are not sent. It returns one coaching overview with "Going well", "Focus areas" and "Next steps".
- **Save as PDF** opens a Save dialog (Documents by default) and writes an A4 PDF. The PDF always uses the light theme, hides the sidebar and buttons, and includes the AI summary if one was generated. **Show in folder** then opens the saved file's location.
- **Fix:** Gemini returns feedback scores as an object, but the Feedback page expected a list, so scores showed "—". They now show on the Feedback page, in the saved history and in reports.

## v1.7.0: send your answer now (Space / Enter)
- In **both** answer modes, a button under the question, or **Space** or **Enter**, ends your answer immediately. The button reads "Send answer now" in Automatic mode and "Done answering" in manual mode. The keys are ignored while the interviewer is talking or while you are typing in a field.
- Automatic mode: Gemini's voice detection doesn't accept an "end of answer" signal, so the app sends "microphone off" (`audioStreamEnd`) and mutes the mic until the interviewer replies. Measured result: the reply comes 0.9–1.2 s after the key press, instead of after the 4 s pause. If nothing comes back within 6 s (for example because nothing was said yet), the mic reopens automatically.

## v1.6.0: the interviewer no longer cuts you off
- **Cause:** Gemini Live decides your answer is over based on silence. Its Live default (`END_SENSITIVITY_HIGH`, a short silence) treated a thinking pause as the end of the answer, so the next question arrived mid-thought.
- **Automatic mode (default):** low end-of-speech sensitivity, plus a pause you choose before the interviewer replies: 1.5 s, 2.5 s (recommended) or 4 s. You pick it on Setup under "When you finish an answer". The interviewer is also told to say "Take your time" or "Go on" instead of moving on when an answer sounds unfinished.
- **Manual mode:** "I'll press Done answering" turns automatic detection off. Your turn opens when the interviewer stops speaking and ends only when you press **Done answering** (or Space). Silence never ends it, and the interviewer can't cut in.
- Tested live with a recorded answer containing a 2 s pause. Automatic mode waited for the full answer; manual mode stayed silent through 20 s of silence until Done was pressed.

## v1.5.0: light mode
- **Light / dark theme:** a sun | moon switch in the title bar. Dark stays the default. The choice is saved in the app's settings file, so the window (including the native minimise, maximise and close buttons) opens in that theme next time, with no dark flash. Browser `localStorage` isn't used for this because it didn't survive restarts under `file://`.
- Hard-coded dark colours were replaced with theme tokens (`--hover`, `--track`, `--sunken`, `--stage-from`, …) in `styles.scss`, so both themes stay in sync.

## v1.4.0: real-interview opening, draggable PiP, saved feedback history
- **Interviewer persona:** each interview gets a named interviewer (Alex, Jack, Ryan… or Ahmed, Bilal, Hamza… for Urdu). It opens like a real call ("Hey Jawad, Alex here. How are you doing today?"), waits for your reply, explains the format, asks you to introduce yourself, and then starts the actual questions. The name shows on the stage and in transcripts.
- **Your name from the CV:** the name is read from the top of the CV (or a "Name:" line) into a new editable "Your name" field on Setup. Without a name the interviewer says "Hey there" and never makes one up. Only a plain first name reaches the prompt.
- **Draggable picture-in-picture:** drag the floating camera anywhere inside the window. It remembers the spot, and scrolling back to the camera panel still docks it.
- **Saved interviews on the Feedback page:** saving now stores the feedback, scores and translations with the session. Earlier saved interviews are listed as collapsible items (score, date, level) that stay until you press **Remove** and confirm. Starting a new interview only replaces the unsaved current result, and the page says so.

## v1.3.0: camera backgrounds, PiP, Urdu, key failover
- **Camera background (blur, colour or image) never worked.** Two causes:
  - The CSP blocked WebAssembly. Added `'wasm-unsafe-eval'`, which allows WebAssembly only, not JavaScript eval.
  - MediaPipe's classic script was bundled as an ES module, so `SelfieSegmentation` was undefined. It is now loaded as a script from the bundled `mediapipe/` assets.
  - The segmenter is kept for the app's lifetime, because MediaPipe can't be re-created after `close()`.
- **Background picker on Setup:** Teams-style tiles next to the camera preview. The choice carries into the interview room.
- **Picture-in-picture camera:** scrolling the interview room moves the camera into a floating preview at the bottom-left. It returns when you scroll back or click its expand button.
- **Urdu interviews:** interview language English or Urdu, with an Urdu prompt and `ur-PK`/`en-US` transcription hints. Transcript and feedback language English or Urdu: the mixed-language transcript is translated after the interview, with an English / اردو / Original toggle on the Feedback page.
- **Live key failover:** when Google closes a Live session because of quota, that key is parked for 30 minutes and the interview reconnects with the next saved key. When every key is out of quota, the app says so instead of retrying.
- Malformed model replies now fall back to the next model instead of to local feedback.

## v1.2.0: fixes and redesign
- **The live interview never started.** The token request sent the SDK-only field `liveConnectConstraints`, which the REST API rejects (`Cannot find field`). Tokens are now created with `uses`/`expireTime`/`newSessionExpireTime` only.
- **The interviewer stayed silent.** Live models wait for input, so the app now sends a kickoff turn and the interviewer greets you and asks the first question.
- **Gemini feedback always fell back to local feedback.** The UI sent `level: "junior"`, but the main process only accepted `"Junior"`. The check is now case-insensitive.
- **Slow or failing feedback.** A selected model that is out of quota or overloaded (for example Pro Preview with no free quota, or Flash returning 503 "high demand") now falls back automatically: selected model → Gemini 3.8 Flash → Gemini 3.5 Flash-Lite. Requests time out after 45 s instead of hanging for minutes. Google's 429 "check your plan and billing" text is now treated as a quota error, not a billing error.
- **Unstyled UI in the packaged app.** Angular's critical-CSS inlining relies on an inline `onload` handler that the app's CSP blocks, so the main stylesheet never applied. `inlineCritical` is now turned off.
- **New UI:** frameless window with native controls, sidebar navigation, a refreshed design system, and redesigned dashboard, setup (sticky summary), interview room, feedback (score ring) and settings pages.

## v1.1.0: redesign, virtual background, paid option
- **UI redesign** with a glass top bar, gradient dashboard hero, step indicator on Setup and a chat-bubble transcript.
- **Virtual camera background** (None, Blur, Solid colour or Custom image) using on-device MediaPipe segmentation. It applies to your preview and to the coaching stills, not to the voice stream.
- **Paid option** in Settings, off by default and confirmed with a dialog. It unlocks Pro-class text models for coaching notes and feedback only. The main process enforces it, so a forged request from the page can't turn it on.
- Builds on the complete v1.0 app: interview setup, webcam and microphone tests, CV upload, animated interviewer avatar, encrypted API keys, Gemini Live voice, webcam coaching (Mode 2), quota-aware failover, feedback and history, and a hardened, packaged Electron shell.
- See [docs/history/FINAL_BUILD.md](docs/history/FINAL_BUILD.md) for the original build report.
