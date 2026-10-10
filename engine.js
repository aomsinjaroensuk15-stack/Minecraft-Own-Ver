/* Engine: WebGL2 context, programs, HDR framebuffer chain, render passes.
   Pass order: shadow -> scene(sky+terrain) -> planar reflection -> water ->
   bloom -> god rays -> composite (ACES grade). */

/* ---------- minimal column-major mat4 ---------- */
const M4 = {
  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  },
  ortho(l, r, b, t, n, f) {
    return new Float32Array([
      2 / (r - l), 0, 0, 0,
      0, 2 / (t - b), 0, 0,
      0, 0, -2 / (f - n), 0,
      -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1,
    ]);
  },
  lookAt(eye, c, up) {
    let zx = eye[0] - c[0], zy = eye[1] - c[1], zz = eye[2] - c[2];
    let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return {
      m: new Float32Array([
        xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
        -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
        -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
        -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1,
      ]),
      right: [xx, yx, zx], up: [yx, yy, yz], fwd: [-zx, -zy, -zz],
    };
  },
  mul(a, b) { // a * b
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
    return o;
  },
  reflectY(p) { // mirror world across plane y = p
    return new Float32Array([
      1, 0, 0, 0,
      0, -1, 0, 0,
      0, 0, 1, 0,
      0, 2 * p, 0, 1,
    ]);
  },
  project(m, v) {
    const x = v[0], y = v[1], z = v[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) / w, w,
    ];
  },
};

/* ---------- sky palette (single source of truth for fog/light colors) ---------- */
function sunDirection(tod) {
  // tod .25 = sunrise, .5 = noon (overhead), .75 = sunset, 0/1 = midnight
  const phi = (tod - 0.25) * Math.PI * 2;
  const h = Math.sin(phi), r = Math.cos(phi);
  const az = 0.7 + phi * 0.15;
  return [Math.cos(az) * r, h, Math.sin(az) * r];
}

function skyPalette(tod) {
  const s = sunDirection(tod);
  const sunH = s[1];
  const day = smoothstep(-0.03, 0.25, sunH);
  const sunset = Math.pow(clamp(1 - Math.abs(sunH) * 3.4, 0, 1), 1.4);
  const night = clamp((1 - day) * (1 - sunset), 0, 1);

  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const zenith = mix3(mix3([0.10, 0.13, 0.38], [0.09, 0.30, 0.80], day), [0.012, 0.020, 0.050], night);
  const horizon = mix3(mix3([1.25, 0.45, 0.16], [0.58, 0.74, 0.95], day), [0.030, 0.045, 0.100], night);
  const sunColor = mix3([1.30, 0.40, 0.11], [1.10, 1.02, 0.90], day);
  const sunI = lerp(1.1, 4.4, day);
  const ambSky = mix3(mix3([0.30, 0.22, 0.24], [0.42, 0.52, 0.68], day), [0.045, 0.070, 0.130], night);
  const ambGround = ambSky.map(v => v * 0.45);

  return {
    sunDir: s, day, sunset, night,
    zenith, horizon,
    sunColor: sunColor.map(v => v * sunI),
    ambSky, ambGround,
    fogColor: horizon.map(v => v * 0.97),
    fogSun: mix3(sunColor.map(v => v * sunI * 0.55), horizon, 0.45),
    fogDensity: lerp(0.030, 0.011, day),
    cloudCover: 0.42,
    sunI,
  };
}

/* ---------- shader compile helpers ---------- */
function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(sh), src);
    throw new Error('shader compile failed');
  }
  return sh;
}
function makeProgram(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(p));
    throw new Error('program link failed');
  }
  const uni = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    uni[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name);
  }
  return { prog: p, u: uni };
}

/* ---------- framebuffer helpers ---------- */
function makeTexture(gl, w, h, internal, format, type, filter) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('no webgl2');
    this.gl = gl;
    this.hdr = !!gl.getExtension('EXT_color_buffer_float');
    this.NEAR = 0.1; this.FAR = 420;
    this.FOV = 66 * Math.PI / 180;
    this.SURFACE_Y = WORLD.WATER_LEVEL + 1 - 0.12;
    this.time = 0;

    this.prog = {
      sky: makeProgram(gl, GLSL.skyVS, GLSL.skyFS),
      terrain: makeProgram(gl, GLSL.terrainVS, GLSL.terrainFS),
      shadow: makeProgram(gl, GLSL.terrainVS, `#version 300 es
precision highp float;
in vec3 vWorld;
out vec4 fragColor;
uniform int uClip; uniform float uClipY;
void main() {
  if (uClip == 1 && vWorld.y < uClipY) discard;
  fragColor = vec4(1.0);
}`),
      water: makeProgram(gl, GLSL.waterVS, GLSL.waterFS),
      bright: makeProgram(gl, GLSL.quadVS, GLSL.brightFS),
      blur: makeProgram(gl, GLSL.quadVS, GLSL.blurFS),
      godray: makeProgram(gl, GLSL.quadVS, GLSL.godrayFS),
      composite: makeProgram(gl, GLSL.quadVS, GLSL.compositeFS),
    };

    this.quadVAO = this._makeQuad();
    this.world = new VoxelWorld();
    const meshes = this.world.buildMeshes();
    this.terrainVAO = this._makeMeshVAO(meshes.terrain);
    this.waterVAO = this._makeMeshVAO(meshes.water);

    // atlas texture
    const atlasCanvas = createTextureAtlas(WORLD.SEED);
    this.atlasTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.quality = 'medium';
    this.fbos = null;
    this.resize();
  }

  setQuality(q) {
    this.quality = q;
    this.resize(); // FBO sizes depend on tier
  }

  /* ---------- geometry ---------- */
  _makeQuad() {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  _makeMeshVAO(mesh) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const mk = (data, loc, size) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    mk(mesh.positions, 0, 3);
    mk(mesh.normals, 1, 3);
    mk(mesh.uvs, 2, 2);
    mk(mesh.aux, 3, 2);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: mesh.count, indexType: mesh.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
  }

  /* ---------- framebuffers ---------- */
  _makeTarget(w, h, needDepth) {
    const gl = this.gl;
    const colorInternal = this.hdr ? gl.RGBA16F : gl.RGBA8;
    const colorType = this.hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    const color = makeTexture(gl, w, h, colorInternal, gl.RGBA, colorType, gl.LINEAR);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    let depth = null;
    if (needDepth) {
      depth = makeTexture(gl, w, h, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, color, depth, w, h };
  }

  _makeShadow(size) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, size };
  }

  resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(2, Math.floor(this.canvas.clientHeight * dpr));
    this.canvas.width = w; this.canvas.height = h;
    this.W = w; this.H = h;

    const Q = {
      low:    { shadow: 1024, mode: 1, refl: 0.25, god: false, bloomLevels: 1 },
      medium: { shadow: 2048, mode: 2, refl: 0.5,  god: true,  bloomLevels: 2 },
      ultra:  { shadow: 2048, mode: 3, refl: 0.5,  god: true,  bloomLevels: 2 },
    }[this.quality];

    this.fbos = {
      scene: this._makeTarget(w, h, true),
      refl: this._makeTarget(Math.floor(w * Q.refl), Math.floor(h * Q.refl), true),
      final: this._makeTarget(w, h, true),
      brightA: this._makeTarget(w >> 1, h >> 1, false),
      blurA: this._makeTarget(w >> 1, h >> 1, false),
      brightB: this._makeTarget(w >> 2, h >> 2, false),
      blurB: this._makeTarget(w >> 2, h >> 2, false),
      god: this._makeTarget(w >> 1, h >> 1, false),
      shadow: this._makeShadow(Q.shadow),
    };
    this.cfg = Q;
  }

  /* ---------- draw helpers ---------- */
  _bindTex(unit, tex) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  _drawSky(cam, rot) {
    const gl = this.gl, u = this.prog.sky.u;
    gl.useProgram(this.prog.sky.prog);
    gl.uniformMatrix3fv(u.uCamRot, false, new Float32Array([...rot.right, ...rot.up, ...rot.fwd].flat()));
    gl.uniform1f(u.uTanFov, Math.tan(this.FOV / 2));
    gl.uniform1f(u.uAspect, this.W / this.H);
    gl.uniform1f(u.uTime, this.time);
    gl.depthMask(false);
    gl.depthFunc(gl.LEQUAL);
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
  }

  _drawTerrain(pass, mats, pal, clip) {
    // pass: 'shadow' | 'scene'
    const gl = this.gl;
    const P = this.prog[pass], u = P.u;
    gl.useProgram(P.prog);
    gl.uniformMatrix4fv(u.uProj, false, mats.proj);
    gl.uniformMatrix4fv(u.uView, false, mats.view);
    if (u.uLightVP) gl.uniformMatrix4fv(u.uLightVP, false, mats.lightVP);
    if (u.uTime) gl.uniform1f(u.uTime, this.time);
    if (u.uClip) { gl.uniform1i(u.uClip, clip ? 1 : 0); gl.uniform1f(u.uClipY, this.SURFACE_Y); }
    if (pass === 'scene') {
      gl.uniform1i(u.uAtlas, 0);
      gl.uniform1i(u.uShadowMap, 1);
      this._bindTex(0, this.atlasTex);
      this._bindTex(1, this.fbos.shadow.tex);
      gl.uniformMatrix4fv(u.uLightVP, false, mats.lightVP);
      gl.uniform1i(u.uShadowMode, this.cfg.mode);
      gl.uniform1f(u.uShadowTexel, 1 / this.fbos.shadow.size);
      gl.uniform3fv(u.uSunDir, pal.sunDir);
      gl.uniform3fv(u.uSunColor, pal.sunColor);
      gl.uniform3fv(u.uAmbSky, pal.ambSky);
      gl.uniform3fv(u.uAmbGround, pal.ambGround);
      gl.uniform3fv(u.uFogColor, pal.fogColor);
      gl.uniform3fv(u.uFogSunColor, pal.fogSun);
      gl.uniform1f(u.uFogDensity, pal.fogDensity);
      gl.uniform1f(u.uWaterLevel, WORLD.WATER_LEVEL + 1);
      gl.uniform3fv(u.uCamPos, mats.camPos);
    }
    gl.bindVertexArray(this.terrainVAO.vao);
    gl.drawElements(gl.TRIANGLES, this.terrainVAO.count, this.terrainVAO.indexType, 0);
  }

  /* ---------- main render ---------- */
  render(dt, tod, cam) {
    const gl = this.gl;
    this.time += dt;
    const pal = skyPalette(tod);

    // camera matrices
    const proj = M4.perspective(this.FOV, this.W / this.H, this.NEAR, this.FAR);
    const eye = cam.pos;
    const center = [eye[0] + cam.fwd[0], eye[1] + cam.fwd[1], eye[2] + cam.fwd[2]];
    const look = M4.lookAt(eye, center, [0, 1, 0]);
    const view = look.m;
    const rot = { right: look.right, up: look.up, fwd: cam.fwd };

    // light matrices
    const c = [WORLD.SX / 2, 8, WORLD.SZ / 2];
    const lightEye = [c[0] + pal.sunDir[0] * 140, c[1] + pal.sunDir[1] * 140, c[2] + pal.sunDir[2] * 140];
    const lightView = M4.lookAt(lightEye, c, [0, 1, 0]).m;
    const lightProj = M4.ortho(-72, 72, -72, 72, 1, 320);
    const lightVP = M4.mul(lightProj, lightView);

    /* 1 — shadow map */
    {
      const s = this.fbos.shadow;
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
      gl.viewport(0, 0, s.size, s.size);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      this._drawTerrain('shadow', { proj: lightProj, view: lightView, lightVP, camPos: eye }, pal, false);
    }

    /* 2 — main scene (sky + terrain) */
    {
      const s = this.fbos.scene;
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
      gl.viewport(0, 0, s.w, s.h);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 1]);
      gl.clearBufferfv(gl.DEPTH, 0, [1]);
      gl.disable(gl.BLEND);
      this._drawSky(rot, pal);
      this._drawTerrain('scene', { proj, view, lightVP, camPos: eye }, pal, false);
    }

    /* 3 — planar reflection (mirrored about water surface) */
    {
      const s = this.fbos.refl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
      gl.viewport(0, 0, s.w, s.h);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 1]);
      gl.clearBufferfv(gl.DEPTH, 0, [1]);
      const refl = M4.reflectY(this.SURFACE_Y);
      const viewR = M4.mul(view, refl);
      const rotR = {
        right: rot.right,
        up: [rot.up[0], -rot.up[1], rot.up[2]],
        fwd: [rot.fwd[0], -rot.fwd[1], rot.fwd[2]],
      };
      this._drawSky(rotR, pal);
      this._drawTerrain('scene', { proj, view: viewR, lightVP, camPos: eye }, pal, true);
    }

    /* 4 — copy scene to final, then draw water into it */
    {
      const a = this.fbos.scene, b = this.fbos.final;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, a.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, b.fbo);
      gl.blitFramebuffer(0, 0, a.w, a.h, 0, 0, b.w, b.h, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);

      gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo);
      gl.viewport(0, 0, b.w, b.h);
      const u = this.prog.water.u;
      gl.useProgram(this.prog.water.prog);
      gl.uniformMatrix4fv(u.uProj, false, proj);
      gl.uniformMatrix4fv(u.uView, false, view);
      gl.uniform1i(u.uSceneColor, 0);
      gl.uniform1i(u.uSceneDepth, 1);
      gl.uniform1i(u.uRefl, 2);
      this._bindTex(0, this.fbos.scene.color);
      this._bindTex(1, this.fbos.scene.depth);
      this._bindTex(2, this.fbos.refl.color);
      gl.uniform3fv(u.uCamPos, eye);
      gl.uniform3fv(u.uSunDir, pal.sunDir);
      gl.uniform3fv(u.uSunColor, pal.sunColor);
      gl.uniform2f(u.uRes, b.w, b.h);
      gl.uniform1f(u.uTime, this.time);
      gl.uniform1f(u.uNear, this.NEAR);
      gl.uniform1f(u.uFar, this.FAR);
      gl.uniform1f(u.uWaterY, this.SURFACE_Y);
      gl.bindVertexArray(this.waterVAO.vao);
      gl.drawElements(gl.TRIANGLES, this.waterVAO.count, this.waterVAO.indexType, 0);
      gl.disable(gl.DEPTH_TEST);
    }

    /* 5 — bloom chain */
    this._bright(this.fbos.final, this.fbos.brightA);
    this._blur(this.fbos.brightA, this.fbos.blurA, true);
    this._blur(this.fbos.blurA, this.fbos.brightA, false);
    if (this.cfg.bloomLevels > 1) {
      this._bright(this.fbos.brightA, this.fbos.brightB);
      this._blur(this.fbos.brightB, this.fbos.blurB, true);
      this._blur(this.fbos.blurB, this.fbos.brightB, false);
    }

    /* 6 — god rays from scene depth */
    let godTex = this.fbos.god.color, godOn = this.cfg.god;
    if (godOn) {
      const s = this.fbos.god;
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
      gl.viewport(0, 0, s.w, s.h);
      const u = this.prog.godray.u;
      gl.useProgram(this.prog.godray.prog);
      gl.uniform1i(u.uDepth, 0);
      this._bindTex(0, this.fbos.scene.depth);
      const sunWorld = [
        eye[0] + pal.sunDir[0] * 300, eye[1] + pal.sunDir[1] * 300, eye[2] + pal.sunDir[2] * 300];
      const sp = M4.project(M4.mul(proj, view), sunWorld);
      const inFront = sp[3] > 0;
      const suv = [sp[0] * 0.5 + 0.5, sp[1] * 0.5 + 0.5];
      const off = Math.hypot(suv[0] - 0.5, suv[1] - 0.5);
      const vis = inFront ? clamp(1.35 - off * 1.35, 0, 1) : 0;
      gl.uniform2f(u.uSunScreen, suv[0], suv[1]);
      gl.uniform1f(u.uSunVis, vis * clamp(pal.sunI * 0.35, 0, 1));
      gl.uniform1f(u.uNear, this.NEAR);
      gl.uniform1f(u.uFar, this.FAR);
      gl.uniform1f(u.uDensity, 0.94);
      gl.uniform1f(u.uDecay, 0.93);
      gl.uniform1f(u.uWeight, 0.16);
      gl.uniform2f(u.uRes, s.w, s.h);
      gl.bindVertexArray(this.quadVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /* 7 — composite to screen */
    {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.W, this.H);
      const u = this.prog.composite.u;
      gl.useProgram(this.prog.composite.prog);
      gl.uniform1i(u.uScene, 0);
      gl.uniform1i(u.uBloomA, 1);
      gl.uniform1i(u.uBloomB, 2);
      gl.uniform1i(u.uGodray, 3);
      this._bindTex(0, this.fbos.final.color);
      this._bindTex(1, this.fbos.brightA.color);
      this._bindTex(2, this.cfg.bloomLevels > 1 ? this.fbos.brightB.color : this.fbos.brightA.color);
      this._bindTex(3, godOn ? godTex : this.fbos.god.color);
      gl.uniform3fv(u.uSunColor, pal.sunColor.map(v => Math.min(v, 1.4)));
      gl.uniform1f(u.uExposure, 1.05);
      gl.uniform1f(u.uTime, this.time % 100);
      gl.uniform1f(u.uCamY, eye[1]);
      gl.uniform1f(u.uWaterY, this.SURFACE_Y);
      gl.uniform1f(u.uVignette, 0.34);
      gl.uniform1f(u.uSaturation, 1.07);
      gl.bindVertexArray(this.quadVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.bindVertexArray(null);
  }

  _bright(src, dst) {
    const gl = this.gl, u = this.prog.bright.u;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.useProgram(this.prog.bright.prog);
    gl.uniform1i(u.uTex, 0);
    this._bindTex(0, src.color);
    gl.uniform1f(u.uThreshold, 1.0);
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _blur(src, dst, horizontal) {
    const gl = this.gl, u = this.prog.blur.u;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.useProgram(this.prog.blur.prog);
    gl.uniform1i(u.uTex, 0);
    this._bindTex(0, src.color);
    gl.uniform2f(u.uDir, horizontal ? 1 / src.w : 0, horizontal ? 0 : 1 / src.h);
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
