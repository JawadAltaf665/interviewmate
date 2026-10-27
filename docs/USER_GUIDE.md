# User guide

## 1. What you need

- **Windows 10 or 11** (64-bit).
- A **microphone**. A **webcam** is optional.
- An internet connection for Gemini. Simulation mode and the offline Windows voice work without one.
- A free **Google AI Studio API key**. See step 3.

## 2. Install

1. Go to the repository's **Releases** page and download `InterviewMate-Windows-Portable-<version>.zip` from the latest release.
2. Right-click the zip and choose **Extract All…**. Pick a folder you will keep, for example `Documents\InterviewMate`.
3. Open the folder and run **`InterviewMate.exe`**. You can right-click it and choose **Send to → Desktop (create shortcut)** for a shortcut.
4. The app isn't code-signed, so Windows SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**.

This is a portable build, so there is no installer. To update, extract the new version and run its `InterviewMate.exe`. Your data is stored separately in `%APPDATA%\interviewmate`, so it carries over. To uninstall, delete the folder. To also delete your data, use **Settings → Clear local data** first, or delete `%APPDATA%\interviewmate`.

## 3. Get a free API key

1. Open <https://aistudio.google.com/apikey> and sign in with a Google account.
2. Click **Create API key**. Copy it and keep it private.
3. In InterviewMate, open **Settings → API keys → Add key**. Paste the key and give it a name (for example "Main") and a project label.
4. Press **Test**. The sidebar should show **Gemini ready · 1 active key**.

**Tip:** free quotas are counted per Google *project*, not per key. If you practise a lot, create keys in two or three different projects and add them all. The app moves to the next key automatically when one runs out.

## 4. Your first interview

1. Open **New Interview**.
2. Pick your **level** (Intern, Junior or Senior) and **mode**. Mode 1 is the plain preview; Mode 2 adds camera coaching and needs your consent.
3. Optionally **upload your CV** (PDF or DOCX) and check the skills summary it shows. Fix anything that's wrong.
4. Set the **target role**, **duration**, **language** and **how answers end**. Automatic with a 2.5 s pause is a good start.
5. Press **Test microphone** and check that the level meter moves when you speak. Optionally press **Start camera preview** and pick a background.
6. Press **Start interview**, then **Begin interview** in the interview room.
7. The interviewer greets you. Answer naturally. When you finish an answer, press **Space** to send it immediately, or just pause.
8. At the end (or when you press **End interview**) you go to **Feedback**. Read it, then press **Save session** to keep it.

**Tips:**
- Use headphones, so the interviewer's voice doesn't leak back into your microphone.
- You can switch to other tabs during an interview. The red banner at the top brings you back.

## 5. Schedule an interview

1. On **New Interview**, set everything up, then under **When** choose **Schedule for later**.
2. Pick the date and time and press **Schedule interview**.
3. The **Interview** tab lists it under **Upcoming**, and the sidebar shows a count.
4. Keep InterviewMate open (minimised is fine). You'll get a reminder 10 minutes before and at the time. Press **Start now** on the banner, or **Start interview** on the Interview tab.

If Windows notifications don't appear, turn them on in **Windows Settings → System → Notifications**. The in-app banner and chime work either way.

## 6. Review progress

- **Feedback** shows the latest result and every saved interview. Expand one to see its scores and notes.
- **Reports** combines a period (1 day to 3 months, or a custom range). Press **AI summary** for a coaching overview, and **Save as PDF** to keep a copy.

## 7. Practise vocabulary

1. Open **Vocabulary**. Choose the topic, level and length, and turn on **Urdu meanings** if you want them.
2. Press **New paragraph**.
3. Press **Listen** and choose Slow, Medium or Fast. The current sentence is highlighted.
4. Click an underlined word to see its meaning. Or select any word or sentence and press **Speak**, **Meaning** or **Save**.
5. Turn on **Practise my saved words** to see your saved words again in new paragraphs.

## 8. Talk to the Coach

1. Press **Ask Coach** (bottom right) on any page, or open the **Coach** tab. On **Feedback** or **Reports**, **Discuss with Coach** starts a chat about that interview or period.
2. Type a question, or press the microphone, speak (up to 60 seconds), press it again, check the text and send. Good first questions: "What should I improve first?", "Make me a 7-day practice plan", "Ask me a practice question".
3. When the Coach offers to do something (open a page, set up or schedule an interview, save words, export a PDF), a card appears. Nothing happens until you press its button; **Cancel** is always safe.
4. **Listen** under a reply reads it aloud. The **+** button starts a new chat, and the clock button (or the Coach tab) shows earlier chats. Delete a chat with its bin icon.

The Coach can't see your API keys, delete interviews, clear data or change settings: do those yourself in Settings or Feedback.

## 9. Troubleshooting

| Problem | What to do |
|---|---|
| "No active key" / interview won't start | Add a key in Settings and press **Test**. If the test reports quota, wait or add a key from another Google project. |
| "All keys are out of quota" | Free limits reset over time (per minute and per day). Add a key from another project, or try later. Simulation mode works meanwhile. |
| The interviewer interrupts you | Use Automatic with **4 s**, or switch to **Manual** ("I'll press Done answering"). |
| The interviewer can't hear you | Check the mic level on Setup, choose the right microphone in Windows sound settings, and allow microphone access for desktop apps in Windows privacy settings. |
| Echo, or the interviewer answers itself | Use headphones. |
| Camera background is slow | Choose **None** or **Blur**; older laptops may struggle with custom images. |
| Listen takes a while | The first play of a paragraph is generated by Gemini (10–20 s). Replays are instant. Choose **Windows voice (offline)** for instant speech. |
| No reminder popup | Turn on Windows notifications (see above), and keep the app running. |
| SmartScreen warning | **More info → Run anyway**. The build isn't code-signed. |
