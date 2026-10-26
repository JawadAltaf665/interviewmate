# Features: what, how and why

This page covers every part of InterviewMate in the order you meet it in the sidebar. Each feature has three parts:

- **What it does**: what you see and use.
- **How it works**: what happens behind the screen.
- **Why it helps**: the problem it solves for interview practice.

Contents:

1. [Dashboard](#1-dashboard)
2. [New Interview (setup)](#2-new-interview-setup)
3. [The voice interview](#3-the-voice-interview)
4. [Interview tab and scheduling](#4-interview-tab-and-scheduling)
5. [Feedback](#5-feedback)
6. [Reports](#6-reports)
7. [Vocabulary](#7-vocabulary)
8. [Settings and API keys](#8-settings-and-api-keys)
9. [Theme, window and small things](#9-theme-window-and-small-things)

---

## 1. Dashboard

![Dashboard](screenshots/dashboard.png)

**What it does.** The dashboard is the home screen. It shows:

- a **Start mock interview** button;
- your saved session count, last practice date and total practice time;
- your most recent sessions;
- a Gemini status pill in the sidebar ("Gemini ready · 1 active key").

**How it works.** The numbers come from `sessions.json` on your computer. The status pill asks the main process how many enabled API keys exist. The key itself is never sent to the page.

**Why it helps.** You can see at a glance whether you are practising regularly and whether the app is ready to go.

---

## 2. New Interview (setup)

![Setup](screenshots/setup.png)

### Level
**What it does.** You choose **Intern**, **Junior** or **Senior**. Each level changes the kind of questions and how hard the follow-ups push:

- **Intern:** fundamentals, a friendly tone and extra thinking time.
- **Junior:** practical application and debugging.
- **Senior:** architecture, trade-offs and challenging follow-ups.

**How it works.** The level becomes part of the interviewer's system instructions (`ui/src/app/core/prompt.ts`).

**Why it helps.** You can practise for the interview you actually have, rather than one generic difficulty.

### Mode
**What it does.**
- **Mode 1, Voice interview + webcam preview:** you see yourself, like in a video call. No camera images are sent to the AI.
- **Mode 2, Voice interview + webcam coaching:** with your explicit consent, one still frame is sent to Gemini every 25 s (adjustable from 15 to 120 s in Settings). You get short tips on framing, lighting and eye contact. A "Camera analysis ON" badge stays visible, and you can pause it.

**How it works.** In Mode 2 the frame is captured from the camera canvas, sent through the main process to a Gemini vision model, and then discarded. Frames are never saved.

**Why it helps.** Body language and presentation matter in video interviews, but many people don't want their camera analysed. So it is off unless you turn it on.

### CV upload
**What it does.** You attach a PDF or DOCX CV (up to 5 MB). The app pulls out your name, skills and projects so you can check them before you start. Questions then stay grounded in that CV. Without a CV, the app uses general questions for the role and skills you type.

**How it works.**
- The CV is read **on your computer** with pdf.js (PDF) or mammoth (DOCX).
- Skill extraction is lexicon-based and only returns terms that actually appear in your text. For example, an Angular/.NET CV never produces "Kubernetes".
- Only the reviewed summary (not the file) goes into the interviewer's instructions.
- The interviewer is told to reference only what the summary contains.

**Why it helps.** Real interviewers ask about *your* projects. Being questioned on your own experience is the best preparation, and it stops the AI from inventing technologies you never used.

### Role, duration, language and name
- **Target role** and **general skills** (used when there is no CV).
- **Duration:** 10, 15, 20 or 30 minutes.
- **Interview language:** English or Urdu.
- **Transcript and feedback language:** English or Urdu. The transcript is translated after the interview.
- **Your name:** filled in from the CV and editable. The interviewer greets you by first name. With no name, it says "Hey there" and never makes one up.

### When you finish an answer
**What it does.** You pick how the interviewer knows your answer is over:

- **Automatic:** the interviewer waits for a pause of **1.5 s, 2.5 s (recommended) or 4 s**.
- **Manual:** the interviewer waits until you press **Done answering**. Silence never ends your turn.

**How it works.** Automatic mode sets Gemini Live's voice-activity detection to *low* end-of-speech sensitivity, with your chosen silence length. Manual mode turns automatic detection off and sends explicit activity start and end signals.

**Why it helps.** Gemini's default treated a thinking pause as the end of the answer, so the next question arrived mid-sentence. People pause to think in real interviews, and the practice tool has to allow for that.

### Camera background and device test
- **Test microphone** (with a live level meter) and **Start camera preview** before you start.
- **Background:** None, Blur, a solid colour or your own image, as in Teams. This uses MediaPipe selfie segmentation running on your computer. The effect applies to your preview and to Mode 2 coaching stills.

### When: start now or schedule for later
Choose **Start now**, or **Schedule for later** with an exact date and time. See [section 4](#4-interview-tab-and-scheduling).

### Simulation mode
If no API key works yet, Setup offers a clearly labelled **Simulation mode**. It uses local questions with Windows speech synthesis and recognition, not Gemini, so you can practise the flow offline. Simulated sessions get honestly labelled local feedback.

---

## 3. The voice interview

**What it does.** The interview runs like a call:

1. A named interviewer (Alex, Jack, Ryan… or Ahmed, Bilal, Hamza… in Urdu) greets you and asks how you are.
2. They explain the format and ask you to introduce yourself.
3. They ask one question at a time and follow up on what you said.
4. A timer counts down, and the live transcript fills in as you talk.
5. An animated avatar shows whether the interviewer is speaking, listening or thinking.

**Controls during the interview:**
- **Space** or **Enter**, or the **Send answer now** / **Done answering** button, ends your answer immediately. The interviewer replies in about 1 second.
- **End interview** at any time; feedback is generated from what was said so far.
- **Pause coaching** / **Resume coaching** in Mode 2.
- The camera becomes a **draggable picture-in-picture** when you scroll down.

**How it works.**
- The main process mints a **single-use, short-lived Gemini Live token** locked to the Live model. The page connects to Gemini Live over a WebSocket with that token only. It never sees your API key.
- Microphone audio is streamed as 16 kHz PCM. The interviewer's voice comes back as 24 kHz audio and is played through a queue.
- Gemini transcribes both sides, and the transcript is built from that.
- If the connection drops, the app reconnects using Gemini's session-resumption handle.
- If Google ends the session because a key ran out of quota, that key is parked for 30 minutes and the interview reconnects with your next key.
- When you press Space in Automatic mode, the app sends "audio stream end" and mutes the mic until the interviewer answers. If nothing comes back within 6 s, it reopens the mic.

**Why it helps.**
- Speaking answers out loud under a time limit is the skill you actually need in the interview.
- Follow-up questions show where an answer is thin, which is hard to find on your own.

### The interview keeps running when you switch tabs
**What it does.** While an interview is running you can open Vocabulary, Reports or any other tab. The interview keeps going. A red **"Interview in progress · 12:31 left"** banner and a **LIVE** badge on the Interview tab take you back.

**How it works.** The interview room is hosted in the app shell (`app.html`), not as a routed page, and is only hidden when you are on another tab. Its microphone, camera, WebSocket and timer are never torn down by navigation. Space and Enter are ignored while the room is hidden, so typing elsewhere can't end your answer.

**Why it helps.** Before v1.10 a single misclick on another tab ended the interview, and it couldn't be recovered.

---

## 4. Interview tab and scheduling

![Interview tab](screenshots/interview-schedule.png)

**What it does.**
- **Schedule for later:** on New Interview, set everything up and pick an exact date and time. The whole setup (CV summary, level, mode, language…) is saved.
- The **Interview** tab shows the running interview if there is one. Otherwise it shows:
  - **Due now:** from 10 minutes before the time until 1 hour after, with a big **Start interview** button.
  - **Upcoming:** date, time and countdown ("in 1 day 10 h"), with **Start now**, **Change time** and **Remove**.
  - **Missed:** past interviews that were not started, with **Start now** and **Reschedule**.
  - **No interview scheduled** when the list is empty, with buttons to schedule one or start now.
- The sidebar badge shows how many interviews are scheduled.
- **Reminders** come 10 minutes before and at the scheduled time, while the app is open (minimised is fine):
  - a Windows notification (click it to jump to the Interview tab);
  - an in-app banner with a soft chime, plus **Start now** and **Later** buttons;
  - a flashing taskbar button.

**How it works.**
- Scheduled interviews are stored in `schedule.json`.
- The main process checks every 20 seconds. Each reminder fires once and is remembered, so restarting the app doesn't repeat it. Changing an interview's time re-arms its reminders.
- Starting from the schedule opens the room with the saved setup and removes the item from the list.
- Windows notifications only show if they are enabled in Windows Settings → System → Notifications. The banner and chime work either way.

**Why it helps.** Treating practice like a real appointment makes it happen. Setting everything up in advance means you can start in one click when the time comes.

---

## 5. Feedback

![Feedback](screenshots/feedback.png)

**What it does.** After the interview you get:
- an **overall score** and a short summary;
- three scores with explanations: **Relevance**, **Clarity** and **Technical depth**;
- **Strengths** and **Areas to improve**;
- **Practice questions** to work on next;
- the full **transcript**, switchable between English, اردو (Urdu) and the original;
- **Save session** to keep it, and a **Saved interviews** list of every earlier result, collapsible and kept until you press **Remove**.

**How it works.**
- The transcript is sent to a free Gemini text model (Gemini 3.8 Flash, falling back to 3.5 Flash-Lite) with strict instructions to grade only what was said.
- If no key works, an honestly labelled **local** heuristic gives basic feedback. It explicitly can't judge technical accuracy.
- Sessions are saved only when you click **Save**.

**Why it helps.** Feedback tied to your actual words is specific enough to act on. Keeping the history shows patterns, such as always forgetting concrete examples.

> The scores are coaching estimates, never a hiring decision.

---

## 6. Reports

![Reports](screenshots/reports.png)

**What it does.** Reports combine every saved interview in a period: **1 day, 3 days, 7 days, 30 days, 3 months** or a **custom** date range. You get:

- **KPI tiles:** number of interviews, practice time, average and best score, and the change from the first interview to the last.
- **Score trend chart:** hover over a point for its date and title.
- **Average by skill area:** relevance, clarity and technical depth.
- **Strengths and areas to improve:** dated, newest first, duplicates removed.
- **Table** of the interviews included.
- **AI summary** (optional): one coaching overview with "Going well", "Focus areas" and "Next steps".
- **Save as PDF:** a clean A4, light-theme PDF saved where you choose, with **Show in folder** afterwards.

**How it works.**
- Everything except the AI summary is calculated locally (`ui/src/app/core/report.ts`), with no Gemini call.
- The AI summary sends only scores and feedback text, never transcripts.
- The PDF is printed by Electron from a print-only layout.

**Why it helps.** One interview tells you little. A trend over weeks shows whether practice is working and what to focus on next. The PDF is easy to keep or share with a mentor.

---

## 7. Vocabulary

![Vocabulary](screenshots/vocabulary.png)

**What it does.** A trainer for English vocabulary, built for interview and workplace English:

- **New paragraph** writes a fresh paragraph for your chosen **topic** (Job interview, Tech & IT, Office, Daily life or Surprise me), **level** (Easy, Medium or Advanced) and **length**.
- **6–8 key words** are underlined. Click one for its meaning, word type, an example sentence and a "say it" pronunciation guide (for example *ar-TIK-yoo-late*). With **Urdu meanings** on, you also get the Urdu meaning.
- **Listen** reads the paragraph aloud at **Slow (0.75×), Medium (1×) or Fast (1.25×)** speed with a natural Gemini voice (Kore, Aoede, Puck or Charon). The sentence being read is highlighted.
- **Select any word or sentence** to get **Speak**, **Meaning** and **Save**. A selected sentence is explained in simple English. Double-click a word to hear it immediately.
- **My words** keeps the words you save. **Practise my saved words** works them into the next paragraph so you see them again in context.
- **Windows voice (offline)** gives instant, free speech. The app switches to it automatically if the Gemini voice is unavailable.

**How it works.**
- Paragraphs and meanings come from the fast free model Gemini 3.5 Flash-Lite (about 2–3 s). The reply is checked: key words that don't actually appear in the paragraph are dropped.
- Speech comes from Gemini text-to-speech models (`gemini-3.8-flash-tts`, with two fallbacks). Only the text itself is sent, so no instruction ever gets read aloud.
- Speed changes use `playbackRate` with pitch preserved, so changing speed doesn't create a new clip or use quota.
- Clips are cached in memory (up to 40), so replays are instant.
- With the Windows voice, word-boundary events give exact sentence highlighting.
- Saved words live in `words.json`.

**Why it helps.**
- A weak vocabulary makes good answers sound unsure.
- Reading, hearing and checking meanings in one place, with words picked for interviews, builds the vocabulary you need to explain your work clearly.
- Hearing words at slow speed helps with pronunciation, and the Urdu meanings make difficult words click faster.

---

## 8. Settings and API keys

**What it does.**
- **API keys:** add several Google AI Studio keys with a name and project label. You can **test**, **disable** or **delete** each one.
- **Models:** pick the text model for feedback. Free models only, unless you turn on the paid option.
- **Paid usage** (off by default): unlocks Pro-class text models for coaching and feedback, after a confirmation dialog. Voice interviews always use the free Live model.
- **Coaching interval** for Mode 2.
- **Clear local data:** wipes sessions, keys, settings, saved words and scheduled interviews.

**How it works.**
- Keys are encrypted with Electron `safeStorage`, which uses Windows DPAPI, and kept in the main process only. If OS encryption is unavailable, the app refuses to store keys.
- Errors are classified (auth, quota, rate limit, billing, server, network, model).
- Only temporary errors are retried: at most 2 attempts per key, after 500 ms and then 1500 ms.
- A key that hits quota cools down, and the next key is tried. Quotas are per Google *project*, so keys from different projects give you more free practice.
- When every key is out, the app says so plainly instead of looping.

**Why it helps.** Free tiers run out quickly during heavy practice. Several keys with automatic failover mean an interview doesn't die halfway, and the key handling means your secrets stay safe.

---

## 9. Theme, window and small things

- **Light and dark theme** with a sun / moon switch in the title bar. It is remembered between launches, with no dark flash.
- **Frameless window** with native Windows minimise, maximise and close buttons.
- **Animated avatar** reflects the interviewer's real state (speaking, listening, thinking, connecting, error) and respects *reduce motion*.
- **Keyboard shortcuts:** Space or Enter sends your answer, but only while the interview room is on screen and you are not typing in a field.
