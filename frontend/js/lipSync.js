/**
 * frontend/js/lipSync.js
 * Synchronized VRM viseme lip-sync engine.
 * 
 * Upgrades:
 * - Removed private requestAnimationFrame loop to prevent tick desynchronization
 *   and mouth-tearing. Driven directly by VrmManager._animate(delta).
 * - Multi-band spectral decomposition (aa, ih, ou, ee, oh).
 * - Delta-scaled exponential attack/release envelope for fluid mouth articulation.
 * - Live audio level telemetry export (for HUD equalizer bars).
 */

const VISEME_SHAPES = ['aa', 'ih', 'ou', 'ee', 'oh'];
const ATTACK_RATE = 28.0;   // Hz: fast natural mouth opening
const RELEASE_RATE = 14.0;  // Hz: smooth natural mouth closure

export class LipSync {
  constructor(audioElement, vrmManager) {
    this.audioElement = audioElement;
    this.vrmManager = vrmManager;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioCtx();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.55;

    this.sourceNode = this.audioContext.createMediaElementSource(this.audioElement);
    this.sourceNode.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);

    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.isSpeaking = false;

    // Smoothed viseme values
    this.currentValues = Object.fromEntries(VISEME_SHAPES.map((s) => [s, 0]));
    
    // Live audio telemetry
    this.currentVolume = 0;
    this.bandLevels = [0, 0, 0, 0];
  }

  async resumeContext() {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  start() {
    this.isSpeaking = true;
  }

  stop() {
    this.isSpeaking = false;
    this._resetMouth();
  }

  _resetMouth() {
    VISEME_SHAPES.forEach((shape) => {
      this.currentValues[shape] = 0;
      this.vrmManager.setExpressionValue(shape, 0);
    });
    this.currentVolume = 0;
    this.bandLevels = [0, 0, 0, 0];
  }

  /**
   * Called every frame from VrmManager._animate(delta) for lockstep sync.
   */
  update(delta) {
    if (!this.isSpeaking) {
      // Smoothly return mouth to neutral position
      let active = false;
      for (const shape of VISEME_SHAPES) {
        if (this.currentValues[shape] > 0.005) {
          const decay = 1 - Math.exp(-RELEASE_RATE * delta);
          this.currentValues[shape] += (0 - this.currentValues[shape]) * decay;
          this.vrmManager.setExpressionValue(shape, this.currentValues[shape]);
          active = true;
        } else if (this.currentValues[shape] !== 0) {
          this.currentValues[shape] = 0;
          this.vrmManager.setExpressionValue(shape, 0);
        }
      }
      this.currentVolume = 0;
      this.bandLevels = [0, 0, 0, 0];
      return active;
    }

    this.analyser.getByteFrequencyData(this.frequencyData);

    const bands = this._splitBands(this.frequencyData, VISEME_SHAPES.length);
    const volume = this._rms(this.frequencyData) / 255;
    this.currentVolume = volume;

    // 4-band telemetry for HUD equalizer bars
    const eqBands = this._splitBands(this.frequencyData, 4);
    const maxB = 255;
    this.bandLevels = eqBands.map((b) => Math.min(1, b / (maxB * 0.8)));

    const openAmount = Math.min(1.0, Math.pow(volume * 2.4, 1.15));
    const bandTotal = bands.reduce((a, b) => a + b, 0) || 1;

    for (let i = 0; i < VISEME_SHAPES.length; i++) {
      const shape = VISEME_SHAPES[i];
      const bandShare = bands[i] / bandTotal;
      const target = openAmount < 0.03 ? 0 : Math.min(1.0, openAmount * bandShare * 3.8);

      const rate = target > this.currentValues[shape] ? ATTACK_RATE : RELEASE_RATE;
      const ease = 1 - Math.exp(-rate * delta);
      this.currentValues[shape] += (target - this.currentValues[shape]) * ease;
      
      this.vrmManager.setExpressionValue(shape, this.currentValues[shape]);
    }

    return true;
  }

  getAudioLevels() {
    return {
      isSpeaking: this.isSpeaking,
      volume: this.currentVolume,
      bands: this.bandLevels,
    };
  }

  _splitBands(data, bandCount) {
    const bandSize = Math.floor(data.length / bandCount);
    const bands = [];
    for (let i = 0; i < bandCount; i++) {
      let sum = 0;
      for (let j = i * bandSize; j < (i + 1) * bandSize; j++) sum += data[j];
      bands.push(sum / bandSize);
    }
    return bands;
  }

  _rms(data) {
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) sumSquares += data[i] * data[i];
    return Math.sqrt(sumSquares / data.length);
  }
}
