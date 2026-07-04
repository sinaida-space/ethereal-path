#version 300 es
// composite.frag — final pass. Adds bloom to the scene, applies a subtle
// vignette, and tone-maps softly to the [0,1] display range.
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uStrength;    // bloom mix strength
uniform int   uHasBloom;    // 0 = scene only (bloom:'none')

void main() {
  vec3 scene = texture(uScene, vUv).rgb;
  vec3 col = scene;
  if (uHasBloom == 1) {
    col += texture(uBloom, vUv).rgb * uStrength;
  }

  // Subtle vignette.
  vec2 d = vUv - 0.5;
  float vig = smoothstep(0.9, 0.35, dot(d, d) * 2.2);
  col *= mix(0.75, 1.0, vig);

  // Soft Reinhard tone map to keep HDR highlights in range.
  col = col / (col + vec3(1.0));
  col = pow(col, vec3(1.0 / 2.2));   // gamma
  fragColor = vec4(col, 1.0);
}
