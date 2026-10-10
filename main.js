/* Entry point: camera controller (keyboard+mouse AND touch), day cycle, UI, main loop. */

(function () {
  const canvas = document.getElementById('gl');
  const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (IS_TOUCH) document.body.classList.add('touch');

  let engine;
  try {
    engine = new Engine(canvas);
  } catch (e) {
    document.getElementById('nogl').hidden = false;
    console.error(e);
    return;
  }

  /* ---------- camera ---------- */
  const cam = {
    pos: [WORLD.SX / 2 - 20, WORLD.WATER_LEVEL + 7, WORLD.SZ / 2 + 26],
    yaw: 2.45, pitch: -0.06,
    fwd: [0, 0, -1],
  };
  const keys = {};
  function updateFwd() {
    const cp = Math.cos(cam.pitch);
    cam.fwd = [Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp];
  }
  updateFwd();

  /* keyboard + mouse (desktop) */
  if (!IS_TOUCH) {
    canvas.addEventListener('click', () => canvas.requestPointerLock());
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      cam.yaw -= e.movementX * 0.0022;
      cam.pitch -= e.movementY * 0.0022;
      cam.pitch = clamp(cam.pitch, -1.55, 1.55);
      updateFwd();
    });
  }
  window.addEventListener('keydown', (e) => { keys[e.code] = true; });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  /* touch: left half = joystick, right half = look */
  const joy = { id: -1, ox: 0, oy: 0, dx: 0, dy: 0 };
  const look = { id: -1, lx: 0, ly: 0 };
  let flyUp = false, flyDown = false;

  function onTouchStart(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const half = window.innerWidth / 2;
      if (t.clientX < half && joy.id === -1) {
        joy.id = t.identifier; joy.ox = t.clientX; joy.oy = t.clientY; joy.dx = joy.dy = 0;
      } else if (look.id === -1) {
        look.id = t.identifier; look.lx = t.clientX; look.ly = t.clientY;
      }
    }
  }
  function onTouchMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) {
        const R = 55;
        joy.dx = clamp((t.clientX - joy.ox) / R, -1, 1);
        joy.dy = clamp((t.clientY - joy.oy) / R, -1, 1);
      } else if (t.identifier === look.id) {
        cam.yaw -= (t.clientX - look.lx) * 0.006;
        cam.pitch -= (t.clientY - look.ly) * 0.006;
        cam.pitch = clamp(cam.pitch, -1.55, 1.55);
        look.lx = t.clientX; look.ly = t.clientY;
        updateFwd();
      }
    }
  }
  function onTouchEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) { joy.id = -1; joy.dx = joy.dy = 0; }
      if (t.identifier === look.id) look.id = -1;
    }
  }
  if (IS_TOUCH) {
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    canvas.addEventListener('touchcancel', onTouchEnd);
    const bindHold = (id, on, off) => {
      const el = document.getElementById(id);
      el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); on(); }, { passive: false });
      el.addEventListener('touchend', off);
      el.addEventListener('touchcancel', off);
    };
    bindHold('btnUp', () => flyUp = true, () => flyUp = false);
    bindHold('btnDown', () => flyDown = true, () => flyDown = false);
    document.querySelector('.help').textContent = 'Left thumb: move · Right thumb: look · hold ▲▼ to fly';
  }

  /* ---------- day cycle ---------- */
  const DAY_LENGTH = 240;        // seconds per full day
  let tod = 0.31;                // start at morning golden hour
  let speed = 1;
  let paused = false;

  /* ---------- UI ---------- */
  const fpsEl = document.getElementById('fps');
  const todEl = document.getElementById('tod');
  const tierBtns = {
    low: document.getElementById('qLow'),
    medium: document.getElementById('qMed'),
    ultra: document.getElementById('qUltra'),
  };
  const tPause = document.getElementById('tPause');
  function setTier(q) {
    engine.setQuality(q);
    Object.values(tierBtns).forEach(b => b.classList.remove('active'));
    tierBtns[q].classList.add('active');
  }
  tierBtns.low.onclick = () => setTier('low');
  tierBtns.medium.onclick = () => setTier('medium');
  tierBtns.ultra.onclick = () => setTier('ultra');
  tPause.onclick = () => { paused = !paused; tPause.classList.toggle('active', paused); };
  document.getElementById('tSlower').onclick = () => { speed = Math.max(0.25, speed / 2); };
  document.getElementById('tFaster').onclick = () => { speed = Math.min(8, speed * 2); };
  document.getElementById('tGolden').onclick = () => { tod = 0.72; };  // evening golden hour
  if (IS_TOUCH) setTier('low');   // phones start on Low for smooth fps

  window.addEventListener('resize', () => engine.resize());

  /* ---------- loop ---------- */
  let last = performance.now();
  let fpsAcc = 0, fpsN = 0, fpsTimer = 0;
  function frame(now) {
    let dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    // movement
    const sprint = (keys['ShiftLeft'] || keys['ShiftRight'] || Math.hypot(joy.dx, joy.dy) > 0.92) ? 1.8 : 1;
    const v = 9 * sprint * dt;
    const right = [-cam.fwd[2], 0, cam.fwd[0]]; // cross(fwd, worldUp)
    let mx = 0, mz = 0, my = 0;
    if (keys['KeyW']) { mx += cam.fwd[0]; mz += cam.fwd[2]; }
    if (keys['KeyS']) { mx -= cam.fwd[0]; mz -= cam.fwd[2]; }
    if (keys['KeyA']) { mx -= right[0]; mz -= right[2]; }
    if (keys['KeyD']) { mx += right[0]; mz += right[2]; }
    if (keys['Space'] || flyUp) my += 1;
    if (keys['KeyC'] || flyDown) my -= 1;
    if (joy.id !== -1) {  // joystick: forward = push away, strafe = sideways
      mx += cam.fwd[0] * -joy.dy + right[0] * joy.dx;
      mz += cam.fwd[2] * -joy.dy + right[2] * joy.dx;
    }
    const ml = Math.hypot(mx, mz) || 1;
    cam.pos[0] = clamp(cam.pos[0] + (mx / ml) * v * Math.min(ml, 1), 2, WORLD.SX - 2);
    cam.pos[2] = clamp(cam.pos[2] + (mz / ml) * v * Math.min(ml, 1), 2, WORLD.SZ - 2);
    cam.pos[1] = clamp(cam.pos[1] + my * v, 3.5, WORLD.SY - 2);

    if (!paused) tod = (tod + dt * speed / DAY_LENGTH) % 1;

    engine.render(dt, tod, cam);

    // fps
    fpsAcc += 1 / Math.max(dt, 1e-4); fpsN++; fpsTimer += dt;
    if (fpsTimer > 0.5) {
      fpsEl.textContent = Math.round(fpsAcc / fpsN) + ' fps';
      const names = ['night', 'sunrise', 'morning', 'noon', 'afternoon', 'sunset', 'dusk'];
      todEl.textContent = names[Math.floor(((tod + 0.1) % 1) * 7)] + ' · ' + speed + 'x';
      fpsAcc = 0; fpsN = 0; fpsTimer = 0;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
