// Low-poly 3D globe in three.js, built from the same points, heights and
// facet colours as the flat map: every vertex is pushed out by its height
// (the same exaggeration the map's shading uses), every face is flat-shaded.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { sphereTriangles, triangleColor, toXYZ, greatCircle, RELIEF } from './world.js';
import { pinRadius } from './map2d.js';

const D2R = Math.PI / 180;

// Map zoom <-> camera distance, matched so both views span about the same
// ground when zoomed in (zoom 1 = whole map = whole hemisphere).
export function distForZoom(z) { return 1 + 8 / (Math.max(0.3, z) + 2.48); }
export function zoomForDist(d) { return Math.max(0.3, 8 / Math.max(0.01, d - 1) - 2.48); }

function buildGlobeGeometry(world) {
  const { points, grid } = world;
  const { triangles } = sphereTriangles(points);
  const nF = triangles.length / 3;
  const pos = new Float32Array(nF * 9), col = new Float32Array(nF * 9);
  const radius = new Float32Array(points.n);
  for (let i = 0; i < points.n; i++) { const h = points.h[i]; radius[i] = 1 + (h > 0 ? h : h * 0.25) * RELIEF; }
  const lons = [0, 0, 0], lats = [0, 0, 0], hs = [0, 0, 0];
  const c = new THREE.Color();
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (let f = 0; f < nF; f++) {
    let ids = [triangles[3 * f], triangles[3 * f + 1], triangles[3 * f + 2]];
    ids.forEach((id, k) => { lons[k] = points.lon[id]; lats[k] = points.lat[id]; hs[k] = points.h[id]; v[k].set(...toXYZ(points.lon[id], points.lat[id], radius[id])); });
    // Outward winding.
    e1.subVectors(v[1], v[0]); e2.subVectors(v[2], v[0]); nrm.crossVectors(e1, e2);
    if (nrm.dot(v[0]) < 0) { [v[1], v[2]] = [v[2], v[1]]; }
    const { color } = triangleColor(grid, lons, lats, hs);
    const jitter = 1 + (((ids[0] * 7919 + ids[1] * 104729 + ids[2] * 1299709) % 1000) / 1000 - 0.5) * 0.1;
    c.setRGB((color[0] / 255) * jitter, (color[1] / 255) * jitter, (color[2] / 255) * jitter, THREE.SRGBColorSpace);
    for (let k = 0; k < 3; k++) {
      pos.set([v[k].x, v[k].y, v[k].z], f * 9 + k * 3);
      col.set([c.r, c.g, c.b], f * 9 + k * 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals(); // non-indexed: per-face normals, i.e. flat shading
  return { geometry: g, facets: nF };
}

function atmosphere() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(1.16, 64, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float i = pow(max(0.0, 0.72 - dot(vN, vV)), 5.0); gl_FragColor = vec4(0.55, 0.7, 0.9, 1.0) * min(1.0, i * 0.22); }',
    }),
  );
}

function stars() {
  const n = 1400, p = new Float32Array(n * 3);
  let s = 3;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1, t = r() * Math.PI * 2, R = 40 + r() * 20, q = Math.sqrt(1 - u * u);
    p.set([R * q * Math.cos(t), R * u, R * q * Math.sin(t)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd8d6d0, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.7 }));
}

function clouds() {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x6a7894, flatShading: true, transparent: true, opacity: 0.88 });
  const base = new THREE.IcosahedronGeometry(1, 0);
  let s = 11;
  const r = () => ((s = (s * 48271) % 2147483647) / 2147483647);
  for (let i = 0; i < 46; i++) {
    const lat = (r() * 2 - 1) * 65, lon = r() * 360 - 180;
    const cl = new THREE.Group();
    const puffs = 3 + Math.floor(r() * 3);
    for (let k = 0; k < puffs; k++) {
      const m = new THREE.Mesh(base, mat);
      const sz = 0.011 + r() * 0.012;
      m.scale.set(sz * 1.3, sz * 0.8, sz);
      m.position.set((k - puffs / 2) * 0.017 + r() * 0.006, r() * 0.006, r() * 0.01 - 0.005);
      m.rotation.set(r() * 3, r() * 3, r() * 3);
      cl.add(m);
    }
    const p = new THREE.Vector3(...toXYZ(lon, lat, 1.06 + r() * 0.02));
    cl.position.copy(p);
    cl.lookAt(0, 0, 0);
    cl.rotateZ(r() * Math.PI);
    group.add(cl);
  }
  return group;
}

const arcVertex = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const arcFragment = `
  uniform float uTime; uniform float uLen; uniform vec3 uColor; uniform float uOpacity; uniform float uPhase;
  varying vec2 vUv;
  void main(){
    float d = vUv.x * uLen * 60.0 - uTime * 0.9 - uPhase;
    float dash = smoothstep(0.0, 0.15, fract(d)) * (1.0 - smoothstep(0.5, 0.65, fract(d)));
    float ends = smoothstep(0.0, 0.03, vUv.x) * smoothstep(1.0, 0.97, vUv.x);
    gl_FragColor = vec4(uColor, (0.25 + 0.75 * dash) * ends * uOpacity);
  }`;

export async function createGlobe3D(container, world, bus) {
  container.classList.add('globe3d');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  const labelsEl = document.createElement('div');
  labelsEl.className = 'globe-labels';
  container.appendChild(labelsEl);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
  camera.position.set(...toXYZ(10, 25, 3.3));
  scene.add(camera);

  const t0 = performance.now();
  const { geometry, facets } = buildGlobeGeometry(world);
  const globeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const globe = new THREE.Mesh(geometry, globeMat);
  scene.add(globe);
  const stats = { facets, buildMs: Math.round(performance.now() - t0) };
  scene.add(atmosphere());
  scene.add(stars());
  const cloudLayer = clouds();
  scene.add(cloudLayer);

  // Light from the viewer's upper left, like the flat map's north-west light.
  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x334466, 1.25));
  const sun = new THREE.DirectionalLight(0xfff3df, 2.1);
  sun.position.set(-2.5, 2.5, 3.5);
  camera.add(sun);
  camera.add(sun.target);

  // ---- pins ----
  const pinsGroup = new THREE.Group();
  globe.add(pinsGroup);
  const headGeo = new THREE.IcosahedronGeometry(1, 1);
  const stemGeo = new THREE.CylinderGeometry(0.18, 0.02, 1, 6, 1);
  stemGeo.translate(0, 0.5, 0);
  const hitGeo = new THREE.SphereGeometry(1, 8, 6);
  // Slop New York's HUD colours: white markers, taxi yellow for New York and for the selection.
  const colPin = new THREE.Color('#f6f5f2'), colOrig = new THREE.Color('#ffc21a'), colSel = new THREE.Color('#ffc21a');
  const pins = world.cities.map((p) => {
    const g = new THREE.Group();
    const up = new THREE.Vector3(...toXYZ(p.lon, p.lat)).normalize();
    const ground = 1 + Math.max(0, heightNear(world, p)) * RELIEF;
    g.position.copy(up).multiplyScalar(ground);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    const mat = new THREE.MeshLambertMaterial({ color: p.original ? colOrig : colPin, flatShading: true, emissive: p.original ? 0x4a3500 : 0x202020 });
    const stem = new THREE.Mesh(stemGeo, mat);
    const head = new THREE.Mesh(headGeo, mat);
    const hit = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
    hit.userData.id = p.id;
    g.add(stem, head, hit);
    pinsGroup.add(g);
    const label = document.createElement('div');
    label.className = 'glabel' + (p.original ? ' original' : '');
    label.innerHTML = `<span></span>${p.entries.length > 1 ? `<b>${p.entries.length}</b>` : ''}`;
    label.firstChild.textContent = p.city;
    label.addEventListener('click', () => bus.emit('select', { id: p.id, source: '3d' }));
    label.addEventListener('pointerenter', () => bus.emit('hover', { id: p.id, source: '3d' }));
    label.addEventListener('pointerleave', () => bus.emit('hover', { id: null, source: '3d' }));
    labelsEl.appendChild(label);
    return { place: p, g, stem, head, hit, mat, up, label, size: pinRadius(p) / 5 };
  });
  function heightNear(w, p) {
    // Highest point among the mesh vertices near the city, so the pin never sinks into a facet.
    let best = -1e9;
    for (let i = 0; i < w.points.n; i++) {
      const dl = Math.abs(w.points.lat[i] - p.lat);
      if (dl > 2.5) continue;
      let dn = Math.abs(w.points.lon[i] - p.lon); if (dn > 180) dn = 360 - dn;
      if (dn * Math.cos(p.lat * D2R) > 2.5) continue;
      best = Math.max(best, w.points.h[i]);
    }
    return best;
  }

  // ---- lineage arcs ----
  const byId = new Map(world.cities.map((p) => [p.id, p]));
  const arcsGroup = new THREE.Group();
  globe.add(arcsGroup);
  const arcs = [];
  for (const p of world.cities) for (const parentId of p.parents) {
    const q = byId.get(parentId);
    const gc = greatCircle(q.lon, q.lat, p.lon, p.lat, 80);
    const lift = 0.03 + gc[0].angle * 0.13;
    const pts = gc.map(({ t, xyz }) => new THREE.Vector3(...xyz).multiplyScalar(1.02 + Math.sin(Math.PI * t) * lift));
    const curve = new THREE.CatmullRomCurve3(pts);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uLen: { value: gc[0].angle + lift }, uColor: { value: new THREE.Color(parentId === 'new-york' ? '#ffc21a' : '#5fd0ff') }, uOpacity: { value: 0.85 }, uPhase: { value: Math.random() * 10 } },
      vertexShader: arcVertex, fragmentShader: arcFragment,
    });
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 0.0032, 5, false), mat);
    arcsGroup.add(mesh);
    arcs.push({ mesh, mat, from: q.id, to: p.id });
  }

  // ---- controls ----
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 1.12;
  controls.maxDistance = 6;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;
  controls.zoomSpeed = 0.8;
  let idleTimer = 0, userDriving = false;
  controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(idleTimer); userDriving = true; cancelFly(); });
  controls.addEventListener('end', () => { userDriving = false; idleTimer = setTimeout(() => { if (opts.spin && !selected) controls.autoRotate = true; }, 6000); });

  // ---- picking ----
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (game) return;
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const id = pick(e);
    bus.emit('select', { id, source: '3d' });
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.buttons || game) return;
    const id = pick(e);
    if (id !== hovered) bus.emit('hover', { id, source: '3d' });
    renderer.domElement.style.cursor = id ? 'pointer' : '';
  });
  function pick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([globe, ...pins.map((p) => p.hit)], false);
    for (const h of hits) { if (h.object === globe) return null; if (h.object.userData.id) return h.object.userData.id; }
    return null;
  }

  // ---- state ----
  let selected = null, hovered = null, relatives = new Set();
  let game = null, target = null; // the flight game's step function and destination
  let filter = null; // ids to show, or null for every city
  const opts = { arcs: false, labels: true, spin: true, clouds: true };
  let W = 1, H = 1;

  function resize() {
    const r = container.getBoundingClientRect();
    if (!r.width || !r.height) return;
    W = r.width; H = r.height;
    renderer.setSize(W, H, false);
    renderer.domElement.style.width = W + 'px';
    renderer.domElement.style.height = H + 'px';
    camera.aspect = W / H;
    // Keep the horizontal field of view in tall panes, so the globe fits.
    camera.fov = camera.aspect < 1 ? (2 * Math.atan(Math.tan(19 * D2R) / camera.aspect)) / D2R : 38;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  // ---- camera flights ----
  let fly = null;
  function cancelFly() { fly = null; }
  function flyTo(lon, lat, zoom, ms = 1100) {
    const dist = zoom ? distForZoom(zoom) : Math.min(camera.position.length(), 2.2);
    const from = camera.position.clone();
    const to = new THREE.Vector3(...toXYZ(lon, lat, 1)).normalize();
    controls.autoRotate = false;
    if (!ms) { camera.position.copy(to.multiplyScalar(dist)); camera.lookAt(0, 0, 0); controls.update(); return; }
    fly = { from: from.clone().normalize(), to, d0: from.length(), d1: dist, start: performance.now(), ms };
  }
  function stepFly(now) {
    if (!fly) return;
    const u = Math.min(1, (now - fly.start) / fly.ms), e = u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
    const ang = fly.from.angleTo(fly.to);
    const dir = new THREE.Vector3().copy(fly.from);
    if (ang > 1e-4) {
      const axis = new THREE.Vector3().crossVectors(fly.from, fly.to).normalize();
      dir.applyAxisAngle(axis, ang * e);
    }
    const bump = Math.min(0.9, ang * 0.5) * Math.sin(Math.PI * u);
    camera.position.copy(dir.multiplyScalar(fly.d0 + (fly.d1 - fly.d0) * e + bump));
    camera.lookAt(0, 0, 0);
    if (u >= 1) fly = null;
  }

  function getView() {
    const p = camera.position;
    const d = p.length();
    const lat = Math.asin(p.y / d) / D2R, lon = Math.atan2(-p.z, p.x) / D2R;
    return { lon, lat, zoom: zoomForDist(d) };
  }
  function setView({ lon, lat, zoom }) {
    cancelFly();
    controls.autoRotate = false;
    const d = zoom ? distForZoom(zoom) : camera.position.length();
    camera.position.set(...toXYZ(lon, Math.max(-85, Math.min(85, lat)), d));
    camera.lookAt(0, 0, 0);
    clearTimeout(idleTimer);
  }

  // ---- labels in screen space ----
  const tmp = new THREE.Vector3(), camDir = new THREE.Vector3();
  function drawLabels() {
    camDir.copy(camera.position).normalize();
    const placed = [];
    const order = [...pins].sort((a, b) => score(b) - score(a));
    function score(p) { return (p.place.id === target ? 2000 : 0) + (p.place.id === selected ? 1000 : 0) + (p.place.id === hovered ? 900 : 0) + (p.place.original ? 100 : 0) + p.place.entries.length * 10; }
    const dist = camera.position.length();
    for (const p of order) {
      const facing = p.up.dot(camDir);
      // Pin scale: constant-ish on screen, a little bigger when zoomed out.
      // In flight, a size on screen from the pin's own distance, small beside the plane.
      const s = (game ? 0.0035 * p.size * Math.min(0.5, tmp.copy(p.g.position).distanceTo(camera.position)) : 0.0075 * p.size * Math.pow(dist - 0.95, 0.75)) * (p.place.id === selected || p.place.id === target ? 1.35 : 1);
      p.stem.scale.set(s * 1.4, s * 4.5, s * 1.4);
      p.head.position.set(0, s * 4.5, 0);
      p.head.scale.setScalar(s * 1.25);
      p.hit.position.copy(p.head.position);
      p.hit.scale.setScalar(s * 3);
      const filteredOut = !!filter && !filter.has(p.place.id) && p.place.id !== selected;
      p.g.visible = !filteredOut;
      const dim = !!selected && p.place.id !== selected && !relatives.has(p.place.id);
      p.mat.color.copy(p.place.id === selected || p.place.id === target ? colSel : p.place.original ? colOrig : colPin);
      p.mat.opacity = dim ? 0.35 : 1; p.mat.transparent = dim;
      tmp.set(0, s * 5.6, 0); p.g.localToWorld(tmp);
      tmp.project(camera);
      const x = (tmp.x * 0.5 + 0.5) * W, y = (-tmp.y * 0.5 + 0.5) * H;
      const force = p.place.id === selected || p.place.id === hovered || p.place.id === target;
      const w = p.place.city.length * 6.8 + (p.place.entries.length > 1 ? 18 : 0) + 12;
      const box = [x - w / 2, y - 22, x + w / 2, y - 4];
      // In flight, low over the ground, hide what is past the horizon.
      const horizon = game ? 1 / dist - 0.004 : 0.12;
      const visible = !filteredOut && facing > horizon && x > -40 && x < W + 40 && y > -20 && y < H + 30;
      const show = visible && (force || (opts.labels && !placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])));
      if (show) placed.push(box);
      p.label.style.display = show ? '' : 'none';
      if (show) {
        p.label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
        p.label.style.opacity = Math.min(1, (facing - horizon) * (game ? 60 : 6));
        p.label.classList.toggle('strong', force);
        p.label.classList.toggle('dim', dim);
      }
    }
  }

  // ---- loop ----
  let running = true, lastView = '';
  const clock = new THREE.Clock();
  function frame(now) {
    requestAnimationFrame(frame);
    if (!running || container.offsetParent === null) return;
    const dt = Math.min(0.05, clock.getDelta());
    if (game) game(dt, now);
    else {
      stepFly(now);
      // Slower rotation when zoomed in.
      controls.rotateSpeed = Math.max(0.12, Math.min(1, (camera.position.length() - 1) * 0.6));
      controls.update();
    }
    if (opts.clouds) cloudLayer.rotation.y += dt * 0.01;
    cloudLayer.visible = opts.clouds;
    arcsGroup.visible = opts.arcs;
    for (const a of arcs) {
      a.mat.uniforms.uTime.value = now / 1000;
      const on = !selected || a.to === selected || a.from === selected;
      a.mat.uniforms.uOpacity.value = on ? (selected ? 1 : 0.8) : 0.12;
    }
    renderer.render(scene, camera);
    drawLabels();
    const v = getView();
    const key = `${v.lon.toFixed(3)},${v.lat.toFixed(3)},${v.zoom.toFixed(3)}`;
    if (!game && key !== lastView && (userDriving || fly || controls.autoRotate)) bus.emit('view', { source: '3d', ...v });
    lastView = key;
  }
  requestAnimationFrame(frame);

  function setSelected(id) {
    selected = id;
    relatives = new Set();
    if (id) for (const a of arcs) { if (a.to === id) relatives.add(a.from); if (a.from === id && id !== 'new-york') relatives.add(a.to); }
    if (id) { controls.autoRotate = false; clearTimeout(idleTimer); }
  }
  function setFilter(ids) { filter = ids; }
  function setHovered(id) { hovered = id; }
  function setOptions(o) {
    Object.assign(opts, o);
    if ('spin' in o) controls.autoRotate = o.spin && !selected;
  }
  function zoomBy(f) {
    const d = camera.position.length();
    const nd = Math.min(controls.maxDistance, Math.max(controls.minDistance, 1 + (d - 1) / f));
    fly = { from: camera.position.clone().normalize(), to: camera.position.clone().normalize(), d0: d, d1: nd, start: performance.now(), ms: 350 };
  }
  function reset() { flyTo(10, 20, 1); }

  // The flight game takes over the camera: step(dt, now) runs each frame in
  // place of the orbit controls, and the globe goes on drawing pins and labels.
  function startGame(step) {
    game = step;
    cancelFly();
    controls.enabled = false; controls.autoRotate = false;
    clearTimeout(idleTimer);
  }
  function endGame() {
    if (!game) return;
    game = null; target = null;
    camera.up.set(0, 1, 0);
    camera.near = 0.01; camera.far = 200;
    resize();
    const v = getView();
    camera.lookAt(0, 0, 0);
    controls.enabled = true;
    flyTo(v.lon, v.lat, 3, 1400);
  }
  function setTarget(id) { target = id; }
  function setRunning(on) { running = on; if (on) clock.getDelta(); }

  return {
    setFilter, setSelected, setHovered, setOptions, flyTo, getView, setView, resize, zoomBy, reset, setRunning, stats, el: container, renderer,
    startGame, endGame, setTarget, engine: { THREE, scene, camera, globe, geometry },
  };
}
