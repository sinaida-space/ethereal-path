#version 300 es
// blur.frag — separable Gaussian. Direction chosen by uDirection (H=(1,0),
// V=(0,1)). 9-tap when uCheap==0 (full tier), 5-tap when uCheap==1 (light tier
// runs a single combined pass). Radius scales with uTexel so it's resolution
// independent.
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTex;
uniform vec2 uDirection;   // (1,0) horizontal or (0,1) vertical
uniform vec2 uTexel;       // 1.0 / textureSize
uniform int  uCheap;       // 0 = 9-tap, 1 = 5-tap

void main() {
  vec2 step = uDirection * uTexel;
  vec3 acc = vec3(0.0);

  if (uCheap == 1) {
    // 5-tap Gaussian.
    float w0 = 0.2270270270;
    float w1 = 0.3162162162;
    float w2 = 0.0702702703;
    acc += texture(uTex, vUv).rgb * w0;
    acc += texture(uTex, vUv + step * 1.3846153846).rgb * w1;
    acc += texture(uTex, vUv - step * 1.3846153846).rgb * w1;
    acc += texture(uTex, vUv + step * 3.2307692308).rgb * w2;
    acc += texture(uTex, vUv - step * 3.2307692308).rgb * w2;
  } else {
    // 9-tap Gaussian.
    float weights[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
    acc += texture(uTex, vUv).rgb * weights[0];
    for (int i = 1; i < 5; i++) {
      vec2 off = step * float(i);
      acc += texture(uTex, vUv + off).rgb * weights[i];
      acc += texture(uTex, vUv - off).rgb * weights[i];
    }
  }
  fragColor = vec4(acc, 1.0);
}
