// Flat low-poly world map in SVG (Equal Earth). The terrain is a few thousand
// <path>s, one per facet colour, drawn once; the pins, labels and lineage arcs
// sit in a light overlay SVG that is redrawn every frame. While you pan or
// zoom, the terrain is moved with a CSS transform and redrawn crisply when you
// stop, so even ~32k facets stay smooth.
import { RELIEF, mapTriangles, triangleColor, shade, project, unproject, mapOutline, greatCircle, MAP_W, MAP_H, LIGHT } from './world.js';

const NS = 'http://www.w3.org/2000/svg';
const S = 200; // SVG user units per projection unit
const OVERSCAN = 0.5;
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};

export function pinRadius(place) { return 5 + Math.min(4, (place.entries.length - 1) * 1.6 + (place.original ? 3 : 0)); }

// Muted, print-like colours for the flat map (the globe keeps the full
// palette). Land keeps its hue but loses most of its saturation and is lifted
// toward a warm paper tone; the sea (off by default) is a few flat bands of
// dark water by depth, like Slop New York's map, rather than a shaded surface. Rounding to coarse steps merges
// neighbouring facets of similar colour, so the land reads as broad patches.
const PAPER = [246, 241, 228];
// Water in Slop New York's map palette: graphite blue, darker with depth.
const SEA = [[24, 37, 46], [19, 30, 38], [15, 24, 31], [11, 18, 25]];
const SEA_ICE = [52, 60, 68];
function printInk([r, g, b], land, depth, lat) {
  if (!land) {
    if (lat > 78 || lat < -70) return SEA_ICE;
    return SEA[depth < 200 ? 0 : depth < 2000 ? 1 : depth < 4500 ? 2 : 3];
  }
  const grey = 0.3 * r + 0.59 * g + 0.11 * b;
  return [r, g, b].map((v, i) => {
    const c = (grey + (v - grey) * 0.62) * 0.6 + PAPER[i] * 0.4;
    return Math.max(0, Math.min(255, Math.round(c / 8) * 8));
  });
}

function buildTerrain(world) {
  const { points, grid } = world;
  const t = mapTriangles(points);
  const { coords, ll, triangles } = t;
  const nPts = points.n;
  const hOf = (i) => (i < nPts ? points.h[i] : -3000);
  const groups = new Map();
  const EX = RELIEF; // projection units are Earth radii too
  const lons = [0, 0, 0], lats = [0, 0, 0], hs = [0, 0, 0];
  for (let f = 0; f < triangles.length; f += 3) {
    const a = triangles[f], b = triangles[f + 1], c = triangles[f + 2];
    [a, b, c].forEach((v, k) => { lons[k] = ll[2 * v]; lats[k] = ll[2 * v + 1]; hs[k] = hOf(v); });
    // A facet whose corners straddle the antimeridian on the map is a sliver
    // along the outline; colour it from its corners' own side.
    const { color, land, lat: cLat } = triangleColor(grid, lons, lats, hs);
    // Facet normal in (east, north, up): screen y points south.
    const z = (h) => (land ? Math.max(0, h) : h * 0.25) * EX;
    const ax = coords[2 * a], ay = -coords[2 * a + 1], az = z(hs[0]);
    const bx = coords[2 * b], by = -coords[2 * b + 1], bz = z(hs[1]);
    const cx = coords[2 * c], cy = -coords[2 * c + 1], cz = z(hs[2]);
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const nl = Math.hypot(nx, ny, nz) || 1;
    const ndl = (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / nl;
    // Print look: soft relief shading, no per-facet jitter, muted inks.
    const depth = -(Math.min(0, hs[0]) + Math.min(0, hs[1]) + Math.min(0, hs[2])) / 3;
    // Flat: land is coloured by biome and height only, with no relief shading.
    const rgb = printInk(color, land, depth, cLat);
    const key = (land ? 'l' : 's') + ((rgb[0] << 16) | (rgb[1] << 8) | rgb[2]);
    let d = groups.get(key);
    if (!d) groups.set(key, (d = []));
    d.push(`M${(ax * S).toFixed(1)} ${(-ay * S).toFixed(1)}L${(bx * S).toFixed(1)} ${(-by * S).toFixed(1)}L${(cx * S).toFixed(1)} ${(-cy * S).toFixed(1)}Z`);
  }
  return { groups, facets: triangles.length / 3 };
}

export function createMap2D(container, world, bus) {
  container.classList.add('map2d');
  const terrainSvg = el('svg', { class: 'terrain', 'aria-hidden': 'true' });
  const overlay = el('svg', { class: 'overlay', role: 'img', 'aria-label': 'World map of slop cities' });
  container.append(terrainSvg, overlay);

  // ---- terrain ----
  const defs = el('defs', {}, terrainSvg);
  const outlineD = 'M' + mapOutline(180).map(([lon, lat]) => project(lon, lat).map((v) => (v * S).toFixed(1)).join(' ')).join('L') + 'Z';
  const clip = el('clipPath', { id: 'map-outline' }, defs);
  el('path', { d: outlineD }, clip);
  const glow = el('filter', { id: 'map-glow', x: '-10%', y: '-10%', width: '120%', height: '120%' }, defs);
  el('feGaussianBlur', { stdDeviation: '6' }, glow);
  el('path', { d: outlineD, class: 'outline-glow sea-only', filter: 'url(#map-glow)' }, terrainSvg);
  const tg = el('g', { 'clip-path': 'url(#map-outline)', class: 'facets' }, terrainSvg);
  const seaG = el('g', { class: 'sea' }, tg);
  const landG = el('g', { class: 'land' }, tg);
  const t0 = performance.now();
  const { groups, facets } = buildTerrain(world);
  const frag = document.createDocumentFragment();
  const seaFrag = document.createDocumentFragment();
  for (const [key, d] of groups) {
    const col = '#' + Number(key.slice(1)).toString(16).padStart(6, '0');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d.join(''));
    p.setAttribute('fill', col);
    p.setAttribute('stroke', col);
    (key[0] === 's' ? seaFrag : frag).appendChild(p);
  }
  landG.appendChild(frag);
  seaG.appendChild(seaFrag);
  // Graticule every 30°, faint, over everything.
  let grat = '';
  for (let lon = -150; lon <= 150; lon += 30) { grat += 'M' + Array.from({ length: 37 }, (_, i) => project(lon, -90 + i * 5).map((v) => (v * S).toFixed(1)).join(' ')).join('L'); }
  for (let lat = -60; lat <= 60; lat += 30) { grat += 'M' + Array.from({ length: 73 }, (_, i) => project(-180 + i * 5, lat).map((v) => (v * S).toFixed(1)).join(' ')).join('L'); }
  el('path', { d: grat, class: 'graticule sea-only', 'clip-path': 'url(#map-outline)' }, terrainSvg);
  el('path', { d: outlineD, class: 'outline sea-only' }, terrainSvg);
  const stats = { facets, colours: groups.size, buildMs: Math.round(performance.now() - t0) };

  // ---- overlay: arcs, pins, labels ----
  const arcsG = el('g', { class: 'arcs' }, overlay);
  const pinsG = el('g', { class: 'pins' }, overlay);
  const labelsG = el('g', { class: 'labels' }, overlay);
  const byId = new Map(world.cities.map((p) => [p.id, p]));
  const pins = world.cities.map((p) => {
    const [x, y] = project(p.lon, p.lat);
    const g = el('g', { class: 'pin' + (p.original ? ' original' : ''), tabindex: '0', role: 'button', 'aria-label': `${p.city}${p.country ? ', ' + p.country : ''}: ${p.entries.length} take${p.entries.length > 1 ? 's' : ''}` }, pinsG);
    el('circle', { class: 'pulse', r: 0 }, g);
    el('circle', { class: 'dot' }, g);
    el('circle', { class: 'core' }, g);
    let badge = null;
    if (p.entries.length > 1) badge = el('text', { class: 'badge', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
    if (badge) badge.textContent = p.entries.length;
    const label = el('text', { class: 'label' }, labelsG);
    label.textContent = p.city;
    g.addEventListener('click', (e) => { e.stopPropagation(); bus.emit('select', { id: p.id, source: '2d' }); });
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bus.emit('select', { id: p.id, source: '2d' }); } });
    // The city's name hovers and selects like its pin does. The stylesheet keeps
    // labels out of hit-testing, so turn it back on here; the label's dark halo
    // (its stroke) counts as part of it, which gives a comfortable target.
    label.style.pointerEvents = 'visiblePainted';
    label.style.cursor = 'pointer';
    for (const t of [g, label]) {
      t.addEventListener('pointerenter', () => bus.emit('hover', { id: p.id, source: '2d' }));
      t.addEventListener('pointerleave', () => bus.emit('hover', { id: null, source: '2d' }));
    }
    label.addEventListener('click', (e) => { e.stopPropagation(); bus.emit('select', { id: p.id, source: '2d' }); });
    return { place: p, x: x * S, y: y * S, g, label, badge, w: p.city.length * 6.6 + 4 };
  });
  const arcs = [];
  for (const p of world.cities) for (const parentId of p.parents) {
    const q = byId.get(parentId);
    const gc = greatCircle(q.lon, q.lat, p.lon, p.lat, 64);
    // Split where the arc jumps across the map's edge.
    const segs = [[]];
    let prev = null;
    for (const { ll: [lon, lat] } of gc) {
      if (prev !== null && Math.abs(lon - prev) > 180) segs.push([]);
      segs[segs.length - 1].push(project(lon, lat).map((v) => v * S));
      prev = lon;
    }
    const d = segs.filter((s) => s.length > 1).map((s) => 'M' + s.map((q) => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L')).join('');
    const path = el('path', { d, class: 'arc' + (parentId !== 'new-york' ? ' remix' : '') }, arcsG);
    arcs.push({ path, from: q.id, to: p.id, phase: Math.random() * 11 });
  }

  // ---- view ----
  let W = 1, H = 1;
  const view = { x: 0, y: 0, z: 1 }; // centre in SVG units, zoom (1 = fit)
  let committed = { ...view };
  let fit = 1;
  let selected = null, hovered = null;
  let filter = null; // ids to show, or null for every city
  const opts = { arcs: false, labels: true, ocean: false };

  const k = () => fit * view.z; // pixels per SVG unit
  function clampView() {
    view.z = Math.min(40, Math.max(0.8, view.z));
    const hw = (MAP_W * S) / 2, hh = (MAP_H * S) / 2;
    // Zoomed in on a phone, allow the map's edge to come a quarter of the way in, so a
    // place near the edge (or under a card) can still be centred.
    const slack = view.z > 1.2 && matchMedia('(max-width: 820px)').matches ? 0.25 / k() : 0;
    const mx = Math.max(0, hw - W / 2 / k()) + W * slack, my = Math.max(0, hh - H / 2 / k()) + H * slack;
    view.x = Math.min(mx, Math.max(-mx, view.x));
    view.y = Math.min(my, Math.max(-my, view.y));
  }
  function commit() {
    committed = { ...view };
    const kk = fit * view.z;
    const vw = W / kk, vh = H / kk;
    const ox = W * OVERSCAN, oy = H * OVERSCAN;
    terrainSvg.setAttribute('width', W + 2 * ox);
    terrainSvg.setAttribute('height', H + 2 * oy);
    terrainSvg.setAttribute('viewBox', `${view.x - vw / 2 - ox / kk} ${view.y - vh / 2 - oy / kk} ${vw + (2 * ox) / kk} ${vh + (2 * oy) / kk}`);
    terrainSvg.style.left = -ox + 'px';
    terrainSvg.style.top = -oy + 'px';
    terrainSvg.style.transform = '';
    container.classList.toggle('zoomed', view.z > 3);
  }
  let commitTimer = 0;
  function render(immediate, emit = true) {
    clampView();
    const kk = k();
    const s = view.z / committed.z;
    const ox = W * OVERSCAN, oy = H * OVERSCAN;
    // screen = s * screen_committed + t (see header comment)
    const tx = (W / 2 + ox) * (1 - s) + (committed.x - view.x) * kk;
    const ty = (H / 2 + oy) * (1 - s) + (committed.y - view.y) * kk;
    terrainSvg.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    clearTimeout(commitTimer);
    if (immediate) commit(); else commitTimer = setTimeout(commit, 140);
    overlay.setAttribute('viewBox', `${view.x - W / 2 / kk} ${view.y - H / 2 / kk} ${W / kk} ${H / kk}`);
    drawOverlay();
    if (emit) bus.emit('view', { source: '2d', ...getView() });
  }

  function drawOverlay() {
    const kk = k(), u = 1 / kk; // one screen pixel in SVG units
    overlay.style.setProperty('--px', u);
    arcsG.style.display = opts.arcs ? '' : 'none';
    for (const a of arcs) {
      const on = !selected || a.to === selected || a.from === selected;
      a.path.classList.toggle('dim', !on);
      a.path.classList.toggle('hot', !!selected && on && (a.to === selected || (a.from === selected && selected !== 'new-york')));
      a.path.style.strokeWidth = (a.path.classList.contains('hot') ? 2.2 : 1.3) * u;
      a.path.style.strokeDasharray = `${6 * u} ${5 * u}`;
    }
    const placed = [];
    // Labels: selected and hovered first, then New York, then most takes; drop overlaps.
    const order = [...pins].sort((a, b) => score(b) - score(a));
    function score(p) { return (p.place.id === selected ? 1000 : 0) + (p.place.id === hovered ? 900 : 0) + (p.place.original ? 100 : 0) + p.place.entries.length * 10 - p.place.city.length * 0.01; }
    for (const p of order) {
      const r = pinRadius(p.place) * (p.place.id === selected ? 1.3 : 1);
      p.g.setAttribute('transform', `translate(${p.x} ${p.y}) scale(${u})`);
      p.g.querySelector('.dot').setAttribute('r', r);
      p.g.querySelector('.core').setAttribute('r', p.place.original ? r * 0.45 : r * 0.38);
      p.g.querySelector('.pulse').setAttribute('r', r);
      if (p.badge) p.badge.setAttribute('font-size', 8);
      p.g.classList.toggle('selected', p.place.id === selected);
      p.g.classList.toggle('hovered', p.place.id === hovered);
      const filteredOut = filter && !filter.has(p.place.id) && p.place.id !== selected;
      p.g.classList.toggle('dim', !!selected && p.place.id !== selected && !relatives.has(p.place.id));
      p.g.classList.toggle('filtered', !!filteredOut);
      // screen-space box for collision
      const sx = (p.x - view.x) * kk + W / 2, sy = (p.y - view.y) * kk + H / 2;
      const box = [sx + r + 3, sy - 8, sx + r + 3 + p.w, sy + 8];
      const off = sx < -50 || sx > W + 50 || sy < -20 || sy > H + 20;
      const force = p.place.id === selected || p.place.id === hovered;
      const show = !off && !filteredOut && (force || (opts.labels && !placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])));
      if (show) placed.push(box);
      p.label.style.display = show ? '' : 'none';
      if (show) {
        p.label.setAttribute('x', p.x + (r + 4) * u);
        p.label.setAttribute('y', p.y + 4 * u);
        p.label.setAttribute('font-size', 12 * u);
        p.label.setAttribute('stroke-width', 3 * u);
        p.label.classList.toggle('strong', force || p.place.original);
      }
      // Keep pins dodging their own label pass: pins always drawn.
    }
    // Draw the hovered/selected pin on top.
    for (const p of pins) if (p.place.id === selected || p.place.id === hovered) pinsG.appendChild(p.g);
  }
  let relatives = new Set();

  // ---- interaction ----
  const pointers = new Map();
  let lastPinch = 0, moved = 0, anim = 0;
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.pin, .label')) return;
    overlay.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
    cancelAnimationFrame(anim);
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; lastPinch = Math.hypot(a.x - b.x, a.y - b.y); }
    container.classList.add('dragging');
  });
  overlay.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) {
      moved += Math.abs(dx) + Math.abs(dy);
      view.x -= dx / k(); view.y -= dy / k();
      render();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = overlay.getBoundingClientRect();
      zoomAt((a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top, d / (lastPinch || d));
      lastPinch = d;
      moved += 10;
    }
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (!pointers.size) container.classList.remove('dragging');
    if (pointers.size === 1) lastPinch = 0;
  };
  overlay.addEventListener('pointerup', (e) => {
    const wasClick = pointers.size === 1 && moved < 4;
    up(e);
    if (wasClick && !e.target.closest('.pin, .label')) {
      // Click on the map: pick the nearest pin within 18 px, else clear.
      const rect = overlay.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      let best = null, bd = 18;
      for (const p of pins) {
        const d = Math.hypot((p.x - view.x) * k() + W / 2 - px, (p.y - view.y) * k() + H / 2 - py);
        if (d < bd) { bd = d; best = p; }
      }
      bus.emit('select', { id: best ? best.place.id : null, source: '2d' });
    }
  });
  overlay.addEventListener('pointercancel', up);
  overlay.addEventListener('wheel', (e) => {
    e.preventDefault();
    cancelAnimationFrame(anim);
    const rect = overlay.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0018)));
  }, { passive: false });
  overlay.addEventListener('dblclick', (e) => {
    const rect = overlay.getBoundingClientRect();
    animateZoomAt(e.clientX - rect.left, e.clientY - rect.top, 2.2);
  });
  function zoomAt(px, py, f) {
    const kk = k();
    const mx = view.x + (px - W / 2) / kk, my = view.y + (py - H / 2) / kk;
    view.z *= f;
    clampView();
    const k2 = k();
    view.x = mx - (px - W / 2) / k2; view.y = my - (py - H / 2) / k2;
    render();
  }
  function animateZoomAt(px, py, f) {
    const start = performance.now(), z0 = view.z;
    cancelAnimationFrame(anim);
    const step = (t) => {
      const u = Math.min(1, (t - start) / 320), e = 1 - (1 - u) ** 3;
      const target = z0 * f ** e;
      zoomAt(px, py, target / view.z);
      if (u < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  // shiftY: put the place this many pixels above the centre (to clear a card).
  function flyTo(lon, lat, zoom, ms = 700, shiftY = 0) {
    const [tx, ty] = project(lon, lat).map((v) => v * S);
    const tz = zoom ?? Math.max(view.z, 3);
    const from = { ...view }, to = { x: tx, y: ty + shiftY / (fit * tz), z: tz };
    cancelAnimationFrame(anim);
    if (!ms) { Object.assign(view, to); render(true); return; }
    const start = performance.now();
    // Zoom out a little mid-flight when the hop is long, like a map app.
    const dist = Math.hypot(to.x - from.x, to.y - from.y) * fit;
    const bump = Math.min(0.6, dist / Math.max(W, H) / Math.max(from.z, to.z) * 2);
    const step = (t) => {
      const u = Math.min(1, (t - start) / ms), e = u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
      view.x = from.x + (to.x - from.x) * e;
      view.y = from.y + (to.y - from.y) * e;
      view.z = Math.exp(Math.log(from.z) + (Math.log(to.z) - Math.log(from.z)) * e) * (1 - bump * Math.sin(Math.PI * u));
      render(u === 1);
      if (u < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  function getView() {
    const [lon, lat] = unproject(view.x / S, view.y / S);
    return { lon, lat, zoom: view.z };
  }
  function setView({ lon, lat, zoom }) {
    cancelAnimationFrame(anim);
    const [x, y] = project(Math.max(-179.9, Math.min(179.9, lon)), lat).map((v) => v * S);
    view.x = x; view.y = y; if (zoom) view.z = zoom;
    clampView();
    const kk = k();
    overlay.setAttribute('viewBox', `${view.x - W / 2 / kk} ${view.y - H / 2 / kk} ${W / kk} ${H / kk}`);
    const s = view.z / committed.z, ox = W * OVERSCAN, oy = H * OVERSCAN;
    terrainSvg.style.transform = `translate(${(W / 2 + ox) * (1 - s) + (committed.x - view.x) * kk}px, ${(H / 2 + oy) * (1 - s) + (committed.y - view.y) * kk}px) scale(${s})`;
    clearTimeout(commitTimer); commitTimer = setTimeout(commit, 140);
    drawOverlay();
  }

  function resize() {
    const r = container.getBoundingClientRect();
    if (!r.width || !r.height) return;
    W = r.width; H = r.height;
    fit = Math.min(W / (MAP_W * S), H / (MAP_H * S)) * 0.96;
    overlay.setAttribute('width', W); overlay.setAttribute('height', H);
    clampView();
    render(true, false);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  function setSelected(id) {
    selected = id;
    relatives = new Set();
    if (id) for (const a of arcs) { if (a.to === id) relatives.add(a.from); if (a.from === id && id !== 'new-york') relatives.add(a.to); }
    drawOverlay();
  }
  function setFilter(ids) { filter = ids; drawOverlay(); }
  function setHovered(id) { hovered = id; drawOverlay(); }
  function setOptions(o) {
    Object.assign(opts, o);
    container.classList.toggle('no-ocean', !opts.ocean);
    drawOverlay();
  }
  container.classList.toggle('no-ocean', !opts.ocean);
  function zoomBy(f) { animateZoomAt(W / 2, H / 2, f); }
  function reset() { flyTo(0, 0, 1); }

  // Arcs flow from parent to child: march their dashes along.
  let flowing = true;
  let flowRaf = 0;
  (function flow(t) {
    if (flowing && opts.arcs && container.offsetParent !== null) {
      const u = 1 / k();
      for (const a of arcs) a.path.style.strokeDashoffset = (-(t / 1000) * 14 - a.phase) * u;
    }
    flowRaf = requestAnimationFrame(flow);
  })(0);
  function setFlowing(on) { flowing = on; }

  // Tear down before building the map again (e.g. in another projection).
  function destroy() {
    ro.disconnect();
    cancelAnimationFrame(flowRaf);
    cancelAnimationFrame(anim);
    clearTimeout(commitTimer);
    container.replaceChildren();
    container.classList.remove('map2d', 'no-ocean', 'zoomed', 'dragging');
  }

  return { destroy, setFilter, setSelected, setHovered, setOptions, setFlowing, flyTo, getView, setView, resize, zoomBy, reset, stats, el: container };
}
