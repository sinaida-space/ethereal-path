// renderer.js — the load-bearing WebGL2 pipeline.
//
// Passes: scene (journey.frag -> HDR target) -> bright -> blur H -> blur V ->
// composite (to default framebuffer). Quality tiers control internal
// resolution scale, march steps, and bloom mode.
//
// Public API (other issues depend on these exact signatures):
//   new Renderer(canvas)         throws Error('webgl2-unavailable') if no WebGL2
//   await r.load()               fetch + compile all shaders
//   r.setQuality('full'|'light'|'potato')
//   r.frame(t, state)            render one frame; t in seconds
//   r.fps                        rolling average FPS

import { QUALITY } from '../config.js';
import {
  createProgram,
  uniformLocations,
  createFullscreenVAO,
  drawFullscreen,
  createRenderTarget,
  fetchText,
} from './glutil.js';

const SHADER_DIR = 'shaders/';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('webgl2-unavailable');
    this.gl = gl;

    this.floatSupported = !!gl.getExtension('EXT_color_buffer_float');

    this.tier = 'full';
    this.q = QUALITY.full;
    this.fps = 60;
    this._fpsAvg = 60;
    this._lastT = null;

    this.vao = createFullscreenVAO(gl);
    this.programs = {};
    this.loc = {};
    this._loaded = false;
  }

  async load() {
    const gl = this.gl;
    const [vert, journey, bright, blur, composite] = await Promise.all([
      fetchText(SHADER_DIR + 'common.vert'),
      fetchText(SHADER_DIR + 'journey.frag'),
      fetchText(SHADER_DIR + 'bright.frag'),
      fetchText(SHADER_DIR + 'blur.frag'),
      fetchText(SHADER_DIR + 'composite.frag'),
    ]);

    this.programs.scene = createProgram(gl, vert, journey, 'scene');
    this.programs.bright = createProgram(gl, vert, bright, 'bright');
    this.programs.blur = createProgram(gl, vert, blur, 'blur');
    this.programs.composite = createProgram(gl, vert, composite, 'composite');

    this.loc.scene = uniformLocations(gl, this.programs.scene, [
      'uResolution', 'uTime', 'uProgress', 'uHead', 'uHandL', 'uHandR',
      'uRays[0]', 'uLight', 'uBreathe', 'uSteps',
    ]);
    this.loc.bright = uniformLocations(gl, this.programs.bright, ['uScene']);
    this.loc.blur = uniformLocations(gl, this.programs.blur, [
      'uTex', 'uDirection', 'uTexel', 'uCheap',
    ]);
    this.loc.composite = uniformLocations(gl, this.programs.composite, [
      'uScene', 'uBloom', 'uStrength', 'uHasBloom',
    ]);

    // HDR scene target + two half-res bloom ping-pong targets.
    this.sceneRT = createRenderTarget(gl, 2, 2, true, this.floatSupported);
    this.bloomA = createRenderTarget(gl, 2, 2, true, this.floatSupported);
    this.bloomB = createRenderTarget(gl, 2, 2, true, this.floatSupported);

    this._loaded = true;
    this.resize();
    return this;
  }

  setQuality(tier) {
    if (!QUALITY[tier]) throw new Error(`unknown tier: ${tier}`);
    this.tier = tier;
    this.q = QUALITY[tier];
    if (this._loaded) this.resize();
  }

  // Match canvas backing store to CSS size, then size the render targets by
  // the tier scale. Bloom targets are half the scene size.
  resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }

    const scale = this.q.scale;
    const sw = Math.max(2, Math.round(cw * scale));
    const sh = Math.max(2, Math.round(ch * scale));
    this.sceneW = sw;
    this.sceneH = sh;

    this.sceneRT.resize(sw, sh);
    const bw = Math.max(1, sw >> 1);
    const bh = Math.max(1, sh >> 1);
    this.bloomA.resize(bw, bh);
    this.bloomB.resize(bw, bh);
  }

  frame(t, state) {
    const gl = this.gl;
    if (!this._loaded) return;

    // Rolling FPS.
    if (this._lastT !== null) {
      const dt = t - this._lastT;
      if (dt > 0) {
        const inst = 1 / dt;
        this._fpsAvg += (inst - this._fpsAvg) * 0.1;
        this.fps = Math.round(this._fpsAvg);
      }
    }
    this._lastT = t;

    // Keep backing store in sync with any CSS-size change.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    if (this.canvas.width !== cw) this.resize();

    this._scenePass(t, state);

    if (this.q.bloom === 'none') {
      this._compositePass(false);
    } else {
      this._brightPass();
      this._blurPass();
      this._compositePass(true);
    }
  }

  _scenePass(t, state) {
    const gl = this.gl;
    const rt = this.sceneRT;
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo);
    gl.viewport(0, 0, rt.width, rt.height);
    gl.useProgram(this.programs.scene);
    const L = this.loc.scene;

    gl.uniform2f(L.uResolution, rt.width, rt.height);
    gl.uniform1f(L.uTime, t);
    gl.uniform1f(L.uProgress, state.progress);
    gl.uniform3f(L.uHead, state.head.x, state.head.y, state.head.z);

    const hl = state.handL, hr = state.handR;
    gl.uniform4f(L.uHandL, hl.x, hl.y, hl.present, 0);
    gl.uniform4f(L.uHandR, hr.x, hr.y, hr.present, 0);

    // uRays[3]: xy pos, z taken, w active.
    const rays = new Float32Array(12);
    for (let i = 0; i < 3; i++) {
      const r = state.rays[i];
      if (r) {
        rays[i * 4 + 0] = r.x;
        rays[i * 4 + 1] = r.y;
        rays[i * 4 + 2] = r.taken || 0;
        rays[i * 4 + 3] = 1;
      }
    }
    gl.uniform4fv(L['uRays[0]'], rays);

    gl.uniform1f(L.uLight, state.light);
    gl.uniform1f(L.uBreathe, state.breathe);
    gl.uniform1i(L.uSteps, this.q.steps);

    drawFullscreen(gl, this.vao);
  }

  _brightPass() {
    const gl = this.gl;
    const dst = this.bloomA;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.width, dst.height);
    gl.useProgram(this.programs.bright);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneRT.tex);
    gl.uniform1i(this.loc.bright.uScene, 0);
    drawFullscreen(gl, this.vao);
  }

  _blurPass() {
    const gl = this.gl;
    const L = this.loc.blur;
    const cheap = this.q.bloom === 'cheap' ? 1 : 0;
    const bw = this.bloomA.width, bh = this.bloomA.height;
    gl.useProgram(this.programs.blur);
    gl.uniform1i(L.uCheap, cheap);
    gl.uniform2f(L.uTexel, 1 / bw, 1 / bh);
    gl.uniform1i(L.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);

    // Horizontal: bloomA -> bloomB.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomB.fbo);
    gl.viewport(0, 0, bw, bh);
    gl.uniform2f(L.uDirection, 1, 0);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomA.tex);
    drawFullscreen(gl, this.vao);

    // Vertical: bloomB -> bloomA.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fbo);
    gl.viewport(0, 0, bw, bh);
    gl.uniform2f(L.uDirection, 0, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomB.tex);
    drawFullscreen(gl, this.vao);
    // Final bloom now lives in bloomA.
  }

  _compositePass(hasBloom) {
    const gl = this.gl;
    const L = this.loc.composite;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.programs.composite);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneRT.tex);
    gl.uniform1i(L.uScene, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomA.tex);
    gl.uniform1i(L.uBloom, 1);

    gl.uniform1f(L.uStrength, this.tier === 'light' ? 1.1 : 1.4);
    gl.uniform1i(L.uHasBloom, hasBloom ? 1 : 0);
    drawFullscreen(gl, this.vao);
  }
}
