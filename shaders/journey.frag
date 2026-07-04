#version 300 es
// journey.frag — PLACEHOLDER scene (pipeline proof).
// #4/#6 replace the SCENE BODY below but MUST keep the OFF-AXIS CAMERA block
// and every uniform name intact. Output is HDR-ish (values may exceed 1.0) so
// the bloom chain has something to threshold.
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2  uResolution;
uniform float uTime;
uniform float uProgress;
uniform vec3  uHead;      // normalized head offset, xy in [-1,1], z reserved
uniform vec4  uHandL;     // xy pos, z present, w unused
uniform vec4  uHandR;
uniform vec4  uRays[3];   // xy pos, z taken, w active
uniform float uLight;
uniform float uBreathe;
uniform int   uSteps;

// --- OFF-AXIS CAMERA (do not modify in #4/#6) ---------------------------
// The screen is a fixed virtual window in world space at z = 0. The eye sits
// behind it, displaced laterally by the head offset. Each fragment shoots a
// ray from the eye THROUGH its point on the window, marching into -z. Moving
// the eye (uHead) reveals parallax because the window stays put — this is a
// window-into-a-world, not a look-around rotation.
const float VIEW_DIST = 1.2;

struct Ray { vec3 origin; vec3 dir; };

Ray setupRay(vec2 uv, float aspect) {
  vec2 WINDOW_HALF = vec2(aspect, 1.0) * 0.5;
  // Point on the virtual window this fragment maps to (world z = 0).
  vec3 windowPoint = vec3((uv * 2.0 - 1.0) * WINDOW_HALF, 0.0);
  // Eye sits behind the window (+z), shifted by the head offset.
  vec3 eye = vec3(uHead.xy * WINDOW_HALF, VIEW_DIST);
  Ray r;
  r.origin = eye;
  r.dir = normalize(windowPoint - eye);   // marches toward -z
  return r;
}
// --- END OFF-AXIS CAMERA ------------------------------------------------

// --- SCENE BODY (placeholder; #4/#6 replace this) -----------------------
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float valueNoise(vec3 p) {
  vec2 i = floor(p.xy + p.z);
  vec2 f = fract(p.xy + p.z);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fog2(vec3 p) {
  // 2-octave value noise, slowly drifting with time.
  float n = 0.6 * valueNoise(p * 1.3 + vec3(0.0, 0.0, uTime * 0.05));
  n += 0.4 * valueNoise(p * 2.7 - vec3(0.0, 0.0, uTime * 0.03));
  return n;
}

void main() {
  float aspect = uResolution.x / uResolution.y;
  Ray ray = setupRay(vUv, aspect);

  vec3 orbPos = vec3(0.0, 0.0, -3.0);
  float breathe = 1.0 + 0.25 * uBreathe;

  vec3 col = vec3(0.0);
  float transmittance = 1.0;

  int steps = uSteps;
  float dt = 0.09;                 // march step length
  float t = 0.05;

  for (int i = 0; i < 256; i++) {
    if (i >= steps) break;
    vec3 p = ray.origin + ray.dir * t;

    // Exponential distance fog, modulated by 2-octave noise.
    float dens = fog2(p) * 0.10;
    float absorb = exp(-t * 0.35);          // farther = thinner contribution
    vec3 fogTint = vec3(0.04, 0.07, 0.11);  // cool blue haze
    col += transmittance * fogTint * dens * absorb;
    transmittance *= (1.0 - dens * 0.5);

    // Sphere of light: pure exponential glow, no surface.
    float d = length(p - orbPos);
    float glow = exp(-d * 3.2) * breathe;
    vec3 orbTint = vec3(0.10, 0.75, 0.85);  // deep teal-blue
    col += transmittance * orbTint * glow * dt * 6.0;

    t += dt;
    if (transmittance < 0.02) break;
  }

  col *= (1.0 + uLight * 1.5);              // answered-questions brightness
  fragColor = vec4(col, 1.0);
}
// --- END SCENE BODY -----------------------------------------------------
