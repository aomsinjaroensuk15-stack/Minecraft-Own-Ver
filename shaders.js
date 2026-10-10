/* All GLSL (ES 3.00) sources. Kept as JS strings so the project runs from
   file:// with zero fetches. */

const GLSL = {};

/* ============================== SKY ============================== */

GLSL.skyVS = `#version 300 es
layout(location=0) in vec2 aNdc;
out vec2 vNdc;
void main() {
  vNdc = aNdc;
  gl_Position = vec4(aNdc, 0.999999, 1.0);
}`;

GLSL.skyFS = `#version 300 es
precision highp float;
in vec2 vNdc;
out vec4 fragColor;

uniform vec3  uCamRot[3];     // camera basis vectors (right, up, forward)
uniform float uTanFov, uAspect;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uZenith, uHorizon;
uniform vec3  uFogColor;
uniform float uTime, uNight, uCloudCover, uCloudDetail;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1, 0));
  float c = hash21(i + vec2(0, 1)), d = hash21(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * noise2(p);
    p = p * 2.13 + vec2(19.7, 7.31);
    a *= 0.5;
  }
  return s;
}
float hash31(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 dir = normalize(
    uCamRot[0] * (vNdc.x * uTanFov * uAspect) +
    uCamRot[1] * (vNdc.y * uTanFov) +
    uCamRot[2]);

  float y = max(dir.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(y, 0.55));

  float cosSun = dot(dir, uSunDir);

  // low-altitude haze melts into the terrain fog color
  col = mix(col, uFogColor, pow(1.0 - y, 7.0) * 0.85);

  // sun: hot HDR disc + Mie glow
  float disc = smoothstep(0.99938, 0.99972, cosSun);
  float glow = pow(max(cosSun, 0.0), 24.0) * 0.28 + pow(max(cosSun, 0.0), 350.0) * 2.2;
  col += uSunColor * (disc * 26.0 + glow);

  // moon (opposite the sun), only meaningful at night
  float cosMoon = dot(dir, -uSunDir);
  float moon = smoothstep(0.99955, 0.99985, cosMoon);
  float moonGlow = pow(max(cosMoon, 0.0), 600.0) * 0.5;
  col += vec3(0.75, 0.82, 0.95) * (moon * 1.6 + moonGlow) * uNight;

  // stars
  if (uNight > 0.02 && dir.y > 0.02) {
    vec3 sp = dir * 220.0;
    float star = step(0.9986, hash31(floor(sp)));
    float twinkle = 0.6 + 0.4 * sin(uTime * 2.7 + hash31(floor(sp)) * 40.0);
    col += vec3(0.9, 0.95, 1.1) * star * twinkle * uNight * smoothstep(0.02, 0.2, dir.y);
  }

  // procedural clouds on a flattened dome projection
  if (dir.y > 0.015) {
    vec2 cuv = dir.xz / (dir.y + 0.18) * 0.9;
    cuv += uTime * vec2(0.006, 0.0023);
    float c = fbm(cuv * (0.55 + uCloudDetail * 0.25));
    float cover = smoothstep(1.0 - uCloudCover - 0.18, 1.0 - uCloudCover + 0.22, c);
    if (cover > 0.001) {
      // cheap self-shading: resample toward the sun
      float cs = fbm(cuv * (0.55 + uCloudDetail * 0.25) + uSunDir.xz * 0.35);
      float lit = clamp(0.55 + (c - cs) * 3.0, 0.15, 1.0);
      vec3 cloudCol = mix(uZenith * 0.55 + vec3(0.06), uSunColor * 0.95 + vec3(0.22), lit * (0.35 + 0.65 * max(cosSun, 0.0)));
      cloudCol = mix(cloudCol, uFogColor, pow(1.0 - y, 5.0) * 0.8);
      col = mix(col, cloudCol, cover * smoothstep(0.015, 0.14, dir.y) * (1.0 - uNight * 0.75));
    }
  }

  fragColor = vec4(col, 1.0);
}`;

/* ============================ TERRAIN ============================ */

GLSL.terrainVS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
layout(location=3) in vec2 aAux;   // x: AO (0..1), y: sway flag
uniform mat4 uProj, uView, uLightVP;
uniform float uTime;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
out float vAo;
out vec4 vLightPos;
void main() {
  vec3 wp = aPos;
  if (aAux.y > 0.5) {
    float ph = wp.x * 0.71 + wp.z * 0.53;
    wp.x += sin(uTime * 1.7 + ph) * 0.055;
    wp.z += cos(uTime * 1.35 + ph * 1.3) * 0.045;
  }
  vWorld = wp;
  vNormal = aNormal;
  vUv = aUv;
  vAo = aAux.x;
  vLightPos = uLightVP * vec4(wp, 1.0);
  gl_Position = uProj * uView * vec4(wp, 1.0);
}`;

GLSL.terrainFS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in float vAo;
in vec4 vLightPos;
out vec4 fragColor;

uniform sampler2D uAtlas;
uniform sampler2DShadow uShadowMap;
uniform vec3  uSunDir, uSunColor;
uniform vec3  uAmbSky, uAmbGround;
uniform vec3  uFogColor, uFogSunColor;
uniform float uFogDensity, uShadowTexel, uWaterLevel;
uniform int   uShadowMode;      // 0 off, 1 hard, 2 PCF, 3 PCSS
uniform int   uClip;            // 1 = discard below uClipY (reflection pass)
uniform float uClipY;
uniform vec3  uCamPos;

float visibility(vec3 proj, float ndl) {
  if (uShadowMode == 0 || ndl <= 0.0) return uShadowMode == 0 ? 1.0 : 0.0;
  float bias = max(0.0016, 0.006 * (1.0 - ndl));
  vec2 uv = proj.xy;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;

  if (uShadowMode == 1) {
    return texture(uShadowMap, vec3(uv, proj.z - bias));
  }
  if (uShadowMode == 2) {
    float s = 0.0;
    for (int x = -1; x <= 1; x++)
      for (int y = -1; y <= 1; y++)
        s += texture(uShadowMap, vec3(uv + vec2(x, y) * uShadowTexel * 1.4, proj.z - bias));
    return s / 9.0;
  }
  // PCSS: blocker search -> variable penumbra
  float blocker = 0.0, cnt = 0.0;
  float r = uShadowTexel * 4.0;
  for (int x = -2; x <= 2; x++)
    for (int y = -2; y <= 2; y++) {
      float d = texture(uShadowMap, vec3(uv + vec2(x, y) * r, proj.z - bias));
      if (d < 0.999) { blocker += d; cnt += 1.0; }
    }
  if (cnt < 0.5) return 1.0;
  blocker /= cnt;
  float penumbra = clamp((proj.z - blocker) * 900.0, 1.0, 9.0);
  float s = 0.0;
  for (int x = -2; x <= 2; x++)
    for (int y = -2; y <= 2; y++)
      s += texture(uShadowMap, vec3(uv + vec2(x, y) * uShadowTexel * penumbra, proj.z - bias));
  return s / 25.0;
}

void main() {
  if (uClip == 1 && vWorld.y < uClipY) discard;

  vec4 tex = texture(uAtlas, vUv);
  if (tex.a < 0.5) discard;

  vec3 n = normalize(vNormal);
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 proj = vLightPos.xyz / vLightPos.w * 0.5 + 0.5;
  float shadow = visibility(proj, ndl);

  vec3 hemi = mix(uAmbGround, uAmbSky, n.y * 0.5 + 0.5);
  vec3 light = uSunColor * (ndl * shadow) + hemi;
  vec3 col = tex.rgb * light * (0.45 + 0.55 * vAo);

  // submerged blocks get absorbed by the water column above them
  if (vWorld.y < uWaterLevel) {
    float depth = clamp(uWaterLevel - vWorld.y, 0.0, 12.0);
    col *= exp(-depth * vec3(0.30, 0.14, 0.10));
  }

  float dist = length(vWorld - uCamPos);
  float f = 1.0 - exp(-dist * uFogDensity);
  vec3 viewDir = (vWorld - uCamPos) / max(dist, 0.001);
  float sunAmt = pow(max(dot(viewDir, uSunDir), 0.0), 10.0);
  vec3 fogCol = mix(uFogColor, uFogSunColor, sunAmt * 0.65);
  col = mix(col, fogCol, f);

  fragColor = vec4(col, 1.0);
}`;

/* ============================ WATER ============================ */

GLSL.waterVS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=2) in vec2 aUv;
uniform mat4 uProj, uView;
out vec3 vWorld;
out vec2 vUv;
out vec4 vClipPos;
void main() {
  vWorld = aPos;
  vUv = aUv;
  vec4 cp = uProj * uView * vec4(aPos, 1.0);
  vClipPos = cp;
  gl_Position = cp;
}`;

GLSL.waterFS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec2 vUv;
in vec4 vClipPos;
out vec4 fragColor;

uniform sampler2D uSceneColor;   // terrain+sky, no water
uniform sampler2D uSceneDepth;
uniform sampler2D uRefl;         // planar reflection (mirrored render)
uniform vec3  uCamPos, uSunDir, uSunColor;
uniform vec2  uRes;
uniform float uTime, uNear, uFar, uWaterY;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
             mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}
float linearize(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}
vec3 waveNormal(vec2 p, float t) {
  float e = 0.09;
  float s = 0.28;
  float h  = noise2(p * 1.4 + vec2(t * 0.9, t * 0.4)) * s
           + noise2(p * 3.1 - vec2(t * 0.6, t * 0.8)) * s * 0.5;
  float hx = noise2((p + vec2(e, 0.0)) * 1.4 + vec2(t * 0.9, t * 0.4)) * s
           + noise2((p + vec2(e, 0.0)) * 3.1 - vec2(t * 0.6, t * 0.8)) * s * 0.5;
  float hz = noise2((p + vec2(0.0, e)) * 1.4 + vec2(t * 0.9, t * 0.4)) * s
           + noise2((p + vec2(0.0, e)) * 3.1 - vec2(t * 0.6, t * 0.8)) * s * 0.5;
  return normalize(vec3((h - hx) / e, 1.0, (h - hz) / e));
}

void main() {
  vec2 screenUV = gl_FragCoord.xy / uRes;
  vec3 n = waveNormal(vWorld.xz, uTime);

  // water column thickness from the pre-water depth buffer
  float sceneZ = linearize(texture(uSceneDepth, screenUV).r);
  float waterZ = linearize(gl_FragCoord.z);
  float thick = clamp(sceneZ - waterZ, 0.0, 30.0);

  // refraction: what's behind the water, distorted by waves
  vec2 refrUV = screenUV + n.xz * 0.045 * clamp(2.0 / (waterZ + 1.0), 0.15, 1.0);
  vec3 refr = texture(uSceneColor, refrUV).rgb;
  refr *= exp(-thick * vec3(0.42, 0.22, 0.16));           // depth absorption
  refr += vec3(0.015, 0.05, 0.06) * (1.0 - exp(-thick * 0.25)); // scatter glow

  // reflection: planar mirrored render, wobbled by waves
  vec2 reflUV = screenUV + n.xz * 0.06 * clamp(3.0 / (waterZ + 1.0), 0.2, 1.0);
  vec3 refl = texture(uRefl, reflUV).rgb;

  vec3 viewDir = normalize(uCamPos - vWorld);
  float fresnel = 0.028 + 0.972 * pow(1.0 - max(dot(viewDir, n), 0.0), 5.0);

  vec3 col = mix(refr, refl, clamp(fresnel, 0.0, 1.0));

  // shoreline foam
  float foamBand = smoothstep(1.15, 0.12, thick);
  float foamNoise = noise2(vWorld.xz * 3.4 + vec2(uTime * 0.7, -uTime * 0.5));
  float foam = foamBand * smoothstep(0.42, 0.75, foamNoise + foamBand * 0.35);
  col = mix(col, vec3(0.92, 0.97, 0.98) * (0.35 + 0.65 * max(uSunDir.y, 0.0) + 0.3), foam * 0.85);

  // sun glints
  vec3 rdir = reflect(-viewDir, n);
  float glint = pow(max(dot(rdir, uSunDir), 0.0), 480.0);
  col += uSunColor * glint * 6.0;

  fragColor = vec4(col, 1.0);
}`;

/* ============================ POST ============================ */

GLSL.quadVS = `#version 300 es
layout(location=0) in vec2 aNdc;
out vec2 vUv;
void main() {
  vUv = aNdc * 0.5 + 0.5;
  gl_Position = vec4(aNdc, 0.0, 1.0);
}`;

GLSL.brightFS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform float uThreshold;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float w = max(l - uThreshold, 0.0) / max(l, 1e-4);
  fragColor = vec4(c * w, 1.0);
}`;

GLSL.blurFS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uDir;   // texel-scaled direction
void main() {
  vec3 s = texture(uTex, vUv).rgb * 0.227027;
  s += texture(uTex, vUv + uDir * 1.3846153).rgb * 0.3162162;
  s += texture(uTex, vUv - uDir * 1.3846153).rgb * 0.3162162;
  s += texture(uTex, vUv + uDir * 3.2307692).rgb * 0.0702703;
  s += texture(uTex, vUv - uDir * 3.2307692).rgb * 0.0702703;
  fragColor = vec4(s, 1.0);
}`;

/* Screen-space crepuscular god rays (GPU Gems style radial blur over the
   depth buffer: sky pixels let light through, occluders block it). */
GLSL.godrayFS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uDepth;
uniform vec2  uSunScreen;    // sun in screen uv space
uniform float uNear, uFar;
uniform float uDensity, uDecay, uWeight;
uniform float uSunVis;       // 0 when sun off-screen / behind camera
uniform vec2  uRes;

float linearize(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}
void main() {
  vec2 uv = vUv;
  vec2 delta = (uv - uSunScreen) * uDensity / float(48);
  float illum = 0.0, w = 1.0;
  for (int i = 0; i < 48; i++) {
    uv -= delta;
    float d = linearize(texture(uDepth, clamp(uv, 0.0, 1.0)).r);
    float open = smoothstep(uFar * 0.85, uFar * 0.99, d);
    illum += open * w;
    w *= uDecay;
  }
  float rays = illum * uWeight * uSunVis;
  // shimmer so shafts feel volumetric
  rays *= 0.85 + 0.15 * sin(vUv.x * 40.0 + vUv.y * 25.0);
  fragColor = vec4(vec3(rays), 1.0);
}`;

GLSL.compositeFS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uScene, uBloomA, uBloomB, uGodray;
uniform vec3  uSunColor;
uniform float uExposure, uTime;
uniform float uCamY, uWaterY;    // for underwater grade
uniform float uVignette, uSaturation;
uniform float uGodStrength;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec3 col = texture(uScene, vUv).rgb;
  col += texture(uBloomA, vUv).rgb * 0.55 + texture(uBloomB, vUv).rgb * 0.75;
  col += texture(uGodray, vUv).rgb * uSunColor * 1.35;

  // camera underwater: green-blue absorption + wobble light
  if (uCamY < uWaterY) {
    float depth = clamp(uWaterY - uCamY, 0.0, 16.0);
    col *= exp(-depth * vec3(0.55, 0.28, 0.18));
    col += vec3(0.01, 0.05, 0.06);
  }

  col *= uExposure;
  col = aces(col);

  // filmic grade: gentle saturation + contrast
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(lum), col, uSaturation);
  col = col * col * (3.0 - 2.0 * col) * 0.22 + col * 0.78;

  // vignette
  vec2 q = vUv - 0.5;
  col *= 1.0 - uVignette * smoothstep(0.35, 0.95, dot(q, q) * 2.4);

  // subtle dither against banding in smooth sky gradients
  col += (hash21(vUv * uTime) - 0.5) * 0.004;

  fragColor = vec4(col, 1.0);
}`;
