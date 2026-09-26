import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// Maps Yumi's emotion tag (from the backend's [emotion: X] parse) onto a
// blend of VRM 1.0's standard expression presets (happy/angry/sad/relaxed/
// surprised). "embarrassed" has no standard VRM preset, so it's built as a
// happy+angry blend — a classic flustered/tsundere "blush and scowl at once"
// look — rather than skipped.
const EMOTION_PRESETS = {
  neutral: {},
  happy: { happy: 1.0 },
  angry: { angry: 1.0 },
  sad: { sad: 1.0 },
  surprised: { surprised: 1.0 },
  embarrassed: { happy: 0.55, angry: 0.35 },
};
const EMOTION_SHAPE_NAMES = ['happy', 'angry', 'sad', 'relaxed', 'surprised'];
const EMOTION_CROSSFADE_RATE = 0.08; // per-frame ease toward target weight

// --- Gesture animations (procedural, not asset-based) -----------------
// These are coded bone-rotation poses rather than imported .vrma/Mixamo
// clips, so the whole thing stays self-contained in this one file with
// no external animation assets to source. The rotation values below are
// starting points — tune them per-model, since exact "arms crossed"/
// "hand near face" angles depend on your VRM's specific rig proportions.
// Each pose is a one-shot: it plays over GESTURE_DURATION seconds
// (ease in -> hold -> ease out) whenever setEmotion() receives a NEW
// emotion, then the avatar returns to normal idle motion.
const GESTURE_DURATION = 1.6; // seconds
const GESTURE_POSES = {
  neutral: null,
  happy: { rightUpperArm: { z: -0.35 }, rightLowerArm: { z: -0.25 } }, // small raised-arm brightening
  angry: {
    leftUpperArm: { z: 1.0 }, rightUpperArm: { z: -1.0 },
    leftLowerArm: { y: 0.55 }, rightLowerArm: { y: -0.55 },
  }, // approximate arms-crossed
  sad: { head: { x: 0.22 } }, // head droops (head.x is untouched by idle, so no conflict)
  surprised: { leftUpperArm: { z: 0.45 }, leftLowerArm: { x: -0.85 } }, // hand toward mouth
  embarrassed: { rightUpperArm: { z: -0.45 }, rightLowerArm: { x: -0.95 } }, // hand near face
};
const GESTURE_BONE_NAMES = [
  'leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'rightLowerArm', 'head',
];

// --- Camera director ----------------------------------------------------
// Only eases field-of-view (a "push in / pull back" zoom), never
// repositions the camera — that way it layers on top of whatever the
// user has done with OrbitControls instead of fighting it.
const CAMERA_FOV_TARGETS = {
  neutral: 30, happy: 30, angry: 27, sad: 32, surprised: 24, embarrassed: 26,
};
const CAMERA_EASE_RATE = 0.035;

export class VrmManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.currentVrm = null;
    this.blinkTimer = 0;
    this.nextBlinkAt = 3 + Math.random() * 3;

    // Idle "alive" behavior state
    this.saccadeTimer = 0;
    this.nextSaccadeAt = 1.5 + Math.random() * 2.5;
    this.lookTarget = { x: 0, y: 0 };
    this.currentLook = { x: 0, y: 0 };
    this.status = 'idle'; // set via setStatus(); drives the "thinking" pose

    // Emotion crossfade state
    this.emotionTargets = {};   // shape name -> target weight (0..1)
    this.emotionCurrent = Object.fromEntries(EMOTION_SHAPE_NAMES.map((s) => [s, 0]));

    // Gesture state
    this.lastGestureEmotion = 'neutral';
    this.gestureStartTime = null;
    this.activeGesturePose = null;

    // Camera director state
    this.cameraFovTarget = CAMERA_FOV_TARGETS.neutral;

    this._initScene();
    this._animate();
  }

  _initScene() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20);
    this.camera.position.set(0, 1.35, 2.2);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.2, 0);
    this.controls.enableDamping = true;
    this.controls.minDistance = 1.0;
    this.controls.maxDistance = 4.0;
    this.controls.update();

    const keyLight = new THREE.DirectionalLight(0xfff2f9, 1.4);
    keyLight.position.set(1, 2, 1.5);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xcfe0ff, 0.6);
    fillLight.position.set(-1.5, 1.2, -1);
    this.scene.add(fillLight);

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(ambient);

    const rimLight = new THREE.PointLight(0xff9fdc, 0.8, 6);
    rimLight.position.set(0, 1.8, -1.5);
    this.scene.add(rimLight);

    window.addEventListener('resize', () => this._onResize());
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  async loadVrmFromUrl(url) {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    if (this.currentVrm) {
      this.scene.remove(this.currentVrm.scene);
      VRMUtils.deepDispose(this.currentVrm.scene);
      this.currentVrm = null;
    }

    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          const vrm = gltf.userData.vrm;
          VRMUtils.rotateVRM0(vrm);
          this.scene.add(vrm.scene);
          this.currentVrm = vrm;
          resolve(vrm);
        },
        undefined,
        (error) => reject(error)
      );
    });
  }

  setExpressionValue(name, value) {
    if (this.currentVrm && this.currentVrm.expressionManager) {
      this.currentVrm.expressionManager.setValue(name, value);
    }
  }

  /** Called from app.js whenever the server status changes, so idle motion
   * can react — e.g. a subtle head-tilt "thinking" pose while waiting on
   * Gemini, instead of the avatar looking frozen/dead during that gap. */
  setStatus(status) {
    this.status = status;
  }

  /** Called from app.js with the emotion tag parsed out of Yumi's reply
   * (e.g. "happy", "angry", "embarrassed"). Sets crossfade targets; the
   * actual easing happens every frame in _updateEmotion() so expression
   * changes fade in/out instead of popping instantly. */
  setEmotion(emotionName) {
    this.emotionTargets = EMOTION_PRESETS[emotionName] ?? EMOTION_PRESETS.neutral;

    // Trigger a one-shot gesture + camera move only on an actual change,
    // not every time a reply happens to repeat the same emotion.
    if (emotionName !== this.lastGestureEmotion) {
      this.lastGestureEmotion = emotionName;
      this.activeGesturePose = GESTURE_POSES[emotionName] ?? null;
      this.gestureStartTime = this.clock.elapsedTime;
      this.cameraFovTarget = CAMERA_FOV_TARGETS[emotionName] ?? CAMERA_FOV_TARGETS.neutral;
    }
  }

  _updateGesture() {
    if (!this.currentVrm?.humanoid) return;

    let envelope = 0;
    if (this.activeGesturePose && this.gestureStartTime !== null) {
      const elapsed = this.clock.elapsedTime - this.gestureStartTime;
      const progress = elapsed / GESTURE_DURATION;
      if (progress >= 1) {
        this.activeGesturePose = null; // gesture finished
      } else if (progress < 0.25) {
        envelope = progress / 0.25; // ease in
      } else if (progress < 0.7) {
        envelope = 1; // hold
      } else {
        envelope = 1 - (progress - 0.7) / 0.3; // ease out
      }
    }

    // Arm bones are never touched by idle motion, and gestures only ever
    // use head.x (idle only touches head.z for the "thinking" tilt), so
    // every axis below can be set directly with no conflict/blending math
    // needed against _updateIdleAnimation.
    for (const boneName of GESTURE_BONE_NAMES) {
      const bone = this.currentVrm.humanoid.getNormalizedBoneNode(boneName);
      if (!bone) continue;
      const targetAxes = this.activeGesturePose?.[boneName];
      bone.rotation.x = (targetAxes?.x ?? 0) * envelope;
      bone.rotation.y = (targetAxes?.y ?? 0) * envelope;
      bone.rotation.z = (targetAxes?.z ?? 0) * envelope;
    }
  }

  _updateCameraDirector() {
    this.camera.fov += (this.cameraFovTarget - this.camera.fov) * CAMERA_EASE_RATE;
    this.camera.updateProjectionMatrix();
  }

  _updateEmotion() {
    if (!this.currentVrm?.expressionManager) return;
    for (const shape of EMOTION_SHAPE_NAMES) {
      const target = this.emotionTargets[shape] ?? 0;
      this.emotionCurrent[shape] += (target - this.emotionCurrent[shape]) * EMOTION_CROSSFADE_RATE;
      this.currentVrm.expressionManager.setValue(shape, this.emotionCurrent[shape]);
    }
  }

  _updateIdleAnimation(delta) {
    if (!this.currentVrm) return;
    const t = this.clock.elapsedTime;

    const spine = this.currentVrm.humanoid?.getNormalizedBoneNode('spine');
    const chest = this.currentVrm.humanoid?.getNormalizedBoneNode('chest');
    const neck = this.currentVrm.humanoid?.getNormalizedBoneNode('neck');
    const head = this.currentVrm.humanoid?.getNormalizedBoneNode('head');
    const leftEye = this.currentVrm.humanoid?.getNormalizedBoneNode('leftEye');
    const rightEye = this.currentVrm.humanoid?.getNormalizedBoneNode('rightEye');

    // Natural breathing: gentle chest/spine oscillation, slightly out of
    // phase so it doesn't read as a single robotic sine wave.
    if (spine) spine.rotation.x = Math.sin(t * 1.2) * 0.015;
    if (chest) chest.rotation.x = Math.sin(t * 1.2 + 0.3) * 0.01;

    // Gentle head sway so she never looks like a frozen render.
    if (neck) {
      neck.rotation.y = Math.sin(t * 0.35) * 0.05;
      neck.rotation.z = Math.sin(t * 0.5 + 1.0) * 0.02;
    }

    // "Thinking" pose: subtle head tilt + downward-ish gaze while waiting
    // on a Gemini/TTS round trip, so the wait itself reads as an expression
    // instead of dead air.
    const thinking = this.status === 'thinking' || this.status === 'synthesizing_voice';
    if (head) {
      const targetTiltZ = thinking ? 0.12 : 0;
      head.rotation.z += (targetTiltZ - head.rotation.z) * 0.05;
    }

    // Saccades: eyes dart to a new small random target periodically instead
    // of staring dead ahead, then smoothly ease toward that target every
    // frame (this is what actually sells "alive" on a static idle avatar).
    this.saccadeTimer += delta;
    if (this.saccadeTimer >= this.nextSaccadeAt) {
      this.lookTarget = {
        x: (Math.random() - 0.5) * (thinking ? 0.12 : 0.35),
        y: (Math.random() - 0.5) * 0.2 + (thinking ? -0.15 : 0),
      };
      this.saccadeTimer = 0;
      this.nextSaccadeAt = thinking ? 2.5 + Math.random() * 2 : 1.2 + Math.random() * 2.2;
    }
    this.currentLook.x += (this.lookTarget.x - this.currentLook.x) * 0.08;
    this.currentLook.y += (this.lookTarget.y - this.currentLook.y) * 0.08;

    if (leftEye) {
      leftEye.rotation.y = this.currentLook.x;
      leftEye.rotation.x = this.currentLook.y;
    }
    if (rightEye) {
      rightEye.rotation.y = this.currentLook.x;
      rightEye.rotation.x = this.currentLook.y;
    }

    // Eye blinking on a randomized timer via VRM expression "blink".
    this.blinkTimer += delta;
    if (this.blinkTimer >= this.nextBlinkAt) {
      this._triggerBlink();
      this.blinkTimer = 0;
      this.nextBlinkAt = 2.5 + Math.random() * 4;
    }
  }

  _triggerBlink() {
    if (!this.currentVrm?.expressionManager) return;
    const mgr = this.currentVrm.expressionManager;
    let progress = 0;
    const blinkDurationMs = 120;
    const start = performance.now();

    const step = () => {
      const elapsed = performance.now() - start;
      progress = Math.min(elapsed / blinkDurationMs, 1);
      const value = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
      mgr.setValue('blink', value);
      if (progress < 1) requestAnimationFrame(step);
      else mgr.setValue('blink', 0);
    };
    requestAnimationFrame(step);
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    const delta = this.clock.getDelta();

    this._updateIdleAnimation(delta);
    this._updateEmotion();
    this._updateGesture();
    this._updateCameraDirector();
    this.controls.update();
    if (this.currentVrm) this.currentVrm.update(delta);

    this.renderer.render(this.scene, this.camera);
  }
}
