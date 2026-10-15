import { AvatarManager } from './avatarManager.js';
import { LipSync } from './lipSync.js';

// Derived from wherever the PAGE was loaded from, instead of hardcoded
// "localhost". Hardcoding it broke the app for anyone opening the
// frontend from a different device on the LAN (e.g. a phone hitting the
// PC's IP to test the "optimize for mobile" layout) — "localhost" inside
// that page means the PHONE's own loopback, not the PC, so every
// WebSocket connection and every /settings, /memory, /diary, /usage fetch
// silently failed. Backend must be reachable at the same hostname, port
// 8000 (true for the default setup in the README).
const BACKEND_HOST = window.location.hostname || 'localhost';
const WS_URL = `ws://${BACKEND_HOST}:8000/ws`;
const API_BASE = `http://${BACKEND_HOST}:8000`;

const canvas = document.getElementById('scene-canvas');
const live2dCanvas = document.getElementById('live2d-canvas');
const captionBox = document.getElementById('caption-box');
const captionText = document.getElementById('caption-text');
const userBubble = document.getElementById('user-bubble');
const userBubbleText = document.getElementById('user-bubble-text');
const chatMessagesStream = document.getElementById('chat-messages-stream');
const testerToggleBtn = document.getElementById('tester-toggle-btn');
const liveTesterWindow = document.getElementById('live-tester-window');
const testerCloseBtn = document.getElementById('tester-close-btn');
const snapshotBtn = document.getElementById('snapshot-btn');

// Avatar Loader Overlay DOM
const avatarLoader = document.getElementById('avatar-loader');
const avatarLoaderTitle = document.getElementById('avatar-loader-title');
const avatarLoaderDetail = document.getElementById('avatar-loader-detail');
const avatarLoaderFill = document.getElementById('avatar-loader-fill');
const avatarLoaderActions = document.getElementById('avatar-loader-actions');
const avatarRetryBtn = document.getElementById('avatar-retry-btn');
const avatarFallbackBtn = document.getElementById('avatar-fallback-btn');

const historyList = document.getElementById('history-list');
const affectionValue = document.getElementById('affection-value');
const micToggle = document.getElementById('mic-toggle');
const vrmUpload = document.getElementById('vrm-upload');
const textForm = document.getElementById('text-form');
const textInput = document.getElementById('text-input');
const ttsAudioPlayer = document.getElementById('tts-audio-player');

const attachBtn = document.getElementById('attach-btn');
const attachMenu = document.getElementById('attach-menu');
const screenShareToggle = document.getElementById('screen-share-toggle');
const webcamToggle = document.getElementById('webcam-toggle');
const screenVideo = document.getElementById('screen-video');
const webcamVideo = document.getElementById('webcam-video');
const frameCanvas = document.getElementById('frame-canvas');

// STT Engine & Settings DOM
const settingSttEngine = document.getElementById('setting-stt-engine');
const settingWhisperSize = document.getElementById('setting-whisper-size');
const settingsSaveSttBtn = document.getElementById('settings-save-stt');
const settingsSaveSttStatus = document.getElementById('settings-save-stt-status');
const whisperStatusHint = document.getElementById('whisper-status-hint');

// Task Management DOM
const taskInputTitle = document.getElementById('task-input-title');
const taskInputDue = document.getElementById('task-input-due');
const taskAddBtn = document.getElementById('task-add-btn');
const taskAddStatus = document.getElementById('task-add-status');
const tasksList = document.getElementById('tasks-list');

// Memory Graph DOM
const memoryGraphExportBtn = document.getElementById('memory-graph-export-btn');
const memoryGraphImportFile = document.getElementById('memory-graph-import-file');

const settingsToggleBtn = document.getElementById('settings-toggle');
const settingsDrawer = document.getElementById('settings-drawer');
const settingsCloseBtn = document.getElementById('settings-close');
const settingsSaveBtn = document.getElementById('settings-save');
const settingsSaveStatus = document.getElementById('settings-save-status');
const settingCharacterName = document.getElementById('setting-character-name');
const settingPersonalityText = document.getElementById('setting-personality-text');
const settingVoiceId = document.getElementById('setting-voice-id');
const settingsSaveVoiceBtn = document.getElementById('settings-save-voice');
const settingsSaveVoiceStatus = document.getElementById('settings-save-voice-status');
const profileExportBtn = document.getElementById('profile-export-btn');
const profileImportFile = document.getElementById('profile-import-file');
const profileBackupStatus = document.getElementById('profile-backup-status');

// Extended HUD & UI elements
const historyDrawer = document.getElementById('history-drawer');
const historyToggle = document.getElementById('history-toggle');
const historyClose = document.getElementById('history-close');
const clearHistoryQuick = document.getElementById('clear-history-quick');
const diaryQuickBtn = document.getElementById('diary-quick-btn');
const cameraToggleBtn = document.getElementById('camera-toggle-btn');
const obsQuickBtn = document.getElementById('obs-quick-btn');
const captionEmotion = document.getElementById('caption-emotion');
const charNameCaption = document.getElementById('char-name-caption');
const relationshipTierPill = document.getElementById('relationship-tier-pill');

// Onboarding Modal elements
const onboardingModal = document.getElementById('onboarding-modal');
const onboardStep1 = document.getElementById('onboard-step-1');
const onboardStep2 = document.getElementById('onboard-step-2');
const stepDot1 = document.getElementById('step-dot-1');
const stepDot2 = document.getElementById('step-dot-2');
const onboardNameInput = document.getElementById('onboard-name-input');
const onboardNextBtn = document.getElementById('onboard-next-btn');
const onboardBackBtn = document.getElementById('onboard-back-btn');
const onboardFinishBtn = document.getElementById('onboard-finish-btn');
const onboardPersonalityInput = document.getElementById('onboard-personality-input');
const onboardImportFile = document.getElementById('onboard-import-file');

const writeDiaryBtn = document.getElementById('write-diary-btn');
const diaryList = document.getElementById('diary-list');
const usageList = document.getElementById('usage-list');
const memoryList = document.getElementById('memory-list');
const relationshipTierLabel = document.getElementById('relationship-tier-label');
const relationshipStats = document.getElementById('relationship-stats');

const settingLlmProvider = document.getElementById('setting-llm-provider');
const settingLlmModel = document.getElementById('setting-llm-model');
const settingLlmApiKey = document.getElementById('setting-llm-api-key');
const settingLlmBaseUrl = document.getElementById('setting-llm-base-url');
const settingLlmTemp = document.getElementById('setting-llm-temp');
const tempDisplay = document.getElementById('temp-display');
const settingLlmTokens = document.getElementById('setting-llm-tokens');
const settingGeminiSearch = document.getElementById('setting-gemini-search');
const settingsSaveBrainBtn = document.getElementById('settings-save-brain');
const settingsBrainStatus = document.getElementById('settings-brain-status');
const providerBadges = document.getElementById('provider-badges');
const providerDesc = document.getElementById('provider-desc');
const rowLlmApiKey = document.getElementById('row-llm-api-key');
const rowLlmBaseUrl = document.getElementById('row-llm-base-url');

// Voice / TTS elements
const settingTtsProvider = document.getElementById('setting-tts-provider');
const sectionFishAudio = document.getElementById('section-fish-audio');
const sectionElevenlabs = document.getElementById('section-elevenlabs');
const settingFishKey = document.getElementById('setting-fish-key');
const settingFishModel = document.getElementById('setting-fish-model');
const settingElevenKey = document.getElementById('setting-eleven-key');
const settingElevenModel = document.getElementById('setting-eleven-model');
const settingElevenVoiceId = document.getElementById('setting-eleven-voice-id');
const settingTtsTestText = document.getElementById('setting-tts-test-text');
const settingTtsTestBtn = document.getElementById('setting-tts-test-btn');
const avatarLoaderCloseBtn = document.getElementById('avatar-loader-close-btn');

// STT & Mic elements
const settingSttPause = document.getElementById('setting-stt-pause');
const sttPauseVal = document.getElementById('stt-pause-val');
const sttToggleListenBtn = document.getElementById('stt-toggle-listen-btn');

// Memory manual addition & History
const manualFactInput = document.getElementById('manual-fact-input');
const manualFactAddBtn = document.getElementById('manual-fact-add-btn');
const manualFactStatus = document.getElementById('manual-fact-status');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const profileResetBtn = document.getElementById('profile-reset-btn');

// VRM Panel elements
const vrmPanelUpload = document.getElementById('vrm-panel-upload');
const toggleBlink = document.getElementById('toggle-blink');
const toggleLookat = document.getElementById('toggle-lookat');

// Features 1-4: Proactive, OBS Mode, Wake Word, Barge-In, Gestures & VRMA
const settingProactiveToggle = document.getElementById('setting-proactive-toggle');
const settingProactiveInterval = document.getElementById('setting-proactive-interval');
const nudgeCompanionBtn = document.getElementById('nudge-companion-btn');
const enterObsModeBtn = document.getElementById('enter-obs-mode-btn');
const copyObsUrlBtn = document.getElementById('copy-obs-url-btn');
const obsExitPill = document.getElementById('obs-exit-pill');
const settingWakeWordToggle = document.getElementById('setting-wake-word-toggle');
const settingBargeInToggle = document.getElementById('setting-barge-in-toggle');
const gestureTestChips = document.getElementById('gesture-test-chips');
const vrmaPanelUpload = document.getElementById('vrma-panel-upload');
const vrmaStopBtn = document.getElementById('vrma-stop-btn');
const vrmaClipsList = document.getElementById('vrma-clips-list');
const vrmaCountBadge = document.getElementById('vrma-count-badge');
const vrmaUploadStatus = document.getElementById('vrma-upload-status');

// Diagnostics elements
const devWsStatus = document.getElementById('dev-ws-status');
const devLatency = document.getElementById('dev-latency');
const devActiveProvider = document.getElementById('dev-active-provider');
const devActiveTts = document.getElementById('dev-active-tts');
const devInspectStateBtn = document.getElementById('dev-inspect-state-btn');
const devStateViewer = document.getElementById('dev-state-viewer');

const avatarManager = new AvatarManager(canvas, live2dCanvas, {
  onProgress: (pct, loaded, total) => {
    if (avatarLoaderFill) avatarLoaderFill.style.width = `${pct}%`;
    if (avatarLoaderDetail) {
      const mbLoaded = (loaded / (1024 * 1024)).toFixed(1);
      const mbTotal = (total / (1024 * 1024)).toFixed(1);
      avatarLoaderDetail.textContent = `Awakening 3D vessel... ${pct}% (${mbLoaded}/${mbTotal} MB)`;
    }
  },
  onLoaded: () => {
    if (avatarLoaderFill) avatarLoaderFill.style.width = '100%';
    if (avatarLoaderTitle) avatarLoaderTitle.textContent = '✨ Yumi is awake!';
    if (avatarLoaderDetail) avatarLoaderDetail.textContent = '3D neural vessel connected';
    setTimeout(() => {
      if (avatarLoader) avatarLoader.classList.add('hidden');
    }, 600);
    // Synchronize UI chip/radio states
    document.querySelectorAll('[data-avatar-type]').forEach((b) => {
      b.classList.toggle('active', b.dataset.avatarType === 'vrm');
    });
    document.querySelectorAll('input[name="avatar-type-mode"]').forEach((r) => {
      r.checked = r.value === 'vrm';
    });
  },
  onError: (err) => {
    console.error('Avatar load error in app:', err);
    if (avatarLoaderTitle) avatarLoaderTitle.textContent = 'Avatar Loading Notice';
    if (avatarLoaderDetail) avatarLoaderDetail.textContent = err?.message || 'Could not load 3D model';
    if (avatarLoaderActions) avatarLoaderActions.classList.remove('hidden');
  },
});
const vrmManager = avatarManager;
const lipSync = new LipSync(ttsAudioPlayer, avatarManager);
avatarManager.attachLipSync(lipSync);

// Retry & Fallback handlers
if (avatarRetryBtn) {
  avatarRetryBtn.addEventListener('click', () => {
    if (avatarLoaderActions) avatarLoaderActions.classList.add('hidden');
    if (avatarLoaderTitle) avatarLoaderTitle.textContent = 'Retrying 3D Avatar...';
    if (avatarLoaderDetail) avatarLoaderDetail.textContent = 'Contacting neural vessel';
    avatarManager.loadDefaultModel((pct, loaded, total) => {
      if (avatarLoaderFill) avatarLoaderFill.style.width = `${pct}%`;
    }).then(() => {
      if (avatarLoader) avatarLoader.classList.add('hidden');
    }).catch((err) => {
      if (avatarLoaderDetail) avatarLoaderDetail.textContent = err.message;
      if (avatarLoaderActions) avatarLoaderActions.classList.remove('hidden');
    });
  });
}

if (avatarLoaderCloseBtn) {
  avatarLoaderCloseBtn.addEventListener('click', () => {
    if (avatarLoader) avatarLoader.classList.add('hidden');
  });
}

if (avatarLoader) {
  avatarLoader.addEventListener('click', (e) => {
    if (e.target === avatarLoader) {
      avatarLoader.classList.add('hidden');
    }
  });
  // Auto-dismiss safety timer
  setTimeout(() => {
    if (avatarLoader && avatarManager.vrm?.currentVrm) {
      avatarLoader.classList.add('hidden');
    }
  }, 2500);
}

if (avatarFallbackBtn) {
  avatarFallbackBtn.addEventListener('click', () => {
    avatarManager.setAvatarType('live2d');
    if (avatarLoader) avatarLoader.classList.add('hidden');
    document.querySelectorAll('[data-avatar-type]').forEach((b) => {
      b.classList.toggle('active', b.dataset.avatarType === 'live2d');
    });
    document.querySelectorAll('input[name="avatar-type-mode"]').forEach((r) => {
      r.checked = r.value === 'live2d';
    });
  });
}

// --- Camera Framing Presets & HUD Cycling ---
const cameraPresets = ['full', 'waist', 'portrait'];
let currentCamIdx = 0;
if (cameraToggleBtn) {
  cameraToggleBtn.addEventListener('click', () => {
    currentCamIdx = (currentCamIdx + 1) % cameraPresets.length;
    const nextPreset = cameraPresets[currentCamIdx];
    vrmManager.setCameraPreset(nextPreset);
    cameraToggleBtn.title = `Camera Framing: ${nextPreset.toUpperCase()}`;
    document.querySelectorAll('#camera-presets-chips .chip-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.cam === nextPreset);
    });
  });
}

document.querySelectorAll('#camera-presets-chips .chip-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#camera-presets-chips .chip-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const cam = btn.dataset.cam;
    if (cam) {
      vrmManager.setCameraPreset(cam);
      currentCamIdx = cameraPresets.indexOf(cam);
      if (cameraToggleBtn) cameraToggleBtn.title = `Camera Framing: ${cam.toUpperCase()}`;
    }
  });
});

// --- Avatar Behaviors (Blink & Look-At Tracking) ---
if (toggleBlink) {
  toggleBlink.addEventListener('change', () => {
    vrmManager.blinkEnabled = toggleBlink.checked;
  });
}
if (toggleLookat) {
  toggleLookat.addEventListener('change', () => {
    vrmManager.lookAtEnabled = toggleLookat.checked;
  });
}

// --- Live Audio Level Equalizer Visualization ---
const eqBars = document.querySelectorAll('.dialogue-audio-indicator .bar');
function updateAudioBars() {
  if (lipSync && eqBars.length > 0) {
    const levels = lipSync.getAudioLevels();
    if (levels.isSpeaking) {
      eqBars.forEach((bar, idx) => {
        const bandVal = levels.bands[idx] !== undefined ? levels.bands[idx] : levels.volume;
        const h = Math.max(3, Math.min(14, Math.round(bandVal * 14)));
        bar.style.height = `${h}px`;
      });
    } else {
      eqBars.forEach((bar) => { bar.style.height = '3px'; });
    }
  }
  requestAnimationFrame(updateAudioBars);
}
requestAnimationFrame(updateAudioBars);

// --- Touch reactions: head pats and touch feedback (Utsuwa & AIRI inspired) ---
function spawnTouchParticle(x, y, symbol = '💖') {
  const p = document.createElement('div');
  p.className = 'touch-particle';
  p.textContent = symbol;
  p.style.left = `${x}px`;
  p.style.top = `${y}px`;
  document.body.appendChild(p);
  setTimeout(() => p.remove(), 1200);
}

const TOUCH_REACTIONS = {
  cold: {
    head: [
      { text: "H-hey! Don't just touch my head out of nowhere! We're not that close!", emotion: 'embarrassed', gesture: 'think', symbol: '💢' },
      { text: "Hands off! I'm not some pet you can just pat whenever you feel like it!", emotion: 'angry', gesture: 'shake_head', symbol: '⚡' },
    ],
    body: [
      { text: "Watch your hands! What do you think you're touching?!", emotion: 'angry', gesture: 'shake_head', symbol: '💢' },
      { text: "Personal space, hello?! Back up a little!", emotion: 'angry', gesture: 'think', symbol: '⚡' },
    ],
  },
  wary: {
    head: [
      { text: "...You're weird. Don't think patting my head will make me go easy on you.", emotion: 'embarrassed', gesture: 'think', symbol: '🌸' },
      { text: "Ugh, my hair... You're messing it up, dummy.", emotion: 'embarrassed', gesture: 'nod', symbol: '✨' },
    ],
    body: [
      { text: "Hey! Keep your hands where I can see them.", emotion: 'surprised', gesture: 'shake_head', symbol: '💧' },
      { text: "A-Ah! Warn me before you poke me like that!", emotion: 'surprised', gesture: 'think', symbol: '🌸' },
    ],
  },
  warming: {
    head: [
      { text: "Uu... I didn't say you could do that. ...Not that it feels terrible or anything.", emotion: 'embarrassed', gesture: 'nod', symbol: '💖' },
      { text: "W-Well, since you're already doing it... I suppose a few more pats won't hurt.", emotion: 'happy', gesture: 'nod', symbol: '🌸' },
    ],
    body: [
      { text: "Eep! You startled me! Don't poke me so suddenly, dummy!", emotion: 'surprised', gesture: 'wave', symbol: '✨' },
      { text: "Hey now! You're getting awful comfortable touching me, aren't you?", emotion: 'embarrassed', gesture: 'nod', symbol: '💖' },
    ],
  },
  attached: {
    head: [
      { text: "Mm... It's not like I asked you to pat my head... but don't stop yet, okay?", emotion: 'happy', gesture: 'nod', symbol: '💖' },
      { text: "Ehehe... Your hand is so warm. I... I really like this.", emotion: 'happy', gesture: 'nod', symbol: '✨' },
    ],
    body: [
      { text: "Ahaha, tickles! You're really affectionate today, aren't you?", emotion: 'happy', gesture: 'wave', symbol: '💖' },
      { text: "If you want my attention that badly, you only had to ask~", emotion: 'happy', gesture: 'nod', symbol: '🌸' },
    ],
  },
};

let currentRelationshipTier = 'wary';
let cachedRelationshipData = null;

vrmManager.onTouchReaction = (part, coords) => {
  const tier = TOUCH_REACTIONS[currentRelationshipTier] ? currentRelationshipTier : 'wary';
  const pool = TOUCH_REACTIONS[tier][part] || TOUCH_REACTIONS[tier].head;
  const pick = pool[Math.floor(Math.random() * pool.length)];

  if (coords && coords.clientX && coords.clientY) {
    spawnTouchParticle(coords.clientX, coords.clientY, pick.symbol);
  } else {
    spawnTouchParticle(window.innerWidth * 0.5, window.innerHeight * 0.35, pick.symbol);
  }

  vrmManager.setEmotion(pick.emotion);
  if (vrmManager.vrm && typeof vrmManager.vrm.playGesture === 'function') {
    vrmManager.vrm.playGesture(pick.gesture);
  }
  setCaption(pick.text, { italic: true, autoHide: true });
};

let socket = null;
let micVad = null;
let micEnabled = false;
let micInitializing = false;
let currentAudioObjectUrl = null;
let currentVrmObjectUrl = null;
let captionHideTimer = null;
let providerList = []; // populated from GET /providers when the drawer opens

// --- TTS Speech equalizer state on dialogue box ---
if (ttsAudioPlayer) {
  ttsAudioPlayer.addEventListener('play', () => captionBox && captionBox.classList.add('speaking'));
  ttsAudioPlayer.addEventListener('pause', () => captionBox && captionBox.classList.remove('speaking'));
  ttsAudioPlayer.addEventListener('ended', () => captionBox && captionBox.classList.remove('speaking'));
}

// --- History drawer toggle & controls ---
if (historyToggle && historyDrawer) {
  historyToggle.addEventListener('click', () => historyDrawer.classList.toggle('hidden'));
}
if (historyClose && historyDrawer) {
  historyClose.addEventListener('click', () => historyDrawer.classList.add('hidden'));
}
if (clearHistoryQuick) {
  clearHistoryQuick.addEventListener('click', async () => {
    if (!confirm('Clear all conversation history?')) return;
    chatLog.length = 0;
    renderHistory();
    hideCaption();
    try {
      await fetch(`${API_BASE}/history/clear`, { method: 'POST' });
    } catch (e) { console.warn('Could not clear server history:', e); }
  });
}

// --- Quick actions (Diary & OBS mode) ---
if (diaryQuickBtn) {
  diaryQuickBtn.addEventListener('click', () => {
    openSettingsDrawer();
    document.querySelectorAll('.settings-nav-item').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.settings-panel').forEach((p) => p.classList.remove('active'));
    const diaryNav = document.querySelector('.settings-nav-item[data-panel="panel-diary"]');
    const diaryPanel = document.getElementById('panel-diary');
    if (diaryNav) diaryNav.classList.add('active');
    if (diaryPanel) diaryPanel.classList.add('active');
  });
}

function toggleObsMode(forceState) {
  const isObs = typeof forceState === 'boolean'
    ? forceState
    : !document.body.classList.contains('obs-mode');
  document.body.classList.toggle('obs-mode', isObs);
  if (obsExitPill) {
    obsExitPill.classList.toggle('hidden', !isObs);
  }
}

if (obsQuickBtn) {
  obsQuickBtn.addEventListener('click', () => toggleObsMode());
}

if (enterObsModeBtn) {
  enterObsModeBtn.addEventListener('click', () => toggleObsMode(true));
}

if (obsExitPill) {
  obsExitPill.addEventListener('click', () => toggleObsMode(false));
}

if (copyObsUrlBtn) {
  copyObsUrlBtn.addEventListener('click', async () => {
    const obsUrl = `${window.location.origin}${window.location.pathname}?obs=1`;
    try {
      await navigator.clipboard.writeText(obsUrl);
      copyObsUrlBtn.textContent = '✅ Copied!';
      setTimeout(() => {
        copyObsUrlBtn.textContent = '📋 Copy OBS URL';
      }, 2000);
    } catch (e) {
      prompt('Copy this OBS Browser Source URL:', obsUrl);
    }
  });
}

// --- OBS/streaming layout: ?obs=1 strips all chrome except avatar + caption ---
if (new URLSearchParams(window.location.search).get('obs') === '1') {
  toggleObsMode(true);
}

// --- Settings drawer category tabs (sidebar on desktop, horizontal row on
// mobile — see the @media rule in style.css) ---
document.querySelectorAll('.settings-nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.settings-nav-item').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.settings-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.panel).classList.add('active');
  });
});

// --- Background mode (studio / white / transparent), persisted locally ---
function applyBackgroundMode(mode) {
  document.body.setAttribute('data-avatar-bg', mode);
  document.querySelectorAll('input[name="bg-mode"]').forEach((el) => {
    el.checked = el.value === mode;
  });
}
(function initBackgroundMode() {
  let saved = 'studio';
  try {
    saved = localStorage.getItem('yumi-bg-mode') || 'studio';
  } catch (e) { /* storage unavailable — default to studio */ }
  applyBackgroundMode(saved);
})();
document.querySelectorAll('input[name="bg-mode"]').forEach((el) => {
  el.addEventListener('change', () => {
    applyBackgroundMode(el.value);
    try { localStorage.setItem('yumi-bg-mode', el.value); } catch (e) { /* ignore */ }
  });
});

// --- Barge-in bookkeeping: see server.py's docstring for the protocol. ---
let requestCounter = 0;
let latestRequestId = 0;
function nextRequestId() {
  requestCounter += 1;
  latestRequestId = requestCounter;
  return requestCounter;
}
function isStale(messageRequestId) {
  return typeof messageRequestId === 'number' && messageRequestId < latestRequestId;
}

let userBubbleHideTimer = null;
let activeCaptionStream = null;

function cancelActiveCaptionStream() {
  if (activeCaptionStream) {
    try {
      activeCaptionStream.cancel();
    } catch (e) {
      /* ignore */
    }
    activeCaptionStream = null;
  }
}

/**
 * Streams spoken dialogue text in real time, synchronized with audio playback or speech cadence.
 * @param {string} fullText - Complete dialogue string.
 * @param {Object} [options]
 * @param {HTMLAudioElement} [options.audioElement] - Audio element (e.g. ttsAudioPlayer) to sync with.
 * @param {number} [options.estimatedDurationMs] - Duration fallback if audio is not yet playing.
 * @param {Function} [options.onComplete] - Callback when complete.
 */
function streamSpokenCaption(fullText, options = {}) {
  cancelActiveCaptionStream();
  clearTimeout(captionHideTimer);

  const rawText = (fullText || '').trim();
  if (!rawText) {
    hideCaption();
    return;
  }

  // Tokenize into words preserving punctuation and spacing
  const wordTokens = [];
  const regex = /\S+\s*/g;
  let match;
  while ((match = regex.exec(rawText)) !== null) {
    wordTokens.push(match[0]);
  }
  if (wordTokens.length === 0) {
    wordTokens.push(rawText);
  }

  // Calculate cumulative character offsets for natural speech rhythm
  const totalChars = rawText.length;
  let runningCharCount = 0;
  const wordCharThresholds = wordTokens.map((tok) => {
    runningCharCount += tok.length;
    return runningCharCount;
  });

  captionBox.classList.remove('hidden');
  captionBox.classList.add('speaking');
  captionText.style.fontStyle = 'normal';
  captionText.innerHTML = '';

  const cursorSpan = document.createElement('span');
  cursorSpan.className = 'caption-cursor';

  const wordSpans = wordTokens.map((tok) => {
    const span = document.createElement('span');
    span.className = 'caption-word';
    span.textContent = tok;
    span.style.display = 'none';
    return span;
  });

  wordSpans.forEach((s) => captionText.appendChild(s));
  captionText.appendChild(cursorSpan);

  let currentRevealedCount = 0;
  let isCancelled = false;
  let animFrameId = null;
  let streamCompleted = false;

  const revealUpTo = (wordIndex) => {
    const targetIdx = Math.min(wordTokens.length, Math.max(0, wordIndex));
    if (targetIdx === currentRevealedCount) return;

    for (let i = 0; i < wordTokens.length; i++) {
      if (i < targetIdx) {
        wordSpans[i].style.display = 'inline';
        if (i === targetIdx - 1 && !streamCompleted) {
          wordSpans[i].className = 'caption-word active';
        } else {
          wordSpans[i].className = 'caption-word spoken';
        }
      } else {
        wordSpans[i].style.display = 'none';
        wordSpans[i].className = 'caption-word';
      }
    }
    currentRevealedCount = targetIdx;
  };

  const finishStream = () => {
    if (isCancelled || streamCompleted) return;
    streamCompleted = true;
    revealUpTo(wordTokens.length);
    wordSpans.forEach((s) => {
      s.style.display = 'inline';
      s.className = 'caption-word spoken';
    });
    cursorSpan.classList.add('hidden');
    captionBox.classList.remove('speaking');
    if (typeof options.onComplete === 'function') {
      options.onComplete();
    }

    clearTimeout(captionHideTimer);
    const readingTime = Math.max(4500, Math.min(30000, rawText.length * 65));
    captionHideTimer = setTimeout(() => {
      captionBox.classList.add('hidden');
    }, readingTime);
  };

  const audio = options.audioElement;
  if (audio) {
    const syncAudioProgress = () => {
      if (isCancelled || streamCompleted) return;

      const dur = audio.duration;
      if (dur && !isNaN(dur) && dur > 0) {
        const progress = Math.min(1.0, Math.max(0, audio.currentTime / dur));
        const currentCharTarget = progress * totalChars;
        let targetWordIdx = 0;
        for (let i = 0; i < wordCharThresholds.length; i++) {
          if (currentCharTarget >= wordCharThresholds[i]) {
            targetWordIdx = i + 1;
          } else {
            targetWordIdx = i + 1;
            break;
          }
        }
        if (progress >= 0.99 || audio.ended) {
          targetWordIdx = wordTokens.length;
        }
        revealUpTo(targetWordIdx);

        if (progress >= 0.999 || audio.ended) {
          finishStream();
          return;
        }
      }

      if (!audio.paused && !audio.ended) {
        animFrameId = requestAnimationFrame(syncAudioProgress);
      }
    };

    const onPlay = () => {
      if (!isCancelled && !streamCompleted) {
        cursorSpan.classList.remove('hidden');
        captionBox.classList.add('speaking');
        cancelAnimationFrame(animFrameId);
        animFrameId = requestAnimationFrame(syncAudioProgress);
      }
    };
    const onEnded = () => finishStream();
    const onPause = () => {
      if (!audio.ended && !streamCompleted) {
        captionBox.classList.remove('speaking');
      }
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('timeupdate', syncAudioProgress);

    // Initial tick to show first word
    revealUpTo(1);
    if (!audio.paused && !audio.ended) {
      animFrameId = requestAnimationFrame(syncAudioProgress);
    }

    activeCaptionStream = {
      cancel: () => {
        isCancelled = true;
        cancelAnimationFrame(animFrameId);
        audio.removeEventListener('play', onPlay);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('pause', onPause);
        audio.removeEventListener('timeupdate', syncAudioProgress);
        cursorSpan.remove();
      },
      finishImmediately: () => finishStream(),
    };
  } else {
    // Speaking rate cadence ticker (~65ms/character)
    const duration = options.estimatedDurationMs || Math.max(2500, rawText.length * 65);
    const startTime = performance.now();

    const tick = (now) => {
      if (isCancelled || streamCompleted) return;
      const elapsed = now - startTime;
      const progress = Math.min(1.0, elapsed / duration);
      const currentCharTarget = progress * totalChars;
      let targetWordIdx = 0;
      for (let i = 0; i < wordCharThresholds.length; i++) {
        if (currentCharTarget >= wordCharThresholds[i]) {
          targetWordIdx = i + 1;
        } else {
          targetWordIdx = i + 1;
          break;
        }
      }
      if (progress >= 1.0) targetWordIdx = wordTokens.length;
      revealUpTo(targetWordIdx);

      if (progress < 1.0) {
        animFrameId = requestAnimationFrame(tick);
      } else {
        finishStream();
      }
    };

    revealUpTo(1);
    animFrameId = requestAnimationFrame(tick);

    activeCaptionStream = {
      cancel: () => {
        isCancelled = true;
        cancelAnimationFrame(animFrameId);
        cursorSpan.remove();
      },
      finishImmediately: () => finishStream(),
    };
  }
}

function setCaption(text, { italic = false, autoHide = false } = {}) {
  cancelActiveCaptionStream();
  clearTimeout(captionHideTimer);
  captionText.textContent = text;
  captionText.style.fontStyle = italic ? 'italic' : 'normal';
  captionBox.classList.remove('hidden');
  captionBox.classList.remove('speaking');
  if (autoHide) {
    captionHideTimer = setTimeout(() => captionBox.classList.add('hidden'), 2500);
  }
}

function hideCaption() {
  cancelActiveCaptionStream();
  captionBox.classList.add('hidden');
  captionBox.classList.remove('speaking');
}

function hideUserBubble() {
  clearTimeout(userBubbleHideTimer);
  if (userBubble) userBubble.classList.add('hidden');
}

// --- Chat stream & session history -------------------------------------
const chatLog = [];
let thinkingRowEl = null;

function showThinkingBubble() {
  removeThinkingBubble();
  if (!historyList) return;
  thinkingRowEl = document.createElement('li');
  thinkingRowEl.className = 'history-bubble assistant thinking-row';
  const charName = (document.getElementById('char-name')?.textContent) || 'Yumi';
  thinkingRowEl.innerHTML = `
    <div class="history-bubble-header">
      <span class="bubble-sender">${charName}</span>
      <span class="history-emotion-tag">🤔 Thinking</span>
    </div>
    <div class="thinking-dots">
      <span></span><span></span><span></span>
    </div>
  `;
  historyList.appendChild(thinkingRowEl);
  historyList.scrollTop = historyList.scrollHeight;
}

function removeThinkingBubble() {
  if (thinkingRowEl && thinkingRowEl.parentNode) {
    thinkingRowEl.parentNode.removeChild(thinkingRowEl);
  }
  thinkingRowEl = null;
}

function appendMessageToStream(role, text, emotion = 'neutral', timestamp = null) {
  if (!chatMessagesStream) return;
  if (role === 'assistant') removeThinkingBubble();

  const row = document.createElement('div');
  row.className = `chat-msg-row ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'chat-msg-bubble';

  const timeStr = timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const header = document.createElement('div');
  header.className = 'chat-msg-header';

  const sender = document.createElement('span');
  sender.className = 'chat-msg-sender';
  const charName = (document.getElementById('char-name')?.textContent) || 'Yumi';
  sender.textContent = role === 'user' ? 'You' : charName;
  header.appendChild(sender);

  if (role === 'assistant' && emotion && emotion !== 'neutral') {
    const emoTag = document.createElement('span');
    emoTag.className = 'chat-msg-emotion-tag';
    emoTag.textContent = emotion;
    header.appendChild(emoTag);
  }

  const timeEl = document.createElement('span');
  timeEl.className = 'chat-msg-time';
  timeEl.textContent = timeStr;
  header.appendChild(timeEl);

  bubble.appendChild(header);

  const textP = document.createElement('div');
  textP.className = 'chat-msg-content';
  textP.textContent = text;
  bubble.appendChild(textP);

  row.appendChild(bubble);
  chatMessagesStream.appendChild(row);

  chatMessagesStream.scrollTop = chatMessagesStream.scrollHeight;
}

function initConversationStream() {
  if (chatLog.length === 0) {
    const defaultGreeting = "Hello! I'm Yumi, your companion. You can chat with me, speak through the mic, or try the quick prompts below!";
    logMessage('assistant', defaultGreeting, 'happy');
    setCaption(defaultGreeting, { autoHide: false });
  }
}

function showUserBubble(text) {
  if (!text) return;
  if (userBubbleText) userBubbleText.textContent = text;
  if (userBubble) {
    userBubble.classList.remove('hidden');
    clearTimeout(userBubbleHideTimer);
    userBubbleHideTimer = setTimeout(() => {
      userBubble.classList.add('hidden');
    }, 6500);
  }
}

function logMessage(role, text, emotion = 'neutral', timestamp = null) {
  if (role === 'assistant') removeThinkingBubble();
  chatLog.push({
    role,
    text,
    emotion,
    time: timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });
  renderHistory();
}

function renderHistory() {
  if (!historyList) return;
  historyList.innerHTML = '';
  if (chatLog.length === 0) {
    const li = document.createElement('li');
    li.className = 'history-empty';
    li.textContent = 'No messages yet this session. Send a message to start chatting!';
    historyList.appendChild(li);
    return;
  }
  const charName = (document.getElementById('char-name')?.textContent) || 'Yumi';
  chatLog.forEach((m) => {
    const li = document.createElement('li');
    li.className = `history-bubble ${m.role}`;

    const header = document.createElement('div');
    header.className = 'history-bubble-header';

    const sender = document.createElement('span');
    sender.className = 'bubble-sender';
    sender.textContent = m.role === 'user' ? 'You' : charName;
    header.appendChild(sender);

    if (m.role === 'assistant' && m.emotion && m.emotion !== 'neutral') {
      const emoTag = document.createElement('span');
      emoTag.className = 'history-emotion-tag';
      emoTag.textContent = m.emotion;
      header.appendChild(emoTag);
    }

    const timeEl = document.createElement('span');
    timeEl.className = 'bubble-time';
    timeEl.textContent = m.time || '';
    header.appendChild(timeEl);

    li.appendChild(header);

    const body = document.createElement('div');
    body.className = 'history-bubble-text';
    body.textContent = m.text;
    li.appendChild(body);

    historyList.appendChild(li);
  });

  if (thinkingRowEl) {
    historyList.appendChild(thinkingRowEl);
  }
  historyList.scrollTop = historyList.scrollHeight;
}
renderHistory();

// Speech chunk streaming queue for low-latency voice synthesis
const audioQueue = [];
let isPlayingAudioQueue = false;
let currentReplyStarted = false;
let currentReplyFullText = '';
let isLastAudioChunk = false;
let audioChunksExpected = 0;
let audioChunksReceived = 0;
let audioQueueGraceTimer = null;

function speakWithBrowserTTS(text, onComplete) {
  const clean = (text || '').trim();
  if (!clean || !('speechSynthesis' in window)) {
    if (typeof onComplete === 'function') onComplete();
    return;
  }
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.05;
    utterance.pitch = 1.15;

    const voices = window.speechSynthesis.getVoices();
    if (voices && voices.length > 0) {
      const preferred = voices.find(v => 
        (v.name.includes('Female') || v.name.includes('Samantha') || v.name.includes('Zira') || v.name.includes('Natural') || v.lang.startsWith('en')) &&
        !v.name.includes('Male') && !v.name.includes('David')
      );
      if (preferred) utterance.voice = preferred;
    }

    avatarManager.setStatus('talking');
    streamSpokenCaption(clean, {
      estimatedDurationMs: Math.max(3000, clean.length * 65),
    });

    utterance.onend = () => {
      avatarManager.setStatus('idle');
      lipSync.stop();
      if (typeof onComplete === 'function') onComplete();
    };
    utterance.onerror = (e) => {
      console.warn('[BrowserTTS] error:', e);
      avatarManager.setStatus('idle');
      lipSync.stop();
      if (typeof onComplete === 'function') onComplete();
    };

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('[BrowserTTS] speak failed:', err);
    avatarManager.setStatus('idle');
    if (typeof onComplete === 'function') onComplete();
  }
}

function enqueueAudioChunk(audioBase64, format = 'mp3', textChunk = '', isLast = false, totalChunks = 0) {
  if (!audioBase64) return;
  audioChunksReceived++;
  if (totalChunks > 0) audioChunksExpected = totalChunks;
  if (isLast) isLastAudioChunk = true;
  clearTimeout(audioQueueGraceTimer);

  audioQueue.push({ audioBase64, format, textChunk });
  if (!isPlayingAudioQueue) {
    playNextAudioQueueItem();
  }
}

async function playNextAudioQueueItem() {
  clearTimeout(audioQueueGraceTimer);
  if (audioQueue.length === 0) {
    if (isLastAudioChunk || (audioChunksExpected > 0 && audioChunksReceived >= audioChunksExpected)) {
      isPlayingAudioQueue = false;
      currentReplyStarted = false;
      lipSync.stop();
      avatarManager.setStatus('idle');
      clearTimeout(captionHideTimer);
      captionHideTimer = setTimeout(hideCaption, 5000);
    } else {
      audioQueueGraceTimer = setTimeout(() => {
        if (audioQueue.length === 0) {
          isPlayingAudioQueue = false;
          currentReplyStarted = false;
          lipSync.stop();
          avatarManager.setStatus('idle');
          clearTimeout(captionHideTimer);
          captionHideTimer = setTimeout(hideCaption, 5000);
        }
      }, 4500);
    }
    return;
  }

  isPlayingAudioQueue = true;
  avatarManager.setStatus('talking');
  const item = audioQueue.shift();
  try {
    await lipSync.resumeContext();
    let audioBlob;
    if (item.format === 'pcm') {
      audioBlob = rawPcmBase64ToWavBlob(item.audioBase64, 44100);
    } else {
      audioBlob = base64ToBlob(item.audioBase64, 'audio/mpeg');
    }
    if (currentAudioObjectUrl) URL.revokeObjectURL(currentAudioObjectUrl);
    currentAudioObjectUrl = URL.createObjectURL(audioBlob);
    ttsAudioPlayer.src = currentAudioObjectUrl;
    lipSync.start();

    // Stream spoken subtitle for this sentence in real-time
    const chunkText = item.textChunk || currentReplyFullText;
    if (chunkText) {
      streamSpokenCaption(chunkText, { audioElement: ttsAudioPlayer });
    }

    ttsAudioPlayer.onended = () => {
      playNextAudioQueueItem();
    };
    ttsAudioPlayer.onerror = (err) => {
      console.warn('[audioQueue] ttsAudioPlayer error:', err);
      playNextAudioQueueItem();
    };
    await ttsAudioPlayer.play();
  } catch (err) {
    console.warn('[audioQueue] chunk playback error:', err);
    playNextAudioQueueItem();
  }
}

function clearAudioQueue() {
  clearTimeout(audioQueueGraceTimer);
  audioQueue.length = 0;
  isPlayingAudioQueue = false;
  try { ttsAudioPlayer.pause(); } catch (e) {}
  lipSync.stop();
  avatarManager.setStatus('idle');
}

async function playAudioBase64(audioBase64, format = 'mp3', spokenText = '') {
  if (!audioBase64) return;
  try {
    await lipSync.resumeContext();
    avatarManager.setStatus('talking');
    let audioBlob;
    if (format === 'pcm') {
      audioBlob = rawPcmBase64ToWavBlob(audioBase64, 44100);
    } else {
      audioBlob = base64ToBlob(audioBase64, 'audio/mpeg');
    }
    if (currentAudioObjectUrl) URL.revokeObjectURL(currentAudioObjectUrl);
    currentAudioObjectUrl = URL.createObjectURL(audioBlob);
    ttsAudioPlayer.src = currentAudioObjectUrl;
    lipSync.start();
    if (spokenText) {
      streamSpokenCaption(spokenText, { audioElement: ttsAudioPlayer });
    }
    ttsAudioPlayer.onended = () => {
      lipSync.stop();
      avatarManager.setStatus('idle');
      captionHideTimer = setTimeout(hideCaption, 4500);
    };
    ttsAudioPlayer.onerror = () => {
      lipSync.stop();
      avatarManager.setStatus('idle');
    };
    await ttsAudioPlayer.play();
  } catch (audioErr) {
    console.warn('[audio] playback failed:', audioErr);
    lipSync.stop();
    avatarManager.setStatus('idle');
  }
}

// Transient status feedback shown as an italic caption while there's no
// real reply text yet (thinking/transcribing/etc). Purely cosmetic.
function setStatus(message) {
  // Never transition avatar to idle while audio is actively playing or queued
  if (message === 'idle' && (isPlayingAudioQueue || (ttsAudioPlayer && !ttsAudioPlayer.paused))) {
    return;
  }
  avatarManager.setStatus(message);

  const statusEmotion = {
    thinking: '🤔 Thinking',
    transcribing: '🎙️ Listening',
  };
  if (captionEmotion && statusEmotion[message]) {
    captionEmotion.textContent = statusEmotion[message];
  }

  // Never clobber or interrupt active spoken dialogue captions
  if (currentReplyStarted || activeCaptionStream || isPlayingAudioQueue || (ttsAudioPlayer && !ttsAudioPlayer.paused)) {
    return;
  }

  const chatty = {
    thinking: '✦ Pondering what to say...',
    transcribing: '🎙️ Listening closely...',
  };
  if (chatty[message]) setCaption(chatty[message], { italic: true });
}

function connectSocket() {
  socket = new WebSocket(WS_URL);
  socket.onopen = () => console.log('[ws] connected');
  socket.onclose = () => setTimeout(connectSocket, 3000);
  socket.onerror = () => console.warn('[ws] connection error');
  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      await handleServerMessage(data);
    } catch (err) {
      console.warn('[ws] failed to parse message:', err);
    }
  };
}

async function handleServerMessage(data) {
  const staleReply = data.type === 'reply' && isStale(data.request_id);
  if (staleReply) {
    console.log('[ws] dropped a superseded reply (a newer turn started first)');
    return;
  }

  switch (data.type) {
    case 'status':
      setStatus(data.message);
      if (data.character_name) {
        const charNameEl = document.getElementById('char-name');
        if (charNameEl) charNameEl.textContent = data.character_name;
        if (charNameCaption) charNameCaption.textContent = data.character_name;
      }
      if (data.affection !== undefined) {
        affectionValue.textContent = data.affection;
        updateRelationshipDisplay(data);
      }
      if (data.message === 'thinking') {
        showThinkingBubble();
      }
      // Hydrate chat log from persisted server history on initial connection
      if (data.history && Array.isArray(data.history) && data.history.length > 0 && chatLog.length <= 1) {
        if (chatMessagesStream) chatMessagesStream.innerHTML = '';
        chatLog.length = 0;
        data.history.forEach((turn) => {
          logMessage(turn.role, turn.text, turn.emotion);
        });
      }

      // Check if new user needs onboarding modal
      const hasOnboarded = localStorage.getItem('yumi_onboarded');
      const isBrandNew = (!data.interaction_count || data.interaction_count === 0) && (!data.history || data.history.length === 0);
      if (!data.is_onboarded && !hasOnboarded && isBrandNew) {
        openOnboardingModal(data.character_name || 'Yumi', data.custom_personality || '');
      } else {
        localStorage.setItem('yumi_onboarded', 'true');
      }
      break;

    case 'transcript':
      logMessage('user', data.text);
      showThinkingBubble();
      break;

    case 'reply_start': {
      currentReplyStarted = true;
      currentReplyFullText = data.text || '';
      audioChunksExpected = 0;
      audioChunksReceived = 0;
      isLastAudioChunk = false;
      clearAudioQueue();
      removeThinkingBubble();
      logMessage('assistant', data.text, data.emotion);
      affectionValue.textContent = data.affection;
      updateRelationshipDisplay(data);
      avatarManager.setEmotion(data.emotion || 'neutral');
      avatarManager.playGesture(data.emotion || 'happy');
      if (captionEmotion) {
        const emo = (data.emotion || 'neutral').toLowerCase();
        const emoMap = {
          happy: '😊 Happy',
          embarrassed: '😳 Flustered',
          angry: '😠 Pouting',
          sad: '😢 Melancholy',
          surprised: '😲 Surprised',
          neutral: '✨ Calm',
        };
        captionEmotion.textContent = emoMap[emo] || `✨ ${emo}`;
      }

      // Stream dialogue text immediately into subtitle box with natural pace
      const textLen = (data.text || '').length;
      const readDuration = Math.max(3500, textLen * 65);
      streamSpokenCaption(data.text, {
        estimatedDurationMs: readDuration,
        onComplete: () => {
          if (!isPlayingAudioQueue && (ttsAudioPlayer.paused || ttsAudioPlayer.ended)) {
            avatarManager.setStatus('idle');
          }
        },
      });

      if (data.action) console.log('Action triggered:', data.action, data.action_result);
      if (data.new_facts && data.new_facts.length > 0) {
        if (!settingsDrawer.classList.contains('hidden')) refreshMemory();
      }
      break;
    }

    case 'audio_chunk': {
      enqueueAudioChunk(data.audio_base64, data.audio_format, data.text_chunk, data.is_last, data.total_chunks);
      break;
    }

    case 'reply': {
      if (!currentReplyStarted) {
        removeThinkingBubble();
        logMessage('assistant', data.text, data.emotion);
        affectionValue.textContent = data.affection;
        updateRelationshipDisplay(data);
        avatarManager.setEmotion(data.emotion || 'neutral');
        avatarManager.playGesture(data.emotion || 'happy');
        if (captionEmotion) {
          const emo = (data.emotion || 'neutral').toLowerCase();
          const emoMap = {
            happy: '😊 Happy',
            embarrassed: '😳 Flustered',
            angry: '😠 Pouting',
            sad: '😢 Melancholy',
            surprised: '😲 Surprised',
            neutral: '✨ Calm',
          };
          captionEmotion.textContent = emoMap[emo] || `✨ ${emo}`;
        }
      }

      // Voice playback check: if audio was delivered via audio_chunk or data.audio_base64, play it
      if (!isPlayingAudioQueue && audioQueue.length === 0) {
        if (data.audio_base64) {
          await playAudioBase64(data.audio_base64, data.audio_format, data.text);
        } else if (audioChunksReceived === 0 && data.text) {
          // Zero audio chunks arrived - fallback to browser speech synthesis
          speakWithBrowserTTS(data.text);
        }
      }

      currentReplyStarted = false;

      if (data.action) {
        console.log('Action triggered:', data.action, data.action_result);
      }
      if (data.new_facts && data.new_facts.length > 0) {
        console.log('Remembered:', data.new_facts);
        if (!settingsDrawer.classList.contains('hidden')) refreshMemory();
      }
      if (data.milestones && data.milestones.length > 0) {
        console.log('Relationship milestone reached:', data.milestones);
      }
      break;
    }

    case 'timer_expired': {
      const t = data.timer;
      const notice = `⏰ Timer Finished: ${t?.label || 'Timer'}!`;
      logMessage('assistant', notice, 'surprised');
      setCaption(notice, { autoHide: true });
      avatarManager.setEmotion('surprised');
      if (data.audio_base64) {
        await playAudioBase64(data.audio_base64, data.audio_format);
      }
      break;
    }

    case 'task_reminder': {
      const task = data.task;
      const notice = `📌 Task Reminder: ${task?.title || 'Task'} is due!`;
      logMessage('assistant', notice, 'happy');
      setCaption(notice, { autoHide: true });
      avatarManager.setEmotion('happy');
      if (data.audio_base64) {
        await playAudioBase64(data.audio_base64, data.audio_format);
      }
      loadTasks();
      break;
    }

    case 'proactive_message': {
      logMessage('assistant', data.text, data.emotion);
      avatarManager.setEmotion(data.emotion || 'happy');
      if (data.audio_base64) {
        await playAudioBase64(data.audio_base64, data.audio_format, data.text);
      } else {
        const readDuration = Math.max(3000, Math.min(10000, (data.text || '').length * 65));
        streamSpokenCaption(data.text, {
          estimatedDurationMs: readDuration,
          onComplete: () => {
            avatarManager.setStatus('idle');
          },
        });
      }
      if (data.affection !== undefined) {
        affectionValue.textContent = data.affection;
        updateRelationshipDisplay(data);
      }
      break;
    }

    case 'diary_entry':
      prependDiaryEntry({ timestamp: Date.now() / 1000, text: data.text });
      break;

    case 'error':
      console.warn('[server error]', data.message);
      removeThinkingBubble();
      avatarManager.setStatus('idle');
      setCaption(data.message, { italic: true, autoHide: true });
      logMessage('assistant', `⚠️ ${data.message}`, 'sad');
      break;

    default:
      console.warn('Unknown message type from server:', data);
  }
}

function base64ToBlob(base64, mimeType) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
}

function rawPcmBase64ToWavBlob(base64Pcm, sampleRate = 44100) {
  const binaryString = atob(base64Pcm);
  const pcmBytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    pcmBytes[i] = binaryString.charCodeAt(i);
  }
  const buffer = new ArrayBuffer(44 + pcmBytes.length);
  const view = new DataView(buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcmBytes.length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, pcmBytes.length, true);

  new Uint8Array(buffer, 44).set(pcmBytes);
  return new Blob([buffer], { type: 'audio/wav' });
}

function interruptCurrentTurn() {
  clearAudioQueue();
  if (!ttsAudioPlayer.paused) ttsAudioPlayer.pause();
  lipSync.stop();
  if (avatarManager) {
    avatarManager.setEmotion('neutral');
    avatarManager.setState('idle');
  }
  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify({ type: 'interrupt', request_id: latestRequestId }));
    } catch (e) {
      console.warn('Failed to send interrupt to backend:', e);
    }
  }
}

// ---------------------------------------------------------------------
// Voice: WAV encoding + VAD-driven always-on listening + barge-in
// ---------------------------------------------------------------------
function float32ToWavBlob(float32Audio, sampleRate = 16000) {
  const numSamples = float32Audio.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, float32Audio[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function sendAudioTurn(float32Audio) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const wavBlob = float32ToWavBlob(float32Audio, 16000);
  const audioBase64 = await blobToBase64(wavBlob);
  const requestId = nextRequestId();
  socket.send(JSON.stringify({ type: 'audio_data', audio_base64: audioBase64, request_id: requestId }));
}

async function toggleMic(forceState = null) {
  const desired = typeof forceState === 'boolean' ? forceState : !micEnabled;

  micEnabled = desired;

  if (micEnabled) {
    micToggle.classList.remove('muted');
    micToggle.title = 'Microphone is ON (Listening) — Click to Mute';
    if (sttToggleListenBtn) sttToggleListenBtn.textContent = '🎤 Mic: Active';
    setCaption('🎤 Microphone is ON — listening...', { italic: true, autoHide: true });
    await startVoiceActivityDetection();
  } else {
    micToggle.classList.add('muted');
    micToggle.classList.remove('speaking');
    micToggle.title = 'Microphone is OFF — Click to Unmute';
    if (sttToggleListenBtn) sttToggleListenBtn.textContent = '🔇 Mic: Muted';
    stopVoiceActivityDetection();
    setCaption('🔇 Microphone is OFF (Muted)', { italic: true, autoHide: true });
  }
}

async function startVoiceActivityDetection() {
  if (typeof window.vad === 'undefined') {
    console.error('window.vad is undefined; check the vad-web scripts in index.html.');
    setCaption('⚠️ Voice VAD script not available.', { italic: true, autoHide: true });
    toggleMic(false);
    return;
  }
  if (micInitializing) return;
  micInitializing = true;
  try {
    if (!micVad) {
      micVad = await window.vad.MicVAD.new({
        model: 'v5',
        positiveSpeechThreshold: 0.5,
        minSpeechFrames: 4,
        onnxWASMBasePath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/',
        baseAssetPath: 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/',
        onSpeechStart: () => {
          if (!micEnabled) return;
          const bargeInEnabled = settingBargeInToggle ? settingBargeInToggle.checked : true;
          if (bargeInEnabled) {
            interruptCurrentTurn();
          }
          micToggle.classList.add('speaking');
          avatarManager.setStatus('listening');
        },
        onSpeechEnd: (audio) => {
          if (!micEnabled) return;
          micToggle.classList.remove('speaking');
          avatarManager.setStatus('thinking');
          sendAudioTurn(audio);
        },
      });
    }
    if (micEnabled) {
      micVad.start();
    }
  } catch (err) {
    console.error('Failed to initialize VAD:', err);
    setCaption('⚠️ Microphone access denied or unavailable.', { italic: true, autoHide: true });
    toggleMic(false);
  } finally {
    micInitializing = false;
  }
}

function stopVoiceActivityDetection() {
  if (micVad) {
    try { micVad.pause(); } catch (e) {}
    try {
      if (micVad.stream) {
        micVad.stream.getTracks().forEach((track) => {
          track.enabled = false;
          track.stop(); // Stop hardware audio track so browser/phone mic shuts off completely!
        });
      }
    } catch (e) {}
    try { micVad.destroy?.(); } catch (e) {}
    micVad = null;
  }
}

micToggle.addEventListener('click', () => {
  toggleMic();
});

// ---------------------------------------------------------------------
// Typed text input & Interaction Sparks
// ---------------------------------------------------------------------
function sendUserTextMessage(text) {
  text = (text || '').trim();
  if (!text) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.warn('[ws] cannot send text, websocket not open');
    setCaption('Connecting to companion server...', { autoHide: true });
    return;
  }
  interruptCurrentTurn();
  logMessage('user', text);
  showThinkingBubble();
  avatarManager.setStatus('thinking');
  const requestId = nextRequestId();
  socket.send(JSON.stringify({ type: 'text_input', text, request_id: requestId }));
}

if (textInput) {
  textInput.addEventListener('focus', () => {
    avatarManager.setStatus('listening');
  });
  textInput.addEventListener('blur', () => {
    if (avatarManager.animationManager?.getState() === 'listening') {
      avatarManager.setStatus('idle');
    }
  });
}

textForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = textInput.value.trim();
  if (!text) return;
  sendUserTextMessage(text);
  textInput.value = '';
});

const drawerChatForm = document.getElementById('drawer-chat-form');
const drawerChatInput = document.getElementById('drawer-chat-input');
if (drawerChatForm && drawerChatInput) {
  drawerChatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = drawerChatInput.value.trim();
    if (!val) return;
    sendUserTextMessage(val);
    drawerChatInput.value = '';
  });
}

// Utsuwa & AIRI Quick Interaction Sparks
document.querySelectorAll('#interaction-sparks .spark-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const spark = chip.dataset.spark;
    if (spark === 'pat') {
      vrmManager.onTouchReaction('head', { clientX: window.innerWidth * 0.5, clientY: window.innerHeight * 0.38 });
    } else if (spark === 'compliment') {
      sendUserTextMessage("You look really cute and pretty today, Yumi!");
    } else if (spark === 'mood') {
      sendUserTextMessage("How are you feeling right now?");
    } else if (spark === 'weather') {
      sendUserTextMessage("What's the weather and current time?");
    } else if (spark === 'secret') {
      sendUserTextMessage("Tell me something you've been privately thinking about lately.");
    } else if (spark === 'task') {
      sendUserTextMessage("What tasks and reminders do I have for today?");
    }
  });
});

// ---------------------------------------------------------------------
// "+" attach popover: VRM upload, screen share, webcam
// ---------------------------------------------------------------------
attachBtn.addEventListener('click', () => attachMenu.classList.toggle('hidden'));
document.addEventListener('click', (event) => {
  if (!attachMenu.contains(event.target) && event.target !== attachBtn) {
    attachMenu.classList.add('hidden');
  }
});

vrmUpload.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (currentVrmObjectUrl) URL.revokeObjectURL(currentVrmObjectUrl);
  currentVrmObjectUrl = URL.createObjectURL(file);
  try {
    if (avatarLoader) {
      avatarLoader.classList.remove('hidden');
      if (avatarLoaderTitle) avatarLoaderTitle.textContent = 'Loading Custom VRM...';
      if (avatarLoaderDetail) avatarLoaderDetail.textContent = file.name;
    }
    await avatarManager.loadVrmFromUrl(currentVrmObjectUrl);
    avatarManager.setAvatarType('vrm');
    if (avatarLoader) avatarLoader.classList.add('hidden');
    setCaption('Custom VRM model loaded successfully!', { autoHide: true });
  } catch (err) {
    console.error('Failed to load VRM:', err);
    if (avatarLoader) avatarLoader.classList.add('hidden');
    setCaption(`Error loading VRM: ${err.message}`, { autoHide: true });
  }
  attachMenu.classList.add('hidden');
});

// --- Screen share / webcam: periodic downscaled JPEG frames sent as
// fire-and-forget screen_frame/webcam_frame messages. The backend only
// ever attaches the FRESHEST frame to the next reply, then discards it
// (see server.py) — this loop just keeps that "freshest frame" current. ---
const FRAME_INTERVAL_MS = 4000;
const FRAME_MAX_DIMENSION = 640;
let screenStream = null;
let webcamStream = null;
let screenFrameTimer = null;
let webcamFrameTimer = null;

function captureFrameToBase64(videoEl) {
  const scale = Math.min(1, FRAME_MAX_DIMENSION / Math.max(videoEl.videoWidth, videoEl.videoHeight));
  frameCanvas.width = Math.max(1, Math.round(videoEl.videoWidth * scale));
  frameCanvas.height = Math.max(1, Math.round(videoEl.videoHeight * scale));
  const ctx = frameCanvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, frameCanvas.width, frameCanvas.height);
  return frameCanvas.toDataURL('image/jpeg', 0.7).split(',')[1];
}

function sendFrame(type, videoEl) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  if (videoEl.readyState < 2) return; // not enough data yet
  const imageBase64 = captureFrameToBase64(videoEl);
  socket.send(JSON.stringify({ type, image_base64: imageBase64 }));
}

async function toggleScreenShare() {
  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
    clearInterval(screenFrameTimer);
    screenShareToggle.textContent = '🖥️ Screen share: off';
    screenShareToggle.classList.remove('active');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    alert('Screen sharing is not supported in this browser or environment (requires HTTPS or localhost).');
    return;
  }
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    screenVideo.srcObject = screenStream;
    await screenVideo.play();
    screenShareToggle.textContent = '🖥️ Screen share: on';
    screenShareToggle.classList.add('active');
    screenFrameTimer = setInterval(() => sendFrame('screen_frame', screenVideo), FRAME_INTERVAL_MS);
    screenStream.getVideoTracks()[0].addEventListener('ended', () => toggleScreenShare());
  } catch (err) {
    console.warn('Screen share cancelled or failed:', err);
    if (err.name !== 'NotAllowedError') {
      alert(`Could not start screen sharing: ${err.message || err.name}`);
    }
  }
}

async function toggleWebcam() {
  if (webcamStream) {
    webcamStream.getTracks().forEach((t) => t.stop());
    webcamStream = null;
    clearInterval(webcamFrameTimer);
    webcamToggle.textContent = '📷 Webcam: off';
    webcamToggle.classList.remove('active');
    return;
  }
  const photoInput = document.getElementById('camera-photo-input');
  const isSecure = window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const hasGetUserMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  if (!isSecure || !hasGetUserMedia) {
    if (photoInput) {
      setCaption('📷 Camera photo mode (browsers require HTTPS or localhost for live streaming)', { italic: true, autoHide: true });
      photoInput.click();
      return;
    }
    setCaption('Webcam requires camera hardware, HTTPS, or localhost.', { isError: true, autoHide: true });
    return;
  }
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } } });
    webcamVideo.srcObject = webcamStream;
    await webcamVideo.play();
    webcamToggle.textContent = '📷 Webcam: on';
    webcamToggle.classList.add('active');
    webcamFrameTimer = setInterval(() => sendFrame('webcam_frame', webcamVideo), FRAME_INTERVAL_MS);
    setCaption('📷 Webcam live stream active!', { autoHide: true });
  } catch (err) {
    console.warn('Webcam access cancelled or failed:', err);
    if (photoInput) {
      photoInput.click();
    } else {
      setCaption(`Could not access webcam: ${err.message || err.name}`, { isError: true, autoHide: true });
    }
  }
}

screenShareToggle.addEventListener('click', toggleScreenShare);
webcamToggle.addEventListener('click', toggleWebcam);

if (snapshotBtn) {
  snapshotBtn.addEventListener('click', () => {
    try {
      const flashEl = document.getElementById('photo-flash-overlay');
      if (flashEl) {
        flashEl.classList.add('flashing');
        setTimeout(() => flashEl.classList.remove('flashing'), 75);
      }
      const dataUrl = avatarManager.captureSnapshot('image/png');
      if (!dataUrl) {
        alert('Could not capture avatar snapshot.');
        return;
      }
      const a = document.createElement('a');
      a.href = dataUrl;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      a.download = `yumi-snapshot-${timestamp}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      attachMenu.classList.add('hidden');
      setCaption('📸 Snapshot captured!', { autoHide: true });
    } catch (e) {
      alert('Snapshot failed: ' + e.message);
    }
  });
}

// --- Live Avatar Emotion & Animation Tester Palette ---
if (testerToggleBtn && liveTesterWindow) {
  testerToggleBtn.addEventListener('click', () => {
    liveTesterWindow.classList.toggle('hidden');
  });
}
if (testerCloseBtn && liveTesterWindow) {
  testerCloseBtn.addEventListener('click', () => {
    liveTesterWindow.classList.add('hidden');
  });
}

document.querySelectorAll('[data-test-emo]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const emo = btn.dataset.testEmo;
    avatarManager.testEmotion(emo);
    if (captionEmotion) captionEmotion.textContent = `✨ ${emo}`;
  });
});

document.querySelectorAll('[data-test-gesture]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const g = btn.dataset.testGesture;
    avatarManager.testGesture(g);
  });
});

document.querySelectorAll('[data-test-state]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const s = btn.dataset.testState;
    avatarManager.setStatus(s);
  });
});

// Avatar Mode toggle in Tester Window
document.querySelectorAll('[data-avatar-type]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.avatarType;
    avatarManager.setAvatarType(type);
    document.querySelectorAll('[data-avatar-type]').forEach((b) => b.classList.toggle('active', b.dataset.avatarType === type));
    document.querySelectorAll('input[name="avatar-type-mode"]').forEach((r) => { r.checked = r.value === type; });
  });
});

// ---------------------------------------------------------------------
// Settings drawer: background mode (above), character/voice settings,
// diary, usage.
// ---------------------------------------------------------------------
// Shared PATCH helper. Checks res.ok — the old version only handled a
// network exception, so a 4xx/5xx from the server still displayed "Saved"
// (one of the reasons settings looked like they worked but didn't).
async function patchSettings(body) {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  const data = await res.json();
  if (data.status === 'error') throw new Error(data.message || 'Unknown error');
  return data;
}

function selectedProviderInfo() {
  return providerList.find((p) => p.id === settingLlmProvider.value);
}

// Updates badges, description, model hint, and which rows are relevant
// (local providers don't need a key; only local/custom/self-hosted need a
// base URL) whenever the provider dropdown changes.
let lastSettingsData = null;

function renderProviderDetails() {
  const info = selectedProviderInfo();
  if (!info) return;

  providerBadges.innerHTML = '';
  const addBadge = (text, cls = '') => {
    const b = document.createElement('span');
    b.className = `badge ${cls}`.trim();
    b.textContent = text;
    providerBadges.appendChild(b);
  };
  if (info.is_local) addBadge('Local', 'local');
  if (info.supports_vision) addBadge('Vision');
  if (info.supports_search) addBadge('Web search');
  if (info.supports_thinking) addBadge('Thinking');

  providerDesc.textContent = info.notes || 'Which service generates her replies.';
  settingLlmModel.placeholder = info.example_models.length
    ? `e.g. ${info.example_models[0]}`
    : 'model name';
  if (info.example_models.length && (!settingLlmModel.value.trim() || settingLlmModel.dataset.lastProvider !== info.id)) {
    settingLlmModel.value = info.example_models[0];
  }
  settingLlmModel.dataset.lastProvider = info.id;
  rowLlmApiKey.classList.toggle('hidden', !info.requires_api_key);
  // Gemini has its own model setting in .env and doesn't use a base URL.
  rowLlmBaseUrl.classList.toggle('hidden', info.id === 'gemini');
  settingLlmBaseUrl.placeholder = info.default_base_url || 'https://your-endpoint/v1';

  const isKeySaved = (info.id === 'gemini')
    ? Boolean(lastSettingsData?.gemini_api_key_set || lastSettingsData?.llm_api_key_set)
    : Boolean(lastSettingsData?.llm_api_key_set);
  settingLlmApiKey.placeholder = isKeySaved
    ? '•••••••• (saved — leave blank to keep)'
    : (info.id === 'gemini' ? 'AIzaSy... (Gemini API Key)' : 'API Key');
}

async function loadProviders(activeId) {
  try {
    const res = await fetch(`${API_BASE}/providers`);
    const data = await res.json();
    providerList = data.providers || [];
    settingLlmProvider.innerHTML = '';
    providerList.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      settingLlmProvider.appendChild(opt);
    });
    settingLlmProvider.value = activeId || data.active;
    renderProviderDetails();
  } catch (err) {
    console.warn('Failed to load providers:', err);
    settingsBrainStatus.textContent = 'Could not reach the backend — is it running?';
    settingsBrainStatus.classList.add('error');
  }
}

settingLlmProvider.addEventListener('change', renderProviderDetails);

async function openSettingsDrawer() {
  settingsDrawer.classList.remove('hidden');
  try {
    const res = await fetch(`${API_BASE}/settings`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    lastSettingsData = data;
    settingCharacterName.value = data.character_name || '';
    if (settingPersonalityText) settingPersonalityText.value = data.custom_personality || '';

    // Voice / TTS
    if (settingTtsProvider) {
      settingTtsProvider.value = data.tts_provider || 'fish_audio';
      updateTtsProviderSections();
    }
    if (settingFishModel && data.fish_audio_model) {
      settingFishModel.value = data.fish_audio_model;
    }
    if (settingElevenModel && data.elevenlabs_model) {
      settingElevenModel.value = data.elevenlabs_model;
    }
    if (settingVoiceId) settingVoiceId.value = data.fish_audio_voice_id || '';
    if (settingFishKey) {
      settingFishKey.value = '';
      settingFishKey.placeholder = data.fish_audio_api_key_set ? '•••••••• (saved — leave blank to keep)' : 'API key';
    }
    if (settingElevenVoiceId) settingElevenVoiceId.value = data.elevenlabs_voice_id || '21m00Tcm4TlvDq8ikWAM';
    if (settingElevenKey) {
      settingElevenKey.value = '';
      settingElevenKey.placeholder = data.elevenlabs_api_key_set ? '•••••••• (saved — leave blank to keep)' : 'xi-...';
    }

    // Brain / LLM
    settingLlmModel.value = (data.llm_provider === 'gemini' ? (data.gemini_model || data.llm_model) : (data.llm_model || '')) || '';
    settingLlmBaseUrl.value = data.llm_base_url || '';
    settingLlmApiKey.value = '';
    const isBrainKeySaved = (data.llm_provider === 'gemini')
      ? Boolean(data.gemini_api_key_set || data.llm_api_key_set)
      : Boolean(data.llm_api_key_set);
    settingLlmApiKey.placeholder = isBrainKeySaved ? '•••••••• (saved — leave blank to keep)' : 'API key';
    if (settingLlmTemp) {
      settingLlmTemp.value = data.gemini_temperature !== undefined ? data.gemini_temperature : 0.9;
      if (tempDisplay) tempDisplay.textContent = settingLlmTemp.value;
    }
    if (settingLlmTokens) settingLlmTokens.value = data.gemini_max_output_tokens || 200;
    if (settingGeminiSearch) settingGeminiSearch.checked = data.gemini_enable_search !== false;

    // Diagnostics
    if (devActiveProvider) devActiveProvider.textContent = `${data.llm_provider || 'gemini'} (${data.llm_model || 'default'})`;
    if (devActiveTts) devActiveTts.textContent = data.tts_provider || 'fish_audio';

    // STT Settings
    if (settingSttEngine) settingSttEngine.value = data.stt_engine || 'google';
    if (settingWhisperSize) settingWhisperSize.value = data.whisper_model_size || 'base';
    if (whisperStatusHint) {
      if (data.whisper_status?.available) {
        whisperStatusHint.textContent = `Whisper is ready locally (${data.whisper_status.engine}).`;
        whisperStatusHint.style.color = '#38bdf8';
      } else {
        whisperStatusHint.textContent = 'Whisper package not detected. Using Google Web Speech fallback.';
        whisperStatusHint.style.color = 'var(--text-secondary)';
      }
    }

    // Proactive Living
    if (settingProactiveToggle) {
      settingProactiveToggle.checked = data.proactive_enabled !== false;
    }
    if (settingProactiveInterval) {
      settingProactiveInterval.value = String(data.proactive_idle_seconds || 120);
    }
    // Wake Word
    if (settingWakeWordToggle) {
      settingWakeWordToggle.checked = Boolean(data.wake_word_enabled);
    }
    // Refresh VRMA clips display
    renderVrmaClipsList();

    updateRelationshipDisplay(data);
    await loadProviders(data.llm_provider);
  } catch (err) {
    console.warn('Failed to load settings:', err);
    settingsSaveStatus.textContent = 'Could not load settings — is the backend running?';
    settingsSaveStatus.classList.add('error');
  }
  refreshDiary();
  refreshUsage();
  refreshMemory();
  loadTasks();
}

function updateTtsProviderSections() {
  if (!settingTtsProvider) return;
  const p = settingTtsProvider.value;
  if (sectionFishAudio) sectionFishAudio.classList.toggle('hidden', p !== 'fish_audio');
  if (sectionElevenlabs) sectionElevenlabs.classList.toggle('hidden', p !== 'elevenlabs');
}
if (settingTtsProvider) settingTtsProvider.addEventListener('change', updateTtsProviderSections);

if (settingLlmTemp && tempDisplay) {
  settingLlmTemp.addEventListener('input', () => {
    tempDisplay.textContent = settingLlmTemp.value;
  });
}

function toggleSettingsDrawer() {
  if (!settingsDrawer) return;
  if (settingsDrawer.classList.contains('hidden')) {
    openSettingsDrawer();
  } else {
    settingsDrawer.classList.add('hidden');
  }
}

if (settingsToggleBtn) {
  settingsToggleBtn.addEventListener('click', toggleSettingsDrawer);
}
if (settingsCloseBtn) {
  settingsCloseBtn.addEventListener('click', () => settingsDrawer.classList.add('hidden'));
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.body.classList.contains('obs-mode')) {
      toggleObsMode(false);
    }
    if (settingsDrawer && !settingsDrawer.classList.contains('hidden')) {
      settingsDrawer.classList.add('hidden');
    }
    if (historyDrawer && !historyDrawer.classList.contains('hidden')) {
      historyDrawer.classList.add('hidden');
    }
  }
});

function setStatusLine(el, text, isError = false) {
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', isError);
}

// Character panel
settingsSaveBtn.addEventListener('click', async () => {
  setStatusLine(settingsSaveStatus, 'Saving...');
  try {
    const name = settingCharacterName.value.trim() || 'Yumi';
    const personality = (settingPersonalityText && settingPersonalityText.value.trim()) || '';
    const proactiveEnabled = settingProactiveToggle ? settingProactiveToggle.checked : true;
    const proactiveInterval = settingProactiveInterval ? (parseInt(settingProactiveInterval.value, 10) || 120) : 120;
    await patchSettings({
      character_name: name,
      custom_personality: personality,
      proactive_enabled: proactiveEnabled,
      proactive_idle_seconds: proactiveInterval,
    });
    const charNameEl = document.getElementById('char-name');
    if (charNameEl) charNameEl.textContent = name;
    if (charNameCaption) charNameCaption.textContent = name;
    setStatusLine(settingsSaveStatus, 'Saved. Applies immediately; also update .env to keep name after a restart.');
  } catch (err) {
    setStatusLine(settingsSaveStatus, `Failed to save: ${err.message}`, true);
  }
});

// Voice panel
settingsSaveVoiceBtn.addEventListener('click', async () => {
  setStatusLine(settingsSaveVoiceStatus, 'Saving...');
  try {
    const body = {
      tts_provider: settingTtsProvider ? settingTtsProvider.value : 'fish_audio',
      fish_audio_voice_id: settingVoiceId ? settingVoiceId.value.trim() : '',
      fish_audio_model: settingFishModel ? settingFishModel.value : 's2.1-pro-free',
      elevenlabs_voice_id: settingElevenVoiceId ? settingElevenVoiceId.value.trim() : '',
      elevenlabs_model: settingElevenModel ? settingElevenModel.value : 'eleven_multilingual_v2',
      wake_word_enabled: settingWakeWordToggle ? settingWakeWordToggle.checked : false,
    };
    if (settingFishKey && settingFishKey.value.trim()) body.fish_audio_api_key = settingFishKey.value.trim();
    if (settingElevenKey && settingElevenKey.value.trim()) body.elevenlabs_api_key = settingElevenKey.value.trim();
    await patchSettings(body);
    setStatusLine(settingsSaveVoiceStatus, 'Saved voice settings! Applies immediately.');
    if (devActiveTts) devActiveTts.textContent = body.tts_provider;
  } catch (err) {
    setStatusLine(settingsSaveVoiceStatus, `Failed to save: ${err.message}`, true);
  }
});

// STT panel save
if (settingsSaveSttBtn) {
  settingsSaveSttBtn.addEventListener('click', async () => {
    setStatusLine(settingsSaveSttStatus, 'Saving...');
    try {
      const engine = settingSttEngine ? settingSttEngine.value : 'google';
      const size = settingWhisperSize ? settingWhisperSize.value : 'base';
      await patchSettings({ stt_engine: engine, whisper_model_size: size });
      setStatusLine(settingsSaveSttStatus, 'Saved STT preferences!');
    } catch (err) {
      setStatusLine(settingsSaveSttStatus, `Failed to save: ${err.message}`, true);
    }
  });
}

// Brain panel — switches provider/model live; takes effect on her very next reply
settingsSaveBrainBtn.addEventListener('click', async () => {
  const info = selectedProviderInfo();
  if (!info) return;

  const model = settingLlmModel.value.trim();
  if (info.id !== 'gemini' && !model && !info.example_models.length) {
    setStatusLine(settingsBrainStatus, 'Enter a model name for this provider.', true);
    return;
  }

  setStatusLine(settingsBrainStatus, 'Saving...');
  try {
    const body = {
      llm_provider: info.id,
      llm_model: model,
      llm_base_url: settingLlmBaseUrl.value.trim(),
    };
    const key = settingLlmApiKey.value.trim();
    if (key) {
      body.llm_api_key = key;
      if (info.id === 'gemini') {
        body.gemini_api_key = key;
      }
    }
    if (info.id === 'gemini' && model) {
      body.gemini_model = model;
    }
    if (settingLlmTemp) body.gemini_temperature = parseFloat(settingLlmTemp.value);
    if (settingLlmTokens) body.gemini_max_output_tokens = parseInt(settingLlmTokens.value, 10);
    if (settingGeminiSearch) body.gemini_enable_search = settingGeminiSearch.checked;

    await patchSettings(body);
    settingLlmApiKey.value = '';
    setStatusLine(settingsBrainStatus, `Saved and switched to ${info.name}! Applies immediately.`);
    if (devActiveProvider) devActiveProvider.textContent = `${info.name} (${model || 'default'})`;
  } catch (err) {
    setStatusLine(settingsBrainStatus, `Failed to save: ${err.message}`, true);
  }
});

function formatDiaryDate(timestamp) {
  return new Date(timestamp * 1000).toLocaleString();
}

function prependDiaryEntry(entry) {
  const li = document.createElement('li');
  const dateSpan = document.createElement('span');
  dateSpan.className = 'diary-date';
  dateSpan.textContent = formatDiaryDate(entry.timestamp);
  li.appendChild(dateSpan);
  li.appendChild(document.createTextNode(entry.text));
  diaryList.prepend(li);
}

async function refreshDiary() {
  try {
    const res = await fetch(`${API_BASE}/diary`);
    const data = await res.json();
    diaryList.innerHTML = '';
    (data.entries || []).slice().reverse().forEach(prependDiaryEntry);
  } catch (err) {
    console.warn('Failed to load diary:', err);
  }
}

writeDiaryBtn.addEventListener('click', () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const requestId = nextRequestId();
  socket.send(JSON.stringify({ type: 'write_diary', request_id: requestId }));
});

async function refreshUsage() {
  try {
    const res = await fetch(`${API_BASE}/usage`);
    const data = await res.json();
    usageList.innerHTML = '';
    const rows = [
      ['Gemini calls', data.gemini_calls],
      ['Gemini input tokens', data.gemini_input_tokens],
      ['Gemini output tokens', data.gemini_output_tokens],
      ['Fish Audio calls', data.fish_audio_calls],
      ['Fish Audio characters', data.fish_audio_characters],
    ];
    rows.forEach(([label, value]) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${label}</span><span>${value}</span>`;
      usageList.appendChild(li);
    });
  } catch (err) {
    console.warn('Failed to load usage:', err);
  }
}

// ---------------------------------------------------------------------
// Memory: she decides what to remember (via her own [memory: ...] tag,
// see brain.py) — this section is purely for VIEWING and
// manually deleting what she's kept. Nothing here expires on its own.
// ---------------------------------------------------------------------
async function refreshMemory() {
  try {
    const res = await fetch(`${API_BASE}/memory/nodes`);
    if (res.ok) {
      const data = await res.json();
      if (data.nodes && data.nodes.length > 0) {
        renderMemoryNodes(data.nodes);
        return;
      }
    }
  } catch (e) { /* fallback to flat facts */ }

  try {
    const res = await fetch(`${API_BASE}/memory`);
    const data = await res.json();
    renderMemoryList(data.facts || []);
  } catch (err) {
    console.warn('Failed to load memory:', err);
  }
}

function renderMemoryNodes(nodes) {
  if (!memoryList) return;
  memoryList.innerHTML = '';
  if (nodes.length === 0) {
    const li = document.createElement('li');
    li.className = 'memory-empty';
    li.textContent = 'Nothing remembered in memory graph yet.';
    memoryList.appendChild(li);
    return;
  }
  nodes.forEach((node) => {
    const li = document.createElement('li');
    li.className = 'memory-node-card';

    const header = document.createElement('div');
    header.className = 'memory-node-header';

    const emoBadge = document.createElement('span');
    emoBadge.className = 'chat-msg-emotion-tag';
    emoBadge.textContent = node.emotion || 'neutral';
    header.appendChild(emoBadge);

    const ctxBadge = document.createElement('span');
    ctxBadge.className = 'task-due';
    ctxBadge.textContent = node.context || 'general';
    header.appendChild(ctxBadge);

    const delBtn = document.createElement('button');
    delBtn.className = 'task-del-btn';
    delBtn.style.marginLeft = 'auto';
    delBtn.textContent = '✕';
    delBtn.title = 'Forget this';
    delBtn.addEventListener('click', async () => {
      try {
        await fetch(`${API_BASE}/memory/nodes/${node.id}`, { method: 'DELETE' });
        refreshMemory();
      } catch (err) {
        console.warn('Failed to delete node:', err);
      }
    });
    header.appendChild(delBtn);

    li.appendChild(header);

    const textDiv = document.createElement('div');
    textDiv.className = 'memory-node-text';
    textDiv.textContent = node.text;
    li.appendChild(textDiv);

    if (node.associations && node.associations.length > 0) {
      const meta = document.createElement('div');
      meta.className = 'memory-node-meta';
      meta.textContent = `Associations: ${node.associations.join(', ')}`;
      li.appendChild(meta);
    }

    memoryList.appendChild(li);
  });
}

function renderMemoryList(facts) {
  memoryList.innerHTML = '';
  if (facts.length === 0) {
    const li = document.createElement('li');
    li.className = 'memory-empty';
    li.textContent = 'Nothing remembered yet.';
    memoryList.appendChild(li);
    return;
  }
  facts.forEach((fact) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.className = 'memory-fact-text';
    span.textContent = fact;
    const delBtn = document.createElement('button');
    delBtn.className = 'memory-delete-btn';
    delBtn.textContent = '✕';
    delBtn.title = 'Forget this';
    delBtn.addEventListener('click', () => deleteMemoryFact(fact));
    li.appendChild(span);
    li.appendChild(delBtn);
    memoryList.appendChild(li);
  });
}

async function deleteMemoryFact(fact) {
  try {
    await fetch(`${API_BASE}/memory`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fact }),
    });
    refreshMemory();
  } catch (err) {
    console.warn('Failed to delete memory fact:', err);
  }
}

// Memory Graph Export & Import
if (memoryGraphExportBtn) {
  memoryGraphExportBtn.addEventListener('click', async () => {
    try {
      const res = await fetch(`${API_BASE}/memory/export`);
      if (!res.ok) throw new Error('Export request failed');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `yumi-memory-graph-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Failed to export memory graph: ' + err.message);
    }
  });
}

if (memoryGraphImportFile) {
  memoryGraphImportFile.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const json = JSON.parse(evt.target.result);
        const res = await fetch(`${API_BASE}/memory/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(json),
        });
        const resData = await res.json();
        if (resData.status === 'ok') {
          alert(`Memory graph imported (${resData.imported_nodes || 0} nodes restored)!`);
          refreshMemory();
        } else {
          alert(`Import failed: ${resData.message}`);
        }
      } catch (err) {
        alert('Malformed memory file: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
}

// ---------------------------------------------------------------------
// Tasks Management System
// ---------------------------------------------------------------------
async function loadTasks(filter = 'all') {
  if (!tasksList) return;
  try {
    const res = await fetch(`${API_BASE}/tasks?filter=${filter}`);
    if (!res.ok) return;
    const data = await res.json();
    renderTasks(data.tasks || []);
  } catch (e) {
    console.warn('Failed to load tasks:', e);
  }
}

function renderTasks(tasks) {
  if (!tasksList) return;
  tasksList.innerHTML = '';
  if (tasks.length === 0) {
    const emptyLi = document.createElement('li');
    emptyLi.className = 'hint';
    emptyLi.style.padding = '8px';
    emptyLi.textContent = 'No tasks found. You can ask Yumi in chat to add tasks!';
    tasksList.appendChild(emptyLi);
    return;
  }
  tasks.forEach((t) => {
    const li = document.createElement('li');
    li.className = `task-item ${t.completed ? 'completed' : ''}`;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!t.completed;
    cb.className = 'task-checkbox';
    cb.addEventListener('change', async () => {
      try {
        await fetch(`${API_BASE}/tasks/${t.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completed: cb.checked }),
        });
        loadTasks();
      } catch (err) {
        console.warn('Failed to toggle task:', err);
      }
    });
    li.appendChild(cb);

    const span = document.createElement('span');
    span.className = 'task-title';
    span.textContent = t.title;
    li.appendChild(span);

    if (t.due || t.reminder) {
      const dueSpan = document.createElement('span');
      dueSpan.className = 'task-due';
      dueSpan.textContent = t.due || t.reminder;
      li.appendChild(dueSpan);
    }

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'task-del-btn';
    delBtn.title = 'Delete task';
    delBtn.textContent = '🗑️';
    delBtn.addEventListener('click', async () => {
      try {
        await fetch(`${API_BASE}/tasks/${t.id}`, { method: 'DELETE' });
        loadTasks();
      } catch (err) {
        console.warn('Failed to delete task:', err);
      }
    });
    li.appendChild(delBtn);

    tasksList.appendChild(li);
  });
}

if (taskAddBtn && taskInputTitle) {
  taskAddBtn.addEventListener('click', async () => {
    const title = taskInputTitle.value.trim();
    if (!title) return;
    const due = taskInputDue ? taskInputDue.value.trim() : '';
    if (taskAddStatus) taskAddStatus.textContent = 'Adding...';
    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, due, reminder: due }),
      });
      if (res.ok) {
        taskInputTitle.value = '';
        if (taskInputDue) taskInputDue.value = '';
        if (taskAddStatus) taskAddStatus.textContent = 'Task added!';
        setTimeout(() => { if (taskAddStatus) taskAddStatus.textContent = ''; }, 2000);
        loadTasks();
      }
    } catch (e) {
      if (taskAddStatus) taskAddStatus.textContent = 'Failed to add task';
    }
  });
}

document.querySelectorAll('[data-task-filter]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-task-filter]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    loadTasks(btn.dataset.taskFilter);
  });
});

// Avatar Mode in Settings Drawer (radio inputs)
document.querySelectorAll('input[name="avatar-type-mode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    avatarManager.setAvatarType(radio.value);
    document.querySelectorAll('[data-avatar-type]').forEach((b) => {
      b.classList.toggle('active', b.dataset.avatarType === radio.value);
    });
  });
});

function updateRelationshipDisplay(data) {
  cachedRelationshipData = Object.assign({}, cachedRelationshipData, data);
  if (data.relationship_tier) {
    currentRelationshipTier = data.relationship_tier;
    if (relationshipTierLabel) relationshipTierLabel.textContent = data.relationship_tier;
    if (relationshipTierPill) relationshipTierPill.textContent = data.relationship_tier;
    const vnStage = document.getElementById('vn-stage-tag');
    if (vnStage) vnStage.textContent = data.relationship_tier;
  }

  const charNameEl = document.getElementById('char-name');
  const vnCharName = document.getElementById('vn-char-name');
  if (charNameEl && vnCharName) vnCharName.textContent = charNameEl.textContent;

  if (data.affection !== undefined) {
    const vnBarAff = document.getElementById('vn-bar-affection');
    const vnValAff = document.getElementById('vn-val-affection');
    if (vnBarAff) vnBarAff.style.width = `${Math.min(100, Math.max(0, (data.affection / 79) * 100))}%`;
    if (vnValAff) vnValAff.textContent = `${data.affection} / 79`;
  }
  if (data.trust !== undefined) {
    const vnBarTrust = document.getElementById('vn-bar-trust');
    const vnValTrust = document.getElementById('vn-val-trust');
    if (vnBarTrust) vnBarTrust.style.width = `${data.trust}%`;
    if (vnValTrust) vnValTrust.textContent = `${data.trust}%`;
  }
  if (data.intimacy !== undefined) {
    const vnBarInt = document.getElementById('vn-bar-intimacy');
    const vnValInt = document.getElementById('vn-val-intimacy');
    if (vnBarInt) vnBarInt.style.width = `${data.intimacy}%`;
    if (vnValInt) vnValInt.textContent = `${data.intimacy}%`;
  }
  if (data.comfort !== undefined) {
    const vnBarComf = document.getElementById('vn-bar-comfort');
    const vnValComf = document.getElementById('vn-val-comfort');
    if (vnBarComf) vnBarComf.style.width = `${data.comfort}%`;
    if (vnValComf) vnValComf.textContent = `${data.comfort}%`;
  }
  if (data.respect !== undefined) {
    const vnBarResp = document.getElementById('vn-bar-respect');
    const vnValResp = document.getElementById('vn-val-respect');
    if (vnBarResp) vnBarResp.style.width = `${data.respect}%`;
    if (vnValResp) vnValResp.textContent = `${data.respect}%`;
  }
  if (data.interaction_count !== undefined) {
    const vnCount = document.getElementById('vn-interaction-count');
    if (vnCount) vnCount.textContent = `${data.interaction_count} turns`;
  }
  if (data.days_known !== undefined) {
    const vnDays = document.getElementById('vn-days-known');
    if (vnDays) vnDays.textContent = `${data.days_known} day(s)`;
  }

  if (!relationshipStats || data.trust === undefined) return;
  relationshipStats.innerHTML = '';
  [
    ['Affection', data.affection], ['Trust', data.trust], ['Intimacy', data.intimacy],
    ['Comfort', data.comfort], ['Respect', data.respect],
  ].forEach(([label, value]) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="stat-name">${label}</span><span class="stat-pill">${value}</span>`;
    relationshipStats.appendChild(li);
  });
}

// Utsuwa-inspired Relationship & Mood Modal wire-up
const statusPillEl = document.getElementById('status-pill');
const relationshipModalEl = document.getElementById('relationship-modal');
const closeRelationshipModalEl = document.getElementById('close-relationship-modal');

if (statusPillEl && relationshipModalEl) {
  statusPillEl.style.cursor = 'pointer';
  statusPillEl.title = 'View Relationship & Mood Profile (Utsuwa Profile)';
  statusPillEl.addEventListener('click', () => {
    if (cachedRelationshipData) updateRelationshipDisplay(cachedRelationshipData);
    relationshipModalEl.classList.remove('hidden');
  });
}
if (closeRelationshipModalEl && relationshipModalEl) {
  closeRelationshipModalEl.addEventListener('click', () => {
    relationshipModalEl.classList.add('hidden');
  });
}

// ---------------------------------------------------------------------
// Personality Presets & Onboarding Wizard
// ---------------------------------------------------------------------
const PERSONALITY_PRESETS = {
  tsundere: "Prickly, sarcastic, and guarded on the outside, but genuinely cares. Highly defensive when flattered, teases affectionately, and denies being attached.",
  sweet: "Warm, kind, and deeply caring. Always listens with empathy, encourages the user, speaks gently, and loves celebrating little victories together.",
  gamer: "Witty, sharp-tongued, and competitive gamer. Loves teasing about code bugs and game losses, speaks casually with humorous banter, but always has your back.",
  calm: "Reflective, mature, and observant. Speaks with calm clarity, enjoys deep late-night conversations, philosophy, and quiet companionship.",
  custom: "",
};

// Preset chip selection in Onboarding Modal
document.querySelectorAll('#onboard-step-2 .chip-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#onboard-step-2 .chip-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const presetKey = btn.dataset.preset;
    if (presetKey && PERSONALITY_PRESETS[presetKey] !== undefined) {
      if (onboardPersonalityInput) onboardPersonalityInput.value = PERSONALITY_PRESETS[presetKey];
    }
  });
});

// Preset chip selection in Character Settings Drawer
document.querySelectorAll('#panel-character .chip-btn-sm').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#panel-character .chip-btn-sm').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const presetKey = btn.dataset.preset;
    if (presetKey && PERSONALITY_PRESETS[presetKey] !== undefined) {
      if (settingPersonalityText) settingPersonalityText.value = PERSONALITY_PRESETS[presetKey];
    }
  });
});

function openOnboardingModal(defaultName = 'Yumi', defaultPersonality = '') {
  if (onboardNameInput) onboardNameInput.value = defaultName;
  if (onboardPersonalityInput) {
    onboardPersonalityInput.value = defaultPersonality || PERSONALITY_PRESETS.tsundere;
  }
  goToOnboardStep(1);
  if (onboardingModal) onboardingModal.classList.remove('hidden');
}

function closeOnboardingModal() {
  if (onboardingModal) onboardingModal.classList.add('hidden');
}

function goToOnboardStep(step) {
  if (step === 1) {
    if (onboardStep1) onboardStep1.classList.add('active');
    if (onboardStep2) onboardStep2.classList.remove('active');
    if (stepDot1) stepDot1.classList.add('active');
    if (stepDot2) stepDot2.classList.remove('active');
    setTimeout(() => onboardNameInput && onboardNameInput.focus(), 80);
  } else if (step === 2) {
    if (onboardStep1) onboardStep1.classList.remove('active');
    if (onboardStep2) onboardStep2.classList.add('active');
    if (stepDot1) stepDot1.classList.remove('active');
    if (stepDot2) stepDot2.classList.add('active');
    setTimeout(() => onboardPersonalityInput && onboardPersonalityInput.focus(), 80);
  }
}

if (onboardNextBtn) {
  onboardNextBtn.addEventListener('click', () => {
    const name = (onboardNameInput && onboardNameInput.value.trim()) || 'Yumi';
    if (onboardNameInput) onboardNameInput.value = name;
    goToOnboardStep(2);
  });
}

if (onboardBackBtn) {
  onboardBackBtn.addEventListener('click', () => {
    goToOnboardStep(1);
  });
}

if (onboardFinishBtn) {
  onboardFinishBtn.addEventListener('click', async () => {
    const name = (onboardNameInput && onboardNameInput.value.trim()) || 'Yumi';
    const personality = (onboardPersonalityInput && onboardPersonalityInput.value.trim()) || '';
    try {
      await patchSettings({ character_name: name, custom_personality: personality });
      await fetch(`${API_BASE}/onboarding/complete`, { method: 'POST' }).catch(() => {});
      const charNameEl = document.getElementById('char-name');
      if (charNameEl) charNameEl.textContent = name;
      if (settingCharacterName) settingCharacterName.value = name;
      if (settingPersonalityText) settingPersonalityText.value = personality;
      localStorage.setItem('yumi_onboarded', 'true');
      closeOnboardingModal();
      vrmManager.setEmotion('happy');
      setCaption(`Nice to meet you! I'm ${name}. Let's chat!`, { autoHide: true });
    } catch (err) {
      console.warn('Failed to save onboarding settings:', err);
      await fetch(`${API_BASE}/onboarding/complete`, { method: 'POST' }).catch(() => {});
      localStorage.setItem('yumi_onboarded', 'true');
      closeOnboardingModal();
    }
  });
}

// ---------------------------------------------------------------------
// Local Data Portability: Profile Export & Import (Backup & Restore)
// ---------------------------------------------------------------------
async function exportProfileData() {
  setStatusLine(profileBackupStatus, 'Exporting backup...');
  try {
    const res = await fetch(`${API_BASE}/profile/export`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const name = (data.character && data.character.name) || 'companion';
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = `${name.toLowerCase()}_profile_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatusLine(profileBackupStatus, 'Backup file downloaded successfully!');
  } catch (err) {
    console.warn('Failed to export profile:', err);
    setStatusLine(profileBackupStatus, 'Export failed: ' + err.message, true);
  }
}

async function handleProfileFileImport(file) {
  if (!file) return;
  const statusEl = profileBackupStatus;
  setStatusLine(statusEl, 'Restoring profile...');
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const res = await fetch(`${API_BASE}/profile/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const result = await res.json();
    if (result.status === 'error') throw new Error(result.message || 'Unknown error');

    // Update UI elements with restored state
    const charName = result.character_name || 'Yumi';
    const charNameEl = document.getElementById('char-name');
    if (charNameEl) charNameEl.textContent = charName;
    if (settingCharacterName) settingCharacterName.value = charName;
    if (settingPersonalityText) settingPersonalityText.value = result.custom_personality || '';

    if (result.affection !== undefined) {
      affectionValue.textContent = result.affection;
      updateRelationshipDisplay(result);
    }

    if (result.history && Array.isArray(result.history)) {
      chatLog.length = 0;
      result.history.forEach((turn) => chatLog.push({ role: turn.role, text: turn.text }));
      renderHistory();
    }

    refreshMemory();
    refreshDiary();
    localStorage.setItem('yumi_onboarded', 'true');
    closeOnboardingModal();

    setStatusLine(statusEl, `Profile for ${charName} restored successfully!`);
    vrmManager.setEmotion('happy');
    setCaption(`Welcome back! All my memories and data are restored.`, { autoHide: true });
  } catch (err) {
    console.warn('Failed to import profile:', err);
    setStatusLine(statusEl, 'Import failed: ' + err.message, true);
    alert('Import failed: ' + err.message);
  }
}

if (profileExportBtn) {
  profileExportBtn.addEventListener('click', exportProfileData);
}

if (profileImportFile) {
  profileImportFile.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleProfileFileImport(e.target.files[0]);
    }
  });
}

if (onboardImportFile) {
  onboardImportFile.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleProfileFileImport(e.target.files[0]);
    }
  });
}

// Fish Audio Voice presets
document.querySelectorAll('#fish-voice-presets .chip-btn-sm').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#fish-voice-presets .chip-btn-sm').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    if (settingVoiceId) {
      settingVoiceId.value = btn.dataset.voice || '';
    }
  });
});

// ElevenLabs Voice presets
document.querySelectorAll('#eleven-voice-presets .chip-btn-sm').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#eleven-voice-presets .chip-btn-sm').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    if (settingElevenVoiceId && btn.dataset.voice) {
      settingElevenVoiceId.value = btn.dataset.voice;
    }
  });
});

// Live Voice Test Button
if (settingTtsTestBtn) {
  settingTtsTestBtn.addEventListener('click', async () => {
    const testText = (settingTtsTestText && settingTtsTestText.value.trim()) || "Hello! My voice is working properly.";
    settingTtsTestBtn.textContent = '⏳ Speaking...';

    const provider = settingTtsProvider ? settingTtsProvider.value : 'fish_audio';
    const payload = { text: testText, provider };
    if (provider === 'fish_audio') {
      if (settingFishKey && settingFishKey.value.trim()) payload.api_key = settingFishKey.value.trim();
      if (settingVoiceId && settingVoiceId.value.trim()) payload.voice_id = settingVoiceId.value.trim();
      if (settingFishModel && settingFishModel.value) payload.model = settingFishModel.value;
    } else if (provider === 'elevenlabs') {
      if (settingElevenKey && settingElevenKey.value.trim()) payload.api_key = settingElevenKey.value.trim();
      if (settingElevenVoiceId && settingElevenVoiceId.value.trim()) payload.voice_id = settingElevenVoiceId.value.trim();
      if (settingElevenModel && settingElevenModel.value) payload.model = settingElevenModel.value;
    }

    try {
      const res = await fetch(`${API_BASE}/tts/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.status === 'ok' && data.audio_base64) {
        playAudioBase64(data.audio_base64, data.format || 'mp3');
        avatarManager.setEmotion('happy');
        avatarManager.playGesture('happy');
        setCaption(testText, { autoHide: true });
      } else {
        alert(data.message || 'TTS generation failed. Check API key and provider.');
      }
    } catch (err) {
      console.warn('TTS test failed:', err);
      alert('TTS test failed: ' + err.message);
    } finally {
      settingTtsTestBtn.textContent = '🎵 Test Voice';
    }
  });
}

// STT Controls
if (settingSttPause && sttPauseVal) {
  settingSttPause.addEventListener('input', () => {
    sttPauseVal.textContent = `${settingSttPause.value}s`;
  });
}

if (sttToggleListenBtn) {
  sttToggleListenBtn.addEventListener('click', () => {
    toggleMic();
  });
}


// Manual Fact Adder
if (manualFactAddBtn && manualFactInput) {
  manualFactAddBtn.addEventListener('click', async () => {
    const fact = manualFactInput.value.trim();
    if (!fact) return;
    setStatusLine(manualFactStatus, 'Remembering...');
    try {
      const res = await fetch(`${API_BASE}/memory/fact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fact }),
      });
      const data = await res.json();
      if (data.status === 'ok') {
        manualFactInput.value = '';
        setStatusLine(manualFactStatus, 'Saved to memory!');
        refreshMemory();
      } else {
        setStatusLine(manualFactStatus, data.message || 'Failed', true);
      }
    } catch (err) {
      setStatusLine(manualFactStatus, err.message, true);
    }
  });
}

// Clear History & Reset Profile
if (clearHistoryBtn) {
  clearHistoryBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to clear chat history? (Memories and stats will be kept)')) return;
    try {
      await fetch(`${API_BASE}/history/clear`, { method: 'POST' });
      chatLog.length = 0;
      renderHistory();
      setStatusLine(profileBackupStatus, 'Conversation history cleared.');
    } catch (err) {
      console.warn('Failed to clear history:', err);
    }
  });
}

if (profileResetBtn) {
  profileResetBtn.addEventListener('click', async () => {
    if (!confirm('WARNING: Reset all relationship stats, facts, and memories to brand new? This cannot be undone.')) return;
    try {
      await fetch(`${API_BASE}/profile/reset`, { method: 'POST' });
      localStorage.removeItem('yumi_onboarded');
      location.reload();
    } catch (err) {
      console.warn('Failed to reset profile:', err);
    }
  });
}

// VRM Panel Expression Testers & Upload
document.querySelectorAll('#emotion-test-chips button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const emotion = btn.dataset.testEmotion;
    if (emotion) {
      vrmManager.setEmotion(emotion);
      setCaption(`Testing expression: [${emotion}]`, { italic: true, autoHide: true });
    }
  });
});

if (vrmPanelUpload) {
  vrmPanelUpload.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (currentVrmObjectUrl) URL.revokeObjectURL(currentVrmObjectUrl);
    currentVrmObjectUrl = URL.createObjectURL(file);
    try {
      if (avatarLoader) {
        avatarLoader.classList.remove('hidden');
        if (avatarLoaderTitle) avatarLoaderTitle.textContent = 'Loading Custom VRM...';
        if (avatarLoaderDetail) avatarLoaderDetail.textContent = file.name;
      }
      await avatarManager.loadVrmFromUrl(currentVrmObjectUrl);
      avatarManager.setAvatarType('vrm');
      if (avatarLoader) avatarLoader.classList.add('hidden');
      setCaption('Custom VRM model loaded successfully!', { autoHide: true });
    } catch (err) {
      console.error('Failed to load VRM:', err);
      if (avatarLoader) avatarLoader.classList.add('hidden');
      setCaption('Failed to load VRM: ' + err.message, { autoHide: true });
    }
  });
}

// Feature 1: Motion & Gesture Library
if (gestureTestChips) {
  gestureTestChips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-test-gesture]');
    if (!btn) return;
    const gestureName = btn.dataset.testGesture;
    avatarManager.playGesture(gestureName);
    gestureTestChips.querySelectorAll('.chip-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    setCaption(`Testing motion gesture: [${gestureName}]`, { italic: true, autoHide: true });
    setTimeout(() => {
      btn.classList.remove('active');
    }, 2000);
  });
}

// Feature 1: VRMA Motion Capture Library Loader
function renderVrmaClipsList() {
  if (!vrmaClipsList) return;
  const clips = avatarManager.getLoadedVrmaClips ? avatarManager.getLoadedVrmaClips() : [];
  if (vrmaCountBadge) {
    vrmaCountBadge.textContent = `${clips.length} Clip${clips.length === 1 ? '' : 's'}`;
  }
  vrmaClipsList.innerHTML = '';
  if (clips.length === 0) {
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.style.fontSize = '12px';
    hint.textContent = 'No custom .VRMA clips loaded yet. Select one above!';
    vrmaClipsList.appendChild(hint);
    return;
  }

  clips.forEach((clip) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip-btn-sm';
    btn.textContent = `▶️ ${clip.name} (${clip.duration.toFixed(1)}s)`;
    btn.addEventListener('click', () => {
      avatarManager.playAnimationClip(clip.name, 0.4, true);
      setCaption(`Playing motion: ${clip.name}`, { italic: true, autoHide: true });
    });
    vrmaClipsList.appendChild(btn);
  });
}

if (vrmaPanelUpload) {
  vrmaPanelUpload.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (vrmaUploadStatus) {
      vrmaUploadStatus.textContent = `Loading ${file.name}...`;
      vrmaUploadStatus.classList.remove('error');
    }
    try {
      const clip = await avatarManager.loadVrma(file);
      if (clip) {
        if (vrmaUploadStatus) {
          vrmaUploadStatus.textContent = `✅ Loaded motion: ${clip.name} (${clip.duration.toFixed(2)}s)`;
        }
        renderVrmaClipsList();
        avatarManager.playAnimationClip(clip.name, 0.5, true);
        setCaption(`Loaded VRMA motion: ${clip.name}`, { autoHide: true });
      }
    } catch (err) {
      console.error('Failed to load VRMA:', err);
      if (vrmaUploadStatus) {
        vrmaUploadStatus.textContent = `❌ Load failed: ${err.message || err}`;
        vrmaUploadStatus.classList.add('error');
      }
    } finally {
      vrmaPanelUpload.value = '';
    }
  });
}

if (vrmaStopBtn) {
  vrmaStopBtn.addEventListener('click', () => {
    avatarManager.stopAnimationClip(0.4);
    if (vrmaUploadStatus) {
      vrmaUploadStatus.textContent = 'Returned to idle rest pose.';
      vrmaUploadStatus.classList.remove('error');
    }
  });
}

// Feature 2: Proactive Nudge Button
if (nudgeCompanionBtn) {
  nudgeCompanionBtn.addEventListener('click', async () => {
    nudgeCompanionBtn.disabled = true;
    const oldText = nudgeCompanionBtn.textContent;
    nudgeCompanionBtn.textContent = '👉 Nudging...';
    try {
      if (avatarManager) {
        avatarManager.playGesture('nod');
        avatarManager.setEmotion('happy');
      }
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'nudge' }));
      } else {
        await fetch(`${API_BASE}/companion/nudge`, { method: 'POST' });
      }
    } catch (err) {
      console.warn('Failed to nudge companion:', err);
    } finally {
      setTimeout(() => {
        nudgeCompanionBtn.textContent = oldText;
        nudgeCompanionBtn.disabled = false;
      }, 1500);
    }
  });
}

// Diagnostics State Inspector
if (devInspectStateBtn && devStateViewer) {
  devInspectStateBtn.addEventListener('click', async () => {
    if (!devStateViewer.classList.contains('hidden')) {
      devStateViewer.classList.add('hidden');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/profile/export`);
      const data = await res.json();
      devStateViewer.textContent = JSON.stringify(data, null, 2);
      devStateViewer.classList.remove('hidden');
    } catch (err) {
      devStateViewer.textContent = 'Failed to load state: ' + err.message;
      devStateViewer.classList.remove('hidden');
    }
  });
}

// Device Camera Direct Capture (Mobile & Tablet)
const cameraPhotoInput = document.getElementById('camera-photo-input');
if (cameraPhotoInput) {
  cameraPhotoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objUrl);
        const scale = Math.min(1, FRAME_MAX_DIMENSION / Math.max(img.width, img.height));
        frameCanvas.width = Math.max(1, Math.round(img.width * scale));
        frameCanvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = frameCanvas.getContext('2d');
        ctx.drawImage(img, 0, 0, frameCanvas.width, frameCanvas.height);
        const imageBase64 = frameCanvas.toDataURL('image/jpeg', 0.8).split(',')[1];
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'webcam_frame', image_base64: imageBase64 }));
          const photoMsg = "📸 I can see the photo you just captured! Ask me anything about it.";
          logMessage('assistant', photoMsg, 'happy');
          setCaption(photoMsg, { autoHide: true });
          avatarManager.setEmotion('happy');
        }
      };
      img.src = objUrl;
    } catch (err) {
      console.warn('Could not process camera photo:', err);
    }
    attachMenu.classList.add('hidden');
    cameraPhotoInput.value = '';
  });
}

initConversationStream();
connectSocket();

window.addEventListener('load', () => {
  if (avatarManager?.vrm?._onResize) {
    avatarManager.vrm._onResize();
  }
});


