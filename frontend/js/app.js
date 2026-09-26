import { VrmManager } from './vrmManager.js';
import { LipSync } from './lipSync.js';

const WS_URL = 'ws://localhost:8000/ws';
const API_BASE = 'http://localhost:8000';

const canvas = document.getElementById('scene-canvas');
const captionBox = document.getElementById('caption-box');
const captionText = document.getElementById('caption-text');
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

const settingsToggleBtn = document.getElementById('settings-toggle');
const settingsDrawer = document.getElementById('settings-drawer');
const settingsCloseBtn = document.getElementById('settings-close');
const settingsSaveBtn = document.getElementById('settings-save');
const settingsSaveStatus = document.getElementById('settings-save-status');
const settingCharacterName = document.getElementById('setting-character-name');
const settingVoiceId = document.getElementById('setting-voice-id');
const writeDiaryBtn = document.getElementById('write-diary-btn');
const diaryList = document.getElementById('diary-list');
const usageList = document.getElementById('usage-list');
const memoryList = document.getElementById('memory-list');

const vrmManager = new VrmManager(canvas);
const lipSync = new LipSync(ttsAudioPlayer, vrmManager);

let socket = null;
let micVad = null;
let micEnabled = true;
let currentAudioObjectUrl = null;
let currentVrmObjectUrl = null;
let captionHideTimer = null;

// --- OBS/streaming layout: ?obs=1 strips all chrome except avatar + caption ---
if (new URLSearchParams(window.location.search).get('obs') === '1') {
  document.body.classList.add('obs-mode');
}

// --- Background mode (studio / white / transparent), persisted locally ---
function applyBackgroundMode(mode) {
  document.body.setAttribute('data-bg', mode);
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

function setCaption(text, { italic = false, autoHide = false } = {}) {
  clearTimeout(captionHideTimer);
  captionText.textContent = text;
  captionText.style.fontStyle = italic ? 'italic' : 'normal';
  captionBox.classList.remove('hidden');
  if (autoHide) {
    captionHideTimer = setTimeout(() => captionBox.classList.add('hidden'), 2500);
  }
}
function hideCaption() {
  captionBox.classList.add('hidden');
}

// Transient status feedback shown as an italic caption while there's no
// real reply text yet (thinking/transcribing/etc). Purely cosmetic.
function setStatus(message) {
  vrmManager.setStatus(message);
  const chatty = {
    thinking: 'hmm...',
    transcribing: 'listening...',
    synthesizing_voice: '...',
    'writing diary': 'writing...',
  };
  if (chatty[message]) setCaption(chatty[message], { italic: true });
}

function connectSocket() {
  socket = new WebSocket(WS_URL);
  socket.onopen = () => console.log('[ws] connected');
  socket.onclose = () => setTimeout(connectSocket, 3000);
  socket.onerror = () => console.warn('[ws] connection error');
  socket.onmessage = async (event) => handleServerMessage(JSON.parse(event.data));
}

async function handleServerMessage(data) {
  if (isStale(data.request_id)) return;

  switch (data.type) {
    case 'status':
      setStatus(data.message);
      break;

    case 'transcript':
      setCaption(`You: ${data.text}`, { italic: true, autoHide: true });
      break;

    case 'reply': {
      setCaption(data.text);
      affectionValue.textContent = data.affection;
      vrmManager.setEmotion(data.emotion || 'neutral');

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

      if (data.audio_base64) {
        await lipSync.resumeContext();
        const mime = data.audio_format === 'pcm' ? 'audio/wav' : 'audio/mpeg';
        const audioBlob = base64ToBlob(data.audio_base64, mime);
        if (currentAudioObjectUrl) URL.revokeObjectURL(currentAudioObjectUrl);
        currentAudioObjectUrl = URL.createObjectURL(audioBlob);
        ttsAudioPlayer.src = currentAudioObjectUrl;
        lipSync.start();
        ttsAudioPlayer.onended = () => {
          lipSync.stop();
          captionHideTimer = setTimeout(hideCaption, 1200);
        };
        await ttsAudioPlayer.play();
      }
      break;
    }

    case 'diary_entry':
      prependDiaryEntry({ timestamp: Date.now() / 1000, text: data.text });
      break;

    case 'error':
      console.warn('[server error]', data.message);
      setCaption(data.message, { italic: true, autoHide: true });
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

function interruptCurrentTurn() {
  if (!ttsAudioPlayer.paused) ttsAudioPlayer.pause();
  lipSync.stop();
  vrmManager.setEmotion('neutral');
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

async function initVoiceActivityDetection() {
  if (typeof window.vad === 'undefined') {
    console.error('window.vad is undefined; check the vad-web <script> tags in index.html.');
    micToggle.disabled = true;
    return;
  }
  try {
    micVad = await window.vad.MicVAD.new({
      model: 'v5',
      onnxWASMBasePath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/',
      baseAssetPath: 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/',
      onSpeechStart: () => {
        interruptCurrentTurn();
        micToggle.classList.add('speaking');
      },
      onSpeechEnd: (audio) => {
        micToggle.classList.remove('speaking');
        sendAudioTurn(audio);
      },
    });
    micVad.start();
  } catch (err) {
    console.error('Failed to initialize VAD:', err);
  }
}

micToggle.addEventListener('click', () => {
  if (!micVad) return;
  micEnabled = !micEnabled;
  if (micEnabled) {
    micVad.start();
    micToggle.classList.remove('muted');
  } else {
    micVad.pause();
    micToggle.classList.add('muted');
  }
});

// ---------------------------------------------------------------------
// Typed text input
// ---------------------------------------------------------------------
textForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = textInput.value.trim();
  if (!text || !socket || socket.readyState !== WebSocket.OPEN) return;
  interruptCurrentTurn();
  setCaption(`You: ${text}`, { italic: true, autoHide: true });
  const requestId = nextRequestId();
  socket.send(JSON.stringify({ type: 'text_input', text, request_id: requestId }));
  textInput.value = '';
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
    await vrmManager.loadVrmFromUrl(currentVrmObjectUrl);
  } catch (err) {
    console.error('Failed to load VRM:', err);
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
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({ video: true });
    webcamVideo.srcObject = webcamStream;
    await webcamVideo.play();
    webcamToggle.textContent = '📷 Webcam: on';
    webcamToggle.classList.add('active');
    webcamFrameTimer = setInterval(() => sendFrame('webcam_frame', webcamVideo), FRAME_INTERVAL_MS);
  } catch (err) {
    console.warn('Webcam access cancelled or failed:', err);
  }
}

screenShareToggle.addEventListener('click', toggleScreenShare);
webcamToggle.addEventListener('click', toggleWebcam);

// ---------------------------------------------------------------------
// Settings drawer: background mode (above), character/voice settings,
// diary, usage.
// ---------------------------------------------------------------------
async function openSettingsDrawer() {
  settingsDrawer.classList.remove('hidden');
  try {
    const res = await fetch(`${API_BASE}/settings`);
    const data = await res.json();
    settingCharacterName.value = data.character_name || '';
    settingVoiceId.value = data.fish_audio_voice_id || '';
  } catch (err) {
    console.warn('Failed to load settings:', err);
  }
  refreshDiary();
  refreshUsage();
  refreshMemory();
}

settingsToggleBtn.addEventListener('click', openSettingsDrawer);
settingsCloseBtn.addEventListener('click', () => settingsDrawer.classList.add('hidden'));

settingsSaveBtn.addEventListener('click', async () => {
  settingsSaveStatus.textContent = 'Saving...';
  try {
    await fetch(`${API_BASE}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        character_name: settingCharacterName.value.trim(),
        fish_audio_voice_id: settingVoiceId.value.trim(),
      }),
    });
    document.getElementById('char-name').textContent = settingCharacterName.value.trim() || 'Yumi';
    settingsSaveStatus.textContent = 'Saved (takes effect immediately; restart to persist after next launch — update .env too).';
  } catch (err) {
    settingsSaveStatus.textContent = 'Failed to save — is the backend running?';
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
// see gemini_engine.py) — this section is purely for VIEWING and
// manually deleting what she's kept. Nothing here expires on its own.
// ---------------------------------------------------------------------
async function refreshMemory() {
  try {
    const res = await fetch(`${API_BASE}/memory`);
    const data = await res.json();
    renderMemoryList(data.facts || []);
  } catch (err) {
    console.warn('Failed to load memory:', err);
  }
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

connectSocket();
initVoiceActivityDetection();
