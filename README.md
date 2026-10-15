# Yumi — AI Waifu Companion

A real-time, voice-interactive 3D VRM companion. Brain: Gemini. Voice: Fish
Audio. Ears: SpeechRecognition/faster-whisper. Face: Three.js + three-vrm.
Yumi is tsundere, and her tone genuinely shifts as her `affection` score
(persisted in a versioned `memory_store.json`) rises through five tiers:
cold → wary → warming → attached → devoted. See `backend/memory_manager.py`
for the schema-versioning/migration logic and `backend/character.py` for how
the tier is folded into her system prompt each turn.

## What's new in this round

- **Choose your brain (LLM provider) from the UI.** Settings → Brain: pick
  Gemini, OpenAI, Groq, NVIDIA NIM, DeepSeek, xAI, Ollama (local),
  LM Studio (local), or Custom (any OpenAI-compatible URL), type the
  model name, paste a key, hit "Save & switch" — her very next reply uses
  it, no restart. Gemini keeps web search / thinking / vision (native
  features); the others share one OpenAI-compatible client
  (`backend/providers/`). Vision works on providers/models marked vision-
  capable; web search is Gemini-only for now. Settings changes are
  runtime-only — put them in `.env` too to survive a restart.
  Run fully free/offline: `LLM_PROVIDER=ollama`, `LLM_MODEL=llama3.3`.
- **Redesigned UI** built from the open-source Utsuwa project's design
  system (neutral fills, one blue accent, system font, 44px touch
  targets, light/dark aware). Settings are now categorized — sidebar on
  desktop, horizontal tabs on phones — with new Brain, Voice, History
  panels. Fully responsive for PC and mobile.
- **Fixed: hands floating out like a T-pose.** three-vrm normalizes every
  model to T-pose; nothing was ever lowering the arms (and the gesture
  code reset them to T-pose between gestures). Now a per-model idle rest
  pose is applied on load (VRM 0.x and 1.0 use opposite rotation signs —
  both handled) and gestures blend to/from it. If your model's arms look
  slightly off, tune `REST_POSE_BY_VERSION` at the top of `vrmManager.js`.
- **Fixed: speech heard in the server log but not shown in the UI.** Two
  causes: (1) every server message from an "older" request was silently
  dropped once VAD started a newer one; only the final spoken reply is
  ever suppressed now. (2) The transcript was drawn into the same caption
  that the "thinking..." status immediately overwrote — your words now
  get their own persistent bubble and a History panel. VAD is also
  slightly stricter so noise doesn't fire fake utterances.
- **Fixed: settings didn't work.** The frontend hardcoded `localhost`, so
  opening it from any other device (phone -> PC's IP) sent every settings
  request to the phone itself. It now uses the hostname the page was
  loaded from. Save buttons also now report real server errors instead of
  always saying "Saved".
- **Fixed: crash on startup with a non-Gemini brain and no Gemini key.**
  The Gemini client is now created lazily; embeddings quietly fall back
  to keyword matching without a key.
- `backend/gemini_engine.py` was replaced by `backend/brain.py` (provider-
  agnostic) + `backend/providers/`.

## What's new in this round — relationship engine rewrite

You said "increasing affection by each message isn't good — use Utsuwa."
I read Utsuwa's actual engine (`src/lib/engine/{heuristics,state-updates,
stages}.ts` — open source, read directly, not guessed) and ported its real
mechanics into `backend/heuristics.py` + a rewritten `memory_manager.py`,
adapted from its 8-stage romantic ladder to our deliberately non-romantic
4-tier one (that boundary was a prior explicit decision, kept on purpose).

- **Five axes, not one**: affection, trust, intimacy, comfort, respect.
  A message is analyzed for sentiment, topic depth (shallow/moderate/deep),
  emotional content, and whether it's a question — each moves a different
  combination of axes. Thanking her and confiding in her are no longer the
  same `+1`.
- **Tiers require more than a score** — `TIER_REQUIREMENTS` in
  `memory_manager.py` now gates each tier behind affection AND trust AND a
  minimum interaction count AND (for "attached") days known across more
  than one calendar day. You cannot grind to the top tier in one spam
  session anymore — verified in a test: 60 identical "thanks, you're
  great" messages in one sitting raises affection but cannot reach
  "attached" without the days/interactions to back it up.
- **Hysteresis-banded demotion**: a stat has to fall below 85% of the
  current tier's floor to demote, not just dip under it once — one rough
  exchange doesn't flip-flop the relationship stage on the next good one.
- **Time decay on absence** (didn't exist before at all): affection/trust
  gently decay if you're gone for days, applied once per absence, not
  every reply.
- Two real bugs caught while porting (via an actual test suite, not by
  inspection): a formula where `-1` sentiment exactly canceled `+1`
  baseline (negative messages read as neutral), and Python's `int()`
  truncating toward zero where the original JS `Math.floor()` always
  rounds down — silently weakening every negative delta. Both fixed.
- The Brain/LLM provider panel, settings redesign, VRM rest-pose fix, and
  STT/localhost bug fixes from the previous round are unchanged — see
  further down for those.

**What I did NOT do**: rebuild this as the actual Utsuwa SvelteKit/Tauri
application. That request needs a live `npm install`'d repo with the
Tauri/Rust toolchain so changes can actually be built and tested — this
sandbox has no network access and can't run that pipeline. For modifying
the real Utsuwa repo on your own machine (where you have those tools),
Claude Code is the right tool, not this chat. What's above is a real,
tested port of its relationship-engine *logic* into our own working
Python project, which I could actually verify.

## Previous rounds

- **Memory: she decides what to remember, not a regex.** The old
  `_extract_fact()` only caught things matching a narrow pattern ("my
  name is X"). Now she extracts it herself every turn via a hidden
  `[memory: ...]` tag (see `TAG_RULES` in `backend/character.py`) —
  anything genuinely worth remembering, not just a few sentence templates.
  **No automatic cap or eviction** — a fact stays forever until you
  delete it yourself from the settings drawer's new Memory section (or
  `DELETE /memory`). Semantic ranking (from the previous round) is what
  keeps this fast and cheap even as the list grows: only the handful of
  facts relevant to what you just said get pulled into any given prompt.
- **Personality via YAML few-shot examples**, not just trait descriptions.
  `backend/persona_examples.yaml` has real example exchanges per
  relationship tier (cold/wary/warming/attached/devoted) — this is what
  actually teaches her *how* to sound, since models imitate concrete
  phrasing far more reliably than they follow adjectives like "tsundere."
  `backend/persona_loader.py` pulls a small relevant slice into her
  prompt each turn (never the whole file, to keep prompts cheap).
- **Explicitly not a girlfriend arc.** ~~The affection tiers~~ **Update:**
  per later feedback, this was dialed back to allow classic tsundere
  romantic flirtiness (blushing, jealousy, teasing) that grows stronger at
  higher affection tiers — barely-there at "cold", clearly flirty by
  "attached"/"devoted". It stays playful/PG throughout; explicit or sexual
  content is a hard no regardless of tier or settings. See `CORE_TRAITS`
  in `character.py`, the tier descriptions in `memory_manager.py`, and the
  `flirty`/`jealousy` situations in `persona_examples.yaml`.
- **"Never honest" clarified in the prompt itself**: it only ever means
  she deflects her own feelings (classic tsundere denial) — she never
  lies to you about anything real. This was already the design in the
  previous round; it's now spelled out more explicitly so the model
  doesn't drift into using it as license to fib about facts.

## Personality customization

Two files, two different jobs:
- `backend/character.py` — traits and rules (`CORE_TRAITS`/`AVOID`
  between the `# ======` banners).
- `backend/persona_examples.yaml` — actual example dialogue per
  relationship tier. **Edit this one if she doesn't sound right** — a
  couple of good/bad example exchanges will change her voice more than
  any amount of trait-tweaking in `character.py`. Needs `PyYAML` (already
  in `requirements.txt`); if it's somehow missing, examples are silently
  skipped rather than crashing the app (check the server log for a
  `[PERSONA]` warning).

## Memory: how it actually works now

- Every turn, she outputs a hidden `[memory: fact1 ; fact2]` tag (or
  `[memory: none]`) deciding what's worth keeping from that exchange —
  see `_split_tags()` in `backend/brain.py`.
- Saved facts never expire and are never auto-evicted. The settings
  drawer's **Memory** section lists everything she's kept, with a ✕ to
  delete anything by hand.
- Only a semantically-relevant handful of facts (not the whole list) get
  pulled into any single prompt — see `get_relevant_facts()` in
  `memory_manager.py`. This is what keeps costs/latency flat even as the
  fact list grows into the hundreds over weeks of use.

## Also still in this build (from earlier rounds)

- **Vision.** Screen-share and webcam toggles (the "+" button near the
  message bar) send a downscaled frame every few seconds; the freshest
  one gets attached to her next reply so she can actually comment on
  what's on your screen or in front of your camera. See "Vision usage
  notes" below.
- **Web search + thinking.** She can use live Google Search
  (`GEMINI_ENABLE_SEARCH` in `.env`) and, optionally, a reasoning budget
  for trickier questions (`GEMINI_THINKING_BUDGET`, off by default).
- **PC control — deliberately limited.** See "PC control setup" below.
- **Diary, settings, usage, memory — all in the gear-icon drawer** (top
  right): background mode, character name / voice ID, a "write a diary
  entry now" button plus her past entries, running Gemini/Fish Audio
  usage totals, and the Memory list described above.
- **Layout**: floating pill message bar at the bottom, captions synced
  with her voice, a settings gear in the corner. Three background modes
  (Studio / White / Transparent) — Transparent is meant for the desktop
  overlay or an OBS browser source.
- **Desktop overlay mode**: `electron/` wraps the frontend in a
  transparent, always-on-top window — see `electron/main.js` for setup.
- **OBS mode**: load the frontend with `?obs=1` to strip all UI chrome
  except her and the captions.
- Gesture animations and camera "director" moves, driven by her emotion
  tag — procedural bone poses in `vrmManager.js`, not imported animation
  files, so nothing extra to download, but the exact angles are starting
  points you'll likely want to tune per-model.

## PC control setup (optional, off by default)

`backend/pc_actions.py`'s `ACTIONS` dict is empty by default — nothing is
enabled until you add entries yourself. Each entry is a name, plus either
a `command` (an argument list — never a raw shell string, so there's no
shell-injection surface) or a `url` to open. A few commented-out examples
are in the file. She can only ever trigger a name that's actually in this
dict; there is no path from her output to running an arbitrary command.

## Vision usage notes

Screen-share and webcam both go through `getDisplayMedia()`/
`getUserMedia()` — the browser will prompt for permission each time.
Frames are sent every 4 seconds (`FRAME_INTERVAL_MS` in `app.js`) at up
to 640px on the long edge, and the backend only ever holds the single
most recent frame in memory (never written to disk, never kept after the
next reply uses it) — see `_latest_frame` in `server.py`.

## What was new in the previous round (still all present)

- **Always-on listening + barge-in.** Silero VAD runs client-side
  (`@ricky0123/vad-web`) to detect when you start/stop talking. Starting
  to talk while she's mid-reply interrupts her immediately.
- **Semantic memory.** Facts are embedded (`backend/embeddings.py`,
  `gemini-embedding-001`) and ranked by topical similarity to what you
  just said, not just shared keywords, with recency blended in. Falls
  back to keyword+recency scoring automatically if an embed call fails.
- **Emotion-driven face.** Every reply carries a hidden `[emotion: X]`
  tag (stripped before TTS/captions) that crossfades her VRM expression.
- **5-viseme lip sync** with attack/release easing instead of 3-band
  snapping, plus idle head sway and eye saccades.

## SECTION 1 — Account Setup

**Google Gemini API key**
1. Go to https://aistudio.google.com/
2. Sign in with a Google account.
3. Click "Get API key" (top-left, or under the key icon in the left rail).
4. Click "Create API key" → choose "Create API key in new project" (or an
   existing GCP project).
5. Copy the key that appears (starts with `AIza...`). Paste it into
   `GEMINI_API_KEY` in your `.env`.

**Fish Audio API key + voice model ID**
1. Go to https://fish.audio/ and sign in / create an account.
2. Click your avatar (top-right) → "API Keys" (or go directly to
   https://fish.audio/go-api/).
3. Click "Create API Key", name it, copy the value into `FISH_AUDIO_API_KEY`.
4. **Voice ID (optional — skip this if you're happy with the default voice):**
   go to the "Discover" tab (or "My Models" → "Create Voice Model" to clone
   your own from a short clean audio sample), open a voice's page, and
   copy its **Reference ID** via the "Copy ID" button (or from the page
   URL). Put it in `FISH_AUDIO_VOICE_ID` in `.env` — or, if you'd rather
   not touch `.env` for this, paste it directly into `HARDCODED_VOICE_ID`
   near the top of `backend/tts_engine.py`.

## SECTION 2 — System Dependencies

**Windows**
- Install "Desktop development with C++" via the Visual Studio Build Tools
  installer: https://visualstudio.microsoft.com/visual-cpp-build-tools/
- Install PyAudio's dependency with: `pip install pipwin && pipwin install pyaudio`
  (skip this if plain `pip install pyaudio` in the steps below already works).

**macOS**
```bash
brew install portaudio
```

**Linux (Debian/Ubuntu)**
```bash
sudo apt-get update
sudo apt-get install -y portaudio19-dev python3-dev build-essential
```

**All platforms — project setup**
```bash
git clone <your-repo-or-unzip-this-folder> ai-waifu-app
cd ai-waifu-app
python3 -m venv venv

# Activate:
source venv/bin/activate        # macOS/Linux
venv\Scripts\activate           # Windows (cmd/PowerShell)

pip install -r requirements.txt
cp .env.example .env
# now edit .env and paste in your real API keys/voice ID
```

If you set `STT_ENGINE=whisper` in `.env`, also run:
```bash
pip install faster-whisper soundfile
```

## SECTION 7 — Execution & Troubleshooting

**Start the backend**
```bash
uvicorn backend.server:app --host 0.0.0.0 --port 8000 --reload
```

**Serve the frontend** (needs its own static server so ES module imports work)
```bash
cd frontend
python3 -m http.server 5500
```
Then open `http://localhost:5500` in your browser. Upload a `.vrm` file via
the "+" button near the message bar, and just start talking (no button
press needed) or type into the pill-shaped input bar.

**Testing checklist**
1. Confirm `http://localhost:8000/health` returns `{"status":"ok", ...}`.
2. Load the frontend — the browser will prompt for microphone permission
   (needed for always-on VAD listening — allow it).
3. Upload a `.vrm` model via the "+" menu — it should appear centered,
   breathing/blinking/glancing around idly.
4. Just talk. Her caption box should show a faint "listening..."/"hmm..."
   indicator while she's processing, then her actual reply.
5. While she's replying, start talking again — she should cut off
   immediately (barge-in) instead of finishing her line.
6. Click the mic icon in the pill bar to mute/unmute if you want a
   type-only session.
7. Open the gear icon (top right) — try switching Background mode, check
   that Diary/Usage sections populate.

**Troubleshooting matrix**

| Symptom | Cause | Fix |
|---|---|---|
| `OSError: No Default Input Device Available` (server console) | Only relevant if you're using the legacy `{"type": "listen"}` server-side-mic path — no default input device found by PortAudio | Check OS sound settings for a default input device; on Linux run `arecord -l`. The shipped browser frontend doesn't use this path at all (it does VAD client-side), so this only matters for custom/headless clients. |
| Nothing happens on load, WebSocket never connects | Backend not running, or wrong `WS_URL`/`API_BASE` | Confirm `uvicorn` is running on port 8000; confirm `WS_URL`/`API_BASE` in `frontend/js/app.js` match your setup. |
| "voice detection failed to load — use text input instead" | `onnxruntime-web`/`vad-web` CDN scripts in `index.html` didn't load (ad blocker, offline, or jsdelivr blocked on your network) | Check the browser console for the failed script URL; try a different network/disable the blocker for `cdn.jsdelivr.net`, or self-host the VAD assets per https://docs.vad.ricky0123.com/user-guide/browser/ and point `baseAssetPath`/`onnxWASMBasePath` in `app.js` at your own paths. |
| Mic permission prompt never appears / VAD silently does nothing | Browser blocked mic access (often because the page isn't served over `https://` or `http://localhost`) | Serve the frontend from `localhost` (as shown above) or over HTTPS — browsers refuse `getUserMedia` on plain `http://` for any other host. |
| Screen share / webcam toggle does nothing | Permission denied, or `getDisplayMedia` unsupported in this browser context | Check the browser console; screen capture needs a secure context (localhost/HTTPS), same as the mic. |
| Yumi doesn't stop talking when you start speaking | Barge-in relies on `onSpeechStart` firing promptly; a very noisy room can delay Silero's detection | Try muting/unmuting once to reset the VAD instance, or reduce background noise; this is a detection-confidence tradeoff, not a hard bug. |
| Gemini call fails with 429 | Rate limit / quota exceeded | The code already retries once on `GEMINI_FALLBACK_MODEL`. If it still fails, add exponential backoff around `_call_gemini`, or wait — free tier quotas reset daily. |
| Fish Audio returns 401 | Bad/expired `FISH_AUDIO_API_KEY` | Regenerate the key on fish.audio and update `.env`, then restart the server (env is loaded once at startup). |
| Fish Audio returns 404 | Wrong voice reference ID | Re-copy the Reference ID from the voice's page (not its display name) into `FISH_AUDIO_VOICE_ID`, `HARDCODED_VOICE_ID`, or the settings drawer. |
| Settings drawer save doesn't survive a restart | Expected — the PATCH endpoint only changes the running process's memory, not `.env` | Update `.env` too if you want it to stick after a restart (noted in the drawer's own status message). |
| A PC action never fires even though she said the tag | `ACTIONS` in `backend/pc_actions.py` is empty by default | Add your own entries — see the README's "PC control setup" section above. |

## Desktop overlay mode

```bash
cd electron
npm install
npm start
```

This opens a transparent, always-on-top window pointed at your running
frontend (`http://localhost:5500`) — make sure the backend and frontend
are both already running first (Section 7 above). Switch Background mode
to "Transparent" in the settings drawer for it to actually look
transparent instead of showing a solid color. See the comments in
`electron/main.js` for click-through notes.
| Fish Audio returns 422 | Malformed request (e.g. bad `format`/`reference_id` value) | The server log now prints Fish Audio's actual `message` field for 422s — check the terminal running `uvicorn` for the specific reason. |
| Browser console: `WebSocket connection to 'ws://localhost:8000/ws' failed` | Backend not running, wrong port, or loading the frontend over `https://` (mixed content blocks plain `ws://`) | Confirm `uvicorn` is running; load the frontend over `http://`, not `https://`. |
| No sound but subtitle text appears | TTS returned empty audio (see server logs for a `[TTS]` line) | Check the Fish Audio rows above. |
| VRM loads but doesn't blink/breathe/glance around | Model has no `blink`/`happy`/etc. expression presets, or no `spine`/`leftEye`/`rightEye` humanoid bones mapped | Re-export the VRM ensuring standard VRM expression presets and full humanoid bone mapping are included (most VRoid Studio exports already have these). |
| Facial expression never changes even though replies clearly have emotion | Gemini omitted the `[emotion: X]` tag (rare, but possible with a very short/unusual reply) | `_split_tags` in `backend/brain.py` already defaults to `"neutral"` when the tag is missing or invalid, so this fails safe — if it happens a lot, lower `GEMINI_TEMPERATURE` slightly or check server logs for the raw reply. |
