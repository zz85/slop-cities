// Play in place: a take's Play opens the game in a frame that fills the
// window, and the map folds away into one of three docks, kept between visits:
//   top   a bar across the top;
//   side  a strip at the left, with the city's card under the controls, so
//         you can switch takes without leaving the game;
//   ball  a small round widget you can drag to either side; hovering it (or
//         tapping it, on a touch screen) opens the same controls as a menu.
// Each dock has the same controls: back to the map (the game keeps running,
// in a "now playing" chip), the city and the author, reload, pop out to a new
// tab, close, and the switch between the three. The bar and the strip can hide
// themselves once unpinned: they slide away and come back at that edge.
// A click with a modifier key (or the middle button) still opens a new tab.
// A site may refuse to be framed and the frame can't tell us so: the controls
// say to pop it out if it stays blank.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k, d) { try { return localStorage.getItem('slop-cities.' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('slop-cities.' + k, v); } catch {} },
};
const DOCKS = [['top', 'Top bar'], ['side', 'Side strip'], ['ball', 'Ball']];
const ICON = {
  map: '<span class="mta-bullet" aria-hidden="true">SC</span>',
  reload: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
  pop: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
  close: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  pin: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/></svg>',
  back: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  // The three docks, each a window with its controls where that dock puts them.
  top: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18" /><path class="fill" d="M5.5 5.5h13v2h-13z"/></svg>',
  side: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/><path class="fill" d="M4.5 5.5h3v13h-3z"/></svg>',
  ball: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle class="fill" cx="8" cy="14.5" r="2.6"/></svg>',
};

export function createPlayer({ onOpen, onClose, onShowMap }) {
  let dock = store.get('dock', 'top');
  if (!DOCKS.some(([d]) => d === dock)) dock = 'top';
  // The bar and the strip stay pinned unless you unpin them, and then hide themselves.
  let pinned = store.get('dock-pin', 'on') !== 'off';
  let now = null; // { url, place, entry, who }
  let shown = false; // the game in front (else the map, with the game waiting)
  const narrow = () => matchMedia('(max-width: 820px)').matches;
  // A phone has no room for the strip; the bar and the ball fit.
  const dockNow = () => (dock === 'side' && narrow() ? 'top' : dock);

  // ---------- the controls, the same in each dock ----------
  // layout: 'bar' (a row), 'side' (a column at the head of the strip) or 'menu' (the ball's).
  function controls(layout) {
    const d = dockNow();
    return `
      <div class="pc pc-${layout}">
        <button class="pc-map" data-pl="map" title="Back to the world map: the game keeps running (Esc)">${ICON.back}${ICON.map}<span>World map</span></button>
        <div class="pc-now"><b class="pc-sign">${esc(now?.place?.city || '')}</b>${now?.who ? `<span class="pc-who">${esc(now.who)}</span>` : ''}</div>
        <span class="pc-tip">Blank? Some sites can't be shown here: pop it out.</span>
        <span class="pc-sp"></span>
        <div class="pc-acts">
          <button class="icon-btn" data-pl="reload" title="Reload the game" aria-label="Reload">${ICON.reload}</button>
          <a class="icon-btn" data-pl="pop" href="${esc(now?.url || '#')}" target="_blank" rel="noopener" title="Open in a new tab and close it here" aria-label="Pop out">${ICON.pop}</a>
          <button class="icon-btn pc-close" data-pl="close" title="Close the game" aria-label="Close the game">${ICON.close}</button>
        </div>
        <div class="pc-dock" role="group" aria-label="Where the controls go">
          ${DOCKS.filter(([k]) => !(k === 'side' && narrow())).map(([k, t]) => `<button class="icon-btn" data-pl-dock="${k}" aria-pressed="${k === d}" title="${t}" aria-label="${t}">${ICON[k]}</button>`).join('')}
          ${layout !== 'menu' ? `<button class="icon-btn pc-pin" data-pl="pin" aria-pressed="${pinned}" title="${pinned
            ? `Pinned: the ${layout === 'bar' ? 'bar' : 'strip'} stays. Click to let it hide itself`
            : `The ${layout === 'bar' ? 'bar' : 'strip'} hides itself and comes back at the ${layout === 'bar' ? 'top' : 'left'} edge. Click to pin it`}" aria-label="Pin">${ICON.pin}</button>` : ''}
        </div>
      </div>`;
  }

  // ---------- the player: the frame, the bar and the strip ----------
  const el = document.createElement('section');
  el.className = 'player';
  el.hidden = true;
  el.setAttribute('aria-label', 'Game');
  el.innerHTML = `
    <div class="pl-hot pl-hot-top" aria-hidden="true"></div>
    <div class="pl-hot pl-hot-left" aria-hidden="true"></div>
    <div class="panel pl-top"></div>
    <aside class="panel pl-side"><div class="pl-side-head"></div><div class="pl-side-card"></div></aside>
    <div class="pl-frame"></div>`;
  document.body.appendChild(el);
  const $ = (s) => el.querySelector(s);

  // ---------- the ball ----------
  const ball = document.createElement('div');
  ball.className = 'pl-ball';
  ball.hidden = true;
  ball.innerHTML = `
    <button class="db-core" aria-label="Slop Cities: map and game controls" aria-haspopup="true"><span class="mta-bullet">SC</span><i class="db-globe" aria-hidden="true"></i></button>
    <div class="panel db-menu" role="menu"></div>`;
  document.body.appendChild(ball);
  const core = ball.querySelector('.db-core'), menu = ball.querySelector('.db-menu');

  // ---------- the chip: the game, waiting while the map is in front ----------
  const chip = document.createElement('div');
  chip.className = 'panel now-playing';
  chip.hidden = true;
  document.body.appendChild(chip);

  // ---------- open, show, hide, close ----------
  function open(url, place, entry) {
    if (now && now.url === url) { show(); return; }
    const who = [entry?.tag || (entry?.title && entry.title !== `${place?.city}, ${place?.country}` ? entry.title : ''), entry?.author ? `by ${entry.author}` : ''].filter(Boolean).join(' · ');
    now = { url, place, entry, who };
    const f = document.createElement('iframe');
    f.src = url;
    f.title = entry?.title || place?.city || 'Game';
    f.allow = 'fullscreen; autoplay; gamepad; pointer-lock; clipboard-write; accelerometer; gyroscope; xr-spatial-tracking; screen-wake-lock';
    f.allowFullscreen = true;
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    f.addEventListener('load', () => { try { f.contentWindow.focus(); } catch {} });
    $('.pl-frame').replaceChildren(f);
    const shot = entry?.screenshot;
    chip.innerHTML = `${shot ? `<img src="../${esc(shot)}" alt="">` : '<span class="np-play" aria-hidden="true">▶</span>'}
      <button class="np-back"><span class="np-k">Now playing</span><b>${esc(place?.city || 'Game')}</b>${who ? `<small>${esc(who)}</small>` : ''}</button>
      <a class="icon-btn" data-pl="pop" href="${esc(url)}" target="_blank" rel="noopener" title="Open in a new tab and close it here" aria-label="Pop out">${ICON.pop}</a>
      <button class="icon-btn" data-pl="close" aria-label="Close the game" title="Close the game">${ICON.close}</button>`;
    el.classList.add('tip');
    clearTimeout(open.tip); open.tip = setTimeout(() => el.classList.remove('tip'), 9000);
    onOpen(now);
    show();
  }

  // Lay out the dock: the controls where it puts them, the card in the strip.
  function layout() {
    const d = dockNow();
    for (const [k] of DOCKS) document.body.classList.toggle('dock-' + k, shown && d === k);
    document.body.classList.toggle('dock-autohide', shown && !pinned && d !== 'ball');
    $('.pl-top').innerHTML = d === 'top' ? controls('bar') : '';
    $('.pl-side-head').innerHTML = d === 'side' ? controls('side') : '';
    menu.innerHTML = d === 'ball' ? controls('menu') : '';
    ball.hidden = !shown || d !== 'ball';
    ball.classList.remove('open');
    // The city's card lives in the strip while it is there, and goes back after.
    const card = document.getElementById('card');
    if (card) {
      if (shown && d === 'side') { if (card.parentElement !== $('.pl-side-card')) $('.pl-side-card').appendChild(card); }
      else if (card.parentElement !== document.body) document.body.appendChild(card);
    }
    placeBall();
    if (shown && !pinned && d !== 'ball') reveal(2600);
  }
  function show() {
    if (!now) return;
    shown = true;
    el.hidden = false; chip.hidden = true;
    document.body.classList.add('playing');
    layout();
    setTimeout(() => { try { $('iframe')?.focus(); } catch {} }, 50);
  }
  // Back to the map: the game keeps running behind it, in the chip.
  function hide() {
    if (!now) return;
    shown = false;
    el.hidden = true; chip.hidden = false;
    document.body.classList.remove('playing');
    layout();
    onShowMap(now);
  }
  function close() {
    if (!now) return;
    const was = now;
    now = null; shown = false;
    $('.pl-frame').replaceChildren(); // unloads the game, and its sound
    el.hidden = true; chip.hidden = true;
    document.body.classList.remove('playing');
    layout();
    onClose(was);
  }
  function setDock(d) { dock = d; store.set('dock', d); if (shown) layout(); }
  function setPinned(on) { pinned = on; store.set('dock-pin', on ? 'on' : 'off'); if (shown) layout(); }

  // ---------- auto-hide: away after a moment, back at the edge ----------
  let hideTimer = 0, over = false;
  function reveal(ms = 1400) {
    el.classList.add('reveal');
    clearTimeout(hideTimer);
    if (!over) hideTimer = setTimeout(conceal, ms);
  }
  function conceal() { if (!over && !pinned) el.classList.remove('reveal'); }
  for (const s of ['.pl-hot-top', '.pl-hot-left']) {
    $(s).addEventListener('pointerenter', () => reveal(1800));
    $(s).addEventListener('pointerdown', () => reveal(4000)); // a tap on a touch screen
  }
  for (const s of ['.pl-top', '.pl-side']) {
    $(s).addEventListener('pointerenter', () => { over = true; clearTimeout(hideTimer); el.classList.add('reveal'); });
    $(s).addEventListener('pointerleave', () => { over = false; hideTimer = setTimeout(conceal, 700); });
  }

  // ---------- every control, wherever it is ----------
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-pl], [data-pl-dock]');
    if (!t || !(el.contains(t) || ball.contains(t) || chip.contains(t))) return;
    if (t.dataset.plDock) { setDock(t.dataset.plDock); return; }
    const act = t.dataset.pl;
    if (act === 'map') hide();
    else if (act === 'close') close();
    else if (act === 'reload') { const f = $('iframe'); if (f) f.src = now.url; }
    else if (act === 'pin') setPinned(!pinned);
    else if (act === 'pop') setTimeout(close, 0); // the link opens the tab itself
  });
  chip.addEventListener('click', (e) => { if (e.target.closest('.np-back, img, .np-play')) show(); });

  // ---------- the ball: drag it to either side; hover or tap for the menu ----------
  // A third of the way up from the bottom, on the left, until you move it.
  let pos = { side: 'left', y: 2 / 3 };
  try { pos = JSON.parse(store.get('ball-pos', 'null')) || pos; } catch {}
  function placeBall() {
    const s = 56, m = 14, H = innerHeight;
    const y = Math.max(m, Math.min(H - s - m, pos.y * H - s / 2));
    ball.style.transform = `translate(${pos.side === 'left' ? m : innerWidth - s - m}px, ${y}px)`;
    ball.dataset.side = pos.side;
    ball.dataset.half = y > H / 2 ? 'low' : 'high'; // the menu opens toward the middle
  }
  addEventListener('resize', () => { if (shown) layout(); else placeBall(); });
  let drag = null;
  core.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: false, touch: e.pointerType !== 'mouse' };
    core.setPointerCapture(e.pointerId);
  });
  core.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    drag.moved = true;
    ball.classList.add('dragging'); ball.classList.remove('open');
    ball.style.transform = `translate(${e.clientX - 28}px, ${e.clientY - 28}px)`;
  });
  core.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const { moved, touch } = drag; drag = null;
    ball.classList.remove('dragging');
    if (!moved) {
      // A click on the ball goes back to the map; a tap opens the menu, which has Map.
      if (touch) ball.classList.toggle('open'); else hide();
      return;
    }
    pos = { side: e.clientX < innerWidth / 2 ? 'left' : 'right', y: e.clientY / innerHeight };
    store.set('ball-pos', JSON.stringify(pos));
    placeBall();
  });
  // Hovering opens the menu, and it stays open while the pointer is on the ball or the menu.
  let menuTimer = 0;
  ball.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && !drag) { clearTimeout(menuTimer); ball.classList.add('open'); } });
  ball.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') menuTimer = setTimeout(() => ball.classList.remove('open'), 350); });

  // Esc on our page (not inside the game, which keeps its own keys) shows the map.
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && shown && !e.target.closest?.('input')) { e.stopImmediatePropagation(); hide(); }
  }, true);

  return {
    open, show, hide, close,
    get playing() { return !!now; },
    get shown() { return shown; },
    get now() { return now; },
    get dock() { return dockNow(); },
  };
}
