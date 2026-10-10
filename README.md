# ⛏️ Craftsman Shaders

A realistic lighting/shader engine for a voxel (Craftsman/Minecraft-style) world.
Pure **WebGL2 + GLSL ES 3.00** — zero dependencies, zero build step, zero network.

God rays · planar water reflection · atmospheric sky · soft shadows · bloom · ACES filmic grade

## Run it

Everything is procedural and offline-friendly — just open the file:

```
open index.html            (double-click works too)
```

or serve it (recommended, avoids any browser file:// quirks):

```
npx serve .        # or: python3 -m http.server
```

Requires a WebGL2-capable browser (any recent Chrome / Edge / Firefox / Safari).

## Controls

| Input | Action |
|---|---|
| Click | Lock mouse for look |
| Mouse | Look |
| `W A S D` | Move |
| `Space` / `C` | Fly up / down |
| `Shift` | Sprint |
| `Esc` | Release mouse |

**On phones/tablets:** touch controls appear automatically — left half of the screen = virtual joystick (push where you land your thumb), right half = drag to look, and the ▲▼ buttons fly up/down. Mobile starts on the Low tier for smooth FPS.

UI panel: quality tier (Low / Medium / Ultra), pause time, time speed (0.25x–8x), jump to golden hour 🌇.

## Feature list

- **Atmospheric sky** — day/sunset/night palette driven by true sun elevation, HDR sun disc, Mie glow, moon, twinkling stars, procedural FBM clouds with sun-side self-shading
- **God rays** — screen-space crepuscular shafts (radial depth blur from the sun, noise shimmer), auto-fade when the sun leaves the screen
- **Water** — planar reflection (real mirrored render), wave-distorted refraction, fresnel, depth-based absorption + scatter, shoreline foam, HDR sun glints
- **Shadows** — PCF soft shadows (PCSS contact-hardening on Ultra), slope-scaled bias
- **Voxel AO** — per-vertex ambient occlusion baked at mesh time
- **Lighting** — hemisphere ambient, underwater absorption, sun-scattered fog with height falloff feel
- **Post** — dual-level bloom, ACES filmic tonemap, saturation/contrast grade, vignette, dither
- **Life** — waving leaves, full day/night cycle (240s default)

## Render pipeline

```
shadow map (depth)                ─┐
scene: sky → terrain (HDR)         │
planar reflection (mirrored, half-res)
final: blit scene → water composite│
bloom: bright → blur×2 (½, ¼ res)  │
god rays: radial blur over depth  ─┘
composite: +bloom +godrays → ACES → grade → vignette → screen
```

## Code layout

```
index.html          shell + UI
css/style.css
js/noise.js         seeded RNG / value noise / fbm
js/textures.js      procedural 16px texture atlas (canvas-painted)
js/world.js         terrain gen, tree placement, culled meshing + AO
js/shaders.js       every GLSL source (sky/terrain/water/post)
js/engine.js        GL setup, HDR FBO chain, all render passes
js/main.js          camera, day cycle, UI, main loop
```

## Quality tiers

| | Low | Medium | Ultra |
|---|---|---|---|
| Shadows | 1024, hard | 2048, PCF 3×3 | 2048, PCSS |
| Reflection | ¼ res | ½ res | ½ res |
| God rays | off | on | on |
| Bloom | 1 level | 2 levels | 2 levels |

## Tuning knobs

- Sky mood: `skyPalette()` in `js/engine.js` (colors, fog density, sunset warmth)
- Water: wave scale/distortion in `GLSL.waterFS` (`js/shaders.js`)
- God rays: density/decay/weight in `render()` step 6
- Grade: exposure/saturation/vignette in composite pass
- World: `WORLD.SEED`, size, lake depth in `js/world.js`

## Known limits / next steps

- No AA pass yet (render at DPR 2 on Medium/Ultra to compensate)
- Single 64×64 chunk; chunk streaming would let it scale to infinite worlds
- Reflection doesn't include foliage sway phase mismatch issues, but skips water (no recursive reflections)
