// Maps live audio frequency/volume data onto VRM viseme expressions
// (aa, ih, ou, ee, oh — the standard VRM 1.0 mouth-shape presets).
//
// v2: five-band mapping instead of three (so "ih"/"oh" actually get used),
// plus an attack/release envelope per shape so the mouth doesn't snap
// instantly between shapes every animation frame — that snapping is what
// makes lip sync look like flappy "puppet mouth" instead of speech.

const VISEME_SHAPES = ['aa', 'ih', 'ou', 'ee', 'oh'];
const ATTACK = 0.55;  // how fast a shape opens toward its target (0..1 per frame)
const RELEASE = 0.25; // how fast a shape closes back toward 0 (0..1 per frame)

export class LipSync {
  constructor(audioElement, vrmManager) {
    this.audioElement = audioElement;
    this.vrmManager = vrmManager;

    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;

    this.sourceNode = this.audioContext.createMediaElementSource(this.audioElement);
    this.sourceNode.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);

    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.isSpeaking = false;

    // Current eased value per viseme shape, so we can lerp toward targets.
    this.currentValues = Object.fromEntries(VISEME_SHAPES.map((s) => [s, 0]));

    this._loop();
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
  }

  _loop() {
    requestAnimationFrame(() => this._loop());

    if (!this.isSpeaking) {
      // Ease every shape back to 0 instead of hard-cutting, even after
      // stop() — avoids a visible "jaw snap shut" at the end of a line.
      for (const shape of VISEME_SHAPES) {
        if (this.currentValues[shape] > 0.001) {
          this.currentValues[shape] += (0 - this.currentValues[shape]) * RELEASE;
          this.vrmManager.setExpressionValue(shape, this.currentValues[shape]);
        }
      }
      return;
    }

    this.analyser.getByteFrequencyData(this.frequencyData);

    // Five bands across the spectrum -> five viseme targets, so quieter
    // consonant-like bands ("ih", "oh") actually get a turn instead of the
    // mouth only ever toggling between three wide-open shapes.
    const bands = this._splitBands(this.frequencyData, VISEME_SHAPES.length);
    const volume = this._rms(this.frequencyData) / 255; // 0..1
    const openAmount = Math.min(1, volume * 2.2);

    const bandTotal = bands.reduce((a, b) => a + b, 0) || 1;

    for (let i = 0; i < VISEME_SHAPES.length; i++) {
      const shape = VISEME_SHAPES[i];
      const bandWeight = bands[i] / bandTotal; // this shape's share of energy
      const target = openAmount < 0.04 ? 0 : openAmount * bandWeight * VISEME_SHAPES.length * 0.6;
      const clampedTarget = Math.max(0, Math.min(1, target));

      const rate = clampedTarget > this.currentValues[shape] ? ATTACK : RELEASE;
      this.currentValues[shape] += (clampedTarget - this.currentValues[shape]) * rate;
      this.vrmManager.setExpressionValue(shape, this.currentValues[shape]);
    }
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
