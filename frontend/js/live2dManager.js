/**
 * frontend/js/live2dManager.js
 * High-performance 2.5D parametric anime avatar engine.
 *
 * Implements:
 * - Natural biological breathing & multi-harmonic idle sway
 * - Eye gaze tracking with vestibulo-ocular inertia
 * - Expressive emotional states (happy, angry, sad, surprised, embarrassed, neutral)
 * - Coordinated lip-sync mouth visemes and talking head gestures
 * - Organic eye blinking with Hermite cubic interpolation
 * - Interactive head pat & touch reactions
 * - Clean snapshot capture
 */

function smoothstep(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

export class Live2DManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = this.canvas.getContext('2d');
    this.lipSync = null;

    // Feature toggles
    this.blinkEnabled = true;
    this.lookAtEnabled = true;

    // Kinematics & Tracking
    this.pointerNormalized = { x: 0, y: 0 };
    this.currentGaze = { x: 0, y: 0 };
    this.currentHeadAngle = { yaw: 0, pitch: 0, roll: 0 };

    // Idle Respiration & Sway
    this.clockTime = 0;
    this.breathTime = 0;

    // Blinking
    this.blinkTimer = 0;
    this.nextBlinkAt = 3.0;
    this.isBlinking = false;
    this.blinkProgress = 0;
    this.blinkDuration = 0.15;

    // Emotions & Expressions
    this.currentEmotion = 'neutral';
    this.blushIntensity = 0.15;
    this.targetBlush = 0.15;

    // Talking & Lip Sync
    this.status = 'idle';
    this.mouthOpen = 0;
    this.talkingNod = 0;
    this.talkingWeight = 0;

    // Touch
    this.onTouchReaction = null;

    // Active visibility
    this.active = false;

    // Camera Framing Preset (Portrait / Waist / Full)
    this.cameraPreset = 'waist';
    this.targetCamScale = 1.0;
    this.currentCamScale = 1.0;
    this.targetCamOffsetY = 0;
    this.currentCamOffsetY = 0;

    this._initListeners();
    this._onResize();
  }

  setCameraPreset(name) {
    this.cameraPreset = name;
    if (name === 'portrait') {
      this.targetCamScale = 1.38;
      this.targetCamOffsetY = 85;
    } else if (name === 'full') {
      this.targetCamScale = 0.78;
      this.targetCamOffsetY = -50;
    } else {
      // 'waist' default
      this.targetCamScale = 1.0;
      this.targetCamOffsetY = 0;
    }
  }

  attachLipSync(lipSync) {
    this.lipSync = lipSync;
  }

  start() {
    this.active = true;
    this._animate();
  }

  stop() {
    this.active = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _initListeners() {
    window.addEventListener('resize', () => this._onResize());

    window.addEventListener('mousemove', (e) => {
      this.pointerNormalized.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointerNormalized.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    window.addEventListener('touchmove', (e) => {
      if (e.touches.length > 0) {
        const t = e.touches[0];
        this.pointerNormalized.x = (t.clientX / window.innerWidth) * 2 - 1;
        this.pointerNormalized.y = -(t.clientY / window.innerHeight) * 2 + 1;
      }
    }, { passive: true });

    this.canvas.addEventListener('click', (e) => {
      if (!this.active || !this.onTouchReaction) return;
      const rect = this.canvas.getBoundingClientRect();
      const clickY = (e.clientY - rect.top) / rect.height;
      const coords = { clientX: e.clientX, clientY: e.clientY };
      if (clickY < 0.45) {
        this.onTouchReaction('head', coords);
      } else {
        this.onTouchReaction('body', coords);
      }
    });
  }

  _onResize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.scale(dpr, dpr);
  }

  setEmotion(emotion) {
    this.currentEmotion = emotion;
    if (emotion === 'embarrassed') {
      this.targetBlush = 0.85;
    } else if (emotion === 'happy') {
      this.targetBlush = 0.5;
    } else if (emotion === 'angry') {
      this.targetBlush = 0.4;
    } else {
      this.targetBlush = 0.15;
    }
  }

  setStatus(status) {
    this.status = status;
  }

  setExpressionValue(name, value) {
    if (name === 'blink') {
      this.blinkProgress = value;
    }
  }

  captureSnapshot(format = 'image/png') {
    try {
      return this.canvas.toDataURL(format);
    } catch (e) {
      console.error('Failed to capture Live2D snapshot:', e);
      return null;
    }
  }

  // --- Animation loop ---
  _animate() {
    if (!this.active) return;
    requestAnimationFrame(() => this._animate());

    const delta = 0.016; // ~60fps step
    this.clockTime += delta;
    this.breathTime += delta;

    this._update(delta);
    this._render();
  }

  _update(delta) {
    // 1. Respiration
    let breathRate = 1.6;
    if (this.currentEmotion === 'angry') breathRate = 2.4;
    else if (this.currentEmotion === 'sad') breathRate = 1.1;

    // 2. Gaze & Head angle interpolation
    const targetGazeX = this.pointerNormalized.x * 0.4;
    const targetGazeY = this.pointerNormalized.y * 0.3;
    const gazeDecay = 1 - Math.exp(-8.0 * delta);
    this.currentGaze.x += (targetGazeX - this.currentGaze.x) * gazeDecay;
    this.currentGaze.y += (targetGazeY - this.currentGaze.y) * gazeDecay;

    // Head yaw/pitch follows gaze with damping
    const headTargetYaw = this.currentGaze.x * 0.6;
    let headTargetPitch = -this.currentGaze.y * 0.4;
    let headTargetRoll = this.currentGaze.x * 0.15;

    if (this.currentEmotion === 'embarrassed') {
      headTargetYaw += 0.25; // Turned shyly away
      headTargetPitch += 0.1;
    } else if (this.currentEmotion === 'sad') {
      headTargetPitch += 0.18; // Downcast
    }

    const headDecay = 1 - Math.exp(-4.5 * delta);
    this.currentHeadAngle.yaw += (headTargetYaw - this.currentHeadAngle.yaw) * headDecay;
    this.currentHeadAngle.pitch += (headTargetPitch - this.currentHeadAngle.pitch) * headDecay;
    this.currentHeadAngle.roll += (headTargetRoll - this.currentHeadAngle.roll) * headDecay;

    // 3. Procedural Blinking
    if (!this.isBlinking) {
      this.blinkTimer += delta;
      if (this.blinkTimer >= this.nextBlinkAt) {
        this.isBlinking = true;
        this.blinkProgress = 0;
        this.blinkTimer = 0;
        this.nextBlinkAt = 2.5 + Math.random() * 3.5;
      }
    } else {
      this.blinkProgress += delta / this.blinkDuration;
      if (this.blinkProgress >= 1.0) {
        this.isBlinking = false;
        this.blinkProgress = 0;
      }
    }

    // 4. Talking & Lip Sync
    const isSpeaking = (this.lipSync && this.lipSync.isSpeaking) || this.status === 'talking';
    const talkTarget = isSpeaking ? 1.0 : 0.0;
    this.talkingWeight += (talkTarget - this.talkingWeight) * (1 - Math.exp(-8.0 * delta));

    if (this.lipSync && this.lipSync.isSpeaking) {
      this.mouthOpen = Math.min(1.0, this.lipSync.currentVolume * 3.8);
      this.talkingNod = Math.sin(this.clockTime * 8.0) * this.lipSync.currentVolume * 0.08;
    } else if (this.status === 'talking') {
      this.mouthOpen = (Math.sin(this.clockTime * 12.0) * 0.5 + 0.5) * 0.7;
      this.talkingNod = Math.sin(this.clockTime * 6.0) * 0.03;
    } else {
      this.mouthOpen *= (1 - Math.exp(-12.0 * delta));
      this.talkingNod *= (1 - Math.exp(-8.0 * delta));
    }

    // 5. Blush decay
    this.blushIntensity += (this.targetBlush - this.blushIntensity) * (1 - Math.exp(-4.0 * delta));

    // 6. Camera Framing Interpolation
    const camDecay = 1 - Math.exp(-5.5 * delta);
    this.currentCamScale += (this.targetCamScale - this.currentCamScale) * camDecay;
    this.currentCamOffsetY += (this.targetCamOffsetY - this.currentCamOffsetY) * camDecay;
  }

  _render() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.ctx.clearRect(0, 0, w, h);

    const centerX = w * 0.5;
    const centerY = h * 0.52;
    const baseScale = Math.min(w / 640, h / 800) * 1.05;
    const scale = baseScale * this.currentCamScale;
    const camOffsetY = this.currentCamOffsetY * baseScale;

    // Respiration breathing offset
    const breath = Math.sin(this.breathTime * 1.6) * 4.5 * scale;
    const swayX = Math.sin(this.breathTime * 0.8) * 3.0 * scale;

    this.ctx.save();
    this.ctx.translate(centerX + swayX, centerY + breath + camOffsetY);
    this.ctx.scale(scale, scale);

    // 1. Torso / Clothes
    this._drawTorso();

    // 2. Neck
    this._drawNeck();

    // 3. Head Layer (with Yaw, Pitch, Roll transform)
    this.ctx.save();
    const headX = this.currentHeadAngle.yaw * 35;
    const headY = this.currentHeadAngle.pitch * 25 + this.talkingNod * 50;
    this.ctx.translate(headX, headY - 140);
    this.ctx.rotate(this.currentHeadAngle.roll);

    this._drawHairBack();
    this._drawFace();
    this._drawBlush();
    this._drawEyes();
    this._drawEyebrows();
    this._drawNose();
    this._drawMouth();
    this._drawHairFront();
    this._drawRibbon();

    this.ctx.restore();
    this.ctx.restore();
  }

  _drawTorso() {
    const ctx = this.ctx;
    // Shoulders & Chest
    ctx.save();
    ctx.fillStyle = '#1e2238';
    ctx.beginPath();
    ctx.moveTo(-110, 70);
    ctx.quadraticCurveTo(0, 45, 110, 70);
    ctx.lineTo(135, 340);
    ctx.lineTo(-135, 340);
    ctx.closePath();
    ctx.fill();

    // Sailor Collar
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(-90, 68);
    ctx.lineTo(0, 155);
    ctx.lineTo(90, 68);
    ctx.lineTo(105, 115);
    ctx.lineTo(0, 210);
    ctx.lineTo(-105, 115);
    ctx.closePath();
    ctx.fill();

    // Red Bowtie
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.moveTo(-35, 155);
    ctx.lineTo(0, 175);
    ctx.lineTo(35, 155);
    ctx.lineTo(45, 205);
    ctx.lineTo(0, 185);
    ctx.lineTo(-45, 205);
    ctx.closePath();
    ctx.fill();

    // Knot
    ctx.fillStyle = '#be123c';
    ctx.beginPath();
    ctx.arc(0, 175, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawNeck() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = '#fcd3b6';
    ctx.beginPath();
    ctx.moveTo(-28, -60);
    ctx.lineTo(-24, 75);
    ctx.lineTo(24, 75);
    ctx.lineTo(28, -60);
    ctx.closePath();
    ctx.fill();

    // Neck shadow under chin
    ctx.fillStyle = 'rgba(217, 130, 95, 0.28)';
    ctx.beginPath();
    ctx.moveTo(-28, -45);
    ctx.quadraticCurveTo(0, -10, 28, -45);
    ctx.lineTo(24, 15);
    ctx.quadraticCurveTo(0, 35, -24, 15);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawHairBack() {
    const ctx = this.ctx;
    ctx.save();
    // Twin tails / Back hair
    ctx.fillStyle = '#f472b6';
    const sway = Math.sin(this.clockTime * 2.2) * 8;

    // Left Twin-tail
    ctx.beginPath();
    ctx.moveTo(-95, -70);
    ctx.quadraticCurveTo(-170 + sway, 40, -145 + sway * 1.5, 260);
    ctx.quadraticCurveTo(-110 + sway, 160, -75, 20);
    ctx.closePath();
    ctx.fill();

    // Right Twin-tail
    ctx.beginPath();
    ctx.moveTo(95, -70);
    ctx.quadraticCurveTo(170 - sway, 40, 145 - sway * 1.5, 260);
    ctx.quadraticCurveTo(110 - sway, 160, 75, 20);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawFace() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = '#ffedd5'; // Anime skin tone
    ctx.strokeStyle = '#e29d78';
    ctx.lineWidth = 2.2;

    ctx.beginPath();
    ctx.moveTo(-88, -70);
    ctx.quadraticCurveTo(-90, 45, 0, 98); // Chin
    ctx.quadraticCurveTo(90, 45, 88, -70);
    ctx.quadraticCurveTo(0, -125, -88, -70);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  _drawBlush() {
    const ctx = this.ctx;
    if (this.blushIntensity <= 0.05) return;
    ctx.save();
    ctx.fillStyle = `rgba(244, 63, 94, ${this.blushIntensity * 0.48})`;

    // Left Cheek
    ctx.beginPath();
    ctx.ellipse(-52, 28, 22, 11, -0.1, 0, Math.PI * 2);
    ctx.fill();

    // Right Cheek
    ctx.beginPath();
    ctx.ellipse(52, 28, 22, 11, 0.1, 0, Math.PI * 2);
    ctx.fill();

    // Tsundere blush lines
    if (this.blushIntensity > 0.5) {
      ctx.strokeStyle = `rgba(225, 29, 72, ${this.blushIntensity * 0.6})`;
      ctx.lineWidth = 1.8;
      [-60, -52, -44].forEach((x) => {
        ctx.beginPath();
        ctx.moveTo(x, 22);
        ctx.lineTo(x + 5, 34);
        ctx.stroke();
      });
      [44, 52, 60].forEach((x) => {
        ctx.beginPath();
        ctx.moveTo(x, 22);
        ctx.lineTo(x + 5, 34);
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  _drawEyes() {
    const ctx = this.ctx;
    const isBlinking = this.blinkProgress > 0.01;
    const blinkVal = isBlinking ? smoothstep(Math.sin(this.blinkProgress * Math.PI)) : 0;
    const eyeOpen = Math.max(0.04, 1 - blinkVal);

    [-46, 46].forEach((eyeX, idx) => {
      ctx.save();
      ctx.translate(eyeX, 5);

      if (this.currentEmotion === 'happy') {
        // Closed happy arched eyes ^^
        ctx.strokeStyle = '#3b2024';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(0, 0, 16, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      } else {
        // Eye Sclera (White)
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(0, 0, 20, 22 * eyeOpen, 0, 0, Math.PI * 2);
        ctx.fill();

        // Iris
        const gazeOffsetX = this.currentGaze.x * 6;
        const gazeOffsetY = this.currentGaze.y * 5;

        const irisGrad = ctx.createRadialGradient(gazeOffsetX, gazeOffsetY + 2, 2, gazeOffsetX, gazeOffsetY, 15);
        irisGrad.addColorStop(0, '#f43f5e'); // Crimson/Magenta anime eyes
        irisGrad.addColorStop(0.7, '#9f1239');
        irisGrad.addColorStop(1, '#4c0519');

        ctx.save();
        ctx.beginPath();
        ctx.ellipse(0, 0, 20, 22 * eyeOpen, 0, 0, Math.PI * 2);
        ctx.clip();

        ctx.fillStyle = irisGrad;
        ctx.beginPath();
        ctx.arc(gazeOffsetX, gazeOffsetY, 13 * eyeOpen, 0, Math.PI * 2);
        ctx.fill();

        // Pupil
        ctx.fillStyle = '#1e050c';
        ctx.beginPath();
        ctx.arc(gazeOffsetX, gazeOffsetY, 5.5 * eyeOpen, 0, Math.PI * 2);
        ctx.fill();

        // Highlights (Anime sparkles)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(gazeOffsetX - 4, gazeOffsetY - 4 * eyeOpen, 3.8 * eyeOpen, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(gazeOffsetX + 4, gazeOffsetY + 3 * eyeOpen, 2.0 * eyeOpen, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        // Upper Eyelash / Lid
        ctx.strokeStyle = '#2d181c';
        ctx.lineWidth = 3.8;
        ctx.beginPath();
        ctx.arc(0, -2 * (1 - eyeOpen), 21, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  _drawEyebrows() {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#be185d';
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';

    let leftAngle = 0;
    let rightAngle = 0;
    let browY = -22;

    if (this.currentEmotion === 'angry') {
      leftAngle = 0.28;
      rightAngle = -0.28;
      browY = -18;
    } else if (this.currentEmotion === 'sad') {
      leftAngle = -0.22;
      rightAngle = 0.22;
      browY = -24;
    } else if (this.currentEmotion === 'surprised') {
      browY = -30;
    }

    // Left Brow
    ctx.beginPath();
    ctx.moveTo(-62, browY + 6 * leftAngle);
    ctx.quadraticCurveTo(-46, browY - 4, -30, browY - 6 * leftAngle);
    ctx.stroke();

    // Right Brow
    ctx.beginPath();
    ctx.moveTo(30, browY - 6 * rightAngle);
    ctx.quadraticCurveTo(46, browY - 4, 62, browY + 6 * rightAngle);
    ctx.stroke();

    ctx.restore();
  }

  _drawNose() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = '#e28864';
    ctx.beginPath();
    ctx.arc(0, 36, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawMouth() {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(0, 56);

    const open = Math.max(0, this.mouthOpen);

    if (open > 0.08) {
      // Articulated talking mouth
      ctx.fillStyle = '#9f1239';
      ctx.strokeStyle = '#4c0519';
      ctx.lineWidth = 2.0;

      ctx.beginPath();
      ctx.moveTo(-16, 0);
      ctx.quadraticCurveTo(0, -5 * open, 16, 0);
      ctx.quadraticCurveTo(0, 24 * open, -16, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Tongue
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(0, 14 * open, 9 * open, Math.PI, 0);
      ctx.fill();
    } else {
      // Resting / Emotional Closed Mouth
      ctx.strokeStyle = '#4c0519';
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';

      ctx.beginPath();
      if (this.currentEmotion === 'happy') {
        ctx.arc(0, -6, 14, Math.PI * 0.2, Math.PI * 0.8);
      } else if (this.currentEmotion === 'angry') {
        ctx.moveTo(-12, 4);
        ctx.quadraticCurveTo(0, -2, 12, 4); // Pouting frown
      } else if (this.currentEmotion === 'sad') {
        ctx.arc(0, 8, 12, Math.PI * 1.25, Math.PI * 1.75);
      } else if (this.currentEmotion === 'embarrassed') {
        ctx.moveTo(-8, 2);
        ctx.lineTo(8, -1); // Small nervous line
      } else {
        ctx.arc(0, -3, 11, Math.PI * 0.25, Math.PI * 0.75); // Subtle smile
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawHairFront() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = '#f472b6'; // Vibrant anime pink

    // Bangs (Forehead hair strands)
    ctx.beginPath();
    ctx.moveTo(-92, -65);
    ctx.quadraticCurveTo(-60, 10, -42, 8);
    ctx.quadraticCurveTo(-38, -15, -28, 14);
    ctx.quadraticCurveTo(-15, -20, 0, 16);
    ctx.quadraticCurveTo(15, -20, 28, 14);
    ctx.quadraticCurveTo(38, -15, 42, 8);
    ctx.quadraticCurveTo(60, 10, 92, -65);
    ctx.quadraticCurveTo(0, -145, -92, -65);
    ctx.closePath();
    ctx.fill();

    // Side Locks framing the cheeks
    ctx.beginPath();
    ctx.moveTo(-90, -45);
    ctx.quadraticCurveTo(-98, 40, -82, 95);
    ctx.quadraticCurveTo(-75, 50, -78, -35);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(90, -45);
    ctx.quadraticCurveTo(98, 40, 82, 95);
    ctx.quadraticCurveTo(75, 50, 78, -35);
    ctx.closePath();
    ctx.fill();

    // Ahoge (hair antenna / cowlick that bobs cutely)
    const ahogeSway = Math.sin(this.clockTime * 3.5) * 8;
    ctx.strokeStyle = '#f472b6';
    ctx.lineWidth = 4.0;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -118);
    ctx.quadraticCurveTo(20 + ahogeSway, -155, 35 + ahogeSway * 1.5, -140);
    ctx.stroke();

    ctx.restore();
  }

  _drawRibbon() {
    const ctx = this.ctx;
    ctx.save();
    // Hair clips / ribbons
    ctx.fillStyle = '#0ea5e9';
    [-85, 85].forEach((rx) => {
      ctx.beginPath();
      ctx.arc(rx, -65, 8, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }
}
