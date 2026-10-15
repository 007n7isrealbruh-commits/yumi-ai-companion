/**
 * frontend/js/vrmManager.js
 * High-performance 3D VRM Runtime Engine.
 *
 * Upgrades:
 * - Integration with centralized AnimationManager (IDLE, LISTENING, THINKING, TALKING).
 * - Full 360-degree OrbitControls with free zoom, orbiting, damping, and multi-touch support.
 * - Non-conflicting programmatic camera transitions that instantly yield to user orbit/zoom inputs.
 * - Native @pixiv/three-vrm-animation and THREE.AnimationMixer plugin support for VRMA loading.
 * - Dynamic VRM LookAt targeting with natural cervical lag and eye saccades.
 * - Comprehensive error containment ensuring the render loop never freezes.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import {
  AnimationManager,
  CompanionState,
  EMOTION_PRESETS,
  GESTURE_EULER_POSES,
} from './animationManager.js';

function smoothstep(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

// Camera Framing Presets (Calibrated for Full-Body & Clean Companion Viewport)
export const CAMERA_PRESETS = Object.freeze({
  full: {
    landscape: {
      target: new THREE.Vector3(0, 0.76, 0),
      position: new THREE.Vector3(0, 0.76, 2.75),
      fov: 32,
    },
    portrait: {
      target: new THREE.Vector3(0, 0.74, 0),
      position: new THREE.Vector3(0, 0.74, 2.85),
      fov: 33,
    },
  },
  waist: {
    landscape: {
      target: new THREE.Vector3(0, 1.05, 0),
      position: new THREE.Vector3(0, 1.05, 1.95),
      fov: 28,
    },
    portrait: {
      target: new THREE.Vector3(0, 1.02, 0),
      position: new THREE.Vector3(0, 1.02, 1.85),
      fov: 28,
    },
  },
  portrait: {
    landscape: {
      target: new THREE.Vector3(0, 1.32, 0),
      position: new THREE.Vector3(0, 1.32, 1.15),
      fov: 25,
    },
    portrait: {
      target: new THREE.Vector3(0, 1.30, 0),
      position: new THREE.Vector3(0, 1.30, 1.10),
      fov: 26,
    },
  },
});

export function getCameraPresetConfig(presetName = 'full', isPortrait = null) {
  if (isPortrait === null && typeof window !== 'undefined') {
    isPortrait = window.innerWidth < window.innerHeight;
  }
  const group = CAMERA_PRESETS[presetName] || CAMERA_PRESETS.full;
  const config = isPortrait ? group.portrait : group.landscape;
  return {
    target: config.target.clone(),
    position: config.position.clone(),
    fov: config.fov,
  };
}

export class VrmManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.currentVrm = null;
    this.lipSync = null;

    // Camera Framing State (Default: full body so entire avatar is visible on screen)
    this.currentCameraPreset = 'full';
    const isPortrait = typeof window !== 'undefined' ? window.innerWidth < window.innerHeight : false;
    const initial = getCameraPresetConfig('full', isPortrait);
    this.camStartPos = new THREE.Vector3();
    this.camStartLook = new THREE.Vector3();
    this.camStartFov = initial.fov;
    this.camTargetPos = initial.position.clone();
    this.camTargetLook = initial.target.clone();
    this.camTargetFov = initial.fov;
    this.camTransitionProgress = 1.0;
    this.isTransitioningCamera = false;
    this.isOrbiting = false;

    // Interaction Raycaster
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.onTouchReaction = null;

    this._initScene();

    // Centralized Animation Engine
    this.animationManager = new AnimationManager({
      scene: this.scene,
      camera: this.camera,
    });

    this._animate();
  }

  attachLipSync(lipSync) {
    this.lipSync = lipSync;
    if (this.animationManager) {
      this.animationManager.attachLipSync(lipSync);
    }
  }

  _initScene() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene = new THREE.Scene();

    const isPortrait = window.innerWidth < window.innerHeight;
    const initial = getCameraPresetConfig('full', isPortrait);
    this.camera = new THREE.PerspectiveCamera(
      initial.fov,
      window.innerWidth / window.innerHeight,
      0.1,
      30
    );
    this.camera.position.copy(initial.position);

    // OrbitControls: Full 360-degree orbit, smooth damping, responsive zoom
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(initial.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.2;
    this.controls.maxDistance = 8.0;
    this.controls.minPolarAngle = 0.01;
    this.controls.maxPolarAngle = Math.PI - 0.01;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.enableZoom = true;
    this.controls.zoomSpeed = 1.2;
    this.controls.enableRotate = true;
    this.controls.rotateSpeed = 0.9;
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };

    // Prevent programmatic camera transitions from fighting user gestures
    const cancelCameraTransition = () => {
      this.isTransitioningCamera = false;
    };

    this.controls.addEventListener('start', () => {
      this.isOrbiting = true;
      cancelCameraTransition();
    });
    this.controls.addEventListener('end', () => {
      this.isOrbiting = false;
    });

    this.canvas.addEventListener('wheel', cancelCameraTransition, { passive: true });
    this.canvas.addEventListener('pointerdown', cancelCameraTransition, { passive: true });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.controls.update();

    // Studio 3-Point Lighting Rig
    const keyLight = new THREE.DirectionalLight(0xfff6ee, 1.85);
    keyLight.position.set(1.4, 2.2, 1.8);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xd8eaff, 0.95);
    fillLight.position.set(-1.8, 1.2, -0.6);
    this.scene.add(fillLight);

    const rimLight = new THREE.PointLight(0x00f2fe, 1.6, 7.5);
    rimLight.position.set(0, 1.8, -1.8);
    this.scene.add(rimLight);

    const sakuraRim = new THREE.PointLight(0xff758c, 0.85, 5.0);
    sakuraRim.position.set(1.2, 1.1, -1.2);
    this.scene.add(sakuraRim);

    const ambient = new THREE.AmbientLight(0xffffff, 0.98);
    this.scene.add(ambient);

    // Touch / Click Raycasting for Physical Feedback
    let isDragging = false;
    let downX = 0, downY = 0;
    this.canvas.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
      isDragging = false;
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) {
        isDragging = true;
      }
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!isDragging && e.button === 0) this._onClick(e);
    });

    window.addEventListener('resize', () => this._onResize());
  }

  _onClick(event) {
    if (!this.currentVrm || !this.onTouchReaction) return;
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.currentVrm.scene.children, true);

    if (intersects.length > 0) {
      const hit = intersects[0];
      const coords = { clientX: event.clientX, clientY: event.clientY, point: hit.point };
      if (hit.point && hit.point.y >= 1.22) {
        this.onTouchReaction('head', coords);
      } else {
        this.onTouchReaction('body', coords);
      }
    }
  }

  _onResize() {
    const width = window.innerWidth || this.canvas.clientWidth || 360;
    const height = window.innerHeight || this.canvas.clientHeight || 640;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);

    if (!this.isOrbiting && !this.isTransitioningCamera) {
      const isPortrait = width < height;
      const preset = getCameraPresetConfig(this.currentCameraPreset, isPortrait);
      const currentDist = this.camera.position.distanceTo(this.controls.target);
      const presetDist = preset.position.distanceTo(preset.target);
      if (Math.abs(currentDist - presetDist) < 0.8) {
        this.camera.position.copy(preset.position);
        this.controls.target.copy(preset.target);
        this.camera.fov = preset.fov;
        this.camera.updateProjectionMatrix();
      }
    }
  }

  setCameraPreset(name) {
    const isPortrait = window.innerWidth < window.innerHeight;
    const preset = getCameraPresetConfig(name, isPortrait);
    if (!preset) return;

    this.currentCameraPreset = name;
    this.camStartPos.copy(this.camera.position);
    this.camStartLook.copy(this.controls.target);
    this.camStartFov = this.camera.fov;

    this.camTargetPos.copy(preset.position);
    this.camTargetLook.copy(preset.target);
    this.camTargetFov = preset.fov;

    this.camTransitionProgress = 0;
    this.isTransitioningCamera = true;
  }

  _updateCamera(delta) {
    if (this.isOrbiting || !this.isTransitioningCamera) {
      return;
    }

    this.camTransitionProgress += delta / 0.65; // Smooth 0.65s transition
    if (this.camTransitionProgress >= 1.0) {
      this.camera.position.copy(this.camTargetPos);
      this.controls.target.copy(this.camTargetLook);
      this.camera.fov = this.camTargetFov;
      this.camera.updateProjectionMatrix();
      this.isTransitioningCamera = false;
    } else {
      const t = smoothstep(this.camTransitionProgress);
      this.camera.position.lerpVectors(this.camStartPos, this.camTargetPos, t);
      this.controls.target.lerpVectors(this.camStartLook, this.camTargetLook, t);
      this.camera.fov = THREE.MathUtils.lerp(this.camStartFov, this.camTargetFov, t);
      this.camera.updateProjectionMatrix();
    }
  }

  async loadVrmFromUrl(url, onProgress = null) {
    const loader = new GLTFLoader();
    loader.crossOrigin = 'anonymous';
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    if (this.currentVrm) {
      this.scene.remove(this.currentVrm.scene);
      try {
        VRMUtils.deepDispose(this.currentVrm.scene);
      } catch (e) { /* ignore */ }
      this.currentVrm = null;
    }

    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          try {
            const vrm = gltf.userData?.vrm;
            if (!vrm) {
              console.error('[VRM] No VRM instance found in asset:', url);
              reject(new Error('Loaded asset does not contain a valid VRM model.'));
              return;
            }

            // Disable frustum culling so camera zoom/framing never culls avatar parts
            vrm.scene.traverse((obj) => {
              obj.frustumCulled = false;
            });

            try {
              VRMUtils.removeUnnecessaryVertices(gltf.scene);
              VRMUtils.removeUnnecessaryJoints(gltf.scene);
            } catch (e) { /* ignore */ }

            VRMUtils.rotateVRM0(vrm);
            this.scene.add(vrm.scene);
            this.currentVrm = vrm;

            // Bind VRM into Centralized AnimationManager
            this.animationManager.bindVrm(vrm);

            // Update humanoid skinning matrices immediately
            if (this.currentVrm.humanoid) {
              this.currentVrm.humanoid.update();
            }
            this.currentVrm.update(0.016);

            this._onResize();
            this.renderer.render(this.scene, this.camera);

            if (typeof onProgress === 'function') {
              onProgress(100, 100, 100);
            }

            console.log(`[VRM] Loaded successfully: ${url} (Meta Version: ${vrm.meta?.metaVersion || '0'})`);
            resolve(vrm);
          } catch (innerErr) {
            console.error('[VRM] Error configuring loaded VRM model:', innerErr);
            reject(innerErr);
          }
        },
        (progress) => {
          if (typeof onProgress === 'function' && progress) {
            if (progress.total > 0) {
              const pct = Math.min(99, Math.round((progress.loaded / progress.total) * 100));
              onProgress(pct, progress.loaded, progress.total);
            } else if (progress.loaded > 0) {
              const estimatedTotal = 11 * 1024 * 1024;
              const pct = Math.min(90, Math.round((progress.loaded / estimatedTotal) * 100));
              onProgress(pct, progress.loaded, estimatedTotal);
            }
          }
        },
        (error) => {
          console.error('[VRM] GLTFLoader error loading VRM:', error);
          reject(error);
        }
      );
    });
  }

  // --- Public API Forwarding to AnimationManager ---

  setStatus(status) {
    if (status === 'talking' || (this.lipSync && this.lipSync.isSpeaking)) {
      this.animationManager.setState(CompanionState.TALKING);
    } else if (status === 'listening') {
      this.animationManager.setState(CompanionState.LISTENING);
    } else if (status === 'thinking' || status === 'synthesizing_voice') {
      this.animationManager.setState(CompanionState.THINKING);
    } else if (status === 'idle') {
      if (!this.lipSync || !this.lipSync.isSpeaking) {
        this.animationManager.setState(CompanionState.IDLE);
      }
    }
  }

  setEmotion(emotionName) {
    this.animationManager.setEmotion(emotionName);
  }

  setExpressionValue(name, value) {
    this.animationManager.setExpressionValue(name, value);
  }

  playGesture(poseName) {
    this.animationManager.playGesture(poseName);
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

  getAvailableEmotions() {
    return Object.keys(EMOTION_PRESETS);
  }

  getAvailableGestures() {
    return Object.keys(GESTURE_EULER_POSES).filter((k) => k !== 'neutral');
  }

  get blinkEnabled() {
    return this.animationManager.blinkEnabled;
  }

  set blinkEnabled(v) {
    this.animationManager.blinkEnabled = Boolean(v);
  }

  get lookAtEnabled() {
    return this.animationManager.lookAtEnabled;
  }

  set lookAtEnabled(v) {
    this.animationManager.lookAtEnabled = Boolean(v);
  }

  // VRMA Loading API
  async loadVrma(urlOrFile, customName = '') {
    return await this.animationManager.loadVrma(urlOrFile, customName);
  }

  playAnimationClip(clipOrName, duration = 0.5) {
    return this.animationManager.playAnimationClip(clipOrName, duration);
  }

  stopAnimationClip(duration = 0.4) {
    this.animationManager.stopAnimationClip(duration);
  }

  getLoadedVrmaClips() {
    return this.animationManager.getLoadedVrmaClips();
  }

  captureSnapshot(format = 'image/png', quality = 0.95) {
    try {
      this.renderer.render(this.scene, this.camera);
      return this.canvas.toDataURL(format, quality);
    } catch (e) {
      console.error('Failed to capture VRM snapshot:', e);
      return null;
    }
  }

  // --- Unified Animation Render Loop ---

  _animate() {
    requestAnimationFrame(() => this._animate());

    if (this.canvas.style.display === 'none') {
      return;
    }

    try {
      const delta = Math.min(this.clock.getDelta(), 0.045);

      // 1. Centralized Animation Engine (States, Respiration, LookAt, Blinking, Gestures, Visemes, Springbones)
      if (this.animationManager) {
        this.animationManager.update(delta);
      }

      // 2. Camera Framing Director & OrbitControls
      this._updateCamera(delta);
      this.controls.update();

      // 3. WebGL Render
      this.renderer.render(this.scene, this.camera);
    } catch (animErr) {
      console.error('[VRM Animate Error]:', animErr);
    }
  }
}
