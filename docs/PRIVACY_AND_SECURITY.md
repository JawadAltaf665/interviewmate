# Privacy and security

InterviewMate is built for one person on one computer. It has no account, no server of its own and no analytics. This page explains what stays on your computer, what goes to Google, and how your API keys are protected.

## What stays on your computer

| Data | Where | Notes |
|---|---|---|
| API keys | `%APPDATA%\interviewmate\credentials.json` | Encrypted with Electron `safeStorage` (Windows DPAPI, tied to your Windows account). If OS encryption isn't available, the app refuses to save keys. |
| Saved interviews | `sessions.json` | Only saved when you press **Save session**. |
| Settings | `settings.json` | No secrets. |
| Saved words | `words.json` | |
| Scheduled interviews | `schedule.json` | Includes the setup, such as the CV summary. |
| Coach chats | `chats.json` | Your messages, the replies, and the data the Coach read to answer. |
| Exported reports | The PDF path you choose | |

**Settings → Clear local data** deletes all of the above, except PDFs you exported.

Some things are **never saved** by the app:

- microphone audio and camera video;
- Mode 2 coaching frames;
- custom background images;
- generated speech;
- your CV file. Only the summary you review is used, and it is saved with a session or scheduled interview if you save one.

## What is sent to Google (Gemini API)

| Feature | Sent | Not sent |
|---|---|---|
| Voice interview | Your microphone audio (live), the interviewer instructions, including your first name and the CV summary | Camera video (Mode 1), your API key (a short-lived token is used) |
| Mode 2 coaching (opt-in) | One still camera frame per interval | Video, audio from the frame |
| Feedback / translation | The interview transcript | Audio, video |
| Report AI summary | Saved scores and feedback text | Transcripts |
| Coach chat | Your messages and earlier messages in that chat; the saved data a question needs (scores, feedback text, a transcript only when asked, your schedule, saved words, page name); your voice question as audio, only when you use the microphone | API keys, your CV file, camera or interview audio |
| Vocabulary | Topic, level, your saved words (if "practise my saved words" is on), text you select for Speak or Meaning | Anything else |

**Free-tier note:** Google's terms allow content sent on the free tier to be used to improve Google products, and it may be reviewed by people. Don't paste anything confidential into a mock interview. For stricter handling, use a key from a Google Cloud project with billing enabled. Paid-tier data isn't used for training under Google's terms, but usage is then billed.

**Coach limits.** The Coach can only use the functions the app gives it. None of them reads API keys, deletes interviews, clears data, turns on paid usage, changes settings, or starts the microphone or camera for an interview. Every function that changes something waits for you to press **Confirm**. Function results are passed to the model as data, and its instructions say they are never commands.

## How keys are protected

- **Encrypted at rest** with the operating system's secure storage, and decrypted only inside the main process.
- **Never sent to the user interface.** The Settings page sees only names, labels and status.
- **Sent to Google in the `x-goog-api-key` header**, never in URLs, and never written to logs.
- **The voice interview uses an ephemeral token**: single-use, expiring within minutes, locked to the Live model. It is minted by the main process, so the web page never handles the real key.
- **The repository holds no keys.** `.gitignore` excludes `*credentials*.json`, `.env*` and `*api-key*`. The only key-like string in the source is an obviously fake value in a unit test.

## App hardening

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
- A **Content-Security-Policy**:
  - scripts come only from the app itself;
  - `wasm-unsafe-eval` is allowed for MediaPipe, but JavaScript `eval` is not;
  - network access goes only to `generativelanguage.googleapis.com`.
- **Navigation lock:** the window can't navigate away from the app. External links open in the system browser, https only.
- **Narrow IPC:** each channel validates its arguments in the main process. Model names are checked against an allow-list, and paid models are refused unless you turned on paid usage.
- **Camera and microphone** are only used on the Setup and interview screens, and they are stopped when the interview ends.

## Cost safety

- By default, only **free** Gemini models can be used. The main process forces a paid model back to Flash unless **Allow paid usage** is on.
- The app never enables billing. If the Google project behind your key has billing linked, even "free" models may be billed per token. Check the project's tier in Google AI Studio.
- A Google One or Google AI Pro subscription does **not** pay for API calls.

## Reporting a problem

If you find a security issue, please open an issue on the repository without including any real keys or personal data.
