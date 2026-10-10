/* Procedural texture atlas, painted on a canvas at startup — no image files.
   Atlas layout: 4x4 grid of 16px tiles.
   0 grass_top · 1 grass_side · 2 dirt · 3 stone · 4 sand · 5 wood_side · 6 wood_top · 7 leaves */

const TILE = 16, ATLAS = 4, ATLAS_PX = TILE * ATLAS;

function createTextureAtlas(seed) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = ATLAS_PX;
  const g = cv.getContext('2d');
  const R = mulberry32(seed ^ 0x9e3779b9);

  function tileXY(index) { return [(index % ATLAS) * TILE, Math.floor(index / ATLAS) * TILE]; }

  function speckle(index, base, vary, density = 1) {
    const [ox, oy] = tileXY(index);
    const img = g.createImageData(TILE, TILE);
    for (let i = 0; i < TILE * TILE; i++) {
      const v = (R() - 0.5) * 2 * vary * density;
      img.data[i * 4 + 0] = clamp(base[0] + v * 55, 0, 255);
      img.data[i * 4 + 1] = clamp(base[1] + v * 55, 0, 255);
      img.data[i * 4 + 2] = clamp(base[2] + v * 55, 0, 255);
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, ox, oy);
  }

  /* grass top: fresh green with patchiness */
  speckle(0, [96, 152, 58], 0.5);
  const [gx, gy] = tileXY(0);
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(${60 + R() * 30 | 0},${120 + R() * 50 | 0},${40 + R() * 25 | 0},0.55)`;
    g.fillRect(gx + (R() * TILE) | 0, gy + (R() * TILE) | 0, 1 + (R() * 2) | 0, 1);
  }

  /* dirt */
  speckle(2, [134, 96, 67], 0.55);
  /* stone with cracks */
  speckle(3, [128, 128, 130], 0.4);
  const [sx, sy] = tileXY(3);
  g.strokeStyle = 'rgba(70,70,74,0.7)'; g.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    let x = sx + R() * TILE, y = sy + R() * TILE;
    g.moveTo(x, y);
    for (let j = 0; j < 4; j++) { x += (R() - 0.5) * 8; y += (R() - 0.5) * 8; g.lineTo(x, y); }
    g.stroke();
  }
  /* sand */
  speckle(4, [219, 203, 158], 0.35);
  /* grass side: dirt + grass fringe on top */
  speckle(1, [134, 96, 67], 0.5);
  const [bsx, bsy] = tileXY(1);
  for (let x = 0; x < TILE; x++) {
    const depth = 2 + (R() * 3 | 0);
    for (let y = 0; y < depth; y++) {
      g.fillStyle = `rgb(${88 + R() * 25 | 0},${142 + R() * 40 | 0},${52 + R() * 20 | 0})`;
      g.fillRect(bsx + x, bsy + y, 1, 1);
    }
  }
  /* wood side: vertical bark stripes */
  const [wsx, wsy] = tileXY(5);
  for (let x = 0; x < TILE; x++) {
    const shade = 96 + Math.sin(x * 1.7) * 22 + R() * 14;
    g.fillStyle = `rgb(${shade + 24 | 0},${shade * 0.72 | 0},${shade * 0.45 | 0})`;
    g.fillRect(wsx + x, wsy, 1, TILE);
  }
  /* wood top: rings */
  speckle(6, [168, 128, 82], 0.18);
  const [wtx, wty] = tileXY(6);
  g.strokeStyle = 'rgba(110,78,45,0.8)';
  for (let r = 2; r < 8; r += 2) { g.beginPath(); g.arc(wtx + 8, wty + 8, r, 0, 7); g.stroke(); }
  /* leaves: clustered greens with real holes for alpha-test */
  const [lx, ly] = tileXY(7);
  g.clearRect(lx, ly, TILE, TILE);
  for (let i = 0; i < 150; i++) {
    const x = R() * TILE, y = R() * TILE;
    if (R() < 0.16) continue; // holes
    const s = 1 + R() * 1.6;
    g.fillStyle = `rgba(${40 + R() * 45 | 0},${105 + R() * 75 | 0},${30 + R() * 30 | 0},${0.85 + R() * 0.15})`;
    g.fillRect(lx + x, ly + y, s, s);
  }

  return cv;
}

/* Tile -> atlas UV rect, slightly inset to stop bleeding */
function atlasUV(tile) {
  const u0 = (tile % ATLAS) / ATLAS, v0 = Math.floor(tile / ATLAS) / ATLAS;
  const m = 0.012;
  return [u0 + m, v0 + m, 1 / ATLAS - m * 2, 1 / ATLAS - m * 2];
}
