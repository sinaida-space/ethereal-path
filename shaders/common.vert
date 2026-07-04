#version 300 es
// Fullscreen triangle. No attributes: positions derived from gl_VertexID.
// Covers the whole clip space with one oversized triangle (verts at
// (-1,-1), (3,-1), (-1,3)); the region outside [-1,1] is clipped away.
precision highp float;

out vec2 vUv;

void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;                       // 0..2, so 0..1 across the visible screen
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
