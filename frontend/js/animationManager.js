/**
 * frontend/js/animationManager.js
 * Centralized Animation & State Engine for 3D VRM Avatars.
 * Inspired by official @pixiv/three-vrm and @pixiv/three-vrm-animation architecture.
 *
 * Supported Features:
 * - Automatic VRM 0.0 vs VRM 1.0 coordinate normalization (eliminates inverted arms/hands on custom models).
 * - Centralized Life States: IDLE, LISTENING, THINKING, TALKING with smooth crossfading.
 * - Organic multi-harmonic respiration & posture micro-sway.
 * - Natural fluid arm posing, relaxed elbow flexion, and living finger curl.
 * - Official three-vrm LookAt target tracking with cervical lag and conversational glance-aways.
 * - Poisson-distributed blinking with realistic double-blinks.
 * - Audio-driven viseme lip-sync + procedural speech cadence fallback.
 * - THREE.AnimationMixer + VRMA clip loading support.
 */

import * as THREE from 'three';
import {
  createVRMAnimationClip,
  VRMAnimationLoaderPlugin,
  VRMLookAtQuaternionProxy,
} from '@pixiv/three-vrm-animation';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Hermite cubic smoothstep
function smoothstep(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

// Supported Companion Life States
export const CompanionState = Object.freeze({
  IDLE: 'idle',
  LISTENING: 'listening',
  THINKING: 'thinking',
  TALKING: 'talking',
});

// Standard VRM Expression Presets
export const EMOTION_PRESETS = Object.freeze({
  neutral: { happy: 0, angry: 0, sad: 0, relaxed: 0.15, surprised: 0 },
  happy: { happy: 0.95, relaxed: 0.25 },
  angry: { angry: 0.9, relaxed: 0 },
  sad: { sad: 0.85, relaxed: 0 },
  surprised: { surprised: 0.9 },
  embarrassed: { happy: 0.5, angry: 0.35, relaxed: 0.15 },
});

export const EMOTION_SHAPE_NAMES = Object.freeze([
  'happy',
  'angry',
  'sad',
  'relaxed',
  'surprised',
]);

// Version-Aware Rest Poses (Euler XYZ in Radians)
// In VRM 0.0, the normalized arm bone hierarchy extends along -X for left and +X for right.
// In VRM 1.0, the normalized arm bone hierarchy extends along +X for left and -X for right.
export const REST_EULER_BY_VERSION = Object.freeze({
  '0': {
    leftShoulder: { x: 0, y: 0, z: 0.04 },
    rightShoulder: { x: 0, y: 0, z: -0.04 },
    leftUpperArm: { x: -0.06, y: 0, z: 1.25 },
    rightUpperArm: { x: -0.06, y: 0, z: -1.25 },
    leftLowerArm: { x: 0, y: 0.35, z: 0.15 },
    rightLowerArm: { x: 0, y: -0.35, z: -0.15 },
    leftHand: { x: 0.05, y: 0.05, z: 0.06 },
    rightHand: { x: 0.05, y: -0.05, z: -0.06 },
  },
  '1': {
    leftShoulder: { x: 0, y: 0, z: -0.04 },
    rightShoulder: { x: 0, y: 0, z: 0.04 },
    leftUpperArm: { x: -0.06, y: 0, z: -1.25 },
    rightUpperArm: { x: -0.06, y: 0, z: 1.25 },
    leftLowerArm: { x: 0, y: -0.35, z: -0.15 },
    rightLowerArm: { x: 0, y: 0.35, z: 0.15 },
    leftHand: { x: 0.05, y: -0.05, z: -0.06 },
    rightHand: { x: 0.05, y: 0.05, z: 0.06 },
  },
});

// Version-Aware Expressive Gestures (Euler XYZ in Radians)
export const GESTURE_EULER_BY_VERSION = Object.freeze({
  '0': {
    neutral: null,
    happy: {
      leftUpperArm: { x: -0.12, y: -0.05, z: 1.05 },
      leftLowerArm: { x: 0, y: 0.65, z: 0.25 },
      rightUpperArm: { x: -0.12, y: 0.05, z: -1.05 },
      rightLowerArm: { x: 0, y: -0.65, z: -0.25 },
      leftHand: { x: 0.05, y: 0.1, z: 0.1 },
      rightHand: { x: 0.05, y: -0.1, z: -0.1 },
      head: { x: -0.05, y: 0.06, z: 0.08 },
    },
    angry: {
      leftUpperArm: { x: -0.15, y: -0.15, z: 1.0 },
      leftLowerArm: { x: 0, y: 0.75, z: 0.35 },
      rightUpperArm: { x: -0.15, y: 0.15, z: -1.0 },
      rightLowerArm: { x: 0, y: -0.75, z: -0.35 },
      leftHand: { x: 0.1, y: 0, z: 0 },
      rightHand: { x: 0.1, y: 0, z: 0 },
      head: { x: 0.1, y: 0, z: 0 },
    },
    sad: {
      leftUpperArm: { x: -0.04, y: -0.02, z: 1.22 },
      leftLowerArm: { x: 0, y: 0.25, z: 0.08 },
      rightUpperArm: { x: -0.04, y: 0.02, z: -1.22 },
      rightLowerArm: { x: 0, y: -0.25, z: -0.08 },
      head: { x: 0.16, y: 0.02, z: -0.04 },
    },
    surprised: {
      leftUpperArm: { x: -0.18, y: 0.08, z: 0.95 },
      leftLowerArm: { x: 0, y: 0.85, z: 0.3 },
      rightUpperArm: { x: -0.18, y: -0.08, z: -0.95 },
      rightLowerArm: { x: 0, y: -0.85, z: -0.3 },
      leftHand: { x: 0.1, y: 0, z: 0.1 },
      rightHand: { x: 0.1, y: 0, z: -0.1 },
      head: { x: -0.12, y: 0, z: 0 },
    },
    embarrassed: {
      leftUpperArm: { x: -0.05, y: -0.05, z: 1.2 },
      leftLowerArm: { x: 0, y: 0.35, z: 0.1 },
      rightUpperArm: { x: -0.22, y: 0.15, z: -0.85 },
      rightLowerArm: { x: 0, y: -0.95, z: -0.4 },
      leftHand: { x: 0.1, y: -0.15, z: -0.1 },
      rightHand: { x: 0.1, y: -0.15, z: -0.1 },
      head: { x: 0.08, y: -0.16, z: -0.12 },
    },
    thinking: {
      leftUpperArm: { x: -0.06, y: -0.05, z: 1.2 },
      leftLowerArm: { x: 0, y: 0.4, z: 0.1 },
      rightUpperArm: { x: -0.25, y: 0.2, z: -0.75 },
      rightLowerArm: { x: 0, y: -1.1, z: -0.45 },
      rightHand: { x: 0.15, y: -0.1, z: -0.12 },
      head: { x: 0.08, y: -0.12, z: 0.1 },
    },
    wave: {
      leftUpperArm: { x: -0.06, y: -0.05, z: 1.25 },
      leftLowerArm: { x: 0, y: 0.35, z: 0.15 },
      rightUpperArm: { x: -0.3, y: 0.2, z: -0.35 },
      rightLowerArm: { x: 0, y: -1.25, z: -0.4 },
      rightHand: { x: 0.2, y: -0.15, z: -0.2 },
      head: { x: -0.05, y: 0.08, z: 0.06 },
    },
    nod: {
      leftUpperArm: { x: -0.06, y: -0.03, z: 1.22 },
      leftLowerArm: { x: 0, y: 0.3, z: 0.1 },
      rightUpperArm: { x: -0.06, y: 0.03, z: -1.22 },
      rightLowerArm: { x: 0, y: -0.3, z: -0.1 },
      head: { x: 0.18, y: 0, z: 0 },
    },
    pout: {
      leftUpperArm: { x: -0.25, y: -0.35, z: 0.75 },
      leftLowerArm: { x: 0, y: 1.15, z: 0.45 },
      rightUpperArm: { x: -0.25, y: 0.35, z: -0.75 },
      rightLowerArm: { x: 0, y: -1.15, z: -0.45 },
      leftHand: { x: 0.15, y: 0, z: 0 },
      rightHand: { x: 0.15, y: 0, z: 0 },
      head: { x: 0.06, y: -0.25, z: 0.06 },
    },
    bow: {
      leftUpperArm: { x: -0.1, y: -0.08, z: 1.2 },
      leftLowerArm: { x: 0, y: 0.25, z: 0.05 },
      rightUpperArm: { x: -0.1, y: 0.08, z: -1.2 },
      rightLowerArm: { x: 0, y: -0.25, z: -0.05 },
      head: { x: 0.32, y: 0, z: 0 },
    },
    cheer: {
      leftUpperArm: { x: -0.35, y: -0.2, z: 0.55 },
      leftLowerArm: { x: 0, y: 1.35, z: 0.35 },
      rightUpperArm: { x: -0.35, y: 0.2, z: -0.55 },
      rightLowerArm: { x: 0, y: -1.35, z: -0.35 },
      leftHand: { x: 0.25, y: 0.1, z: 0.1 },
      rightHand: { x: 0.25, y: -0.1, z: -0.1 },
      head: { x: -0.15, y: 0, z: 0 },
    },
    stretch: {
      leftUpperArm: { x: -0.2, y: -0.1, z: 0.7 },
      leftLowerArm: { x: 0, y: 0.8, z: 0.2 },
      rightUpperArm: { x: -0.2, y: 0.1, z: -0.7 },
      rightLowerArm: { x: 0, y: -0.8, z: -0.2 },
      head: { x: -0.1, y: 0, z: 0 },
    },
  },
  '1': {
    neutral: null,
    happy: {
      leftUpperArm: { x: -0.12, y: 0.05, z: -1.05 },
      leftLowerArm: { x: 0, y: -0.65, z: -0.25 },
      rightUpperArm: { x: -0.12, y: -0.05, z: 1.05 },
      rightLowerArm: { x: 0, y: 0.65, z: 0.25 },
      leftHand: { x: 0.05, y: -0.1, z: -0.1 },
      rightHand: { x: 0.05, y: 0.1, z: 0.1 },
      head: { x: -0.05, y: 0.06, z: 0.08 },
    },
    angry: {
      leftUpperArm: { x: -0.15, y: 0.15, z: -1.0 },
      leftLowerArm: { x: 0, y: -0.75, z: -0.35 },
      rightUpperArm: { x: -0.15, y: -0.15, z: 1.0 },
      rightLowerArm: { x: 0, y: 0.75, z: 0.35 },
      leftHand: { x: 0.1, y: 0, z: 0 },
      rightHand: { x: 0.1, y: 0, z: 0 },
      head: { x: 0.1, y: 0, z: 0 },
    },
    sad: {
      leftUpperArm: { x: -0.04, y: 0.02, z: -1.22 },
      leftLowerArm: { x: 0, y: -0.25, z: -0.08 },
      rightUpperArm: { x: -0.04, y: -0.02, z: 1.22 },
      rightLowerArm: { x: 0, y: 0.25, z: 0.08 },
      head: { x: 0.16, y: 0.02, z: -0.04 },
    },
    surprised: {
      leftUpperArm: { x: -0.18, y: -0.08, z: -0.95 },
      leftLowerArm: { x: 0, y: -0.85, z: -0.3 },
      rightUpperArm: { x: -0.18, y: 0.08, z: 0.95 },
      rightLowerArm: { x: 0, y: 0.85, z: 0.3 },
      leftHand: { x: 0.1, y: 0, z: -0.1 },
      rightHand: { x: 0.1, y: 0, z: 0.1 },
      head: { x: -0.12, y: 0, z: 0 },
    },
    embarrassed: {
      leftUpperArm: { x: -0.05, y: 0.05, z: -1.2 },
      leftLowerArm: { x: 0, y: -0.35, z: -0.1 },
      rightUpperArm: { x: -0.22, y: -0.15, z: 0.85 },
      rightLowerArm: { x: 0, y: 0.95, z: 0.4 },
      rightHand: { x: 0.1, y: 0.15, z: 0.1 },
      head: { x: 0.08, y: -0.16, z: -0.12 },
    },
    thinking: {
      leftUpperArm: { x: -0.06, y: 0.05, z: -1.2 },
      leftLowerArm: { x: 0, y: -0.4, z: -0.1 },
      rightUpperArm: { x: -0.25, y: -0.2, z: 0.75 },
      rightLowerArm: { x: 0, y: 1.1, z: 0.45 },
      rightHand: { x: 0.15, y: 0.1, z: 0.12 },
      head: { x: 0.08, y: -0.12, z: 0.1 },
    },
    wave: {
      leftUpperArm: { x: -0.06, y: 0.05, z: -1.25 },
      leftLowerArm: { x: 0, y: -0.35, z: -0.15 },
      rightUpperArm: { x: -0.3, y: -0.2, z: 0.35 },
      rightLowerArm: { x: 0, y: 1.25, z: 0.4 },
      rightHand: { x: 0.2, y: 0.15, z: 0.2 },
      head: { x: -0.05, y: 0.08, z: 0.06 },
    },
    nod: {
      leftUpperArm: { x: -0.06, y: 0.03, z: -1.22 },
      leftLowerArm: { x: 0, y: -0.3, z: -0.1 },
      rightUpperArm: { x: -0.06, y: -0.03, z: 1.22 },
      rightLowerArm: { x: 0, y: 0.3, z: 0.1 },
      head: { x: 0.18, y: 0, z: 0 },
    },
    pout: {
      leftUpperArm: { x: -0.25, y: 0.35, z: -0.75 },
      leftLowerArm: { x: 0, y: -1.15, z: -0.45 },
      rightUpperArm: { x: -0.25, y: -0.35, z: 0.75 },
      rightLowerArm: { x: 0, y: 1.15, z: 0.45 },
      leftHand: { x: 0.15, y: 0, z: 0 },
      rightHand: { x: 0.15, y: 0, z: 0 },
      head: { x: 0.06, y: 0.25, z: -0.06 },
    },
    bow: {
      leftUpperArm: { x: -0.1, y: 0.08, z: -1.2 },
      leftLowerArm: { x: 0, y: -0.25, z: -0.05 },
      rightUpperArm: { x: -0.1, y: -0.08, z: 1.2 },
      rightLowerArm: { x: 0, y: 0.25, z: 0.05 },
      head: { x: 0.32, y: 0, z: 0 },
    },
    cheer: {
      leftUpperArm: { x: -0.35, y: 0.2, z: -0.55 },
      leftLowerArm: { x: 0, y: -1.35, z: -0.35 },
      rightUpperArm: { x: -0.35, y: -0.2, z: 0.55 },
      rightLowerArm: { x: 0, y: 1.35, z: 0.35 },
      leftHand: { x: 0.25, y: -0.1, z: -0.1 },
      rightHand: { x: 0.25, y: 0.1, z: 0.1 },
      head: { x: -0.15, y: 0, z: 0 },
    },
    stretch: {
      leftUpperArm: { x: -0.2, y: 0.1, z: -0.7 },
      leftLowerArm: { x: 0, y: -0.8, z: -0.2 },
      rightUpperArm: { x: -0.2, y: -0.1, z: 0.7 },
      rightLowerArm: { x: 0, y: 0.8, z: 0.2 },
      head: { x: -0.1, y: 0, z: 0 },
    },
  },
});

export const GESTURE_EULER_POSES = GESTURE_EULER_BY_VERSION['1'];

const POSE_BONE_NAMES = Object.freeze([
  'leftShoulder',
  'rightShoulder',
  'leftUpperArm',
  'rightUpperArm',
  'leftLowerArm',
  'rightLowerArm',
  'leftHand',
  'rightHand',
]);

// Standard VRM Finger Bones for Natural Living Hands
const FINGER_BONE_CONFIGS = [
  // Knuckles (Proximal) - gentle inward curl
  { names: ['leftIndexProximal', 'rightIndexProximal'], curl: 0.14, splay: 0.02 },
  { names: ['leftMiddleProximal', 'rightMiddleProximal'], curl: 0.16, splay: 0.0 },
  { names: ['leftRingProximal', 'rightRingProximal'], curl: 0.18, splay: -0.02 },
  { names: ['leftLittleProximal', 'rightLittleProximal'], curl: 0.20, splay: -0.04 },
  // Middle joints (Intermediate) - relaxed bend
  { names: ['leftIndexIntermediate', 'rightIndexIntermediate'], curl: 0.18 },
  { names: ['leftMiddleIntermediate', 'rightMiddleIntermediate'], curl: 0.20 },
  { names: ['leftRingIntermediate', 'rightRingIntermediate'], curl: 0.22 },
  { names: ['leftLittleIntermediate', 'rightLittleIntermediate'], curl: 0.22 },
  // Tips (Distal) - subtle soft rest
  { names: ['leftIndexDistal', 'rightIndexDistal'], curl: 0.10 },
  { names: ['leftMiddleDistal', 'rightMiddleDistal'], curl: 0.10 },
  { names: ['leftRingDistal', 'rightRingDistal'], curl: 0.10 },
  { names: ['leftLittleDistal', 'rightLittleDistal'], curl: 0.10 },
];

export class AnimationManager {
  /**
   * @param {Object} options
   * @param {THREE.Scene} options.scene
   * @param {THREE.Camera} options.camera
   */
  constructor(options = {}) {
    this.scene = options.scene || null;
    this.camera = options.camera || null;
    this.vrm = null;
    this.lipSync = null;
    this.isVrm0 = false;

    // Feature Toggles
    this.blinkEnabled = true;
    this.lookAtEnabled = true;

    // State Machine
    this.state = CompanionState.IDLE;
    this.stateWeights = {
      [CompanionState.IDLE]: 1.0,
      [CompanionState.LISTENING]: 0.0,
      [CompanionState.THINKING]: 0.0,
      [CompanionState.TALKING]: 0.0,
    };
    this.stateCrossfadeSpeed = 6.0;

    // Three.js AnimationMixer & VRMA action cache
    this.mixer = null;
    this.activeAction = null;
    this.actions = new Map();
    this.vrmaClips = new Map();

    // Procedural Clocks & Randomization Seeds
    this.breathClock = 0;
    this.swayCycleTime = 0;
    this.swayTargetHipX = 0;
    this.swayCurrentHipX = 0;

    // Blinking System
    this.blinkTimer = 0;
    this.nextBlinkAt = 2.8;
    this.isBlinking = false;
    this.blinkProgress = 0;
    this.blinkDuration = 0.15;
    this.doubleBlinkPending = false;

    // LookAt & Eye Gaze Tracking
    this.pointerNormalized = new THREE.Vector2(0, 0);
    this.lookAtTarget = new THREE.Object3D();
    this.lookAtTarget.name = 'CompanionLookAtTarget';
    if (this.scene) {
      this.scene.add(this.lookAtTarget);
    }
    this.currentEyeOffset = { x: 0, y: 0 };
    this.targetEyeOffset = { x: 0, y: 0 };
    this.saccadeTimer = 0;
    this.nextSaccadeAt = 2.0;
    this.glanceAwayTimer = 0;
    this.glanceAwayActive = false;
    this.headTrackingEuler = new THREE.Euler(0, 0, 0, 'YXZ');

    // Listening State Dynamics
    this.listeningNodTimer = 0;
    this.listeningNodActive = false;
    this.listeningNodProgress = 0;

    // Thinking State Dynamics
    this.thinkingGazeTarget = { x: 0.18, y: 0.22 };

    // Talking State Dynamics
    this.talkingCadenceClock = 0;
    this.talkingGestureVariant = 0;
    this.talkingVariantTimer = 0;

    // Facial Emotion Morphing
    this.currentEmotion = 'neutral';
    this.emotionTargets = { ...EMOTION_PRESETS.neutral };
    this.emotionCurrent = Object.fromEntries(EMOTION_SHAPE_NAMES.map((s) => [s, 0]));
    this.emotionCrossfadeSpeed = 7.0;

    // Arm & Bone Pose Quaternions
    this.restQuats = {};
    this.targetBoneQuats = {};
    this.currentBoneQuats = {};
    this.gestureActive = false;
    this.gestureTimer = 0;
    this.gestureHeadTargetEuler = { x: 0, y: 0, z: 0 };
    this.gestureHeadCurrentEuler = { x: 0, y: 0, z: 0 };

    this._initPointerListeners();
  }

  // --- Initialization & Binding ---

  bindVrm(vrm) {
    this.vrm = vrm;
    if (!vrm) return;

    // Detect exact coordinate convention:
    // In VRM 0.0 (or models facing -Z in local rig), leftUpperArm position has negative X.
    const leftUpperArmNode = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
    const isVrm0 =
      vrm.meta?.metaVersion === '0' ||
      (leftUpperArmNode && leftUpperArmNode.position.x < 0);
    this.isVrm0 = Boolean(isVrm0);

    console.log(`[AnimationManager] Bound VRM model (vrm0=${this.isVrm0})`);
    // Capture normalized hips rest elevation to prevent skeleton collapsing into floor
    const hipsNode = vrm.humanoid?.getNormalizedBoneNode('hips');
    this.restHipsY = (hipsNode && hipsNode.position.y > 0.1) ? hipsNode.position.y : 0.82;

    // Initialize AnimationMixer on model scene
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.actions.clear();

    // Bind official Three-VRM LookAt target
    if (vrm.lookAt) {
      vrm.lookAt.target = this.lookAtTarget;
      vrm.lookAt.autoUpdate = true;
    }

    // Initialize Quaternions and Poses
    this._initQuaternions();
    this._applyRestPose();
    this._applyNaturalFingerCurl();

    // Reset state and expressions
    this.setState(CompanionState.IDLE);
    this.setEmotion('neutral');
  }

  attachLipSync(lipSync) {
    this.lipSync = lipSync;
  }

  _initPointerListeners() {
    window.addEventListener('pointermove', (e) => {
      this.pointerNormalized.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointerNormalized.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });
  }

  _initQuaternions() {
    const versionKey = this.isVrm0 ? '0' : '1';
    const restEulers = REST_EULER_BY_VERSION[versionKey] || REST_EULER_BY_VERSION['1'];

    this.restQuats = {};
    this.targetBoneQuats = {};
    this.currentBoneQuats = {};

    for (const boneName of POSE_BONE_NAMES) {
      const e = restEulers[boneName] || { x: 0, y: 0, z: 0 };
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e.x, e.y, e.z, 'XYZ'));
      this.restQuats[boneName] = q;
      this.currentBoneQuats[boneName] = q.clone();
      this.targetBoneQuats[boneName] = q.clone();
    }
  }

  _applyRestPose() {
    if (!this.vrm?.humanoid) return;
    for (const boneName of POSE_BONE_NAMES) {
      const bone = this.vrm.humanoid.getNormalizedBoneNode(boneName);
      const restQ = this.restQuats[boneName];
      if (bone && restQ) {
        bone.quaternion.copy(restQ);
      }
    }
  }

  _applyNaturalFingerCurl() {
    if (!this.vrm?.humanoid) return;

    // Apply relaxed, soft feminine anime finger curl
    for (const group of FINGER_BONE_CONFIGS) {
      const curlAmount = group.curl || 0.15;
      const splay = group.splay || 0;

      for (const boneName of group.names) {
        const bone = this.vrm.humanoid.getNormalizedBoneNode(boneName);
        if (!bone) continue;

        const isLeft = boneName.startsWith('left');
        const sign = this.isVrm0 ? -1 : 1;
        const euler = new THREE.Euler(
          isLeft ? -curlAmount : -curlAmount,
          0,
          isLeft ? (splay * sign) : (-splay * sign),
          'XYZ'
        );
        bone.quaternion.setFromEuler(euler);
      }
    }

    // Relaxed thumbs
    const leftThumb = this.vrm.humanoid.getNormalizedBoneNode('leftThumbProximal');
    const rightThumb = this.vrm.humanoid.getNormalizedBoneNode('rightThumbProximal');
    const thumbSign = this.isVrm0 ? -1 : 1;
    if (leftThumb) {
      leftThumb.quaternion.setFromEuler(new THREE.Euler(-0.08, 0.12 * thumbSign, 0.14 * thumbSign, 'XYZ'));
    }
    if (rightThumb) {
      rightThumb.quaternion.setFromEuler(new THREE.Euler(-0.08, -0.12 * thumbSign, -0.14 * thumbSign, 'XYZ'));
    }
  }

  // --- Central State Transitions ---

  setState(newState) {
    if (!Object.values(CompanionState).includes(newState)) {
      console.warn(`[AnimationManager] Unknown state '${newState}', defaulting to 'idle'`);
      newState = CompanionState.IDLE;
    }

    if (this.state === newState) return;
    this.state = newState;

    if (newState === CompanionState.LISTENING) {
      this.listeningNodTimer = 1.5 + Math.random() * 2.0;
    } else if (newState === CompanionState.THINKING) {
      this.thinkingGazeTarget.x = Math.random() > 0.5 ? 0.22 : -0.22;
      this.thinkingGazeTarget.y = 0.18 + Math.random() * 0.12;
      this.playGesture('thinking');
    } else if (newState === CompanionState.TALKING) {
      this.talkingGestureVariant = Math.floor(Math.random() * 3);
      this.talkingVariantTimer = 2.2 + Math.random() * 1.5;
    } else if (newState === CompanionState.IDLE) {
      this._returnToRestPose();
    }
  }

  getState() {
    return this.state;
  }

  setEmotion(emotionName) {
    this.currentEmotion = emotionName;
    this.emotionTargets = EMOTION_PRESETS[emotionName] || EMOTION_PRESETS.neutral;
    const versionKey = this.isVrm0 ? '0' : '1';
    const gestures = GESTURE_EULER_BY_VERSION[versionKey] || GESTURE_EULER_BY_VERSION['1'];
    if (gestures[emotionName]) {
      this.playGesture(emotionName);
    }
  }

  setExpressionValue(name, value) {
    if (!this.vrm?.expressionManager) return;
    try {
      this.vrm.expressionManager.setValue(name, Math.max(0, Math.min(1, value)));
    } catch (e) {
      /* ignore unsupported morph targets */
    }
  }

  // --- Gesture Offsetting ---

  playGesture(poseName) {
    const versionKey = this.isVrm0 ? '0' : '1';
    const gestures = GESTURE_EULER_BY_VERSION[versionKey] || GESTURE_EULER_BY_VERSION['1'];
    const pose = gestures[poseName];

    if (pose) {
      this.gestureActive = true;
      this.gestureTimer = 3.2;
      for (const boneName of POSE_BONE_NAMES) {
        const e = pose[boneName];
        if (e) {
          const q = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(e.x ?? 0, e.y ?? 0, e.z ?? 0, 'XYZ')
          );
          this.targetBoneQuats[boneName] = q;
        } else {
          this.targetBoneQuats[boneName] = this.restQuats[boneName]?.clone() || new THREE.Quaternion();
        }
      }
      if (pose.head) {
        this.gestureHeadTargetEuler = {
          x: pose.head.x ?? 0,
          y: pose.head.y ?? 0,
          z: pose.head.z ?? 0,
        };
      } else {
        this.gestureHeadTargetEuler = { x: 0, y: 0, z: 0 };
      }
    } else {
      this._returnToRestPose();
    }
  }

  _returnToRestPose() {
    this.gestureActive = false;
    for (const boneName of POSE_BONE_NAMES) {
      if (this.restQuats[boneName]) {
        this.targetBoneQuats[boneName] = this.restQuats[boneName].clone();
      }
    }
    this.gestureHeadTargetEuler = { x: 0, y: 0, z: 0 };
  }

  // --- VRMA & Animation Clips (THREE.AnimationMixer) ---

  async loadVrma(urlOrFile, customName = '') {
    if (!this.vrm) {
      throw new Error('Cannot load VRMA without an active VRM model.');
    }

    let url = urlOrFile;
    let autoRevoke = false;
    let clipName = customName;

    if (urlOrFile instanceof Blob || (typeof File !== 'undefined' && urlOrFile instanceof File)) {
      url = URL.createObjectURL(urlOrFile);
      autoRevoke = true;
      if (!clipName && urlOrFile.name) {
        clipName = urlOrFile.name.replace(/\.[^/.]+$/, '');
      }
    }

    const loader = new GLTFLoader();
    loader.crossOrigin = 'anonymous';
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    console.log(`[AnimationManager] Loading VRMA animation: ${clipName || url}`);
    try {
      const gltf = await loader.loadAsync(url);
      const vrmAnimation = gltf.userData.vrmAnimation;
      if (!vrmAnimation) {
        throw new Error('Loaded asset does not contain valid VRM animation data.');
      }

      const clip = createVRMAnimationClip(vrmAnimation, this.vrm);
      clip.name = clipName || (typeof url === 'string' ? url.split('/').pop().replace(/\.[^/.]+$/, '') : 'vrma_motion');
      this.vrmaClips.set(clip.name, clip);
      console.log(`[AnimationManager] Registered VRMA motion clip: '${clip.name}' (${clip.duration.toFixed(2)}s)`);

      return clip;
    } finally {
      if (autoRevoke) {
        URL.revokeObjectURL(url);
      }
    }
  }

  playAnimationClip(clipOrName, crossfadeDuration = 0.5, loop = true) {
    if (!this.mixer) return null;

    let clip = clipOrName;
    if (typeof clipOrName === 'string') {
      clip = this.vrmaClips.get(clipOrName);
      if (!clip) {
        console.warn(`[AnimationManager] Animation clip '${clipOrName}' not found in registry.`);
        return null;
      }
    }

    let action = this.actions.get(clip.name);
    if (!action) {
      action = this.mixer.clipAction(clip);
      this.actions.set(clip.name, action);
    }

    if (!loop) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
    }

    if (this.activeAction && this.activeAction !== action) {
      action.reset();
      action.fadeIn(crossfadeDuration);
      this.activeAction.fadeOut(crossfadeDuration);
    } else {
      action.reset().fadeIn(crossfadeDuration);
    }

    action.play();
    this.activeAction = action;
    return action;
  }

  stopAnimationClip(crossfadeDuration = 0.4) {
    if (this.activeAction) {
      this.activeAction.fadeOut(crossfadeDuration);
      this.activeAction = null;
    }
  }

  getLoadedVrmaClips() {
    return Array.from(this.vrmaClips.keys());
  }

  // --- Subsystem 1: State Machine Weights Interpolation ---

  _updateStateWeights(delta) {
    const step = 1 - Math.exp(-this.stateCrossfadeSpeed * delta);
    let total = 0;

    for (const s of Object.values(CompanionState)) {
      const target = this.state === s ? 1.0 : 0.0;
      this.stateWeights[s] += (target - this.stateWeights[s]) * step;
      total += this.stateWeights[s];
    }

    if (total > 0.0001) {
      for (const s of Object.values(CompanionState)) {
        this.stateWeights[s] /= total;
      }
    }
  }

  // --- Subsystem 2: Biological Respiration & Postural Dynamics ---

  _updateRespiration(delta) {
    if (!this.vrm?.humanoid) return;

    let rateMult = 1.0;
    if (this.currentEmotion === 'angry') rateMult = 1.35;
    else if (this.currentEmotion === 'sad') rateMult = 0.8;
    else if (this.currentEmotion === 'happy') rateMult = 1.15;

    if (this.state === CompanionState.LISTENING) rateMult *= 1.08;
    else if (this.state === CompanionState.THINKING) rateMult *= 0.88;

    this.breathClock += delta * rateMult;
    const t = this.breathClock;

    const spine = this.vrm.humanoid.getNormalizedBoneNode('spine');
    const chest = this.vrm.humanoid.getNormalizedBoneNode('chest');
    const upperChest = this.vrm.humanoid.getNormalizedBoneNode('upperChest');
    const neck = this.vrm.humanoid.getNormalizedBoneNode('neck');
    const hips = this.vrm.humanoid.getNormalizedBoneNode('hips');
    const leftShoulder = this.vrm.humanoid.getNormalizedBoneNode('leftShoulder');
    const rightShoulder = this.vrm.humanoid.getNormalizedBoneNode('rightShoulder');

    const breathPhase = t * 1.65;
    const primaryBreath = Math.sin(breathPhase);
    const harmonicBreath = Math.sin(breathPhase * 2.0 - 0.4) * 0.18;
    const combinedBreath = primaryBreath + harmonicBreath;

    let chestExpand = combinedBreath * 0.038 + 0.01;
    let spinePitch = Math.sin(breathPhase - 0.25) * 0.03;
    let shoulderLift = Math.sin(breathPhase - 0.4) * 0.022;

    const wListening = this.stateWeights[CompanionState.LISTENING];
    const wThinking = this.stateWeights[CompanionState.THINKING];

    spinePitch -= wListening * 0.035;
    chestExpand += wListening * 0.02;
    spinePitch += wThinking * 0.025;

    if (this.currentEmotion === 'sad') {
      spinePitch += 0.06;
      shoulderLift -= 0.025;
    } else if (this.currentEmotion === 'angry') {
      chestExpand += 0.04;
      shoulderLift += 0.03;
    }

    const shoulderSign = this.isVrm0 ? -1 : 1;
    if (chest) chest.rotation.x = chestExpand;
    if (upperChest) upperChest.rotation.x = chestExpand * 0.65;
    if (spine) spine.rotation.x = spinePitch;
    if (leftShoulder) leftShoulder.rotation.z = (0.04 * -shoulderSign) + (shoulderLift * shoulderSign);
    if (rightShoulder) rightShoulder.rotation.z = (0.04 * shoulderSign) - (shoulderLift * shoulderSign);

    // Living idle micro-fidgets & organic postural adjustments (Feature 2)
    this.swayCycleTime += delta;
    if (this.state === CompanionState.IDLE) {
      if (this.swayCycleTime >= (this.nextFidgetAt || 7.5)) {
        this.swayCycleTime = 0;
        this.nextFidgetAt = 6.0 + Math.random() * 8.0;
        this.swayTargetHipX = (Math.random() - 0.5) * 0.042;
      }
    } else {
      if (this.swayCycleTime >= 8.5) {
        this.swayCycleTime = 0;
        this.swayTargetHipX = (Math.random() - 0.5) * 0.035;
      }
    }
    const swayDecay = 1 - Math.exp(-0.8 * delta);
    this.swayCurrentHipX += (this.swayTargetHipX - this.swayCurrentHipX) * swayDecay;

    const swayPhase = t * 0.75;
    if (hips) {
      hips.rotation.y = Math.sin(swayPhase) * 0.025;
      hips.rotation.x = -combinedBreath * 0.012;
      hips.rotation.z = this.swayCurrentHipX + Math.sin(swayPhase * 0.5) * 0.015;
      const baseHipsY = (this.restHipsY !== undefined) ? this.restHipsY : 0.82;
      hips.position.y = baseHipsY + combinedBreath * 0.006;
    }

    if (neck) {
      neck.rotation.y = Math.sin(swayPhase + 0.4) * 0.028;
      neck.rotation.z = Math.sin(t * 0.45) * 0.015;
    }
  }

  // --- Subsystem 3: LookAt, Gaze Shifts, Saccades & Head Following ---

  _updateLookAt(delta) {
    if (!this.lookAtEnabled || !this.vrm) return;

    this.saccadeTimer += delta;
    if (this.saccadeTimer >= this.nextSaccadeAt) {
      this.saccadeTimer = 0;
      this.nextSaccadeAt = 1.8 + Math.random() * 2.4;
      const saccadeAmp = this.state === CompanionState.THINKING ? 0.08 : 0.04;
      this.targetEyeOffset.x = (Math.random() - 0.5) * saccadeAmp;
      this.targetEyeOffset.y = (Math.random() - 0.5) * saccadeAmp;
    }

    this.glanceAwayTimer += delta;
    const glanceInterval = this.glanceAwayActive ? 0.6 : 5.5 + Math.random() * 2.0;
    if (this.glanceAwayTimer >= glanceInterval) {
      this.glanceAwayTimer = 0;
      this.glanceAwayActive = !this.glanceAwayActive;
    }

    let gazeX = this.pointerNormalized.x * 0.5;
    let gazeY = this.pointerNormalized.y * 0.35;

    const wThinking = this.stateWeights[CompanionState.THINKING];
    const wListening = this.stateWeights[CompanionState.LISTENING];

    if (wThinking > 0.05) {
      gazeX = gazeX * (1 - wThinking) + this.thinkingGazeTarget.x * wThinking;
      gazeY = gazeY * (1 - wThinking) + this.thinkingGazeTarget.y * wThinking;
    } else if (wListening > 0.05) {
      gazeX *= 1.15;
      gazeY *= 1.15;
    } else if (this.glanceAwayActive) {
      gazeX += 0.22;
      gazeY += 0.05;
    }

    const eyeDecay = 1 - Math.exp(-14.0 * delta);
    this.currentEyeOffset.x += (gazeX + this.targetEyeOffset.x - this.currentEyeOffset.x) * eyeDecay;
    this.currentEyeOffset.y += (gazeY + this.targetEyeOffset.y - this.currentEyeOffset.y) * eyeDecay;

    if (this.camera) {
      const distance = 2.0;
      const targetPos = new THREE.Vector3(
        this.currentEyeOffset.x * 1.2,
        1.38 + this.currentEyeOffset.y * 0.8,
        distance
      );
      this.lookAtTarget.position.copy(targetPos);
    }

    const headTargetY = this.currentEyeOffset.x * 0.36;
    const headTargetX = -this.currentEyeOffset.y * 0.24 + (wThinking * 0.12) - (wListening * 0.05);
    const headTargetZ = wThinking * 0.08;

    const headDecay = 1 - Math.exp(-4.5 * delta);
    this.headTrackingEuler.x += (headTargetX - this.headTrackingEuler.x) * headDecay;
    this.headTrackingEuler.y += (headTargetY - this.headTrackingEuler.y) * headDecay;
    this.headTrackingEuler.z += (headTargetZ - this.headTrackingEuler.z) * headDecay;
  }

  // --- Subsystem 4: Head Orientation Composition ---

  _updateHeadComposition(delta) {
    if (!this.vrm?.humanoid) return;
    const head = this.vrm.humanoid.getNormalizedBoneNode('head');
    if (!head) return;

    const decay = 1 - Math.exp(-6.0 * delta);
    this.gestureHeadCurrentEuler.x += (this.gestureHeadTargetEuler.x - this.gestureHeadCurrentEuler.x) * decay;
    this.gestureHeadCurrentEuler.y += (this.gestureHeadTargetEuler.y - this.gestureHeadCurrentEuler.y) * decay;
    this.gestureHeadCurrentEuler.z += (this.gestureHeadTargetEuler.z - this.gestureHeadCurrentEuler.z) * decay;

    let listeningNodX = 0;
    const wListening = this.stateWeights[CompanionState.LISTENING];
    if (wListening > 0.05) {
      this.listeningNodTimer -= delta;
      if (this.listeningNodTimer <= 0 && !this.listeningNodActive) {
        this.listeningNodActive = true;
        this.listeningNodProgress = 0;
      }
      if (this.listeningNodActive) {
        this.listeningNodProgress += delta / 0.55;
        if (this.listeningNodProgress >= 1.0) {
          this.listeningNodActive = false;
          this.listeningNodTimer = 3.5 + Math.random() * 3.0;
        } else {
          listeningNodX = Math.sin(this.listeningNodProgress * Math.PI) * 0.065 * wListening;
        }
      }
    }

    let talkingNodX = 0;
    let talkingTiltZ = 0;
    const wTalking = this.stateWeights[CompanionState.TALKING];
    if (wTalking > 0.02) {
      const vol = this.lipSync && this.lipSync.isSpeaking ? this.lipSync.currentVolume : 0.22;
      this.talkingCadenceClock += delta * (4.5 + vol * 7.0);
      talkingNodX = Math.sin(this.talkingCadenceClock) * (0.05 + vol * 0.065) * wTalking;
      talkingTiltZ = Math.cos(this.talkingCadenceClock * 0.5) * (0.03 + vol * 0.04) * wTalking;
    }

    const finalEulerX = this.headTrackingEuler.x + this.gestureHeadCurrentEuler.x + listeningNodX + talkingNodX;
    const finalEulerY = this.headTrackingEuler.y + this.gestureHeadCurrentEuler.y;
    const finalEulerZ = this.headTrackingEuler.z + this.gestureHeadCurrentEuler.z + talkingTiltZ;

    head.quaternion.setFromEuler(new THREE.Euler(finalEulerX, finalEulerY, finalEulerZ, 'YXZ'));
  }

  // --- Subsystem 5: Arm, Wrist & Hand Articulation ---

  _updateArmsAndHands(delta) {
    if (!this.vrm?.humanoid) return;

    if (this.gestureActive) {
      this.gestureTimer -= delta;
      if (this.gestureTimer <= 0) {
        this._returnToRestPose();
      }
    }

    const blendRate = 5.8;
    const blendStep = 1 - Math.exp(-blendRate * delta);

    const breathOsc = Math.sin(this.breathClock * 1.65);
    const swayOsc = Math.cos(this.breathClock * 0.75);

    const wIdle = this.stateWeights[CompanionState.IDLE];
    const wListening = this.stateWeights[CompanionState.LISTENING];
    const wTalking = this.stateWeights[CompanionState.TALKING];

    // Coordinate orientation multiplier for VRM 0.0 vs VRM 1.0
    const sign = this.isVrm0 ? -1 : 1;

    if (wTalking > 0.1) {
      this.talkingVariantTimer -= delta;
      if (this.talkingVariantTimer <= 0) {
        this.talkingGestureVariant = (this.talkingGestureVariant + 1) % 3;
        this.talkingVariantTimer = 2.4 + Math.random() * 1.8;
      }
    }

    for (const boneName of POSE_BONE_NAMES) {
      const bone = this.vrm.humanoid.getNormalizedBoneNode(boneName);
      if (!bone) continue;

      const baseTargetQ = this.targetBoneQuats[boneName] || this.restQuats[boneName];
      const currentQ = this.currentBoneQuats[boneName];
      if (!baseTargetQ || !currentQ) continue;

      let effectiveTargetQ = baseTargetQ.clone();

      // 1. Biological Idle Sway & Respiration Motion
      if (!this.gestureActive) {
        if (boneName === 'leftUpperArm') {
          const swayEuler = new THREE.Euler(swayOsc * 0.02, 0, breathOsc * 0.03 * wIdle * -sign);
          effectiveTargetQ.multiply(new THREE.Quaternion().setFromEuler(swayEuler));
        } else if (boneName === 'rightUpperArm') {
          const swayEuler = new THREE.Euler(swayOsc * 0.02, 0, breathOsc * 0.03 * wIdle * sign);
          effectiveTargetQ.multiply(new THREE.Quaternion().setFromEuler(swayEuler));
        } else if (boneName === 'leftLowerArm') {
          const swayEuler = new THREE.Euler(breathOsc * 0.025, breathOsc * 0.035 * -sign, 0);
          effectiveTargetQ.multiply(new THREE.Quaternion().setFromEuler(swayEuler));
        } else if (boneName === 'rightLowerArm') {
          const swayEuler = new THREE.Euler(breathOsc * 0.025, breathOsc * 0.035 * sign, 0);
          effectiveTargetQ.multiply(new THREE.Quaternion().setFromEuler(swayEuler));
        } else if (boneName === 'leftHand') {
          const handEuler = new THREE.Euler(breathOsc * 0.04, swayOsc * 0.03 * sign, 0);
          effectiveTargetQ.multiply(new THREE.Quaternion().setFromEuler(handEuler));
        } else if (boneName === 'rightHand') {
          const handEuler = new THREE.Euler(breathOsc * 0.04, -swayOsc * 0.03 * sign, 0);
          effectiveTargetQ.multiply(new THREE.Quaternion().setFromEuler(handEuler));
        }
      }

      // 2. Listening: subtle attentive hand positioning
      if (wListening > 0.05 && !this.gestureActive) {
        if (boneName === 'leftLowerArm') {
          const listenEuler = new THREE.Euler(0, 0.08 * wListening * -sign, 0);
          effectiveTargetQ.multiply(new THREE.Quaternion().setFromEuler(listenEuler));
        } else if (boneName === 'rightLowerArm') {
          const listenEuler = new THREE.Euler(0, 0.08 * wListening * sign, 0);
          effectiveTargetQ.multiply(new THREE.Quaternion().setFromEuler(listenEuler));
        }
      }

      // 3. Conversational Talking Gestures
      if (wTalking > 0.05 && !this.gestureActive) {
        const talkCadence = this.talkingCadenceClock;
        const talkOsc1 = Math.sin(talkCadence * 0.8) * 0.16 * wTalking;
        const talkOsc2 = Math.cos(talkCadence * 0.75) * 0.18 * wTalking;

        if (boneName === 'rightLowerArm' && (this.talkingGestureVariant === 0 || this.talkingGestureVariant === 2)) {
          const swayEuler = new THREE.Euler(-talkOsc2 * 0.35, talkOsc2 * 0.45 * sign, talkOsc2 * 0.25 * sign);
          effectiveTargetQ.multiply(new THREE.Quaternion().setFromEuler(swayEuler));
        } else if (boneName === 'leftLowerArm' && (this.talkingGestureVariant === 1 || this.talkingGestureVariant === 2)) {
          const swayEuler = new THREE.Euler(-talkOsc1 * 0.3, -talkOsc1 * 0.4 * sign, -talkOsc1 * 0.2 * sign);
          effectiveTargetQ.multiply(new THREE.Quaternion().setFromEuler(swayEuler));
        } else if (boneName === 'rightHand') {
          const handEuler = new THREE.Euler(
            Math.sin(talkCadence * 1.1) * 0.18 * wTalking,
            Math.cos(talkCadence * 0.9) * 0.12 * wTalking * sign,
            0
          );
          effectiveTargetQ.multiply(new THREE.Quaternion().setFromEuler(handEuler));
        } else if (boneName === 'leftHand') {
          const handEuler = new THREE.Euler(
            Math.cos(talkCadence * 1.0) * 0.15 * wTalking,
            -Math.sin(talkCadence * 0.8) * 0.10 * wTalking * sign,
            0
          );
          effectiveTargetQ.multiply(new THREE.Quaternion().setFromEuler(handEuler));
        }
      }

      currentQ.slerp(effectiveTargetQ, blendStep);
      bone.quaternion.copy(currentQ);
    }
  }

  // --- Subsystem 6: Natural Blinking ---

  _updateBlink(delta) {
    if (!this.vrm?.expressionManager || !this.blinkEnabled) return;

    if (!this.isBlinking) {
      this.blinkTimer += delta;
      if (this.blinkTimer >= this.nextBlinkAt) {
        this.isBlinking = true;
        this.blinkProgress = 0;
        this.blinkTimer = 0;
        this.nextBlinkAt = 2.2 + Math.random() * 3.4;
        this.doubleBlinkPending = Math.random() < 0.18;
      }
    } else {
      this.blinkProgress += delta / this.blinkDuration;
      if (this.blinkProgress >= 1.0) {
        this.isBlinking = false;
        this.setExpressionValue('blink', 0);

        if (this.doubleBlinkPending) {
          this.doubleBlinkPending = false;
          this.nextBlinkAt = 0.12;
          this.blinkTimer = 0;
        }
      } else {
        const v = Math.sin(this.blinkProgress * Math.PI);
        this.setExpressionValue('blink', smoothstep(v));
      }
    }
  }

  // --- Subsystem 7: Emotional Expressions Crossfades ---

  _updateEmotions(delta) {
    if (!this.vrm?.expressionManager) return;
    const decay = 1 - Math.exp(-this.emotionCrossfadeSpeed * delta);

    for (const shape of EMOTION_SHAPE_NAMES) {
      const target = this.emotionTargets[shape] ?? 0;
      this.emotionCurrent[shape] += (target - this.emotionCurrent[shape]) * decay;
      this.setExpressionValue(shape, this.emotionCurrent[shape]);
    }
  }

  // --- Subsystem 8: Audio & Procedural Viseme Articulation ---

  _updateVisemes(delta) {
    if (!this.vrm?.expressionManager) return;

    const wTalking = this.stateWeights[CompanionState.TALKING];
    const hasAudio = this.lipSync && this.lipSync.isSpeaking && this.lipSync.currentVolume > 0.02;

    if (this.lipSync) {
      this.lipSync.update(delta);
    }

    if (wTalking > 0.05 && !hasAudio) {
      const talkPhase = this.breathClock * 13.0;
      const openA = Math.max(0, Math.sin(talkPhase)) * 0.6 * wTalking;
      const openI = Math.max(0, Math.sin(talkPhase * 0.8 + 1.2)) * 0.35 * wTalking;
      const openO = Math.max(0, Math.sin(talkPhase * 1.2 + 2.4)) * 0.4 * wTalking;

      this.setExpressionValue('aa', openA);
      this.setExpressionValue('ih', openI);
      this.setExpressionValue('oh', openO);
    } else if (!hasAudio) {
      this.setExpressionValue('aa', 0);
      this.setExpressionValue('ih', 0);
      this.setExpressionValue('oh', 0);
    }
  }

  // --- Master Animation Tick ---

  update(delta) {
    if (!this.vrm) return;

    // 1. Interpolate life state weights (IDLE, LISTENING, THINKING, TALKING)
    this._updateStateWeights(delta);

    // 2. Update THREE.AnimationMixer (if any active VRMA action is playing)
    if (this.mixer) {
      this.mixer.update(delta);
    }

    // 3. Layer biological respiration and full-body posture sway
    this._updateRespiration(delta);

    // 4. Layer LookAt 3D target tracking and saccadic gaze shifts
    this._updateLookAt(delta);

    // 5. Layer smooth head composition (LookAt + gesture + state nods)
    this._updateHeadComposition(delta);

    // 6. Layer procedural arms, wrists, fingers, and gesture posing
    this._updateArmsAndHands(delta);

    // 7. Layer procedural blinking
    this._updateBlink(delta);

    // 8. Layer emotion morph crossfades
    this._updateEmotions(delta);

    // 9. Layer audio-driven speech visemes
    this._updateVisemes(delta);

    // 10. Update VRM Core (spring bones, humanoid bones, LookAt applier, morph targets)
    this.vrm.update(delta);
  }

  dispose() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.vrm.scene);
    }
    if (this.lookAtTarget && this.scene) {
      this.scene.remove(this.lookAtTarget);
    }
    this.actions.clear();
    this.vrmaClips.clear();
  }
}
