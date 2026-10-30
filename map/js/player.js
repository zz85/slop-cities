// Play in place: a take's Play opens the game in a frame that fills the
// window, and the map folds away. It folds into one of two docks, kept
// between visits:
//   ball  a small round widget you can drag to any edge; it opens the map
//         again, and the game waits in a "now playing" chip until you go back;
//   side  a strip at the left with the city's card, so you can switch takes
//         without leaving the game.
// Pop out moves the game to a tab of its own, and × closes it. A click with
// a modifier key (or the middle button) still opens a new tab, as a link does.
// A site may refuse to be framed (X-Frame-Options, CSP frame-ancestors) and
// the frame can't tell us so: the bar says where to go if it stays blank.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const KEY = 'slop-cities.dock';

export function createPlayer({ onOpen, onClose, onShowMap }) {
  let dock = 'ball';
  try { if (localStorage.getItem(KEY) === 'side') dock = 'side'; } catch {}
  let now = null; // { url, place, entry }
  let shown = false; // the game in front (else the map, with the game waiting)

  // ---------- the player ----------
  const el = document.createElement('section');
  el.className = 'player';
  el.hidden = true;
  el.setAttribute('aria-label', 'Game');
  el.innerHTML = `
    <div class="panel pl-bar">
      <button class="pl-map" title="Back to the map (the game keeps running)"><span class="mta-bullet" aria-hidden="true">SC</span><span class="pl-map-t">Map</span></button>
      <b class="pl-sign"></b>
      <span class="pl-who"></span>
      <span class="pl-tip">Blank? Some sites don't allow being embedded: pop it out.</span>
      <span class="pl-sp"></span>
      <div class="pl-dock" role="group" aria-label="Map while playing">
        <button data-dock="ball" title="Fold the map into a ball you can drag">Ball</button>
        <button data-dock="side" title="Keep the city's card at the side">Side</button>
      </div>
      <button class="icon-btn pl-reload" title="Reload the game" aria-label="Reload"><svg class="icon" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg></button>
      <a class="tool-btn pl-pop" target="_blank" rel="noopener" title="Open in a new tab and close it here">Pop out <span aria-hidden="true">↗</span></a>
      <button class="icon-btn pl-close" title="Close the game" aria-label="Close the game">×</button>
    </div>
    <div class="pl-frame"></div>`;
  document.body.appendChild(el);
  const $ = (s) => el.querySelector(s);

  // ---------- the ball: the map, folded ----------
  const ball = document.createElement('button');
  ball.className = 'dock-ball';
  ball.hidden = true;
  ball.title = 'Slop Cities map';
  ball.innerHTML = '<span class="mta-bullet">SC</span><i class="dock-ball-globe" aria-hidden="true"></i>';
  document.body.appendChild(ball);

  // ---------- the chip: the game, waiting while the map is in front ----------
  const chip = document.createElement('div');
  chip.className = 'panel now-playing';
  chip.hidden = true;
  document.body.appendChild(chip);

  // ---------- open, show, hide, close ----------
  function open(url, place, entry) {
    if (now && now.url === url) { show(); return; }
    now = { url, place, entry };
    const f = document.createElement('iframe');
    f.src = url;
    f.title = `${entry?.title || place?.city || 'Game'}`;
    f.allow = 'fullscreen; autoplay; gamepad; pointer-lock; clipboard-write; accelerometer; gyroscope; xr-spatial-tracking; screen-wake-lock';
    f.allowFullscreen = true;
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    f.addEventListener('load', () => { try { f.contentWindow.focus(); } catch {} });
    $('.pl-frame').replaceChildren(f);
    $('.pl-sign').textContent = place?.city || '';
    const who = [entry?.tag || (entry?.title && entry.title !== `${place?.city}, ${place?.country}` ? entry.title : ''), entry?.author ? `by ${entry.author}` : ''].filter(Boolean).join(' · ');
    $('.pl-who').textContent = who;
    $('.pl-pop').href = url;
    $('.pl-tip').classList.add('on');
    clearTimeout(open.tip); open.tip = setTimeout(() => $('.pl-tip').classList.remove('on'), 9000);
    const shot = entry?.screenshot;
    chip.innerHTML = `${shot ? `<img src="../${esc(shot)}" alt="">` : '<span class="np-play" aria-hidden="true">▶</span>'}
      <button class="np-back"><span class="np-k">Now playing</span><b>${esc(place?.city || 'Game')}</b>${who ? `<small>${esc(who)}</small>` : ''}</button>
      <button class="icon-btn np-close" aria-label="Close the game" title="Close the game">×</button>`;
    onOpen(now);
    show();
  }
  function show() {
    if (!now) return;
    shown = true;
    el.hidden = false; chip.hidden = true;
    // A phone has no room for the side strip: it always folds into the ball.
    const d = matchMedia('(max-width: 820px)').matches ? 'ball' : dock;
    ball.hidden = d !== 'ball';
    document.body.classList.add('playing');
    document.body.classList.toggle('dock-side', d === 'side');
    document.body.classList.toggle('dock-ball', d === 'ball');
    syncDock();
    placeBall();
    setTimeout(() => { try { $('iframe')?.focus(); } catch {} }, 50);
  }
  // Back to the map: the game keeps running behind it, in the chip.
  function hide() {
    if (!now) return;
    shown = false;
    el.hidden = true; ball.hidden = true; chip.hidden = false;
    document.body.classList.remove('playing', 'dock-side', 'dock-ball');
    onShowMap(now);
  }
  function close() {
    if (!now) return;
    const was = now;
    now = null; shown = false;
    $('.pl-frame').replaceChildren(); // unloads the game, and its sound
    el.hidden = true; ball.hidden = true; chip.hidden = true;
    document.body.classList.remove('playing', 'dock-side', 'dock-ball');
    onClose(was);
  }
  function setDock(d) {
    dock = d;
    try { localStorage.setItem(KEY, d); } catch {}
    if (shown) show();
  }
  function syncDock() {
    for (const b of el.querySelectorAll('[data-dock]')) b.setAttribute('aria-pressed', String(b.dataset.dock === dock));
  }

  $('.pl-map').addEventListener('click', hide);
  $('.pl-close').addEventListener('click', close);
  $('.pl-reload').addEventListener('click', () => { const f = $('iframe'); if (f) f.src = now.url; });
  $('.pl-pop').addEventListener('click', () => setTimeout(close, 0));
  for (const b of el.querySelectorAll('[data-dock]')) b.addEventListener('click', () => setDock(b.dataset.dock));
  chip.addEventListener('click', (e) => {
    if (e.target.closest('.np-close')) close();
    else show();
  });

  // ---------- the ball: drag it to any edge; a click opens the map ----------
  let pos = { side: 'left', y: 0.86 };
  try { pos = JSON.parse(localStorage.getItem('slop-cities.ball')) || pos; } catch {}
  function placeBall() {
    const s = 56, m = 14, H = innerHeight;
    const y = Math.max(m, Math.min(H - s - m, pos.y * H - s / 2));
    ball.style.transform = `translate(${pos.side === 'left' ? m : innerWidth - s - m}px, ${y}px)`;
  }
  addEventListener('resize', placeBall);
  let drag = null;
  ball.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: false };
    ball.setPointerCapture(e.pointerId);
  });
  ball.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    drag.moved = true;
    ball.classList.add('dragging');
    ball.style.transform = `translate(${e.clientX - 28}px, ${e.clientY - 28}px)`;
  });
  ball.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const moved = drag.moved; drag = null;
    ball.classList.remove('dragging');
    if (!moved) { hide(); return; }
    // Snap to the nearer side, where it stays.
    pos = { side: e.clientX < innerWidth / 2 ? 'left' : 'right', y: e.clientY / innerHeight };
    try { localStorage.setItem('slop-cities.ball', JSON.stringify(pos)); } catch {}
    placeBall();
  });
  ball.addEventListener('click', (e) => e.preventDefault());

  // Esc on our page (not inside the game, which keeps its own keys) shows the map.
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && shown && !e.target.closest?.('input')) { e.stopImmediatePropagation(); hide(); }
  }, true);

  return {
    open, show, hide, close,
    get playing() { return !!now; },
    get shown() { return shown; },
    get now() { return now; },
    get dock() { return dock; },
  };
}
