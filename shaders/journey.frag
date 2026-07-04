#version 300 es
// journey.frag — Acts I–II: fractal water surface + the deep (#4).
// Single-pass volumetric march beneath a fractal water plane, descending into a
// bioluminescent abyss. HDR output (values exceed 1.0) so the bloom chain
// (bright-pass threshold 0.7) can threshold: anything meant to GLOW exceeds 0.7,
// ambient fog stays below it. Act III / nebula is #7 — here uProgress>0.6 just
// lets Act II continue.
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

// --- SCENE BODY (Acts I–II) ---------------------------------------------
//
// Structure:
//   hash / vnoise / fbm  — procedural noise primitives (NO texture fetches).
//   pathX / cameraFrame  — the drifting, curving path the eye travels.
//   waterSurface         — Act I: analytic ray/plane intersect + FBM-shaded
//                          underside with refracted sun glow, god-rays, rim.
//   godRayCones          — analytic light shafts (cone falloff, not marched).
//   moteField            — Act II: grid-cell bioluminescent sparkle (1 cell/sample).
//   floraSilhouette      — Act II: SDF kelp ribbons, dark against the light.
//   main                 — one volumetric march; surface shaded OUTSIDE the loop.
//
// PALETTE — abyssal, no saturated primaries. Darkness is the canvas.
const vec3 BASE_NEAR = vec3(0.012, 0.047, 0.063); // #03141a  shallow abyss
const vec3 BASE_FAR  = vec3(0.008, 0.024, 0.031); // #020608  deep abyss
const vec3 RAY_CYAN  = vec3(0.55, 0.85, 1.00);    // cold pale cyan god-rays
const vec3 MOTE_WARM = vec3(1.00, 0.86, 0.82);    // warm-white motes
const vec3 MOTE_PINK = vec3(1.00, 0.72, 0.86);    // faint pink-violet at depth

// ---- noise primitives ----
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

// 2D value noise (for the water heightfield, evaluated OUTSIDE the march loop).
float vnoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// 3D value noise (for motes / fog inside the loop). One octave = cheap.
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

// 4-octave FBM of 2D value noise, domain-warped once. Water heightfield only —
// runs a single time per fragment (outside the march), so the octave count here
// does NOT count against the per-sample budget.
float waterFBM(vec2 p) {
  float t = uTime * 0.08;
  // domain warp: one cheap noise lookup nudges the coordinates.
  vec2 warp = vec2(vnoise2(p * 0.7 + t),
                   vnoise2(p * 0.7 - t + 11.3));
  p += (warp - 0.5) * 1.6;
  float amp = 0.5, sum = 0.0, norm = 0.0;
  vec2 q = p;
  for (int o = 0; o < 4; o++) {
    sum  += amp * vnoise2(q + vec2(0.0, t * 0.5));
    norm += amp;
    q *= 2.03;
    amp *= 0.5;
  }
  return sum / norm; // 0..1
}

// ---- the drifting, curving path ----
// Lateral curve of the journey. camera follows it so the head must lean/turn to
// peer around the bends; head parallax (camera block) stays on top of this.
float pathX(float z) {
  return 1.2 * sin(z * 0.08) + 0.6 * sin(z * 0.023);
}

// ---- Act I: fractal water surface (analytic, NOT marched) ----
// Plane at y = surfaceY. We intersect the ray once, shade the underside, and
// return premultiplied radiance + how much it occludes the deep behind it.
const float SURFACE_Y = 2.5;

vec3 shadeSurface(Ray ray, vec3 sunDir, float breatheFog, float breatheGlow,
                  float act1, out float surfMask) {
  surfMask = 0.0;
  // Ray/plane intersection (plane y = SURFACE_Y, marching upward toward +y?).
  // Eye is near y≈0, surface is overhead at +2.5; ray.dir.y may be + or -.
  float denom = ray.dir.y;
  if (abs(denom) < 1e-4) return vec3(0.0);
  float tHit = (SURFACE_Y - ray.origin.y) / denom;
  if (tHit <= 0.0) return vec3(0.0); // surface behind us / below horizon
  vec3 hit = ray.origin + ray.dir * tHit;

  // Heightfield + numerical normal from waterFBM (finite differences).
  vec2 uv = hit.xz * 0.6;
  float e = 0.15;
  float h  = waterFBM(uv);
  float hx = waterFBM(uv + vec2(e, 0.0));
  float hz = waterFBM(uv + vec2(0.0, e));
  // Underside normal points down (-y) with FBM-driven tilt.
  vec3 nrm = normalize(vec3(-(hx - h) / e, -1.0, -(hz - h) / e));

  // (a) Sun-disc glow refracted through the surface: exponential falloff around
  // the down-refracted sun direction. exp(-d*k), no pow.
  float sunAlign = max(dot(ray.dir, sunDir), 0.0);
  float d = 1.0 - sunAlign;                 // 0 at sun centre
  // Slender refracted disc: tight core crosses the 0.7 bloom threshold, the
  // halo is narrow and dim so it does NOT blow out the fog into a milky cone.
  float sunGlow = exp(-d * 60.0) * (1.4 * breatheGlow);   // tight bright core
  sunGlow += exp(-d * 16.0) * 0.20 * breatheGlow;         // narrow dim halo

  // (b) Normal-based rim shimmer: grazing angles catch cold light.
  float fres = 1.0 - abs(dot(ray.dir, nrm));
  float shimmer = exp(-(1.0 - fres) * 4.0) * (0.10 + 0.20 * h);

  // Surface tint: cold cyan where the sun shows through, dim base elsewhere.
  vec3 col = RAY_CYAN * (sunGlow + shimmer * 0.6);
  col += BASE_NEAR * 0.6; // faint ambient membrane, stays well below 0.7

  // Distance haze: far patches of surface wash into fog.
  float haze = exp(-tHit * 0.06 * breatheFog);
  col *= haze;

  // Occlusion of the deep behind the surface: only the bright sun region and
  // brighter foam meaningfully block; most of the membrane is translucent.
  surfMask = clamp(sunGlow * 0.5 + shimmer * 0.3, 0.0, 0.9) * act1;
  return col * act1;
}

// ---- Volumetric god-rays: analytic cones (NOT shadow-marched) ----
// Each ray shaft is a slanted cone; we accumulate its cross-shaft falloff along
// the view ray. uRays[i].xy positions it; .z (taken) condenses the shaft into a
// bright slow-pulsing point; .w activates it.
vec3 godRayContribution(vec3 p, vec3 sunDir, float act1, float act2,
                        float breatheGlow) {
  vec3 acc = vec3(0.0);
  // Shafts get rarer, colder, more vertical in Act II.
  float vertical = mix(0.0, 1.0, act2);          // 0 in Act I, 1 in deep
  vec3 shaftDir = normalize(mix(sunDir, vec3(0.0, -1.0, 0.0), vertical));
  float count = mix(3.0, 1.6, act2);             // rarer in the deep

  for (int i = 0; i < 3; i++) {
    if (float(i) >= count) break;
    vec4 R = uRays[i];
    if (R.w < 0.5) continue;
    // Map ray xy [-1,1] into a world anchor high above, near the surface.
    vec3 anchor = vec3(R.x * 3.0 + pathX(p.z), SURFACE_Y, p.z + R.y * 3.0);
    // Perpendicular distance from p to the shaft line through anchor.
    vec3 rel = p - anchor;
    float along = dot(rel, shaftDir);
    vec3 perp = rel - shaftDir * along;
    float dperp = length(perp);

    // SLENDER shaft: narrow, BOUNDED cone. radius stays small and its growth
    // with depth is capped so the shaft never becomes a half-plane wedge.
    // width ~4-6x tighter than before; pure smooth exponential of perp dist.
    float radius = 0.10 + 0.05 * clamp(along, 0.0, 6.0);   // capped growth
    float k = dperp / radius;
    float shaft = exp(-k * k * 3.0);                       // tight core, ->0 fast

    // Finite shaft length: bright only between the surface and a soft cutoff,
    // smoothly windowed at both ends (no unbounded half-space).
    shaft *= smoothstep(-1.0, 1.5, along);                 // fade in below surface
    shaft *= 1.0 - smoothstep(7.0, 12.0, along);           // fade out with depth

    // .z (taken): condense the whole shaft into a bright slow-pulsing point.
    float taken = clamp(R.z, 0.0, 1.0);
    if (taken > 0.001) {
      float dpt = length(rel);
      float pulse = 0.6 + 0.4 * sin(uTime * 3.14159); // ~2s period
      float pt = exp(-dpt * 5.5) * pulse;
      shaft = mix(shaft, pt * 2.0, taken);
    }

    // Colder + slightly brighter as Act II deepens; breathe modulates glow.
    vec3 tint = mix(RAY_CYAN, RAY_CYAN * vec3(0.8, 0.95, 1.15), act2);
    // Peak tuned so only the shaft CORE crosses the 0.7 bloom threshold.
    acc += tint * shaft * 0.9 * breatheGlow;
  }
  // Rays fade with the surface in Act I, thin out but persist in Act II.
  return acc * mix(1.0, 0.7, act2);
}

// ---- Act II: bioluminescent motes (grid-cell hashing) ----
// Sparse 3D sparkle advected slowly upward. Each mote is a SOFT point with
// FINITE support: brightness reaches ~0 well before the cell edge (influence
// radius < 0.5 cell). We scan the 3x3x3 neighborhood so a mote near a cell
// boundary still lights adjacent samples continuously — NO hard cell squares.
vec3 moteField(vec3 p, float act2) {
  if (act2 < 0.01) return vec3(0.0);
  // Advect the field upward over time (motes drift up past the descending eye).
  vec3 q = p + vec3(0.0, uTime * 0.15, 0.0);
  vec3 base = floor(q);
  vec3 f = q - base;                   // position within the base cell [0,1)

  float spark = 0.0;
  // 3x3x3 = 27 cheap hash lookups, no noise octaves — well within budget.
  for (int gz = -1; gz <= 1; gz++)
  for (int gy = -1; gy <= 1; gy++)
  for (int gx = -1; gx <= 1; gx++) {
    vec3 g = vec3(float(gx), float(gy), float(gz));
    vec3 cell = base + g;
    // ~22% of cells lit — sparse.
    float on = step(0.78, hash3(cell + 3.7));
    // Jittered point inside its cell; offset into this neighbor's frame.
    vec3 jitter = vec3(hash3(cell + 1.1),
                       hash3(cell + 2.2),
                       hash3(cell + 5.5));
    vec3 pt = g + jitter;              // point position relative to base cell
    float d = length(f - pt);
    // Finite support: hard zero beyond R=0.45 (< half a cell), smooth to 0.
    // smoothstep(R,0,d) guarantees exactly 0 at/after the influence radius.
    float fall = smoothstep(0.45, 0.0, d) * exp(-d * 6.0) * on;
    // Per-mote twinkle keyed to the cell hash.
    float tw = 0.7 + 0.3 * sin(uTime * 2.0 + hash3(cell) * 6.28);
    spark += fall * tw;
  }
  // Warm-white with a pink-violet cast that grows with depth.
  vec3 tint = mix(MOTE_WARM, MOTE_PINK, act2 * 0.6);
  return tint * spark * act2 * 2.2;
}

// ---- Act II: silhouetted flora (SDF kelp ribbons) ----
// Distance to a sine-swayed vertical segment. Purely dark — flora occludes the
// motes/rays behind it. Height scales with raised arms:
//   grow = (hand.y*0.5+0.5) * hand.z   (present-gated).
// NOTE: this uses the RAW hand value every frame; smoothing over seconds is
// gameplay's job (a shader uniform can't hold state), so arms-raised growth
// will look abrupt here until the app lerps hand.y before feeding it.
float floraOcclusion(vec3 p, float act2) {
  if (act2 < 0.01) return 0.0;
  float growL = (uHandL.y * 0.5 + 0.5) * uHandL.z;
  float growR = (uHandR.y * 0.5 + 0.5) * uHandR.z;

  float occ = 0.0;
  // 5 ribbons anchored at the path edges, alternating sides.
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float side = mod(fi, 2.0) < 0.5 ? -1.0 : 1.0;
    float grow = side < 0.0 ? growL : growR;
    // Anchor down the path, offset to the edge of the corridor.
    float za = p.z - fi * 1.7 + 1.0;          // near the current sample
    float baseX = pathX(p.z) + side * (1.4 + 0.3 * hash(vec2(fi, 3.0)));
    float baseZ = p.z;
    // Sway: horizontal offset grows toward the tip (higher y).
    float height = 2.2 + grow * 2.6;           // arms raised -> taller
    float tipT = clamp((p.y + 0.5) / height, 0.0, 1.0);
    float sway = sin(uTime * 0.6 + fi * 1.3 + p.y * 0.8) * 0.35 * tipT;
    vec2 seg = vec2(baseX + sway, baseZ);
    float dxz = length(p.xz - seg);
    // Vertical extent: ribbon lives from y≈-0.5 up to its height.
    float inY = step(-0.5, p.y) * step(p.y, height - 0.5);
    float ribbon = exp(-dxz * 6.0) * inY;
    occ = max(occ, ribbon);
  }
  return clamp(occ, 0.0, 1.0) * act2;
}

void main() {
  float aspect = uResolution.x / uResolution.y;
  Ray ray = setupRay(vUv, aspect);

  // ---- progress-driven act weights (blend over ±0.05 via smoothstep) ----
  float p = uProgress;
  // Act I present 0.00–0.25, fading out by 0.30.
  float act1 = 1.0 - smoothstep(0.25, 0.35, p);
  // Act II present from ~0.20 onward (and continues past 0.60 — Act III is #7).
  float act2 = smoothstep(0.20, 0.30, p);

  // ---- breathing world ----
  float breatheFog  = 1.0 + (uBreathe - 0.5) * 0.20;   // fog density ±10%
  float breatheGlow = 1.0 + (uBreathe - 0.5) * 0.30;   // sun glow ±15%

  // ---- path & sun ----
  // Down-refracted sun direction (mostly downward, slight forward slant),
  // canted with the path so shafts lean as the corridor curves.
  float curve = pathX(ray.origin.z);
  vec3 sunDir = normalize(vec3(0.15 * cos(curve) + 0.2, -1.0, -0.35));

  // ---- Act I: analytic water surface (shaded ONCE, outside the loop) ----
  float surfMask;
  vec3 surfCol = shadeSurface(ray, sunDir, breatheFog, breatheGlow, act1, surfMask);

  // ---- fog setup: exponential height fog, thicker with depth (Act II ×3) ----
  float fogBase = mix(0.10, 0.30, act2);               // density ramps ×3
  fogBase *= breatheFog;

  // ---- single volumetric march ----
  vec3 col = vec3(0.0);
  float transmittance = 1.0;

  int steps = uSteps;
  // Fewer steps => longer dt over the same depth => grainier fog, never missing
  // geometry (god-rays/motes are analytic, so coarse sampling only adds noise).
  float MARCH_LEN = 26.0;
  float dt = MARCH_LEN / float(steps);
  float t = 0.05;

  for (int i = 0; i < 256; i++) {
    if (i >= steps) break;
    vec3 wp = ray.origin + ray.dir * t;

    // Depth-based abyss base colour (below 0.7 — this is canvas, not event).
    float depthMix = clamp((-wp.z) / MARCH_LEN, 0.0, 1.0);
    vec3 baseTint = mix(BASE_NEAR, BASE_FAR, depthMix);

    // Exponential height fog: denser lower (more negative y) and with depth.
    float heightF = exp(-(wp.y + 3.0) * 0.12);          // thicker down low
    float nz = vnoise3(wp * 0.5 + vec3(0.0, uTime * 0.06, uTime * 0.04));
    float dens = fogBase * heightF * (0.6 + 0.8 * nz);
    float stepAbsorb = 1.0 - exp(-dens * dt);           // Beer-Lambert step
    col += transmittance * baseTint * stepAbsorb;

    // God-rays (analytic cones) — the glowing event above 0.7 after accum.
    vec3 rays = godRayContribution(wp, sunDir, act1, act2, breatheGlow);

    // Motes (Act II) — one grid cell lookup per sample.
    vec3 motes = moteField(wp, act2);

    // Flora silhouette occludes the light behind it (dark against motes/rays).
    float flora = floraOcclusion(wp, act2);
    float lightVis = 1.0 - flora;

    col += transmittance * (rays + motes) * lightVis * dt;

    transmittance *= exp(-dens * dt);
    t += dt;
    if (transmittance < 0.01) break;
  }

  // ---- composite the analytic surface behind whatever the march revealed ----
  // Surface sits far overhead; the marched deep is in front of it along the ray,
  // so the surface shows through by the remaining transmittance, minus the
  // portion the bright membrane/foam itself occludes.
  col += surfCol * transmittance * (1.0 - surfMask * 0.5);

  // ---- uLight: answered-questions luminance lift (up to +25%) + warm rays ----
  col *= (1.0 + uLight * 0.25);
  col += RAY_CYAN * uLight * 0.03 * vec3(1.05, 1.0, 0.95); // slight warm tint

  fragColor = vec4(col, 1.0);
}
// --- END SCENE BODY -----------------------------------------------------
