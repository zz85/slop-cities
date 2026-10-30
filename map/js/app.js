// App shell: city list, search, city card, Map / Globe / Compare modes, and
// the wiring that keeps selection (and, in Compare, the view) in sync.
import { loadWorld, distanceKm, setProjection, projectionId, PROJECTIONS } from './world.js';
import { createMap2D } from './map2d.js';
import { createMusic } from './music.js';
import { createSfx } from './sfx.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const bus = {
  h: {},
  on(t, f) { (this.h[t] ||= []).push(f); },
  emit(t, d) { for (const f of this.h[t] || []) f(d); },
};

const world = await loadWorld('./data/');
const places = world.cities;
const byId = new Map(places.map((p) => [p.id, p]));
const ny = byId.get('new-york');

// The projection is read from the URL before the map is first built.
setProjection(new URLSearchParams(location.hash.slice(1)).get('proj') || 'patterson');
let map = createMap2D($('#stage-2d'), world, bus);
let globe = null, globePromise = null;
function ensureGlobe() {
  if (!globePromise) {
    globePromise = import('./globe3d.js')
      .then(({ createGlobe3D }) => createGlobe3D($('#stage-3d'), world, bus))
      .then((g) => {
        globe = g;
        $('#loading-3d').hidden = true;
        g.setOptions(currentOpts());
        g.setSelected(state.selected);
        g.setFilter(state.tag ? new Set(places.filter((p) => p.tags.includes(state.tag)).map((p) => p.id)) : null);
        if (state.selected) { const p = byId.get(state.selected); g.flyTo(p.lon, p.lat, 3.5, 0); }
        else if (state.mode === 'compare' && $('#opt-link').checked) g.setView(map.getView());
        return g;
      })
      .catch((e) => { $('#loading-3d').textContent = 'The globe needs WebGL: ' + e.message; throw e; });
  }
  return globePromise;
}

const state = { mode: '3d', selected: null, hovered: null, query: '', tag: null };

// ---------- stats + list ----------
const takes = places.reduce((n, p) => n + p.entries.length, 0);
const countries = new Set(places.map((p) => p.country || p.city)).size;
const far = places.filter((p) => !p.original).reduce((a, p) => (distanceKm(ny.lon, ny.lat, p.lon, p.lat) > distanceKm(ny.lon, ny.lat, a.lon, a.lat) ? p : a));
$('#brand-sub').textContent = `World map · ${places.length} cities · ${takes} takes · ${countries} countries`;
$('#stats').innerHTML = `${ny.remixes.length} New York remixes · farthest from New York: ${esc(far.city)}, ${Math.round(distanceKm(ny.lon, ny.lat, far.lon, far.lat)).toLocaleString()} km`;

const REGIONS = ['North America', 'South America', 'Europe', 'Africa', 'Asia'];
// ---------- labels and ranking ----------
// An entry's *(...)* markers in the README are either a status (source only,
// WIP, unverified) or a label the list's editor gives a take, such as
// *(editor's pick)*, *(slop inspired)*, *(isometric)* or *(tiny)*. Labels are
// free text: each one becomes a badge on the card and a filter chip. Where a
// city has several takes, an editor's pick comes first, then the README order.
// Picks are the takes the list's editor highlights: `pick: true` in cities.yml
// (an older *(editor's pick)* flag counts too). They come first on a city's
// card, carry a Pick badge and have their own filter.
const STATUS = /^(source only|wip|unverified)$/i;
const PICK_FLAG = /^editor'?s pick$/i;
const rankOf = (e) => (e.pick ? 0 : 1);
for (const p of places) {
  p.entries.forEach((e, i) => {
    const flags = e.flags.flatMap((f) => f.split(/\s*,\s*/));
    e.status = flags.filter((f) => STATUS.test(f));
    e.pick = e.pick || flags.some((f) => PICK_FLAG.test(f));
    e.labels = flags.filter((f) => !STATUS.test(f) && !PICK_FLAG.test(f));
    e.order = i;
  });
  p.entries.sort((a, b) => rankOf(a) - rankOf(b) || a.order - b.order);
}
const labelKey = (l) => 'label:' + l.toLowerCase();
const LABELS = [...new Map(places.flatMap((p) => p.entries.flatMap((e) => e.labels)).map((l) => [l.toLowerCase(), l])).values()]
  .sort((a, b) => a.localeCompare(b));

// ---------- tags ----------
// Read from each entry's links and flags in the README, so there is nothing
// extra to keep up to date. A city has a tag when any of its takes has it.
const TAGS = [
  { id: 'pick', label: 'Picks', test: (e) => e.pick },
  { id: 'play', label: 'Playable', test: (e) => !!e.links.play },
  { id: 'source', label: 'Open source', test: (e) => !!e.links.source },
  { id: 'source-only', label: 'Source only', test: (e) => e.flags.some((f) => /source only/i.test(f)) },
  { id: 'wip', label: 'WIP', test: (e) => e.flags.some((f) => /wip/i.test(f)) },
  ...LABELS.map((l) => ({ id: labelKey(l), label: l[0].toUpperCase() + l.slice(1), test: (e) => e.labels.some((x) => x.toLowerCase() === l.toLowerCase()), label_: true })),
];
for (const p of places) {
  p.tags = TAGS.filter((t) => (t.place ? t.place(p) : p.entries.some(t.test))).map((t) => t.id);
  for (const e of p.entries) e.tags = TAGS.filter((t) => t.test && t.test(e)).map((t) => t.id);
}
const tagLabel = Object.fromEntries(TAGS.map((t) => [t.id, t.label]));
function renderChips() {
  $('#chips').innerHTML = TAGS.map((t) => {
    const n = places.filter((p) => p.tags.includes(t.id)).length;
    return n ? `<button class="chip${state.tag === t.id ? ' on' : ''}${t.label_ ? ' lbl' : ''}" data-tag="${t.id}" aria-pressed="${state.tag === t.id}">${esc(t.label)} <span>${n}</span></button>` : '';
  }).join('');
}
renderChips();
// The filter chips fold away behind a toggle; the choice is kept between visits.
function setChipsOpen(open) {
  $('#chips').classList.toggle('collapsed', !open);
  $('#chips-toggle').setAttribute('aria-expanded', String(open));
  try { localStorage.setItem('slop-cities.filters', open ? 'open' : 'closed'); } catch {}
}
let chipsStored = null;
try { chipsStored = localStorage.getItem('slop-cities.filters'); } catch {}
setChipsOpen(chipsStored !== 'closed');
$('#chips-toggle').addEventListener('click', () => setChipsOpen($('#chips').classList.contains('collapsed')));
$('#chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tag]');
  if (!b) return;
  state.tag = state.tag === b.dataset.tag ? null : b.dataset.tag;
  renderChips();
  renderList();
  const ids = state.tag ? new Set(places.filter((p) => p.tags.includes(state.tag)).map((p) => p.id)) : null;
  map.setFilter(ids);
  globe?.setFilter(ids);
});

function renderList() {
  const q = state.query.trim().toLowerCase();
  const match = (p) => (!state.tag || p.tags.includes(state.tag)) && (!q || [p.city, p.country, p.region, ...p.entries.flatMap((e) => [e.author, e.tag, e.desc])].some((s) => s && s.toLowerCase().includes(q)));
  let html = '';
  for (const r of REGIONS) {
    const items = places.filter((p) => p.region === r && match(p)).sort((a, b) => (b.original - a.original) || a.city.localeCompare(b.city));
    if (!items.length) continue;
    html += `<h3>${esc(r)} <span>${items.length}</span></h3><ul>`;
    for (const p of items) {
      // New York counts its remixes too: they are versions of the same city.
      const n = p.entries.length + (p.remixes?.length || 0);
      const nTitle = p.remixes?.length ? `the original and ${p.remixes.length} remixes` : `${n} takes`;
      html += `<li><button data-id="${p.id}" class="${p.id === state.selected ? 'on' : ''}${p.original ? ' original' : ''}">
        <span class="nm">${esc(p.city)}</span><span class="ct">${esc(p.country || '')}</span>${p.original ? '<span class="tagline">the original</span>' : ''}${n > 1 ? `<span class="n" title="${nTitle}">${n}</span>` : ''}
      </button></li>`;
    }
    html += '</ul>';
  }
  $('#list').innerHTML = html || '<p class="none">No city matches.</p>';
}
renderList();
$('#list').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-id]');
  if (b) bus.emit('select', { id: b.dataset.id, source: 'list' });
});
$('#list').addEventListener('pointerover', (e) => {
  const b = e.target.closest('button[data-id]');
  bus.emit('hover', { id: b ? b.dataset.id : null, source: 'list' });
});
$('#list').addEventListener('pointerleave', () => bus.emit('hover', { id: null, source: 'list' }));
$('#search').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const b = $('#list button[data-id]'); if (b) bus.emit('select', { id: b.dataset.id, source: 'list' }); }
  if (e.key === 'Escape') { e.target.value = ''; state.query = ''; renderList(); e.target.blur(); }
});

// ---------- card ----------
function linkBtns(l) {
  return [['play', 'Play'], ['source', 'Source'], ['tweet', 'Tweet']].filter(([k]) => l[k]).map(([k, t]) => `<a class="btn ${k}" href="${esc(l[k])}" target="_blank" rel="noopener">${t}</a>`).join('');
}
// A take's own screenshot, beside its links; the card's top picture is the first take that has one.
function thumb(e) {
  if (!e.screenshot) return '';
  return `<a class="thumb" href="${esc(e.links.play || e.links.source || e.links.tweet)}" target="_blank" rel="noopener"><img src="../${esc(e.screenshot)}" alt="${esc(e.title)} screenshot" loading="lazy"></a>`;
}

function renderCard() {
  const p = byId.get(state.selected);
  const card = $('#card');
  if (!p) { card.hidden = true; return; }
  const parents = p.parents.map((id) => byId.get(id));
  const km = `${Math.round(distanceKm(ny.lon, ny.lat, p.lon, p.lat)).toLocaleString()} km from New York`;
  const lineage = p.original
    ? `The original. ${places.filter((q) => q.parents.includes('new-york')).length} cities and ${ny.remixes.length} remixes descend from it.`
    : !parents.length
    ? `Built on its own engine, not on Slop New York's code · ${km}`
    : `Remixed from ${parents.map((q) => `<a href="#" data-id="${q.id}">Slop ${esc(q.city)}</a>`).join(' and ')} · ${Math.round(distanceKm(ny.lon, ny.lat, p.lon, p.lat)).toLocaleString()} km from New York`;
  const children = places.filter((q) => q.parents.includes(p.id) && p.id !== 'new-york');
  const shot = p.entries.find((e) => e.screenshot);
  card.innerHTML = `
    <button class="close" aria-label="Close">×</button>
    ${shot ? `<a class="shot" href="${esc(shot.links.play)}" target="_blank" rel="noopener"><img src="../${esc(shot.screenshot)}" alt="${esc(p.city)} screenshot" loading="lazy"></a>` : ''}
    <header><h2>${esc(p.city)}</h2><p>${esc([p.country, p.region].filter(Boolean).join(' · '))}</p></header>
    <p class="lineage">${lineage}${children.length ? `<br>Inspired ${children.map((q) => `<a href="#" data-id="${q.id}">${esc(q.city)}</a>`).join(', ')}` : ''}</p>
    <ul class="takes">${p.entries.map((e) => `
      <li${rankOf(e) === 0 ? ' class="pick"' : ''}>
        ${e.pick || e.labels.length ? `<div class="labels">${e.pick ? '<span class="label-badge pick">Pick</span>' : ''}${e.labels.map((l) => `<span class="label-badge">${esc(l)}</span>`).join('')}</div>` : ''}
        <div class="who">${e.tag ? `<b>${esc(e.tag)}</b> · ` : ''}${e.author ? `by <a href="${esc(e.authorUrl)}" target="_blank" rel="noopener">${esc(e.author)}</a>` : '<i>unknown author</i>'}${e.status.map((f) => ` <span class="flag">${esc(f)}</span>`).join('')}${e.tags.includes('source') && !e.tags.includes('source-only') ? ' <span class="flag open">open source</span>' : ''}</div>
        ${e.desc ? `<p>${esc(e.desc)}</p>` : ''}
        <div class="links">${linkBtns(e.links)}</div>
        ${e !== shot ? thumb(e) : ''}
      </li>`).join('')}
    </ul>
    ${p.remixes.length ? `<h4>New York remixes</h4><ul class="takes remixes">${p.remixes.map((e) => `
      <li><div class="who"><b>${esc(e.title)}</b>${e.author ? ` · by <a href="${esc(e.authorUrl)}" target="_blank" rel="noopener">${esc(e.author)}</a>` : ''}</div>${e.desc ? `<p>${esc(e.desc)}</p>` : ''}<div class="links">${linkBtns(e.links)}</div>${thumb(e)}</li>`).join('')}</ul>` : ''}`;
  card.hidden = false;
  card.scrollTop = 0;
}
$('#card').addEventListener('click', (e) => {
  if (e.target.closest('.close')) { bus.emit('select', { id: null, source: 'card' }); return; }
  const a = e.target.closest('a[data-id]');
  if (a) { e.preventDefault(); bus.emit('select', { id: a.dataset.id, source: 'card' }); }
});

// ---------- selection ----------
bus.on('select', ({ id, source }) => {
  $('#peek').hidden = true;
  if (id === state.selected && id) { focusSelected(source); return; }
  state.selected = id;
  map.setSelected(id);
  globe?.setSelected(id);
  renderCard();
  for (const b of document.querySelectorAll('#list button[data-id]')) b.classList.toggle('on', b.dataset.id === id);
  document.querySelector(`#list button[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  if (id) focusSelected(source);
  writeHash();
  if (source !== 'tour') stopTour();
});
function focusSelected(source) {
  const p = byId.get(state.selected);
  if (!p || flight?.running) return; // the plane keeps the camera
  const linked = state.mode === 'compare' && $('#opt-link').checked;
  // Linked: fly one view and let the link carry the other along.
  const lead = linked ? (source === '2d' ? 'map' : 'globe') : 'both';
  swooshTo(p, source, state.mode === '2d' || lead === 'map' ? 800 : 1300);
  if (lead !== 'globe' && state.mode !== '3d') map.flyTo(p.lon, p.lat, Math.max(map.getView().zoom, p.region === 'Europe' ? 5 : 3.5), 800, matchMedia('(max-width: 820px)').matches && state.mode === '2d' ? innerHeight * 0.2 : 0);
  if (lead !== 'map' && state.mode !== '2d') ensureGlobe().then((g) => g.flyTo(p.lon, p.lat, Math.min(6, Math.max(g.getView().zoom, 1.5)), 1300));
}

// Hovering a pin or a list row shows a preview: the city's picture and its takes.
let pointer = [0, 0];
addEventListener('pointermove', (e) => { pointer = [e.clientX, e.clientY]; placePeek(); }, { passive: true });
function placePeek() {
  const el = $('#peek');
  if (el.hidden) return;
  const w = el.offsetWidth, h = el.offsetHeight;
  let x = pointer[0] + 18, y = pointer[1] + 18;
  if (x + w > innerWidth - 10) x = pointer[0] - w - 18;
  if (y + h > innerHeight - 10) y = pointer[1] - h - 18;
  el.style.transform = `translate(${Math.max(10, x)}px, ${Math.max(10, y)}px)`;
}
function showPeek(id, source) {
  const el = $('#peek');
  const p = byId.get(id);
  if (!p || id === state.selected || matchMedia('(hover: none)').matches) { el.hidden = true; return; }
  const shot = p.entries.find((e) => e.screenshot);
  const n = p.entries.length + (p.original ? p.remixes.length : 0);
  el.innerHTML = `${shot ? `<img src="../${esc(shot.screenshot)}" alt="">` : ''}<div><b>${esc(p.city)}</b><span>${esc(p.country || '')}${n > 1 ? ` · ${n} takes` : ''}</span></div>`;
  el.hidden = false;
  if (source === 'list') {
    const r = document.querySelector(`#list button[data-id="${id}"]`)?.getBoundingClientRect();
    if (r) pointer = [r.right - 10, r.top - 6];
  }
  placePeek();
}

bus.on('hover', ({ id, source }) => {
  if (id === state.hovered) return;
  state.hovered = id;
  showPeek(id, source);
  map.setHovered(id);
  globe?.setHovered(id);
  for (const b of document.querySelectorAll('#list button[data-id]')) b.classList.toggle('hover', b.dataset.id === id);
});

// Compare: keep the two cameras looking at the same place.
bus.on('view', (v) => {
  if (state.mode !== 'compare' || !$('#opt-link').checked) return;
  if (v.source === '2d') globe?.setView(v);
  else map.setView(v);
});

// ---------- modes ----------
function setMode(mode) {
  if (flight?.running && mode !== '3d') stopFlight();
  state.mode = mode;
  document.body.className = 'mode-' + mode;
  for (const b of document.querySelectorAll('.modes button')) b.setAttribute('aria-selected', b.dataset.mode === mode);
  placeIndicator();
  if (mode !== '2d') ensureGlobe().then((g) => { g.resize(); g.setRunning(true); if (mode === 'compare' && $('#opt-link').checked && !state.selected) g.setView(map.getView()); });
  else globe?.setRunning(false);
  requestAnimationFrame(() => {
    map.resize();
    // The flat map doesn't follow selections while hidden; catch it up.
    const p = byId.get(state.selected);
    if (p && mode !== '3d') map.flyTo(p.lon, p.lat, Math.max(map.getView().zoom, p.region === 'Europe' ? 5 : 3.5), 0);
  });
  writeHash();
}
for (const b of document.querySelectorAll('.modes button')) b.addEventListener('click', () => setMode(b.dataset.mode));
// The taxi-yellow pill glides under the selected mode, as in Slop New York.
function placeIndicator() {
  const b = document.querySelector('.modes button[aria-selected="true"]');
  const ind = document.querySelector('.mode-indicator');
  if (!b || !ind) return;
  ind.style.setProperty('--ind-x', b.offsetLeft + 'px');
  ind.style.setProperty('--ind-w', b.offsetWidth + 'px');
}
addEventListener('resize', placeIndicator);
document.fonts?.ready.then(placeIndicator);

function currentOpts() {
  return { arcs: $('#opt-arcs').checked, labels: $('#opt-labels').checked, clouds: $('#opt-clouds').checked, ocean: $('#opt-ocean').checked };
}
map.setOptions(currentOpts());
for (const id of ['opt-arcs', 'opt-labels', 'opt-clouds', 'opt-ocean']) $('#' + id).addEventListener('change', () => { map.setOptions(currentOpts()); globe?.setOptions(currentOpts()); });
$('#opt-link').addEventListener('change', (e) => { if (e.target.checked) globe?.setView(map.getView()); });

// Projection: rebuild the flat map, keeping the selection and the place in view.
function applyProjection(id) {
  if (id === projectionId) return;
  const v = map.getView();
  map.destroy();
  setProjection(id);
  map = createMap2D($('#stage-2d'), world, bus);
  map.setOptions(currentOpts());
  map.setSelected(state.selected);
  map.setFilter(state.tag ? new Set(places.filter((p) => p.tags.includes(state.tag)).map((p) => p.id)) : null);
  map.setView(v);
  syncProjectionUI();
  writeHash();
}
function syncProjectionUI() {
  for (const r of document.querySelectorAll('input[name=proj]')) r.checked = r.value === projectionId;
  $('#caption-2d').textContent = 'Map · ' + PROJECTIONS[projectionId].name;
}
for (const r of document.querySelectorAll('input[name=proj]')) r.addEventListener('change', () => r.checked && applyProjection(r.value));
syncProjectionUI();

for (const z of document.querySelectorAll('.map-zoom button')) z.addEventListener('click', () => {
  const v = z.closest('.view').classList.contains('view-2d') ? map : globe;
  if (!v) return;
  if (z.dataset.z === 'reset') v.reset(); else v.zoomBy(z.dataset.z === 'in' ? 1.8 : 1 / 1.8);
});

// ---------- tour ----------
let tourTimer = 0;
const tourOrder = [ny, ...places.filter((p) => !p.original).sort((a, b) => a.lon - b.lon)];
function stopTour() { clearInterval(tourTimer); tourTimer = 0; $('#tour').setAttribute('aria-pressed', 'false'); $('#tour').textContent = 'Tour'; }
$('#tour').addEventListener('click', () => {
  if (tourTimer) { stopTour(); return; }
  let i = Math.max(0, tourOrder.findIndex((p) => p.id === state.selected));
  const next = () => { bus.emit('select', { id: tourOrder[i % tourOrder.length].id, source: 'tour' }); i++; };
  next();
  tourTimer = setInterval(next, 3800);
  $('#tour').setAttribute('aria-pressed', 'true');
  $('#tour').textContent = 'Stop tour';
});

// ---------- swoosh ----------
// A whoosh as the view flies to a city, as loud as the flight is long. Not on
// page load (a link to a city), when browsers don't allow sound anyway.
const sfx = createSfx();
const swooshOpt = $('#opt-swoosh');
try { swooshOpt.checked = localStorage.getItem('slop-cities.swoosh') !== 'off'; } catch {}
swooshOpt.addEventListener('change', () => { try { localStorage.setItem('slop-cities.swoosh', swooshOpt.checked ? 'on' : 'off'); } catch {} });
function swooshTo(p, source, ms) {
  if (!swooshOpt.checked || source === 'hash') return;
  const v = state.mode === '2d' ? map.getView() : globe ? globe.getView() : map.getView();
  const km = distanceKm(v.lon, v.lat, p.lon, p.lat);
  const dLon = ((p.lon - v.lon + 540) % 360) - 180;
  // An S-curve on the distance: even a hop next door is clearly heard, it
  // grows fastest over mid-range flights and levels off for the long ones.
  const x = Math.min(1, km / 10000);
  sfx.swoosh({ ms, amount: 0.6 + 0.4 * x * x * (3 - 2 * x), pan: Math.sign(dLon) * Math.min(1, Math.abs(dLon) / 90) });
}

// ---------- music ----------
// On unless you turned it off last time. It starts at once where the browser
// allows sound without a click, and otherwise on your first click, tap or key
// anywhere on the page (always the case on an iPhone).
const music = createMusic();
const musicWanted = () => { try { return localStorage.getItem('slop-cities.music') !== 'off'; } catch { return true; } };
const showMusic = () => $('#music').setAttribute('aria-pressed', String(music.playing));
async function startMusic() { await music.start(); showMusic(); }
async function toggleMusic() {
  disarmMusic();
  await music.toggle();
  showMusic();
  try { localStorage.setItem('slop-cities.music', music.playing ? 'on' : 'off'); } catch {}
}
$('#music').addEventListener('click', toggleMusic);
let unlocking = false;
function onFirstGesture(e) {
  // The music button and the M key toggle it themselves.
  if (e.target.closest?.('#music') || (e.type === 'keydown' && (e.key === 'm' || e.key === 'M'))) return;
  if (!unlocking) { unlocking = true; music.unlock(() => { disarmMusic(); if (musicWanted() && !music.playing) startMusic(); }); }
  else music.unlock(() => {});
}
const GESTURES = ['pointerdown', 'pointerup', 'click', 'touchend', 'keydown'];
function disarmMusic() { for (const t of GESTURES) removeEventListener(t, onFirstGesture, true); }
if (musicWanted()) {
  if (music.mayAutoplay()) startMusic();
  else for (const t of GESTURES) addEventListener(t, onFirstGesture, true);
}

// ---------- fly: the biplane game ----------
let flight = null;
async function startFlight() {
  if (state.mode !== '3d') setMode('3d');
  stopTour();
  const g = await ensureGlobe();
  if (!flight) {
    const { createFlight } = await import('./flight.js');
    flight = createFlight({
      globe: g, world, places,
      sound: () => swooshOpt.checked,
      onExit: stopFlight,
      // Land here: stop flying and open the city's card.
      onArrive: (c, land) => { if (land) { stopFlight(); bus.emit('select', { id: c.id, source: 'fly' }); } },
      // Explore: the city below opens its card, and the plane flies on.
      onOpen: (c) => bus.emit('select', { id: c.id, source: 'fly' }),
      onEscape: () => { if (!state.selected) return false; bus.emit('select', { id: null, source: 'key' }); return true; },
    });
  }
  if (flight.running) return;
  const from = byId.get(state.selected);
  bus.emit('select', { id: null, source: 'fly' });
  $('#peek').hidden = true;
  document.body.classList.add('flying');
  $('#fly').setAttribute('aria-pressed', 'true');
  flight.start(from);
  writeHash();
}
function stopFlight() {
  if (!flight?.running) return;
  flight.stop();
  document.body.classList.remove('flying');
  $('#fly').setAttribute('aria-pressed', 'false');
  writeHash();
}
function toggleFlight() { if (flight?.running) stopFlight(); else startFlight(); }
$('#fly').addEventListener('click', toggleFlight);

// ---------- keyboard, panel, hash ----------
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input[type=search], input[type=text]')) return;
  if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
  else if (e.key === 'Escape') bus.emit('select', { id: null, source: 'key' });
  else if (e.key === '1') setMode('3d');
  else if (e.key === '2') setMode('2d');
  else if (e.key === '3') setMode('compare');
  else if (e.key === 'm' || e.key === 'M') toggleMusic();
  else if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey) toggleFlight();
});
$('#panel-handle').addEventListener('click', () => $('#panel').classList.toggle('collapsed'));

function writeHash() {
  const h = new URLSearchParams();
  if (state.mode !== '3d') h.set('view', state.mode === '2d' ? 'map' : 'compare');
  if (state.selected) h.set('city', state.selected);
  if (flight?.running) h.set('fly', document.body.classList.contains('explore') ? 'explore' : 'race');
  if (projectionId !== 'patterson') h.set('proj', projectionId);
  const s = h.toString();
  history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
}
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const v = h.get('view');
  setMode(v === 'map' ? '2d' : v === 'compare' ? 'compare' : '3d');
  if (h.get('proj') && PROJECTIONS[h.get('proj')]) applyProjection(h.get('proj'));
  const c = h.get('city');
  if (c && byId.has(c)) bus.emit('select', { id: c, source: 'hash' });
  if (h.has('fly') && !flight?.running) {
    if (['explore', 'race'].includes(h.get('fly'))) try { localStorage.setItem('slop-cities.flight', h.get('fly')); } catch {}
    startFlight();
  }
}
readHash();
window.addEventListener('hashchange', readHash);

if (matchMedia('(max-width: 820px)').matches) $('#panel').classList.add('collapsed');
bus.on('select', ({ id }) => { if (id && matchMedia('(max-width: 820px)').matches) $('#panel').classList.add('collapsed'); });
$('#boot').remove();
// For checks and the console.
window.slopMap = { world, get map() { return map; }, get globe() { return globe; }, get flight() { return flight; }, bus, state, setMode, ensureGlobe, startFlight, stopFlight };
