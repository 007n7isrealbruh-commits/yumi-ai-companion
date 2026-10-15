/**
 * frontend/js/avatarManager.js
 * Unified Avatar Abstraction Layer supporting 3D VRM and 2.5D Live2D avatars.
 */

import { VrmManager } from './vrmManager.js';
import { Live2DManager } from './live2dManager.js';

export class AvatarManager {
  constructor(vrmCanvas, live2dCanvas, options = {}) {
    this.vrmCanvas = vrmCanvas;
    this.live2dCanvas = live2dCanvas;
    this.options = options;

    this.vrm = new VrmManager(this.vrmCanvas);
    this.live2d = new Live2DManager(this.live2dCanvas);

    this.currentType = 'vrm'; // Default to 3D VRM
    this.lipSync = null;

    // Check saved avatar choice
    try {
      const saved = localStorage.getItem('yumi_avatar_type');
      if (saved === 'live2d') {
        this.currentType = 'live2d';
      } else {
        this.currentType = 'vrm';
      }
    } catch (e) { /* ignore */ }

    this._applyTypeVisibility();

    // Load local sample VRM model immediately with progress hooks
    this.loadDefaultModel((pct, loaded, total) => {
      if (typeof this.options.onProgress === 'function') {
        this.options.onProgress(pct, loaded, total);
      }
    }).then(() => {
      if (typeof this.options.onLoaded === 'function') {
        this.options.onLoaded();
      }
    }).catch((e) => {
      console.warn('[VRM] Initial load notice:', e);
      if (typeof this.options.onError === 'function') {
        this.options.onError(e);
      }
    });

    // Safety watchdog: ensure loader overlay is dismissed once model is ready
    setTimeout(() => {
      const loader = document.getElementById('avatar-loader');
      if (loader && !loader.classList.contains('hidden') && this.vrm?.currentVrm) {
        loader.classList.add('hidden');
      }
    }, 2500);
  }

  async loadDefaultModel(onProgress = null) {
    const defaultUrls = [
      'assets/models/avatar.vrm',
      'assets/models/4365276823721452582.vrm',
      'https://pixiv.github.io/three-vrm/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm',
      'https://cdn.jsdelivr.net/gh/vrm-c/vrm-specification@master/samples/VRM1_Constraint_Twist_Sample.vrm'
    ];
    let loaded = false;
    let lastErr = null;
    for (const url of defaultUrls) {
      try {
        await this.loadVrmFromUrl(url, onProgress);
        console.log('[VRM] Successfully loaded avatar model from:', url);
        loaded = true;
        this.setAvatarType('vrm');
        break;
      } catch (e) {
        lastErr = e;
        console.warn('[VRM] Could not load VRM from:', url, e.message);
      }
    }
    if (!loaded) {
      throw lastErr || new Error('All default VRM model sources failed to load');
    }
  }

  attachLipSync(lipSync) {
    this.lipSync = lipSync;
    this.vrm.attachLipSync(lipSync);
    this.live2d.attachLipSync(lipSync);
  }

  setAvatarType(type) {
    if (type !== 'vrm' && type !== 'live2d') return;
    this.currentType = type;
    try {
      localStorage.setItem('yumi_avatar_type', type);
    } catch (e) { /* ignore */ }

    this._applyTypeVisibility();
  }

  getAvatarType() {
    return this.currentType;
  }

  _applyTypeVisibility() {
    if (this.currentType === 'live2d') {
      this.vrmCanvas.style.display = 'none';
      this.live2dCanvas.style.display = 'block';
      this.live2d.start();
    } else {
      // VRM mode: display 3D canvas and stop 2D render loop
      this.vrmCanvas.style.display = 'block';
      this.live2dCanvas.style.display = 'none';
      this.live2d.stop();
      this.vrm._onResize();
    }
  }

  setEmotion(emotion) {
    this.vrm.setEmotion(emotion);
    this.live2d.setEmotion(emotion);
  }

  setStatus(status) {
    this.vrm.setStatus(status);
    this.live2d.setStatus(status);
  }

  setExpressionValue(name, value) {
    this.vrm.setExpressionValue(name, value);
    this.live2d.setExpressionValue(name, value);
  }

  setCameraPreset(name) {
    this.vrm.setCameraPreset(name);
    this.live2d.setCameraPreset(name);
  }

  async loadVrmFromUrl(url, onProgress = null) {
    const vrm = await this.vrm.loadVrmFromUrl(url, onProgress);
    this.setAvatarType('vrm');
    return vrm;
  }

  captureSnapshot(format = 'image/png') {
    if (this.currentType === 'live2d') {
      return this.live2d.captureSnapshot(format);
    }
    return this.vrm.captureSnapshot(format);
  }

  set onTouchReaction(cb) {
    this.vrm.onTouchReaction = cb;
    this.live2d.onTouchReaction = cb;
  }

  playGesture(name) {
    if (this.currentType === 'vrm') {
      this.vrm.playGesture(name);
    } else {
      this.live2d.setEmotion(name);
    }
  }

  get blinkEnabled() {
    return this.vrm.blinkEnabled;
  }

  set blinkEnabled(v) {
    this.vrm.blinkEnabled = Boolean(v);
  }

  get lookAtEnabled() {
    return this.vrm.lookAtEnabled;
  }

  set lookAtEnabled(v) {
    this.vrm.lookAtEnabled = Boolean(v);
  }

  get controls() {
    return this.vrm.controls;
  }

  testEmotion(name) {
    this.setEmotion(name);
  }

  testExpression(name, val = 1.0) {
    this.setExpressionValue(name, val);
  }

  testGesture(name) {
    this.playGesture(name);
  }

  get animationManager() {
    return this.vrm?.animationManager;
  }

  async loadVrma(urlOrFile, customName = '') {
    if (this.currentType === 'vrm' && this.vrm) {
      return await this.vrm.loadVrma(urlOrFile, customName);
    }
    return null;
  }

  playAnimationClip(clipOrName, duration = 0.5) {
    if (this.currentType === 'vrm' && this.vrm) {
      return this.vrm.playAnimationClip(clipOrName, duration);
    }
    return null;
  }

  stopAnimationClip(duration = 0.4) {
    if (this.currentType === 'vrm' && this.vrm) {
      this.vrm.stopAnimationClip(duration);
    }
  }

  getAvailableEmotions() {
    return this.vrm.getAvailableEmotions();
  }

  getAvailableGestures() {
    return this.vrm.getAvailableGestures();
  }

  getLoadedVrmaClips() {
    return this.vrm?.getLoadedVrmaClips() || [];
  }
}
