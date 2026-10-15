// three.js renderer / scene setup with a performance budget:
//  - pixel ratio capped (settings.pixelRatioCap, default 1.5; "low" quality forces 1)
//  - one shadow-casting directional light, shadow map size by quality (off on low)
//  - linear fog + gradient sky dome from the map palette (no textures)
//  - a separate view-model scene drawn after a depth clear (first-person gun)
//  - a single always-present point light used for muzzle/explosion flashes
//    (constant light count = no shader recompiles mid-game)

import * as THREE from "../../vendor/three.module.min.js";

const QUALITY = {
  low: { shadows: 0, antialias: false, maxPR: 1, aniso: 1 },
  medium: { shadows: 1024, antialias: false, maxPR: 1.25, aniso: 2 },
  high: { shadows: 2048, antialias: true, maxPR: 2, aniso: 4 },
};

export class Renderer {
  constructor(canvas, settings = {}) {
    this.canvas = canvas;
    this.settings = Object.assign({ quality: "high", pixelRatioCap: 1.5, fov: 75, shadows: true }, settings);
    this.q = QUALITY[this.settings.quality] || QUALITY.high;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: this.q.antialias, powerPreference: "high-performance", stencil: false, alpha: false,
    });
    const r = this.renderer;
    // Checking shader logs forces synchronous program links (a long stall per new material);
    // keep it for ?debug sessions only.
    r.debug.checkShaderErrors = typeof location !== "undefined" && /[?&]debug\b/.test(location.search);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = this._shadowsOn();
    r.shadowMap.type = THREE.PCFShadowMap;
    r.autoClear = true;
    r.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.05, 320);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);

    // lights
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x666666, 1.6);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = this._shadowsOn();
    this.scene.add(this.sun, this.sun.target);
    this.flash = new THREE.PointLight(0xffc070, 0, 10, 2);
    this.flash.position.set(0, -1000, 0);
    this.scene.add(this.flash);
    this.flashT = 0;
    this.flashPeak = 0;

    // sky dome
    this.skyUniforms = {
      top: { value: new THREE.Color(0x8fd3ff) },
      horizon: { value: new THREE.Color(0xd8f1ff) },
      bottom: { value: new THREE.Color(0xcdeeff) },
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vP;
        void main(){ float h = normalize(vP).y;
          vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h,0.0,1.0), 0.6)) : mix(horizon, bottom, clamp(-h*4.0,0.0,1.0));
          gl_FragColor = vec4(c, 1.0); }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 12), skyMat);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(0xcdeeff, 40, 130);

    // view-model scene
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
    this.vmHemi = new THREE.HemisphereLight(0xffffff, 0x666666, 1.8);
    this.vmSun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.vmSun.position.set(0.4, 1, 0.6);
    this.vmFlash = new THREE.PointLight(0xffc070, 0, 3, 2);
    this.vmFlash.position.set(0.2, -0.1, -0.9);
    this.vmScene.add(this.vmHemi, this.vmSun, this.vmFlash, this.vmCamera);

    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
  }

  _shadowsOn() { return this.q.shadows > 0 && this.settings.shadows !== false; }

  /** Apply palette (fog, sky, lights) and fit the shadow frustum to the map bounds. */
  setPalette(pal, bounds) {
    const col = (c, d) => new THREE.Color(c || d);
    this.skyUniforms.top.value = col(pal.sky, "#8fd3ff");
    this.skyUniforms.horizon.value = col(pal.skyHorizon || pal.sky, "#d8f1ff");
    this.skyUniforms.bottom.value = col(pal.fog || pal.skyHorizon, "#cdeeff");
    this.scene.fog.color = col(pal.fog, "#cdeeff");
    this.scene.fog.near = pal.fogNear ?? 40;
    this.scene.fog.far = pal.fogFar ?? 130;
    this.scene.background = col(pal.fog, "#cdeeff");
    this.hemi.color = col(pal.ambient, "#ffffff");
    this.hemi.groundColor = col(pal.hemiGround, "#777777");
    this.hemi.intensity = (pal.ambientIntensity ?? 0.6) * 2.6;
    this.sun.color = col(pal.sun, "#ffffff");
    this.sun.intensity = (pal.sunIntensity ?? 1) * 2.4;
    this.vmHemi.color.copy(this.hemi.color);
    this.vmHemi.groundColor.copy(this.hemi.groundColor);
    this.vmHemi.intensity = this.hemi.intensity * 0.9;
    this.vmSun.color.copy(this.sun.color);
    this.vmSun.intensity = this.sun.intensity * 0.8;

    const d = pal.sunDir || [-0.4, -1, -0.3];
    const L = Math.hypot(d[0], d[1], d[2]) || 1;
    const mn = bounds.min, mx = bounds.max;
    const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
    const half = Math.hypot(mx[0] - mn[0], mx[2] - mn[2]) / 2;
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx - (d[0] / L) * 80, -(d[1] / L) * 80, cz - (d[2] / L) * 80);
    const sc = this.sun.shadow.camera;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
    sc.near = 1; sc.far = 200;
    sc.updateProjectionMatrix();
    this.sun.shadow.mapSize.set(this.q.shadows || 512, this.q.shadows || 512);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.sun.shadow.needsUpdate = true;
  }

  applySettings(s) {
    const prevQ = this.settings.quality, prevSh = this.settings.shadows;
    Object.assign(this.settings, s);
    this.q = QUALITY[this.settings.quality] || QUALITY.high;
    if (prevQ !== this.settings.quality || prevSh !== this.settings.shadows) {
      const on = this._shadowsOn();
      this.renderer.shadowMap.enabled = on;
      this.sun.castShadow = on;
      this.sun.shadow.mapSize.set(this.q.shadows || 512, this.q.shadows || 512);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      // materials must recompile for the shadow change
      this.scene.traverse((o) => { if (o.material) { for (const m of [].concat(o.material)) m.needsUpdate = true; } });
    }
    this.resize();
  }

  pixelRatio() {
    const cap = Math.min(this.settings.pixelRatioCap ?? 1.5, this.q.maxPR);
    return Math.max(0.5, Math.min(window.devicePixelRatio || 1, cap));
  }

  resize() {
    const c = this.canvas;
    const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = this.camera.aspect;
    this.vmCamera.updateProjectionMatrix();
    this.width = w; this.height = h;
  }

  /** Trigger a light flash at (x,y,z). */
  flashAt(x, y, z, intensity = 6, dist = 10, dur = 0.06, color = 0xffc070) {
    if (intensity < this.flashPeak * (this.flashT > 0 ? 0.5 : 0)) return;
    this.flash.position.set(x, y, z);
    this.flash.distance = dist;
    this.flash.color.set(color);
    this.flashPeak = intensity;
    this.flashT = dur;
    this.flashDur = dur;
  }

  update(dt) {
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.intensity = Math.max(0, this.flashPeak * (this.flashT / this.flashDur));
    } else this.flash.intensity = 0;
    if (this.vmFlash.intensity > 0) this.vmFlash.intensity = Math.max(0, this.vmFlash.intensity - dt * 60);
    this.sky.position.copy(this.camera.position);
  }

  render(drawViewModel = true) {
    const r = this.renderer;
    r.info.reset();
    r.render(this.scene, this.camera);
    if (drawViewModel) {
      r.autoClear = false;
      r.clearDepth();
      r.render(this.vmScene, this.vmCamera);
      r.autoClear = true;
    }
  }

  dispose() {
    window.removeEventListener("resize", this._onResize);
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) for (const m of [].concat(o.material)) m.dispose();
    });
    this.renderer.dispose();
    // release the WebGL context now: browsers cap live contexts (~16) and drop the oldest one
    this.renderer.forceContextLoss();
  }
}
