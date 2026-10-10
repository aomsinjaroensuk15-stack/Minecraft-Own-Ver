/* Entry point: camera controller, day cycle, UI, main loop. */

(function () {
  const canvas = document.getElementById('gl');
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

  canvas.addEventListener('click', () => canvas.requestPointerLock());
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    cam.yaw -= e.movementX * 0.0022;
    cam.pitch -= e.movementY * 0.0022;
    cam.pitch = clamp(cam.pitch, -1.55, 1.55);
    updateFwd();
  });
  window.addEventListener('keydown', (e) => { keys[e.code] = true; });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  /* ---------- day cycle ---------- */
  const DAY_LENGTH = 240;        // seconds per full day
  let tod = 0.31;                // start at morning golden hour
  let speed = 1;
  let paused = false;

  /* ---------- UI ---------- */
  const fpsEl = document.getElementById('fps');
  const todEl = document.getElementById('tod');
  const tierBtns = { low: qLow, medium: qMed, ultra: qUltra };
  function setTier(q) {
    engine.setQuality(q);
    Object.values(tierBtns).forEach(b => b.classList.remove('active'));
    tierBtns[q].classList.add('active');
  }
  tierBtns.low.onclick = () => setTier('low');
  tierBtns.medium.onclick = () => setTier('medium');
  tierBtns.ultra.onclick = () => setTier('ultra');
  tPause.onclick = () => { paused = !paused; tPause.classList.toggle('active', paused); };
  tSlower.onclick = () => { speed = Math.max(0.25, speed / 2); };
  tFaster.onclick = () => { speed = Math.min(8, speed * 2); };
  tGolden.onclick = () => { tod = 0.72; };  // evening golden hour

  window.addEventListener('resize', () => engine.resize());

  /* ---------- loop ---------- */
  let last = performance.now();
  let fpsAcc = 0, fpsN = 0, fpsTimer = 0;
  function frame(now) {
    let dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    // movement
    const sprint = keys['ShiftLeft'] || keys['ShiftRight'] ? 3 : 1;
    const v = 9 * sprint * dt;
    const right = [-cam.fwd[2], 0, cam.fwd[0]]; // cross(fwd, worldUp)
    let mx = 0, mz = 0, my = 0;
    if (keys['KeyW']) { mx += cam.fwd[0]; mz += cam.fwd[2]; }
    if (keys['KeyS']) { mx -= cam.fwd[0]; mz -= cam.fwd[2]; }
    if (keys['KeyA']) { mx -= right[0]; mz -= right[2]; }
    if (keys['KeyD']) { mx += right[0]; mz += right[2]; }
    if (keys['Space']) my += 1;
    if (keys['KeyC']) my -= 1;
    const ml = Math.hypot(mx, mz) || 1;
    cam.pos[0] = clamp(cam.pos[0] + (mx / ml) * v, 2, WORLD.SX - 2);
    cam.pos[2] = clamp(cam.pos[2] + (mz / ml) * v, 2, WORLD.SZ - 2);
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
