// glutil.js — low-level WebGL2 helpers: shader compile/link, fullscreen-triangle
// VAO, and float render targets. Shared by renderer.js and benchmark.js.

export function compileShader(gl, type, src, label = 'shader') {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`${label} compile failed:\n${log}`);
  }
  return sh;
}

export function createProgram(gl, vertSrc, fragSrc, label = 'program') {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc, `${label}.vert`);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc, `${label}.frag`);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`${label} link failed:\n${log}`);
  }
  return prog;
}

// Cache uniform locations for a program keyed by name.
export function uniformLocations(gl, prog, names) {
  const map = {};
  for (const n of names) map[n] = gl.getUniformLocation(prog, n);
  return map;
}

// A single fullscreen triangle needs no vertex buffer: the vertex shader
// derives clip-space positions from gl_VertexID. We still bind an empty VAO
// so draw calls are valid in WebGL2 core profile.
export function createFullscreenVAO(gl) {
  const vao = gl.createVertexArray();
  return vao;
}

export function drawFullscreen(gl, vao) {
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
}

// A render target: framebuffer + single color texture. `float` selects RGBA16F
// when supported, else falls back to RGBA8. Returns an object with a resize().
export function createRenderTarget(gl, w, h, float, floatSupported) {
  const useFloat = float && floatSupported;
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();

  const rt = {
    fbo,
    tex,
    width: w,
    height: h,
    float: useFloat,
    resize(nw, nh) {
      this.width = nw;
      this.height = nh;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const internal = useFloat ? gl.RGBA16F : gl.RGBA8;
      const kind = useFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, nw, nh, 0, gl.RGBA, kind, null);
    },
  };

  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  rt.resize(w, h);

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return rt;
}

export async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.text();
}
