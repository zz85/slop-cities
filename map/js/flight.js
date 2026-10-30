// Fly: a little game on the globe. A low-poly open-cockpit biplane, in the
// spirit of the 1930s and 40s, flies from one slop city to the next. The
// HUD names the next city; reach it to log it and get the next one.
// Explore is the other way to fly: no destination, the camera high over the
// plane, a way to get around the globe. Climb to see more of it, dive to see
// a country; the city below you is named, and Enter opens its card.
//
// Units are the globe's: 1 = Earth's radius, and heights use the globe's
// relief (x50), so the altimeter reads in the same metres as the terrain.
import { RELIEF, distanceKm } from './world.js';

const D2R = Math.PI / 180;
const L = 0.0012; // the plane's length, in Earth radii
const CRUISE = 0.008, BOOST = 0.02, SLOW = 0.004; // ground speed, radians a second
const KMH = 290 / CRUISE; // what the airspeed indicator reads, for the plane's size
const ARRIVE_KM = 160;
const MAX_ALT = 12000 * RELIEF, CLEAR = 180 * RELIEF;
// Explore: the camera's height over the ground, in Earth radii, and the
// plane drawn big enough to see from there.
const H_MIN = 0.03, H_MAX = 1.6, H_START = 0.45;

export function createFlight({ globe, world, places, onArrive, onExit, onOpen, onEscape, sound }) {
  const { THREE, scene, camera, geometry } = globe.engine;
  const $ = (s) => hud.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---------- the plane ----------
  const plane = buildPlane(THREE);
  plane.group.scale.setScalar(L);
  plane.group.visible = false;
  scene.add(plane.group);

  // ---------- the destination: a light column and a ring on the ground ----------
  const beacon = new THREE.Group();
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffc21a, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
  const beamGeo = new THREE.CylinderGeometry(0.0005, 0.0012, 0.09, 6, 1, true);
  beamGeo.translate(0, 0.045, 0);
  beacon.add(new THREE.Mesh(beamGeo, beamMat));
  const ringR = ARRIVE_KM / 6371;
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffc21a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(ringR * 0.93, ringR, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  beacon.add(ring);
  beacon.visible = false;
  scene.add(beacon);

  // ---------- puffs of smoke behind the tail ----------
  const puffs = [];
  const puffGeo = new THREE.IcosahedronGeometry(1, 0);
  for (let i = 0; i < 48; i++) {
    const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: 0xf4f2ec, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    puffs.push({ m, age: 9, life: 1 });
  }
  let puffAt = 0, puffI = 0;

  // ---------- ground under the plane ----------
  // The globe's own facets, binned by 3 degree cells, so a ray straight down
  // finds the facet under the plane among a few dozen.
  const bins = new Map();
  const pos = geometry.attributes.position.array;
  const nF = pos.length / 9;
  const binKey = (la, lo) => la * 1000 + lo;
  for (let f = 0; f < nF; f++) {
    const x = (pos[f * 9] + pos[f * 9 + 3] + pos[f * 9 + 6]) / 3, y = (pos[f * 9 + 1] + pos[f * 9 + 4] + pos[f * 9 + 7]) / 3, z = (pos[f * 9 + 2] + pos[f * 9 + 5] + pos[f * 9 + 8]) / 3;
    const r = Math.hypot(x, y, z);
    const lat = Math.asin(y / r) / D2R, lon = Math.atan2(-z, x) / D2R;
    const k = binKey(Math.floor((lat + 90) / 3), Math.floor((lon + 180) / 3) % 120);
    (bins.get(k) || bins.set(k, []).get(k)).push(f);
  }
  const ray = new THREE.Ray(), va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), hitP = new THREE.Vector3();
  function groundAt(p) {
    const lat = Math.asin(p.y) / D2R, lon = Math.atan2(-p.z, p.x) / D2R;
    const bl = Math.floor((lat + 90) / 3), bo = Math.floor((lon + 180) / 3);
    const span = Math.min(60, Math.ceil(1.5 / Math.max(0.03, Math.cos(lat * D2R))));
    ray.origin.copy(p).multiplyScalar(1.3); ray.direction.copy(p).negate();
    for (let dl = -1; dl <= 1; dl++) for (let dO = -span; dO <= span; dO++) {
      const list = bins.get(binKey(bl + dl, (((bo + dO) % 120) + 120) % 120));
      if (!list) continue;
      for (const f of list) {
        va.fromArray(pos, f * 9); vb.fromArray(pos, f * 9 + 3); vc.fromArray(pos, f * 9 + 6);
        if (ray.intersectTriangle(va, vb, vc, false, hitP)) return Math.max(1, hitP.length());
      }
    }
    return 1;
  }

  // ---------- state ----------
  const p = new THREE.Vector3(), f = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const st = { mode: 'race', h: H_START, hWant: H_START, size: L, alt: 0, ground: 1, speed: CRUISE, bank: 0, pitch: 0, prop: 0, t: 0, legT: 0, view: 'chase', warn: 0, shake: 0 };
  let target = null, visited = new Set(), legs = 0, running = false, toastTimer = 0, below = null;
  try { if (localStorage.getItem('slop-cities.flight') === 'explore') st.mode = 'explore'; } catch {}
  st.north = true; // north up unless you turned it off
  try { st.north = localStorage.getItem('slop-cities.flight-north') !== 'off'; } catch {}
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), camUp = new THREE.Vector3();
  const keys = new Set();
  let drag = null; // pointer steering: { x0, y0, dx, dy }
  // North up: the plane flies toward the cursor (a mouse over the globe, or a
  // finger held on it), faster the further away it points.
  let aim = null; // { x, y, id, touch }
  const following = () => running && st.mode === 'explore' && st.north;

  // ---------- HUD ----------
  const hud = document.createElement('div');
  hud.className = 'flight';
  hud.hidden = true;
  hud.innerHTML = `
    <div class="panel fl-goal">
      <div class="fl-kicker"><span class="fl-goal-k">Fly to</span></div>
      <div class="fl-dest"><b class="fl-sign"></b><span class="fl-country"></span></div>
      <div class="fl-dist"></div>
      <div class="fl-compass"><div class="fl-tape"></div><i class="fl-caret"></i><i class="fl-mark"></i></div>
    </div>
    <div class="fl-arrow" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3l7 16-7-4-7 4z"/></svg><span></span></div>
    <div class="fl-pullup">PULL UP</div>
    <div class="panel fl-gauges">
      <div class="fl-g"><span>Speed</span><b class="fl-speed">0</b><small>km/h</small></div>
      <div class="fl-g"><span>Altitude</span><b class="fl-alt">0</b><small>m</small></div>
      <div class="fl-g"><span>Heading</span><b class="fl-hdg">0</b><small>°</small></div>
      <div class="fl-g"><span>Log</span><b class="fl-log">0</b><small class="fl-of"></small></div>
      <div class="fl-btns">
        <div class="fl-modes" role="tablist" aria-label="Flight mode">
          <button class="mode-btn" role="tab" data-fm="explore" title="Fly anywhere over the globe (E)">Explore</button>
          <button class="mode-btn" role="tab" data-fm="race" title="Fly from city to city (R)">Race</button>
        </div>
        <button class="tool-btn fl-north" aria-pressed="false" title="Keep north at the top, as on the globe (V)">North up <kbd>V</kbd></button>
        <button class="tool-btn fl-open" title="Open the card of the city below (Enter)">Open <kbd>Enter</kbd></button>
        <button class="tool-btn fl-view" title="Cockpit or chase camera (V)">Cockpit <kbd>V</kbd></button>
        <button class="tool-btn fl-boost" title="Full throttle (Space)">Boost <kbd>Space</kbd></button>
        <button class="tool-btn fl-skip" title="Another city (N)">Skip <kbd>N</kbd></button>
        <button class="tool-btn fl-land" title="Back to the globe (Esc)">Land <kbd>Esc</kbd></button>
      </div>
      <div class="fl-help"><span class="fl-keys">←→ or A D turn · ↑↓ or W S climb and dive · or drag on the sky</span><span class="fl-touch">Drag to steer: sideways turns, up climbs</span><span class="fl-keys fl-xkeys"></span><span class="fl-touch fl-xkeys"></span></div>
    </div>
    <div class="panel fl-toast" hidden></div>`;
  document.body.appendChild(hud);
  // A compass tape: N E S W every 90 degrees and ticks every 15, twice over so it wraps.
  {
    let t = '';
    for (let d = -360; d <= 720; d += 15) {
      const n = ((d % 360) + 360) % 360;
      const name = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[n];
      t += `<i style="left:${d * 2}px" class="${name ? 'big' : n % 45 ? '' : 'mid'}">${name || (n % 45 ? '' : n)}</i>`;
    }
    $('.fl-tape').innerHTML = t;
  }
  $('.fl-view').addEventListener('click', toggleView);
  const boostBtn = $('.fl-boost');
  for (const t of ['pointerdown']) boostBtn.addEventListener(t, (e) => { e.preventDefault(); keys.add('boost'); boostBtn.setAttribute('aria-pressed', 'true'); });
  for (const t of ['pointerup', 'pointerleave', 'pointercancel']) boostBtn.addEventListener(t, () => { keys.delete('boost'); boostBtn.setAttribute('aria-pressed', 'false'); });
  $('.fl-skip').addEventListener('click', () => nextTarget(true));
  $('.fl-open').addEventListener('click', openBelow);
  $('.fl-north').addEventListener('click', toggleNorth);
  $('.fl-north').setAttribute('aria-pressed', String(st.north));
  // Explore's camera: behind the plane, turning with it, or north up over it.
  function toggleNorth() {
    st.north = !st.north;
    $('.fl-north').setAttribute('aria-pressed', String(st.north));
    showHelp();
    try { localStorage.setItem('slop-cities.flight-north', st.north ? 'on' : 'off'); } catch {}
  }
  for (const b of hud.querySelectorAll('[data-fm]')) b.addEventListener('click', () => setMode(b.dataset.fm));
  $('.fl-land').addEventListener('click', () => onExit());

  function toggleView() {
    st.view = st.view === 'chase' ? 'cockpit' : 'chase';
    $('.fl-view').firstChild.textContent = st.view === 'chase' ? 'Cockpit ' : 'Chase ';
    plane.pilot.visible = st.view === 'chase';
    // From the seat the upper wing, its struts and wires would fill the top
    // of the view: leave them out there and keep the nose, the windscreen,
    // the dials and the lower wing's tips.
    for (const m of plane.upper) m.visible = st.view === 'chase';
    // A blade a frame flickers from the seat; the blurred disc alone reads better.
    for (const m of plane.blades) m.visible = st.view === 'chase';
    camera.fov = st.view === 'chase' ? 58 : 70;
    camera.updateProjectionMatrix();
  }

  // ---------- input ----------
  const KEYMAP = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ' ': 'boost', Shift: 'boost', q: 'slow', Q: 'slow' };
  function onKey(e) {
    if (!running || e.target.matches?.('input[type=search], input[type=text]')) return;
    const k = KEYMAP[e.key];
    if (e.type === 'keydown') {
      if (k) { keys.add(k); e.preventDefault(); }
      else if (e.key === 'v' || e.key === 'V' || e.key === 'c' || e.key === 'C') { if (st.mode === 'explore') toggleNorth(); else toggleView(); }
      else if ((e.key === 'n' || e.key === 'N') && st.mode === 'race') nextTarget(true);
      else if (e.key === 'e' || e.key === 'E') setMode('explore');
      else if (e.key === 'r' || e.key === 'R') setMode('race');
      else if (e.key === 'Enter' && st.mode === 'explore') { e.preventDefault(); openBelow(); }
      else if (e.key === 'Escape') { e.stopImmediatePropagation(); if (!onEscape()) onExit(); }
    } else if (k) keys.delete(k);
  }
  addEventListener('keydown', onKey, true);
  addEventListener('keyup', onKey, true);
  addEventListener('blur', () => keys.clear());
  const canvas = globe.renderer.domElement;
  // In Explore, the wheel climbs and descends.
  canvas.addEventListener('wheel', (e) => {
    if (!running || st.mode !== 'explore') return;
    e.preventDefault();
    st.hWant = Math.max(H_MIN, Math.min(H_MAX, st.hWant * Math.exp(e.deltaY * 0.0012)));
  }, { passive: false });
  canvas.addEventListener('pointerdown', (e) => {
    if (!running) return;
    if (following()) { if (e.pointerType !== 'mouse') aim = { x: e.clientX, y: e.clientY, id: e.pointerId, touch: true }; return; }
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 };
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (following()) {
      if (e.pointerType === 'mouse') aim = { x: e.clientX, y: e.clientY, id: e.pointerId };
      else if (aim && aim.id === e.pointerId) { aim.x = e.clientX; aim.y = e.clientY; }
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    const k = Math.min(innerWidth, innerHeight) * 0.18;
    drag.dx = Math.max(-1, Math.min(1, (e.clientX - drag.x0) / k));
    drag.dy = Math.max(-1, Math.min(1, (drag.y0 - e.clientY) / k));
  });
  for (const t of ['pointerup', 'pointercancel']) canvas.addEventListener(t, (e) => {
    if (drag && e.pointerId === drag.id) drag = null;
    if (aim?.touch && aim.id === e.pointerId) aim = null;
  });
  // The mouse leaving the globe, over a panel or out of the window, lets the plane fly straight on.
  canvas.addEventListener('pointerleave', (e) => { if (aim && !aim.touch) aim = null; });
  function showHelp() {
    $('.fl-keys.fl-xkeys').textContent = st.north
      ? 'Point where to fly: the plane follows the cursor, faster the further it points · scroll or W S to climb · click a city'
      : '←→ or A D turn · ↑↓ or W S climb and descend, or scroll · drag to steer · click a city';
    $('.fl-touch.fl-xkeys').textContent = st.north
      ? 'Hold a finger where to fly · tap a city'
      : 'Drag to steer: sideways turns, up climbs · tap a city';
    canvas.classList.toggle('fl-aiming', following());
  }

  // ---------- engine sound ----------
  // A low sawtooth through a low-pass, beaten at the propeller's rate, and a
  // rush of wind that grows with speed. Its own context, so it stops with the game.
  let audio = null;
  function startSound() {
    if (!sound() || audio) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const out = ctx.createGain(); out.gain.value = 0; out.connect(ctx.destination);
      out.gain.setTargetAtTime(0.5, ctx.currentTime, 0.4);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 2;
      const eng = ctx.createGain(); eng.gain.value = 0.12; lp.connect(eng); eng.connect(out);
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 62;
      const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 31.3;
      const g2 = ctx.createGain(); g2.gain.value = 0.5; o2.connect(g2); g2.connect(lp); o1.connect(lp);
      // Putt-putt: the cylinders firing, as a tremolo.
      const trem = ctx.createGain(); trem.gain.value = 0.6;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 18; const lfoG = ctx.createGain(); lfoG.gain.value = 0.4;
      lfo.connect(lfoG); lfoG.connect(trem.gain);
      lp.disconnect(); lp.connect(trem); trem.connect(eng);
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      let b = 0; for (let i = 0; i < len; i++) { b = 0.96 * b + 0.04 * (Math.random() * 2 - 1); d[i] = b * 5; }
      const wind = ctx.createBufferSource(); wind.buffer = buf; wind.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6;
      const wg = ctx.createGain(); wg.gain.value = 0.05; wind.connect(bp); bp.connect(wg); wg.connect(out);
      for (const n of [o1, o2, lfo, wind]) n.start();
      audio = { ctx, out, o1, o2, lfo, lp, wg, bp };
    } catch { audio = null; }
  }
  function soundStep() {
    if (!audio) return;
    const t = audio.ctx.currentTime, x = st.speed / CRUISE;
    audio.o1.frequency.setTargetAtTime(48 + 26 * x, t, 0.25);
    audio.o2.frequency.setTargetAtTime((48 + 26 * x) / 2 + 0.3, t, 0.25);
    audio.lfo.frequency.setTargetAtTime(12 + 9 * x, t, 0.25);
    audio.lp.frequency.setTargetAtTime(380 + 260 * x, t, 0.3);
    audio.wg.gain.setTargetAtTime(0.03 + 0.05 * x + 0.04 * Math.abs(st.pitch), t, 0.3);
    audio.bp.frequency.setTargetAtTime(500 + 400 * x, t, 0.3);
  }
  function chime() {
    if (!audio) return;
    const { ctx, out } = audio, t = ctx.currentTime;
    [784, 1175].forEach((fr, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = fr;
      g.gain.setValueAtTime(0, t + i * 0.12); g.gain.linearRampToValueAtTime(0.18, t + i * 0.12 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.9);
      o.connect(g); g.connect(out); o.start(t + i * 0.12); o.stop(t + i * 0.12 + 1);
    });
  }
  function stopSound() {
    if (!audio) return;
    const a = audio; audio = null;
    a.out.gain.setTargetAtTime(0, a.ctx.currentTime, 0.15);
    setTimeout(() => a.ctx.close(), 600);
  }

  // ---------- geometry helpers ----------
  const north = new THREE.Vector3(), east = new THREE.Vector3(), tmp = new THREE.Vector3(), tdir = new THREE.Vector3(), axis = new THREE.Vector3();
  const lonLat = (v) => ({ lat: Math.asin(Math.max(-1, Math.min(1, v.y / v.length()))) / D2R, lon: Math.atan2(-v.z, v.x) / D2R });
  const xyz = (lon, lat) => new THREE.Vector3(Math.cos(lat * D2R) * Math.cos(lon * D2R), Math.sin(lat * D2R), -Math.cos(lat * D2R) * Math.sin(lon * D2R));
  function frameAt(v) {
    north.set(0, 1, 0).addScaledVector(v, -v.y);
    if (north.lengthSq() < 1e-8) north.set(1, 0, 0);
    north.normalize();
    east.crossVectors(north, v).normalize();
  }
  function bearingTo(v) { // radians, clockwise from north, from p toward v
    frameAt(p);
    tdir.copy(v).addScaledVector(p, -p.dot(v)).normalize();
    return Math.atan2(tdir.dot(east), tdir.dot(north));
  }
  function heading() { frameAt(p); return Math.atan2(f.dot(east), f.dot(north)); }
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  // ---------- destinations ----------
  function nextTarget(skip) {
    const here = lonLat(p);
    const left = places.filter((c) => !visited.has(c.id) && c.id !== target?.id);
    if (!left.length) { visited = new Set(); return nextTarget(skip); }
    const d = (c) => distanceKm(here.lon, here.lat, c.lon, c.lat);
    // Prefer a leg of a minute or two of flying; else the nearest left.
    const good = left.filter((c) => d(c) > 500 && d(c) < 4500);
    const pool = good.length ? good : [...left].sort((a, b) => d(a) - d(b)).slice(0, 3);
    target = pool[Math.floor(Math.random() * pool.length)];
    st.legT = 0;
    globe.setTarget(target.id);
    const tp = xyz(target.lon, target.lat);
    const g = groundAt(tp);
    beacon.position.copy(tp).multiplyScalar(g + 0.0004);
    beacon.quaternion.setFromUnitVectors(up, tp);
    beacon.visible = true;
    target.v = tp;
    $('.fl-sign').textContent = target.city;
    $('.fl-country').textContent = target.country || '';
    $('.fl-of').textContent = `of ${places.length}`;
    if (skip) hud.querySelector('.fl-goal').animate([{ transform: 'translateX(-50%) scale(1.06)' }, { transform: 'translateX(-50%) scale(1)' }], { duration: 300, easing: 'ease-out' });
  }

  function arrive() {
    visited.add(target.id);
    legs++;
    chime();
    const c = target;
    const shot = c.entries.find((e) => e.screenshot);
    const play = c.entries.find((e) => e.links.play)?.links.play;
    const secs = Math.round(st.legT);
    const t = $('.fl-toast');
    t.innerHTML = `${shot ? `<img src="../${esc(shot.screenshot)}" alt="">` : ''}
      <div class="fl-toast-body"><div class="fl-kicker">Landed · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</div>
      <b class="fl-sign">${esc(c.city)}</b>
      <p>${c.entries.length} take${c.entries.length > 1 ? 's' : ''} of ${esc(c.city)}${c.original ? ', the original' : ''}.</p>
      <div class="links">${play ? `<a class="btn play" href="${esc(play)}" target="_blank" rel="noopener">Play ↗</a>` : ''}<button class="btn fl-more" title="Stop flying and open the city's card">Land here</button></div></div>`;
    t.querySelector('.fl-more').addEventListener('click', () => onArrive(c, true));
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 7000);
    onArrive(c, false);
    nextTarget(false);
  }

  // ---------- Race or Explore ----------
  function setMode(m) {
    if (m === st.mode && hud.dataset.fm === m) return;
    st.mode = m;
    hud.dataset.fm = m;
    for (const b of hud.querySelectorAll('[data-fm]')) b.setAttribute('aria-selected', String(b.dataset.fm === m));
    document.body.classList.toggle('explore', m === 'explore');
    try { localStorage.setItem('slop-cities.flight', m); } catch {}
    globe.setGamePick(m === 'explore');
    aim = null; showHelp();
    if (m === 'explore') {
      target = null; beacon.visible = false; globe.setTarget(null);
      $('.fl-goal-k').textContent = 'Below';
      st.h = st.hWant = Math.max(st.h, 0.12);
      if (st.view === 'cockpit') toggleView();
    } else {
      $('.fl-goal-k').textContent = 'Fly to';
      below = null;
      if (running) nextTarget(false);
    }
  }
  // The city nearest the point under the plane, within a reach that grows with height.
  function nearest() {
    let best = null, bd = 1e9;
    for (const c of places) {
      c.v ||= xyz(c.lon, c.lat);
      const d = Math.acos(Math.max(-1, Math.min(1, p.dot(c.v)))) * 6371;
      if (d < bd) { bd = d; best = c; }
    }
    return { city: best, km: bd };
  }
  function openBelow() {
    if (st.mode !== 'explore' || !below) return;
    onOpen(below);
  }

  // ---------- start and stop ----------
  function start(from) {
    const c = from || places.find((x) => x.original) || places[0];
    p.copy(xyz(c.lon, c.lat));
    // Head off to the north-east, then turn toward the first city.
    frameAt(p); f.copy(north).add(east).normalize();
    st.ground = groundAt(p);
    st.alt = st.ground + 2600 * RELIEF;
    st.speed = CRUISE; st.bank = 0; st.pitch = 0; st.t = 0;
    visited = new Set([c.id]); legs = 0;
    target = null; below = null;
    hud.dataset.fm = '';
    setMode(st.mode);
    if (st.mode === 'race') {
      nextTarget(false);
      // Face the first city, so the game starts heading somewhere.
      const b = bearingTo(target.v);
      f.copy(north).multiplyScalar(Math.cos(b)).addScaledVector(east, Math.sin(b)).normalize();
    }
    // The camera swoops in from wherever the globe was looking.
    camPos.copy(camera.position); camLook.set(0, 0, 0); camUp.copy(camera.up);
    camera.near = L * 0.03; camera.far = 90;
    if (st.view !== 'chase') { st.view = 'cockpit'; toggleView(); }
    plane.group.visible = true;
    hud.hidden = false;
    running = true;
    showHelp();
    startSound();
    globe.startGame(step);
  }
  function stop() {
    if (!running) return;
    running = false;
    keys.clear(); drag = null; aim = null;
    canvas.classList.remove('fl-aiming');
    plane.group.visible = false; beacon.visible = false;
    for (const q of puffs) { q.m.visible = false; q.age = 9; }
    hud.hidden = true;
    $('.fl-toast').hidden = true;
    document.body.classList.remove('explore');
    globe.setGamePick(false);
    stopSound();
    globe.endGame();
  }

  // ---------- the frame ----------
  const aimV = new THREE.Vector3();
  const qBasis = new THREE.Quaternion(), qLocal = new THREE.Quaternion(), mBasis = new THREE.Matrix4(), right = new THREE.Vector3(), eul = new THREE.Euler();
  function step(dt, now) {
    st.t += dt; st.legT += dt;
    // Controls: keys, else a drag on the sky.
    let roll = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
    let climb = (keys.has('up') ? 1 : 0) - (keys.has('down') ? 1 : 0);
    if (drag) { roll = roll || drag.dx; climb = climb || drag.dy; }
    const explore = st.mode === 'explore';
    // Follow the cursor: bank toward its bearing from the plane on screen,
    // which north up makes the bearing on the map.
    let aimSpeed = 1;
    if (following() && aim && !roll) {
      aimV.copy(plane.group.position).project(camera);
      const sx = (aimV.x * 0.5 + 0.5) * innerWidth, sy = (-aimV.y * 0.5 + 0.5) * innerHeight;
      const dx = aim.x - sx, dy = aim.y - sy, d = Math.hypot(dx, dy);
      if (d > 18) {
        const diff = wrap(Math.atan2(dx, -dy) - heading());
        roll = Math.max(-1, Math.min(1, diff * 1.4));
      }
      aimSpeed = Math.max(0.3, Math.min(1.8, d / (0.25 * Math.min(innerWidth, innerHeight))));
    }
    // Explore: up and down change the height, and the plane's size and speed follow it.
    if (explore) {
      if (climb) st.hWant = Math.max(H_MIN, Math.min(H_MAX, st.hWant * Math.exp(climb * dt * 0.55)));
      st.h += (st.hWant - st.h) * (1 - Math.exp(-dt * 3));
      climb = 0;
    }
    const zoom = explore ? st.h / H_START : 1;
    const wantSpeed = (keys.has('boost') ? BOOST : keys.has('slow') ? SLOW : CRUISE) * (explore ? 5 * Math.sqrt(zoom) * aimSpeed : 1);
    st.speed += (wantSpeed - st.speed) * (1 - Math.exp(-dt * (wantSpeed > st.speed ? 1.2 : 0.8)));
    st.bank += (roll * 55 * D2R - st.bank) * (1 - Math.exp(-dt * 3));
    st.pitch += (climb * 22 * D2R - st.pitch) * (1 - Math.exp(-dt * 2.5));

    // Turn with the bank, then fly on along the great circle.
    const yaw = Math.tan(st.bank) * 0.9 * (explore ? 1.3 : (CRUISE / Math.max(SLOW, st.speed)) ** 0.3);
    f.applyAxisAngle(p, -yaw * dt);
    axis.crossVectors(p, f).normalize();
    const ang = st.speed * dt;
    p.applyAxisAngle(axis, ang).normalize();
    f.applyAxisAngle(axis, ang).addScaledVector(p, -f.dot(p)).normalize();

    // Climb, and keep above the ground: a firm hand pulls up near it.
    st.alt += Math.sin(st.pitch) * st.speed * 0.55 * dt;
    st.ground = groundAt(p);
    const floor = st.ground + CLEAR;
    st.warn = Math.max(0, st.warn - dt);
    if (st.alt < floor + 400 * RELIEF && st.pitch < 0) st.warn = 0.6;
    if (st.alt < floor) { st.alt = floor; if (st.pitch < 0) st.pitch *= 0.5; st.shake = 0.25; st.warn = 1.2; }
    st.alt = Math.min(st.alt, 1 + MAX_ALT);
    st.shake = Math.max(0, st.shake - dt);
    // Explore draws the plane at the size of a small country, a little above the ground.
    st.size += ((explore ? st.h * 0.06 : L) - st.size) * (1 - Math.exp(-dt * 4));
    plane.group.scale.setScalar(st.size);
    if (explore) { st.warn = 0; st.alt = Math.max(st.alt, st.ground + st.size * 0.8); }
    const drawAlt = explore ? Math.max(st.ground, 1) + st.size * 0.9 : st.alt;

    // The plane: on the globe's tangent frame, pitched and banked.
    right.crossVectors(f, p).normalize();
    mBasis.makeBasis(right, p, tmp.copy(f).negate());
    qBasis.setFromRotationMatrix(mBasis);
    qLocal.setFromEuler(eul.set(st.pitch + 0.03 * Math.sin(st.t * 1.3), 0, -st.bank, 'XZY'));
    plane.group.quaternion.copy(qBasis).multiply(qLocal);
    plane.group.position.copy(p).multiplyScalar(drawAlt);
    if (st.shake) plane.group.position.addScaledVector(p, Math.sin(st.t * 90) * L * 0.08 * st.shake);
    const thr = explore ? (keys.has('boost') ? 2.3 : keys.has('slow') ? 0.6 : 1) : st.speed / CRUISE;
    st.prop += dt * (30 + 40 * thr);
    plane.prop.rotation.z = st.prop;
    plane.animate(st.t, thr);

    // Smoke puffs from the exhaust, thicker at full throttle.
    puffAt -= dt;
    if (puffAt <= 0) {
      puffAt = keys.has('boost') ? 0.035 : 0.09;
      const q = puffs[puffI++ % puffs.length];
      q.m.position.set(0, -0.02, 0.5).applyMatrix4(plane.group.matrixWorld);
      q.age = 0; q.life = keys.has('boost') ? 2.4 : 1.4; q.m.visible = true;
      q.m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    }
    for (const q of puffs) {
      if (q.age > q.life) { q.m.visible = false; continue; }
      q.age += dt;
      const u = q.age / q.life;
      q.m.scale.setScalar(st.size * (0.025 + 0.1 * u));
      q.m.material.opacity = 0.4 * (1 - u) * (1 - u);
    }

    // The camera: chasing behind, or the pilot's seat.
    const at = tdir.copy(p).multiplyScalar(drawAlt);
    if (explore) {
      // High over the plane and a little behind it, looking down the way it flies,
      // so the globe turns under you as a map does.
      // High up, the plane sits nearer the middle, so the whole globe shows.
      const lean = 1 / (1 + st.h * 1.5);
      const k = 1 - Math.exp(-dt * (st.t < 2.5 ? 1.6 + st.t : 4));
      if (st.north) {
        // Straight over the plane, looking at the globe's centre, north at the
        // top as in the Globe view: the plane turns on screen, the map doesn't.
        frameAt(p);
        tmp.copy(at).addScaledVector(p, st.h);
        camPos.lerp(tmp, k);
        camLook.lerp(at, k);
        camUp.lerp(north, k).normalize();
      } else {
        tmp.copy(at).addScaledVector(p, st.h).addScaledVector(f, -st.h * 0.45 * lean);
        camPos.lerp(tmp, k);
        camLook.lerp(at.addScaledVector(f, st.h * 0.3 * lean), k);
        camUp.lerp(tmp.copy(f).addScaledVector(p, 0.3).normalize(), k).normalize();
      }
      camera.position.copy(camPos);
      camera.up.copy(camUp);
      camera.lookAt(camLook);
    } else if (st.view === 'chase') {
      // Above and behind, high enough to see the ground ahead past the plane.
      tmp.copy(at).addScaledVector(f, -L * 8.5).addScaledVector(p, L * 4.2);
      // Never under the ground.
      const tl = tmp.length(), tg = groundAt(tmp.clone().normalize()) + L * 0.6;
      if (tl < tg) tmp.multiplyScalar(tg / tl);
      const k = 1 - Math.exp(-dt * (st.t < 2.5 ? 1.6 + st.t : 5));
      camPos.lerp(tmp, k);
      camLook.lerp(at.addScaledVector(f, L * 6), k);
      camUp.lerp(tmp.copy(p).applyAxisAngle(f, st.bank * 0.35), k).normalize();
      camera.position.copy(camPos);
      camera.up.copy(camUp);
      camera.lookAt(camLook);
    } else {
      plane.group.updateMatrixWorld();
      camera.position.copy(plane.eye).applyMatrix4(plane.group.matrixWorld);
      camera.quaternion.copy(plane.group.quaternion).multiply(qLocal.setFromEuler(eul.set(-0.02, 0, 0)));
      camera.up.copy(p);
      camPos.copy(camera.position); camUp.copy(p);
      camLook.copy(camera.position).add(tmp.set(0, 0, -1).applyQuaternion(camera.quaternion));
    }

    // Arrived? Or, exploring, which city is below.
    const km = target ? Math.acos(Math.max(-1, Math.min(1, p.dot(target.v)))) * 6371 : 1e9;
    if (km < ARRIVE_KM) arrive();
    if (explore) {
      const n = nearest();
      const reach = Math.max(250, st.h * 6371 * 0.35);
      const now = n.km < reach ? n.city : null;
      if (now !== below) {
        below = now;
        if (below && !visited.has(below.id)) { visited.add(below.id); legs++; }
        globe.setTarget(below?.id ?? null);
        $('.fl-sign').textContent = below ? below.city : n.city.city;
        $('.fl-country').textContent = (below ? below.country : n.city.country) || '';
      }
      st.nearest = n;
    }
    beamMat.opacity = 0.32 + 0.18 * Math.sin(now / 260);
    ringMat.opacity = km < 600 ? 0.75 : 0.45;

    soundStep();
    drawHud(km);
  }

  // ---------- HUD each frame ----------
  const v3 = new THREE.Vector3(), goalEl = $('.fl-goal'), gaugesEl = $('.fl-gauges');
  function drawHud(km) {
    const hdg = ((heading() / D2R) + 360) % 360;
    const explore = st.mode === 'explore';
    // Explore reads its ground speed and the camera's height, Race the plane's own.
    $('.fl-speed').textContent = Math.round(st.speed * (explore ? 6371 * 3600 : KMH)).toLocaleString('en');
    $('.fl-alt').textContent = explore ? Math.round(st.h * 6371).toLocaleString('en') : Math.round(((st.alt - 1) / RELIEF) / 10) * 10;
    $('.fl-alt + small').textContent = explore ? 'km' : 'm';
    $('.fl-hdg').textContent = String(Math.round(hdg) % 360).padStart(3, '0');
    $('.fl-log').textContent = legs;
    $('.fl-tape').style.transform = `translateX(${-hdg * 2}px)`;
    const goal = explore ? st.nearest?.city : target;
    const gkm = explore ? st.nearest?.km ?? 0 : km;
    $('.fl-dist').textContent = explore
      ? (below ? `${below.entries.length} take${below.entries.length > 1 ? 's' : ''} · Enter to open` : `nearest ${Math.round(gkm).toLocaleString('en')} km`)
      : km >= 1e8 ? '' : `${Math.round(km).toLocaleString('en')} km · ${Math.floor(st.legT / 60)}:${String(Math.floor(st.legT % 60)).padStart(2, '0')}`;
    goalEl.classList.toggle('far', explore && !below);
    $('.fl-open').disabled = !below;
    if (!goal) return;
    const brg = bearingTo(goal.v) / D2R;
    const rel = ((brg - hdg + 540) % 360) - 180;
    const mark = $('.fl-mark');
    mark.style.transform = `translateX(${Math.max(-118, Math.min(118, rel * 2))}px)`;
    mark.classList.toggle('edge', Math.abs(rel) > 59);
    $('.fl-pullup').classList.toggle('on', st.warn > 0);
    if (explore) return;

    // A marker on the destination: over it while it is in sight, else an
    // arrow at the edge of the screen pointing the way to turn.
    const arrow = $('.fl-arrow');
    v3.copy(target.v).multiplyScalar(groundAtCache()).project(camera);
    const W = innerWidth, H = innerHeight;
    const camD = camera.position.length();
    const inSight = v3.z < 1 && target.v.dot(tmp.copy(camera.position).normalize()) > 1 / camD - 0.002;
    let x = (v3.x * 0.5 + 0.5) * W, y = (-v3.y * 0.5 + 0.5) * H;
    // Keep the marker clear of the goal panel at the top and the gauges below.
    const top = goalEl.offsetTop + goalEl.offsetHeight + 70, bottom = H - gaugesEl.offsetHeight - 40;
    const onScreen = inSight && x > 30 && x < W - 30 && y > top && y < bottom;
    arrow.classList.toggle('there', onScreen);
    if (!onScreen) {
      const a = rel * D2R;
      const rx = W / 2 - 70, ry = H / 2 - 150;
      x = W / 2 + Math.sin(a) * rx; y = Math.max(top - 40, Math.min(bottom - 40, H / 2 - Math.cos(a) * ry));
      arrow.style.setProperty('--rot', rel + 'deg');
    } else arrow.style.setProperty('--rot', '180deg');
    arrow.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    arrow.querySelector('span').textContent = km < 1e8 ? `${Math.round(km).toLocaleString('en')} km` : '';
  }
  let gCache = { id: null, g: 1 };
  function groundAtCache() { if (gCache.id !== target.id) gCache = { id: target.id, g: groundAt(target.v) }; return gCache.g; }

  return { start, stop, get running() { return running; }, get target() { return target; } };
}

// ---------- a low-poly biplane ----------
// Nose toward -z, up +y, right +x, about 1 long. Olive fuselage, doped-linen
// wings with roundels, a taxi-yellow cowling, and an open cockpit with a
// pilot in a leather helmet, goggles and a long red scarf.
function buildPlane(THREE) {
  const group = new THREE.Group();
  const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
  const olive = lam(0x5d6b3f), linen = lam(0xcdbd8c, { emissive: 0x2c2618 }), yellow = lam(0xffc21a, { emissive: 0x2a1d00 }), dark = lam(0x2b2620), metal = lam(0x8a8f94), black = lam(0x121212), tyre = lam(0x1c1c1c);
  const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); group.add(o); return o; };

  // Fuselage: an eight-sided tube tapering to the tail.
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.035, 0.78, 8, 1), olive);
  fus.rotation.x = -Math.PI / 2; fus.position.z = -0.01; group.add(fus);
  // Turtle deck behind the cockpit.
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.02, 0.22, 6, 1, false, -Math.PI / 2, Math.PI), olive);
  deck.rotation.x = -Math.PI / 2; deck.position.set(0, 0.055, 0.24); group.add(deck);
  // Cowling and engine.
  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.1, 0.14, 10, 1), yellow);
  cowl.rotation.x = Math.PI / 2; cowl.position.z = -0.44; group.add(cowl);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.08, 10), black); face.position.z = -0.512; face.rotation.y = Math.PI; group.add(face);
  for (let i = 0; i < 7; i++) { // the radial engine's cylinder heads
    const a = (i / 7) * Math.PI * 2;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.05, 5), metal);
    c.rotation.x = Math.PI / 2; c.position.set(Math.cos(a) * 0.06, Math.sin(a) * 0.06, -0.51); group.add(c);
  }
  // Propeller.
  const prop = new THREE.Group(); prop.position.z = -0.54; group.add(prop);
  const hub = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.07, 8), metal); hub.rotation.x = -Math.PI / 2; hub.position.z = -0.03; prop.add(hub);
  const blades = [];
  for (const s of [1, -1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.22, 0.012), dark); b.position.y = 0.11 * s; b.rotation.y = 0.35 * s; prop.add(b); blades.push(b); }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.23, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }));
  prop.add(disc);

  // Wings: the upper one on cabane struts, the lower through the fuselage.
  // `upper` holds what the cockpit view leaves out.
  const upper = [];
  const n0 = group.children.length;
  box(1.32, 0.026, 0.21, linen, 0, 0.25, -0.24);
  upper.push(group.children[n0]);
  box(1.18, 0.024, 0.19, linen, 0, -0.075, -0.19);
  const n1 = group.children.length;
  for (const x of [-0.46, 0.46]) for (const z of [-0.3, -0.15]) box(0.014, 0.32, 0.014, dark, x, 0.087, z);
  for (const x of [-0.07, 0.07]) for (const z of [-0.3, -0.18]) { const s = box(0.007, 0.19, 0.007, dark, x, 0.16, z); s.rotation.z = x > 0 ? 0.35 : -0.35; }
  // Bracing wires, crossed between the struts.
  for (const x of [-0.46, 0.46]) { const w = box(0.003, 0.5, 0.003, dark, x * 0.55, 0.087, -0.22); w.rotation.z = x > 0 ? -0.95 : 0.95; }
  upper.push(...group.children.slice(n1));
  // Roundels (yellow, blue, white, red) on the top wing and the lower wing's underside.
  const ringM = (c) => new THREE.MeshBasicMaterial({ color: c });
  for (const [y, flip] of [[0.264, false], [-0.088, true]]) for (const x of [-0.45, 0.45]) {
    [[0.075, 0xffc21a], [0.062, 0x24356b], [0.042, 0xf4f1e8], [0.022, 0xb3262b]].forEach(([r, c], i) => {
      const d = new THREE.Mesh(new THREE.CircleGeometry(r, 16), ringM(c));
      d.rotation.x = flip ? Math.PI / 2 : -Math.PI / 2; d.position.set(x, y + (flip ? -i : i) * 0.0008, flip ? -0.19 : -0.24); group.add(d);
      if (!flip) upper.push(d);
    });
  }
  // Tail.
  box(0.42, 0.014, 0.12, linen, 0, 0.01, 0.36);
  const fin = box(0.014, 0.14, 0.12, olive, 0, 0.08, 0.37); fin.rotation.x = -0.15;
  [[0xb3262b, 0.018], [0xf4f1e8, 0.0], [0x24356b, -0.018]].forEach(([c, dz]) => { const s = box(0.016, 0.1, 0.018, lam(c), 0, 0.08, 0.41 + dz); s.rotation.x = -0.15; });
  // Undercarriage.
  for (const x of [-0.13, 0.13]) {
    const leg = box(0.014, 0.17, 0.014, dark, x * 0.6, -0.15, -0.27); leg.rotation.z = x > 0 ? -0.5 : 0.5;
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 10), tyre); wheel.rotation.z = Math.PI / 2; wheel.position.set(x, -0.23, -0.27); group.add(wheel);
  }
  box(0.27, 0.012, 0.012, dark, 0, -0.23, -0.27);
  const skid = box(0.012, 0.05, 0.012, dark, 0, -0.04, 0.4); skid.rotation.x = 0.5;

  // The open cockpit: a dark hole with a padded rim, a little windscreen and
  // an instrument panel with three dials.
  const CZ = 0.11; // the cockpit sits behind the top wing, as in a Tiger Moth
  box(0.12, 0.012, 0.15, black, 0, 0.088, CZ);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.011, 4, 12), lam(0x4a3524)); rim.rotation.x = Math.PI / 2; rim.scale.set(0.9, 1.15, 1);  rim.position.set(0, 0.093, CZ); group.add(rim);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.045), new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
  screen.position.set(0, 0.112, CZ - 0.085); screen.rotation.x = -0.5; group.add(screen);
  const panel = box(0.12, 0.045, 0.01, lam(0x2e2219), 0, 0.083, CZ - 0.07); panel.rotation.x = -0.25;
  for (const x of [-0.035, 0, 0.035]) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.0135, 12), new THREE.MeshBasicMaterial({ color: 0xe9e2cf })); d.position.set(x, 0.085, CZ - 0.0643); d.rotation.x = -0.25; group.add(d);
    const n = new THREE.Mesh(new THREE.PlaneGeometry(0.0018, 0.011), new THREE.MeshBasicMaterial({ color: 0x111111 })); n.position.set(x, 0.085, CZ - 0.0638); n.rotation.x = -0.25; n.rotation.z = x * 30; group.add(n);
  }
  // Exhaust stubs.
  for (const s of [1, -1]) { const e = box(0.012, 0.012, 0.09, metal, s * 0.1, 0.01, -0.36); e.rotation.y = s * 0.15; }

  // The pilot.
  const pilot = new THREE.Group(); pilot.position.set(0, 0.093, CZ); group.add(pilot);
  const jacket = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.06), lam(0x5a3c22)); jacket.position.y = 0.015; pilot.add(jacket);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.035, 1), lam(0x6b4423)); head.position.y = 0.07; pilot.add(head);
  const faceM = new THREE.Mesh(new THREE.IcosahedronGeometry(0.026, 0), lam(0xe0b48f)); faceM.position.set(0, 0.062, -0.017); pilot.add(faceM);
  for (const x of [-0.014, 0.014]) {
    const g = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 8), lam(0x9fc4d8, { emissive: 0x223344 })); g.rotation.x = Math.PI / 2; g.position.set(x, 0.077, -0.034); pilot.add(g);
  }
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.004, 3, 14), black); strap.position.y = 0.077; strap.rotation.x = Math.PI / 2; pilot.add(strap);

  // The scarf: a ribbon of segments that flutters back in the wind.
  const N = 10;
  const sPos = new Float32Array((N + 1) * 2 * 3), idx = [];
  for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const sGeo = new THREE.BufferGeometry(); sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3)); sGeo.setIndex(idx);
  const scarf = new THREE.Mesh(sGeo, new THREE.MeshLambertMaterial({ color: 0xc8202a, side: THREE.DoubleSide, flatShading: true }));
  scarf.position.set(0.012, 0.04, 0.01); scarf.frustumCulled = false; pilot.add(scarf);
  function animate(t, speed) {
    for (let i = 0; i <= N; i++) {
      const u = i / N, z = u * 0.24 * (0.8 + 0.2 * speed);
      const wave = Math.sin(t * 14 * (0.7 + 0.3 * speed) - u * 7) * 0.025 * u;
      const lift = Math.sin(t * 9 - u * 5) * 0.012 * u + u * 0.01;
      const w = 0.014 * (1 - 0.5 * u);
      sPos.set([wave + 0.003, lift + w, z, wave - 0.003, lift - w, z], i * 6);
    }
    sGeo.attributes.position.needsUpdate = true;
    sGeo.computeVertexNormals();
    disc.material.opacity = (blades[0].visible ? 0.05 : 0.03) + 0.03 * speed;
  }

  // Where the pilot's eyes are, for the cockpit camera.
  const eye = new THREE.Vector3(0, 0.2, CZ + 0.03);
  return { group, prop, pilot, eye, upper, blades, animate };
}
