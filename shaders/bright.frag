#version 300 es
// bright.frag — soft-threshold bright pass for bloom. Keeps only the parts of
// the scene above ~0.7 luminance, with a soft knee so the transition isn't hard.
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uScene;

const float THRESHOLD = 0.7;
const float KNEE = 0.3;

void main() {
  vec3 c = texture(uScene, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Soft knee: quadratic ramp across [THRESHOLD-KNEE, THRESHOLD+KNEE].
  float soft = clamp((l - THRESHOLD + KNEE) / (2.0 * KNEE), 0.0, 1.0);
  soft = soft * soft;
  float contrib = max(soft, step(THRESHOLD, l));
  fragColor = vec4(c * contrib, 1.0);
}
