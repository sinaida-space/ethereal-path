#version 300 es
// journey.frag — v1.1: the ring tunnel (#21).
// One continuous tunnel of turbulent, light-painted cyan filament on
// near-black — closed-form cylinder shading, NO volumetric march. The
// per-pixel cost is fixed (~3 noise stacks + optional inner shell), which is
// both cheaper than the v1.0 march and closer to the reference photographs:
// long-exposure light streaks swirling around a dark throat, and a luminous
// broken ring as the sacred object.
//
// HDR output: filament cores and ring arcs exceed the 0.7 bloom bright-pass;
// the dark walls stay far below it. Darkness is the canvas.
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2  uResolution;
uniform float uTime;
uniform float uProgress;
uniform vec3  uHead;      // normalized head offset, xy in [-1,1], z reserved
uniform vec4  uHandL;     // xy pos, z present, w unused
uniform vec4  uHandR;
uniform vec4  uRays[3];   // RING semantics (v1.1): x lateral offset,
                          // y arc completion 0..1, z flare, w fade alpha
uniform float uLight;
uniform float uBreathe;
uniform int   uSteps;     // quality proxy: inner shell only when uSteps > 40
uniform float uSurface;   // Act-0 (v1.2): 1 = at the surface (splash), eases
                          // to 0 on begin — the dive into the tunnel

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

// --- SCENE BODY (v1.1 ring tunnel) ---------------------------------------
// PALETTE — electric light on near-black.
const vec3 FIL_CYAN   = vec3(0.15, 0.72, 1.00);  // filament body
const vec3 FIL_TEAL   = vec3(0.20, 0.85, 0.90);  // act I watery cast
const vec3 FIL_DEEP   = vec3(0.10, 0.45, 0.85);  // act II colder blue
const vec3 FIL_VIOLET = vec3(0.55, 0.45, 1.00);  // act III cast
const vec3 RING_HOT   = vec3(0.85, 0.97, 1.05);  // ring arc, near-white
const vec3 STAR_WHITE = vec3(0.95, 0.97, 1.05);

const float MAXD = 40.0;   // throat depth: beyond this the tunnel is night

// ---- noise primitives (unchanged from v1.0) ----
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float hash3(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash3(i);
  float n100 = hash3(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash3(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash3(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash3(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash3(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash3(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash3(i + vec3(1.0, 1.0, 1.0));
  vec4 x = mix(vec4(n000, n010, n001, n011),
               vec4(n100, n110, n101, n111), f.x);
  vec2 y = mix(x.xz, x.yw, f.y);
  return mix(y.x, y.y, f.z);
}

// Single-cell soft points (stars / drifting motes) — see v1.0 notes: jitter
// confined to [R,1-R] of the cell keeps the field continuous with ONE lookup.
float moteLayer(vec3 q, float scale, float seed) {
  q = q * scale + seed;
  vec3 base = floor(q);
  vec3 f = q - base;
  float on = step(0.90, hash3(base + 3.7));
  float amp = 0.15 + 0.85 * pow(hash3(base + 7.7), 3.0);
  const float R = 0.30;
  vec3 jitter = vec3(hash3(base + 1.1), hash3(base + 2.2), hash3(base + 5.5));
  vec3 pt = R + (1.0 - 2.0 * R) * jitter;
  float d = length(f - pt);
  float fall = smoothstep(R, 0.0, d) * exp(-d * 10.0) * on * amp;
  float tw = 0.7 + 0.3 * sin(uTime * 2.0 + hash3(base) * 6.28);
  return fall * tw;
}

// ---- tunnel axis: a gently wandering centreline ----
vec2 axisAt(float z) {
  return vec2(0.35 * sin(z * 0.14) + 0.15 * sin(z * 0.043),
              0.22 * sin(z * 0.09 + 1.7));
}

// ---- closed-form wall hit: straight-cylinder solve, one curvature refine --
// Inside a cylinder of radius R around axisAt(z). Solve against the axis at
// the eye's z, then re-solve once against the axis at the first hit's z —
// two iterations track the mild curvature exactly enough.
float wallHit(Ray ray, float R) {
  float t = 4.0;
  for (int k = 0; k < 2; k++) {
    vec2 c = axisAt(ray.origin.z + ray.dir.z * t);
    vec2 oc = ray.origin.xy - c;
    float a = dot(ray.dir.xy, ray.dir.xy) + 1e-6;
    float b = 2.0 * dot(oc, ray.dir.xy);
    float cc = dot(oc, oc) - R * R;
    float disc = max(b * b - 4.0 * a * cc, 0.0);
    t = (-b + sqrt(disc)) / (2.0 * a);
  }
  return clamp(t, 0.0, MAXD);
}

// ---- filament field on a shell surface -----------------------------------
// Sampled seamlessly via a 3D embedding of (angle, along). Strands are the
// iso-band of warped noise, shaped by exp into thin bright streaks that
// stretch longitudinally — long-exposure light painting, not fog.
float filaments(vec3 hit, vec2 axis, float flowT, float swirl, float iso) {
  vec2 rel = hit.xy - axis;
  float ang = atan(rel.y, rel.x);
  // Anisotropic embedding: stretched along the tunnel so strands elongate.
  vec3 q = vec3(cos(ang) * 1.4, sin(ang) * 1.4, hit.z * 0.35 + flowT);
  float w = vnoise3(q * 1.1 + vec3(0.0, 0.0, flowT * 0.3));
  q.xy += swirl * (w - 0.5) * 1.8;              // the swirl of the streaks
  float v = vnoise3(q * 2.1) * 0.65 + w * 0.35;
  // Thin bright band where v crosses the iso line; K controls strand width.
  return exp(-abs(v - iso) * 34.0);
}

// ---- Act-0: at the surface (v1.2) -----------------------------------------
// Looking up from just under the water: a caustic-webbed ceiling, a soft sun,
// bubbles rising past. Two noise evals for the caustics + one mote layer —
// cheap, and only paid while uSurface > 0.
float causticWeb(vec2 uv, float t) {
  float n1 = vnoise3(vec3(uv * 2.0, t * 0.45));
  float n2 = vnoise3(vec3(uv * 2.0 + 5.7, t * 0.45 + 3.1));
  float c = 1.0 - abs(n1 - n2) * 2.4;
  return pow(clamp(c, 0.0, 1.0), 8.0);
}

vec3 surfaceScene(Ray ray) {
  vec3 d = normalize(ray.dir);
  // Deep aqua gradient: brighter toward the surface overhead.
  float up = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(vec3(0.015, 0.075, 0.13), vec3(0.07, 0.34, 0.44), pow(up, 1.6));

  // The water ceiling and its caustic webbing.
  if (d.y > 0.02) {
    float tC = (1.1 - ray.origin.y) / d.y;
    vec2 uv = (ray.origin + d * tC).xz;
    float c = causticWeb(uv, uTime);
    float fade = exp(-tC * 0.07);
    col += vec3(0.45, 0.9, 1.0) * c * fade * 1.25;
  }
  // Soft god-ray shafts slanting down from the sun side.
  float shaft = vnoise3(vec3(d.x * 4.0 - d.y * 2.0 + uTime * 0.06, d.z * 4.0, uTime * 0.05));
  col += vec3(0.30, 0.62, 0.72) * pow(shaft, 3.0) * clamp(d.y + 0.55, 0.0, 1.0) * 0.30;

  // Sun disk refracted through the surface — bright core crosses the bloom
  // threshold; soft halo stays ambient.
  vec3 sunDir = normalize(vec3(0.25, 1.0, -0.35));
  float sd = max(dot(d, sunDir), 0.0);
  col += vec3(0.95, 1.0, 0.95) * (pow(sd, 48.0) * 1.6 + pow(sd, 6.0) * 0.22);

  // Bubbles rising past the eye.
  vec3 bp = ray.origin + d * 2.5;
  col += vec3(0.8, 0.97, 1.05) * moteLayer(bp + vec3(0.0, -uTime * 0.45, 0.0), 3.0, 77.0) * 1.3;

  return col;
}

// ---- the ring: analytic torus glow with a growing arc ---------------------
vec3 ringGlow(Ray ray, vec4 R, float breatheGlow) {
  if (R.w < 0.01) return vec3(0.0);
  float zR = -5.5;
  float tR = (zR - ray.origin.z) / min(ray.dir.z, -1e-4);
  if (tR < 0.0) return vec3(0.0);
  vec2 center = axisAt(zR) + vec2(R.x * 0.45, 0.0);
  vec2 rel = (ray.origin + ray.dir * tR).xy - center;
  float rr = length(rel);

  float flare = clamp(R.z, 0.0, 1.0);
  float rad = 0.62 + flare * 0.25;              // flare breathes the ring out
  float dr = rr - rad;
  float band = exp(-dr * dr * 260.0);

  // Arc: drawn symmetrically from the top (12 o'clock), R.y of the full turn.
  float a = atan(rel.x, rel.y);                  // 0 at top, ±π at bottom
  float aa = abs(a);
  float arcEnd = clamp(R.y, 0.0, 1.0) * 3.14159265;
  float arc = 1.0 - smoothstep(arcEnd - 0.12, arcEnd + 0.04, aa);
  // Hot tips where the arc is currently growing (the broken-ring look).
  float tip = exp(-(aa - arcEnd) * (aa - arcEnd) * 60.0) * step(0.01, R.y) * 0.9;

  float pulse = 0.85 + 0.15 * sin(uTime * 2.2);
  float glow = band * (arc * 1.35 + tip) * pulse * breatheGlow;
  glow *= 1.0 + flare * 2.2;                     // completion flare
  // Soft interior wash when flared — the gate opening.
  glow += exp(-rr * rr * 3.0) * flare * 0.35;

  return RING_HOT * glow * R.w;
}

void main() {
  float aspect = uResolution.x / uResolution.y;
  Ray ray = setupRay(vUv, aspect);

  // ---- act moods (cross-faded; one tunnel, four weathers) ----
  float p = uProgress;
  float mWater = 1.0 - smoothstep(0.20, 0.35, p);
  float mDeep  = smoothstep(0.20, 0.35, p) * (1.0 - smoothstep(0.55, 0.70, p));
  float mStar  = smoothstep(0.55, 0.70, p) * (1.0 - smoothstep(0.93, 0.98, p));
  float mRet   = smoothstep(0.93, 0.98, p);

  float breatheGlow = 1.0 + (uBreathe - 0.5) * 0.30;
  float Rt = 1.0 * (1.0 + (uBreathe - 0.5) * 0.06);   // the tunnel breathes
  float flowT = uTime * 0.55;                          // streaks flow past

  // Mood-driven filament character.
  float swirl = 0.7 + 0.5 * mWater + 0.3 * mStar;      // wateriest at start
  float iso = 0.5 + 0.06 * mDeep;                      // deep act: sparser
  vec3 filCol = FIL_CYAN;
  filCol = mix(filCol, FIL_TEAL, mWater * 0.6);
  filCol = mix(filCol, FIL_DEEP, mDeep * 0.7);
  filCol = mix(filCol, FIL_VIOLET, mStar * 0.45);

  vec3 col = vec3(0.0);

  // ---- outer wall ----
  float tW = wallHit(ray, Rt);
  vec3 hitW = ray.origin + ray.dir * tW;
  vec2 axW = axisAt(hitW.z);
  float fW = filaments(hitW, axW, flowT, swirl, iso);
  // Watery caustic shimmer near the start: a second high-freq sparkle pass.
  float caustic = mWater * 0.5 *
    filaments(hitW, axW, flowT * 1.7 + 13.0, swirl * 1.6, 0.5);
  float depthFade = exp(-abs(hitW.z) * 0.085);
  // Grazing side-walls right beside the head stay dark — light lives ahead.
  float nearFade = smoothstep(0.3, 3.0, tW);
  // Dark base, thin hot cores: f² term carries the heat, f term a dim body.
  float wall = (fW * fW * 1.5 + fW * 0.18 + caustic * 0.6) * depthFade * nearFade;
  col += filCol * wall;
  // Whisper of wall ambient so the tunnel's shape never fully vanishes.
  col += filCol * 0.018 * depthFade * nearFade;

  // ---- inner translucent film (full/light tiers only: uSteps proxy) ----
  if (uSteps > 40) {
    float tS = wallHit(ray, Rt * 0.62);
    vec3 hitS = ray.origin + ray.dir * tS;
    float fS = filaments(hitS, axisAt(hitS.z), flowT * 1.25 + 41.0,
                         swirl * 1.2, iso + 0.03);
    col += filCol * fS * fS * 0.30 * exp(-abs(hitS.z) * 0.10);
  }

  // ---- drifting motes: one soft-point layer floating mid-tunnel ----
  vec3 mid = ray.origin + ray.dir * 3.0;
  col += STAR_WHITE * moteLayer(mid + vec3(0.0, uTime * 0.10, flowT), 2.2, 5.0)
         * 0.8 * (0.5 + 0.5 * mDeep);

  // ---- star dust on the walls in the third act ----
  if (mStar > 0.001) {
    col += STAR_WHITE * moteLayer(hitW + vec3(0.0, 0.0, flowT * 0.6), 4.0, 91.0)
           * 2.0 * mStar * depthFade;
  }

  // ---- the throat: night ahead — or the bright exit on the Return ----
  float throat = 1.0 - exp(-abs(hitW.z) * 0.085);      // 1 = far darkness
  vec3 throatCol = mix(vec3(0.0), vec3(0.85, 0.93, 1.0) * 1.2, mRet);
  col = mix(col, throatCol, throat * (0.75 + 0.25 * mRet));

  // ---- Act-0 crossfade: the surface passes overhead as we dive ----
  if (uSurface > 0.003) {
    col = mix(col, surfaceScene(ray), uSurface);
  }

  // ---- the ring (active station gate) ----
  col += ringGlow(ray, uRays[0], breatheGlow);

  // ---- return exhale + answered-light lift ----
  col = mix(col, col * 1.2 + vec3(0.10, 0.11, 0.12) * breatheGlow, mRet);
  col *= (1.0 + uLight * 0.25);

  // Fine grain breaks gradient banding in the glows.
  col += (hash(gl_FragCoord.xy + uTime) - 0.5) * 0.012;

  fragColor = vec4(col, 1.0);
}
// --- END SCENE BODY -----------------------------------------------------
