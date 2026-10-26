# Gemini verification — Segment 0 (checked 2026-10-22, official Google docs only)

Sources: ai.google.dev/gemini-api/docs/{live-api, live-api/capabilities, ephemeral-tokens, pricing, rate-limits}

## Verified
- **Live API transport:** stateful WebSocket (WSS). Input: raw 16-bit PCM audio, 16kHz, little-endian; images JPEG at ≤1 FPS; text. Output: raw PCM audio, 24kHz, little-endian.
- **Features relevant here:** input + output audio transcription, barge-in, multilingual (70 languages).
- **Current Live models (official docs, 2026-10-22):** default `gemini-3.8-live`; `gemini-3.8-live` Extended Thinking variant; `gemini-3.1-flash-live-preview` listed as legacy preview. Model IDs churn — re-verify and pin at Segment 7, never hardcode from memory.
- **Session limits:** audio-only sessions limited to 15 minutes; audio+video to 2 minutes. Longer sessions require session resumption + context compression (documented session-management techniques). Resumption reconnect is needed about every 10 minutes.
  - Design consequence: Mode 2 webcam coaching must send periodic stills as separate vision requests, NOT stream video into the Live session.
- **Ephemeral tokens:** real, JS SDK `@google/genai` (`client.authTokens.create`). Defaults: 1 minute to start a session (`newSessionExpireTime`), 30 minutes to send (`expireTime`), `uses: 1`. Tokens can be locked to a model + config (`liveConnectConstraints`), keeping system instructions server/main-process side. Only compatible with the Live API, only on `v1beta`.
  - Design consequence for Electron: main process holds the long-lived key and mints the token; the renderer only ever receives the short-lived token.
- **Audio format for mic capture:** renderer must produce PCM 16kHz chunks (Web Audio API + resampling) — implementation detail for Segment 7.
- **Rate limits:** applied **per project, not per API key** (RPM / TPM / RPD; RPD resets midnight Pacific). Multiple keys in the same project share one quota pool. Exact free limits are NOT published as static numbers — they are visible only in the user's own AI Studio rate-limit page. The app must never display a fake remaining quota.
- **Pricing / free tier:** eligible Flash and Live models show "Free of charge" on the official pricing page (Live: text/audio/image input and text/audio output free of charge on the free tier, as listed 2026-10-22). Free-tier content may be used by Google to improve its products — the app must disclose this (Settings/Help, brief §9). Free Tier = active project, no billing; Tier 1+ requires linking billing — InterviewMate must never do this automatically.

## Not verified / uncertain (do not assume)
- Whether a specific user's project/region is eligible for a specific Live model on the free tier — only testable with the user's own key at Segment 6/7.
- Exact RPM/TPM/RPD numbers for the user's project — only visible in their AI Studio.
- Future model names/pricing — Google changes these; re-check at Segment 7 and again at Segment 11.
