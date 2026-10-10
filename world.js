/* Voxel world: terrain generation, chunk meshing with per-vertex ambient
   occlusion, foliage-sway flags, and the water surface mesh. */

const WORLD = {
  SX: 64, SY: 48, SZ: 64,
  WATER_LEVEL: 8,
  SEED: 1337,
};

const B = { AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, WOOD: 5, LEAVES: 6, WATER: 7 };

const BLOCK_TILE = { [B.GRASS]: 0, [B.DIRT]: 2, [B.STONE]: 3, [B.SAND]: 4, [B.WOOD]: 5, [B.LEAVES]: 7 };
const TILE_GRASS_SIDE = 1, TILE_WOOD_TOP = 6;

class VoxelWorld {
  constructor() {
    const { SX, SY, SZ } = WORLD;
    this.blocks = new Uint8Array(SX * SY * SZ);
    this.noise = makeNoise2D(WORLD.SEED);
    this.treeNoise = makeNoise2D(WORLD.SEED ^ 0x51ab);
    this.generate();
  }

  idx(x, y, z) { return (y * WORLD.SZ + z) * WORLD.SX + x; }
  get(x, y, z) {
    if (x < 0 || y < 0 || z < 0 || x >= WORLD.SX || y >= WORLD.SY || z >= WORLD.SZ) return B.AIR;
    return this.blocks[this.idx(x, y, z)];
  }
  set(x, y, z, b) { this.blocks[this.idx(x, y, z)] = b; }
  isOpaque(b) { return b !== B.AIR && b !== B.WATER && b !== B.LEAVES; }

  generate() {
    const { SX, SY, SZ, WATER_LEVEL } = WORLD;
    const N = this.noise;
    const heights = new Int8Array(SX * SZ);

    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        let h = 9 + N.fbm(x * 0.045, z * 0.045, 5) * 17;
        // central lake basin
        const dx = x - SX / 2, dz = z - SZ / 2;
        const d = Math.sqrt(dx * dx + dz * dz);
        h -= smoothstep(30, 8, d) * 12.5;
        // gentle beach ring shaping
        h = clamp(Math.round(h), 1, SY - 6);
        heights[z * SX + x] = h;

        for (let y = 0; y <= h; y++) {
          let b;
          if (y === h) b = (h <= WATER_LEVEL + 1) ? B.SAND : B.GRASS;
          else if (y >= h - 3) b = (h <= WATER_LEVEL + 1) ? B.SAND : B.DIRT;
          else b = B.STONE;
          this.set(x, y, z, b);
        }
        for (let y = h + 1; y <= WATER_LEVEL; y++) this.set(x, y, z, B.WATER);
      }
    }

    // trees
    for (let z = 3; z < SZ - 3; z++) {
      for (let x = 3; x < SX - 3; x++) {
        const h = heights[z * SX + x];
        if (this.get(x, h, z) !== B.GRASS) continue;
        if (this.treeNoise.fbm(x * 0.11, z * 0.11, 3) < 0.60) continue;
        const trunk = 4 + (this.treeNoise.rand() * 3 | 0);
        if (h + trunk + 3 >= SY) continue;
        for (let y = h + 1; y <= h + trunk; y++) this.set(x, y, z, B.WOOD);
        for (let dy = -2; dy <= 1; dy++) {
          const r = dy < 0 ? 2 : 1;
          for (let ddx = -r; ddx <= r; ddx++) {
            for (let ddz = -r; ddz <= r; ddz++) {
              if (ddx === 0 && ddz === 0 && dy < 1) continue;
              if (Math.abs(ddx) === r && Math.abs(ddz) === r && this.treeNoise.rand() < 0.5) continue;
              const bx = x + ddx, by = h + trunk + dy, bz = z + ddz;
              if (this.get(bx, by, bz) === B.AIR) this.set(bx, by, bz, B.LEAVES);
            }
          }
        }
      }
    }
  }

  /* ---- Meshing ---- */

  buildMeshes() {
    const t = this.meshOpaque();
    const w = this.meshWater();
    return { terrain: t, water: w };
  }

  face(x, y, z, d, out, tile, wave) {
    // d: 0:+x 1:-x 2:+y 3:-y 4:+z 5:-z
    const FACES = [
      { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
      { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
      { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
      { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
      { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
      { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
    ];
    const f = FACES[d];
    const [u0, v0, uw, vh] = atlasUV(tile);
    const uvs = [[u0, v0 + vh], [u0 + uw, v0 + vh], [u0 + uw, v0], [u0, v0]];
    const base = out.pos.length / 10;

    for (let i = 0; i < 4; i++) {
      const c = f.c[i];
      out.pos.push(x + c[0], y + c[1], z + c[2]);
      out.nrm.push(f.n[0], f.n[1], f.n[2]);
      out.uv.push(uvs[i][0], uvs[i][1]);
      let ao = 3;
      if (d !== 2 && d !== 3) ao = this.cornerAO(x, y, z, d, c);
      out.aux.push(ao / 3, wave);
    }
    out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /* classic 4-tap voxel AO in the plane of the face */
  cornerAO(x, y, z, d, c) {
    const px = x + c[0], py = y + c[1], pz = z + c[2];
    let s1, s2, cn;
    if (d === 0 || d === 1) { // x-facing
      const oy = c[1] === 1 ? 1 : -1, oz = c[2] === 1 ? 1 : -1;
      s1 = this.isOpaque(this.get(px, py + oy, pz)) ? 1 : 0;
      s2 = this.isOpaque(this.get(px, py, pz + oz)) ? 1 : 0;
      cn = this.isOpaque(this.get(px, py + oy, pz + oz)) ? 1 : 0;
    } else { // z-facing
      const oy = c[1] === 1 ? 1 : -1, ox = c[0] === 1 ? 1 : -1;
      s1 = this.isOpaque(this.get(px, py + oy, pz)) ? 1 : 0;
      s2 = this.isOpaque(this.get(px + ox, py, pz)) ? 1 : 0;
      cn = this.isOpaque(this.get(px + ox, py + oy, pz)) ? 1 : 0;
    }
    if (s1 && s2) return 0;
    return 3 - (s1 + s2 + cn);
  }

  meshOpaque() {
    const { SX, SY, SZ } = WORLD;
    const out = { pos: [], nrm: [], uv: [], aux: [], idx: [] };
    for (let y = 0; y < SY; y++) {
      for (let z = 0; z < SZ; z++) {
        for (let x = 0; x < SX; x++) {
          const b = this.get(x, y, z);
          if (b === B.AIR || b === B.WATER) continue;
          const wave = (b === B.LEAVES) ? 1 : 0;
          for (let d = 0; d < 6; d++) {
            const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
            const ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
            const nz = z + (d === 4 ? 1 : d === 5 ? -1 : 0);
            const nb = this.get(nx, ny, nz);
            if (nb !== B.AIR && nb !== B.WATER) continue;
            let tile = BLOCK_TILE[b];
            if (b === B.GRASS && (d === 0 || d === 1 || d === 4 || d === 5)) tile = TILE_GRASS_SIDE;
            if (b === B.WOOD && d === 2) tile = TILE_WOOD_TOP;
            if (b === B.WOOD && d === 3) tile = TILE_WOOD_TOP;
            this.face(x, y, z, d, out, tile, wave);
          }
        }
      }
    }
    return packMesh(out);
  }

  meshWater() {
    const { SX, SY, SZ, WATER_LEVEL } = WORLD;
    const out = { pos: [], nrm: [], uv: [], aux: [], idx: [] };
    for (let y = 0; y < SY; y++) {
      for (let z = 0; z < SZ; z++) {
        for (let x = 0; x < SX; x++) {
          if (this.get(x, y, z) !== B.WATER) continue;
          if (this.get(x, y + 1, z) === B.WATER) continue;
          const f = { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] };
          const base = out.pos.length / 10;
          const [u0, v0, uw, vh] = atlasUV(0);
          const uvs = [[u0, v0 + vh], [u0 + uw, v0 + vh], [u0 + uw, v0], [u0, v0]];
          for (let i = 0; i < 4; i++) {
            const c = f.c[i];
            out.pos.push(x + c[0], y + 1 - 0.12, z + c[2]); // slightly below block top
            out.nrm.push(0, 1, 0);
            out.uv.push(uvs[i][0], uvs[i][1]);
            out.aux.push(1, 0);
          }
          out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
    return packMesh(out);
  }
}

function packMesh(out) {
  return {
    positions: new Float32Array(out.pos),
    normals: new Float32Array(out.nrm),
    uvs: new Float32Array(out.uv),
    aux: new Float32Array(out.aux),
    indices: out.idx.length > 65535 ? new Uint32Array(out.idx) : new Uint16Array(out.idx),
    count: out.idx.length,
  };
}
