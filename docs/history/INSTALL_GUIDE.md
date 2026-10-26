# InterviewMate v1.0.0 — Complete Installation & First-Run Guide

InterviewMate is a local-first AI mock-interview desktop app for Windows.
It has no accounts, no cloud backend and no subscription. It runs on your
own computer; only the interview audio, transcript, CV text and (in Mode 2)
selected webcam stills are sent to Google's Gemini API when you run an
interview.

**Files**
- `InterviewMate-Windows-Portable-1.0.0.zip` (152 MB) — the ready-to-run app. **Use this one.**
- `InterviewMate-1.0.0-Source.zip` (181 KB) — source code only. Only needed if you want to rebuild it or build the installer yourself.
- SHA-256 (to check a download is intact):
  - Portable: `609e35ba962b1054e131b8696eeef9d3bedef33692efe047f3abd10688554269`
  - Source: `33a6b254981d3b54b09bb6f865ab4190e134662bcd7f04ba34a4b5afeb502de3`

**System requirements**
- Windows 10 or 11, 64-bit.
- A microphone and (optional) a webcam.
- Internet connection for Gemini interviews (not needed for Simulation mode).
- About 500 MB free disk space for the extracted app, plus room for your
  own sessions if you save them.

---

## Option A — Portable build (recommended, no installation)

### Step 1 — Download
1. Open the Drive folder link for InterviewMate (see the chat message).
2. Download `InterviewMate-Windows-Portable-1.0.0.zip`.
3. Wait for the download to finish completely before opening it.

### Step 2 — Extract
1. Right-click the downloaded zip and choose **Extract All**.
2. Choose a permanent location, for example `C:\Apps\InterviewMate` — do **not**
   run it from inside the zip or from Downloads if you plan to keep it.
3. Click **Extract** and wait until it finishes.
4. Open the extracted folder. You should see `InterviewMate.exe` plus folders
   such as `resources` and `locales`. If you only see the zip again, you have
   not extracted it yet.

### Step 3 — First run (Windows security prompt)
1. Double-click `InterviewMate.exe`.
2. Because this build is **not code-signed**, Windows may show a blue
   **"Windows protected your PC"** (SmartScreen) screen. This is expected for
   an unsigned local app, not a sign it is harmful.
   - Click **More info**, then **Run anyway**.
   - If your antivirus quarantines it, restore it and add the folder
     (`C:\Apps\InterviewMate`) to its exclusions — this is your own app, and
     you can inspect the full source in the source zip.
3. The app window opens on the **Dashboard**.

### Step 4 — Get a Gemini API key (free)
You only need this for real AI interviews. Simulation mode works without it.
1. In a browser, go to **Google AI Studio** (aistudio.google.com) and sign in
   with your Google account.
2. Click **Get API key** → **Create API key** (in a new or existing project).
3. Copy the key. Treat it like a password: never paste it into chat, email
   or a public place.

### Step 5 — Add the key in InterviewMate
1. In InterviewMate, open **Settings** (top navigation).
2. Under credentials, enter a name (e.g. "Main key") and an optional project
   label, paste the key, and click **Add**.
3. The key field clears immediately. Keys are encrypted with your Windows
   secure storage (DPAPI) and are never shown again.
4. Click **Test** next to the credential. It should show **ok**.
   - If Settings warns that secure storage is unavailable, do not add a key
     until that warning is resolved — the app refuses to store keys safely
     without it.
5. Leave **Free-tier only** switched **on**. This is the default and the
   recommended setting. It blocks any paid path in the app.

### Step 6 — Run your first interview
1. Click **New Interview**.
2. Choose a level: **Intern**, **Junior** or **Senior**.
3. Choose a mode:
   - **Voice + Webcam Preview** — your camera is shown locally only. Nothing
     visual is sent to Google.
   - **Voice + Periodic Webcam Coaching** — tick the consent checkbox first.
     A still frame is sent to Google roughly every 25 seconds for coaching on
     framing, lighting and face position only. A **Camera analysis ON** badge
     stays visible, and you can pause coaching at any time.
4. Optionally set a target role and duration (10/15/20/30 minutes).
5. Optionally upload your CV (PDF or DOCX, max 5 MB). Review the extracted
   skills and projects shown, and edit the summary if anything is wrong —
   **this reviewed summary is what the interviewer is allowed to ask about**.
   Without a CV, the interviewer uses general questions based on the role
   and skills you type in.
6. Click **Test microphone** and **Test camera**, allow the permissions,
   then click **Start interview** (the Begin button inside the room).
7. Answer out loud, one question at a time. The avatar speaks, listens and
   follows up. Click **End interview** whenever you are done, or let the
   timer end it.
8. On the summary screen you get feedback (strengths, improvements, practice
   questions, explained scores) and the transcript. Click **Save session**
   only if you want this session kept — nothing is saved unless you do.

### Step 7 — No key? Use Simulation mode
On the setup screen, switch on **Simulation mode** (clearly labelled
"not Gemini"). It runs the same interview flow with local questions and
your device's speech, so you can test the app, camera and microphone
without an API key.

---

## Option B — Build from source (for developers)

Requires **Node.js 22+** (LTS recommended) and **Git**.

### Step 1 — Install Node.js
1. Download the Windows LTS installer from nodejs.org and run it.
2. Accept the defaults, including adding Node to PATH.
3. Open a new PowerShell window and check:
   ```
   node -v
   npm -v
   ```

### Step 2 — Extract the source
1. Download `InterviewMate-1.0.0-Source.zip` from Drive.
2. Extract it to a folder, e.g. `C:\dev\interviewmate`.

### Step 3 — Install dependencies
In PowerShell, inside the extracted folder:
```
npm run setup
```

### Step 4 — Run it
```
npm run dev
```
This starts the Angular dev server and opens the desktop window with
live reload. Or run the production build in the window with:
```
npm start
```

### Step 5 — Run the tests (optional)
```
npm run verify
```
This runs the Electron backend tests (34) and the Angular tests (18) and
then builds the app.

### Step 6 — Build the real installer (optional)
```
npm run dist:win
```
This produces `dist\InterviewMate Setup 1.0.0.exe` on Windows (no Wine
needed there). It is unsigned, so the same SmartScreen "More info → Run
anyway" step applies when you install it.

---

## Troubleshooting

- **"Windows protected your PC"** — click More info → Run anyway (see Step 3
  of Option A). This happens because the build is unsigned, not because
  anything is wrong with it.
- **App opens but shows nothing / blank window** — close it, re-extract the
  zip to a folder whose path has no special characters, and run
  `InterviewMate.exe` again. Do not run it from inside the zip.
- **No microphone or camera** — check Windows Settings → Privacy &
  security → Microphone / Camera, and make sure InterviewMate is allowed.
  Re-test from the setup screen after changing permissions.
- **No sound from the interviewer** — check your output device and volume,
  and make sure no other app has exclusive control of the speaker.
- **Key test says invalid** — re-copy the key from AI Studio (no spaces
  before/after it) and add it again. A key belongs to one Google project.
- **Quota / rate-limit error** — you have hit your project's free-tier
  limit. Wait (limits reset at midnight Pacific time) or use a key from a
  different project. Adding more keys to the *same* project does not add
  quota, because limits are per project, not per key.
- **"Secure storage unavailable" in Settings** — the app will not store a
  key in that state. On Windows this usually means the user profile/DPAPI
  is restricted; use a normal local Windows user account.
- **Webcam coaching shows a failure notice** — the voice interview keeps
  going; coaching pauses itself. Check your key/quota and resume coaching
  from the room.
- **Something looks wrong in a CV summary** — edit the summary text on the
  setup screen before starting. The interviewer only uses that reviewed
  summary, so fixing it there fixes the questions.

## Privacy & data

- No account, no cloud backend, no recording by default. Sessions are saved
  only when you click Save session, and only on your computer.
- Settings → **Clear local data** deletes saved sessions, credentials and
  settings.
- When you run a Gemini interview, your spoken answers (transcript), CV
  summary and — in Mode 2 only — selected webcam stills are sent to Google
  for that interview. Free-tier content may be used by Google to improve
  its products; that is a Google free-tier term, and it is why the app
  shows the free-tier note in Settings.
- To remove the app: delete the extracted folder (portable) or uninstall
  it (installer build), then delete the app data folder if you want all
  local sessions gone.

## Uninstall

- Portable: close the app and delete the extracted folder.
- Installer build: Windows Settings → Apps → InterviewMate → Uninstall.


## Optional: paid usage (v1.1)

In **Settings**, **Allow paid usage** is off by default and asks for confirmation before turning on. When on, you can pick a paid text model (Gemini 3.1 Pro Preview or Gemini 4 Argon) for webcam-coaching notes and end-of-interview feedback only; voice interviews still use the free Live model. Paid calls are billed per token by Google to your key's Cloud project — link billing in Google AI Studio yourself first. A Google AI Pro / Google One subscription does not pay for API calls. Turning it off returns the text model to free Gemini 3.8 Flash.

## Optional: virtual camera background (v1.1)

In the interview room, the camera panel has a background picker: **None / Blur / Solid colour / Custom image**. It runs on your own computer (MediaPipe segmentation) and only changes what you see and what Mode 2 coaching stills show — it is not sent into the Live voice stream. If it cannot load, the app shows "Background effect unavailable — showing your original camera" and uses your normal camera.
