// Drafting Board: a large pannable, zoomable surface for sheets, sticky notes,
// quotes, images and post cards, tied together with string. Boards are saved to
// Supabase as JSON; the sidebar library (notes, quotes, Freewrite drafts, images)
// lives in the `snippets` table.
//
// The board is drawn at true scale: 1 inch = 96 board units (the CSS inch), so a
// Letter sheet is 816 × 1056 and 12-point type is 16 units.

const uid = () => Math.random().toString(36).slice(2, 10);
const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const IN = 96;
const NOTE_COLORS = { yellow: '#F2E27A', pink: '#F2B5B0', blue: '#A9CBE8', green: '#B9DDB0', paper: '#F3ECDD' };
const STRING_COLORS = { red: '#C0392B', ink: '#1E2836', ivory: '#E9E2D2' };
export const PAPER = {
  letter: ['Letter', 8.5, 11], legal: ['Legal', 8.5, 14], half: ['Half letter', 5.5, 8.5], tabloid: ['Tabloid', 11, 17],
  a4: ['A4', 8.27, 11.69], a5: ['A5', 5.83, 8.27], card: ['Index card', 4, 6],
};
const PDF_BAR = 36;
const SIZES = { note: [3 * IN, 3 * IN], quote: [5 * IN, 3 * IN], image: [4 * IN, 3 * IN], post: [4 * IN, 2 * IN], pdf: [6.5 * IN, Math.round(6.5 * IN * 1.294) + PDF_BAR],
  link: [4 * IN, 176], video: [6 * IN, Math.round(6 * IN * 9 / 16) + 84], text: [4 * IN, 40], rect: [3 * IN, 2 * IN], ellipse: [2.5 * IN, 2.5 * IN], line: [3 * IN, 1] };
// Drawing colours, weights (board units; 1 unit = 1/96 in) and line styles.
const INK = { ivory: '#E9E2D2', ink: '#1E2836', red: '#C0392B', gold: '#E9C46A', blue: '#7FB2E5', green: '#8CC08A' };
const WEIGHTS = [1, 2, 4, 8];
const TEXT_SIZES = { S: 16, M: 24, L: 36, XL: 56 };
const PEN = { red: '#C0392B', blue: '#2E6DB4', ink: '#1E2836', yellow: '#F2D33A', green: '#7BD389', pink: '#F29AC0' };
const dashArray = (dash, w) => dash === 'dashed' ? `${3 * w + 5} ${2 * w + 5}` : dash === 'dotted' ? `0.1 ${2 * w + 4}` : '';
const LABEL = { video: 'Video', sheet: 'Sheet', note: 'Note', quote: 'Quote', image: 'Image', post: 'Post card', text: 'Text', rect: 'Box', ellipse: 'Circle', line: 'Line', pdf: 'PDF', link: 'Link' };
const MIN_Z = 0.1, MAX_Z = 3;

const fmtIn = (u) => { const v = Math.round((u / IN) * 4) / 4; return String(v).replace(/\.0+$/, ''); };
function paperSize(key, land) { const [, w, h] = PAPER[key] || PAPER.letter; return land ? [w * IN, h * IN].reverse() : [w * IN, h * IN]; }
function sizeLabel(it) {
  const dims = `${fmtIn(it.w)} × ${fmtIn(it.h)} in`;
  const pg = it.chain ? `Page ${it.page} · ` : '';
  return pg + (it.paper && it.paper !== 'custom' ? `${PAPER[it.paper][0]} · ${dims}` : dims);
}

export function mdToHtml(md) {
  const inline = (s) => escH(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>').replace(/\[\^(\w+)\]/g, '<sup>$1</sup>');
  let title = '';
  const html = String(md).replace(/\r/g, '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean).map((b) => {
    if (/^# /.test(b) && !title) { title = b.slice(2).trim(); return ''; }
    if (/^#{2,3} /.test(b)) return `<h3>${inline(b.replace(/^#+ /, ''))}</h3>`;
    if (/^> /.test(b)) return `<blockquote>${inline(b.replace(/^> ?/gm, ' ').trim())}</blockquote>`;
    if (/^\[\^\w+\]:/.test(b)) return `<p class="fnote">${inline(b)}</p>`;
    return `<p>${inline(b.replace(/\n/g, ' '))}</p>`;
  }).join('');
  return { title, html };
}

export function initDesk(ctx) {
  const { sb, toast, confirmBox, upload, openPost } = ctx;
  const $ = (id) => document.getElementById(id);
  const vp = $('deskVp'), world = $('deskWorld'), svg = $('deskLinks'), grid = $('deskGrid');
  const rulerX = $('rulerX'), rulerY = $('rulerY');
  const NS = 'http://www.w3.org/2000/svg';
  let board = null, els = new Map(), linkEls = new Map(), selected = null, sel = new Set(), selLink = null, tool = 'select', tieFrom = null, zTop = 1;
  let saveTimer = null;
  // The last colour/weight/style you picked is used for the next shape, line or text.
  let style = { color: 'ivory', weight: 2, dash: 'solid', fill: false, ends: 'none', size: 'M' };
  try { Object.assign(style, JSON.parse(localStorage.getItem('na-desk-style') || '{}')); } catch {}
  const remember = (patch) => { Object.assign(style, patch); try { localStorage.setItem('na-desk-style', JSON.stringify(style)); } catch {} };
  // Preferences that apply to every board (kept in this browser).
  let prefs = { notePad: 12 }; try { Object.assign(prefs, JSON.parse(localStorage.getItem('na-desk-prefs') || '{}')); } catch {}
  const setPref = (patch) => { Object.assign(prefs, patch); try { localStorage.setItem('na-desk-prefs', JSON.stringify(prefs)); } catch {} applyPrefs(); };
  function applyPrefs() { world.style.setProperty('--note-pad', prefs.notePad + 'px'); }
  applyPrefs();
  let ink = null; // PDF markup mode: { id, mode: 'pen'|'hl'|'erase', color }

  /* ------------------------------------------------------------ frame scheduling */
  // Everything visual that follows the pointer is batched into one animation frame.
  let raf = 0; const dirty = { view: false, items: new Set() };
  function frame() {
    raf = 0;
    if (dirty.view) { dirty.view = false; paintView(); }
    if (dirty.items.size) {
      const ids = [...dirty.items]; dirty.items.clear();
      ids.forEach((id) => { const it = byId(id); if (it) place(it); });
      if (world.classList.contains('gsel')) drawGroupBox();
      // updateLinks below always refreshes strings tied to passages.
      updateLinks(new Set(ids));
    }
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(frame); };
  const touchView = () => { dirty.view = true; schedule(); settleSoon(); };
  const touchItem = (id) => { dirty.items.add(id); schedule(); };
  // While panning/zooming the world is its own compositor layer; afterwards it is
  // re-rasterised so text is crisp at the new zoom.
  let settleT = 0;
  function settleSoon() { world.style.willChange = 'transform'; clearTimeout(settleT); settleT = setTimeout(() => { world.style.willChange = ''; }, 220); }

  /* ------------------------------------------------------------ view */
  const view = () => board.view;
  let lastGridZ = 0, rulerSize = { w: 0, h: 0, dpr: 0 };
  function paintView() {
    const { x, y, z } = view();
    world.style.transform = `translate3d(${x}px,${y}px,0) scale(${z})`;
    world.style.setProperty('--inv', (1 / z).toFixed(4)); // keeps handles the same size on screen
    const bg = bgOf(), cell = IN * bg.size * z;
    let minor = cell, major = cell * 4; if (minor < 6) minor = major; if (major < 6) major = minor = 6 * Math.ceil(6 / cell);
    if (z !== lastGridZ) {
      lastGridZ = z;
      const sizes = bg.grid === 'dots' ? `${major}px ${major}px, ${minor}px ${minor}px` : `${major}px ${major}px, ${major}px ${major}px, ${minor}px ${minor}px, ${minor}px ${minor}px`;
      grid.style.backgroundSize = sizes;
      grid.style.width = vp.clientWidth + 2 * major + 'px'; grid.style.height = vp.clientHeight + 2 * major + 'px';
    }
    const ox = ((x % major) + major) % major - major, oy = ((y % major) + major) % major - major;
    grid.style.transform = `translate3d(${ox}px,${oy}px,0)`;
    $('zoomPct').textContent = Math.round(z * 100) + '%';
    drawRulers();
  }
  const applyView = () => { lastGridZ = 0; paintView(); };

  /* ------------------------------------------------------------ background: colour, opacity, grid */
  const BG_PRESETS = { Blueprint: '#22344A', Charcoal: '#1F2328', Slate: '#2E3742', 'Drafting green': '#2D463C', Oxblood: '#4A2427', Kraft: '#7A6247', Vellum: '#E4DECF', White: '#F7F6F2' };
  const BG_DEFAULT = { color: '#22344A', opacity: 1, grid: 'lines', size: 0.25, gridOpacity: 1 };
  let bgLast = {}; try { bgLast = JSON.parse(localStorage.getItem('na-desk-bg') || '{}'); } catch {}
  const bgOf = () => ({ ...BG_DEFAULT, ...(board?.view?.bg || {}) });
  const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  function paintBg() {
    const b = bgOf(), [r, g, bl] = hexRgb(b.color);
    vp.style.backgroundColor = `rgba(${r},${g},${bl},${b.opacity})`;
    const light = (0.299 * r + 0.587 * g + 0.114 * bl) / 255 > 0.55;
    const c = light ? '30,40,54' : '170,200,230', k = b.gridOpacity;
    const maj = `rgba(${c},${Math.min(1, (light ? 0.2 : 0.17) * k)})`, min = `rgba(${c},${Math.min(1, (light ? 0.08 : 0.06) * k)})`;
    grid.style.display = b.grid === 'none' ? 'none' : '';
    grid.style.backgroundImage = b.grid === 'dots'
      ? `radial-gradient(circle at 1px 1px, ${maj.replace(/[\d.]+\)$/, (m) => Math.min(1, parseFloat(m) * 2.6) + ')')} 1.4px, transparent 1.9px), radial-gradient(circle at 1px 1px, ${min.replace(/[\d.]+\)$/, (m) => Math.min(1, parseFloat(m) * 3.2) + ')')} 0.9px, transparent 1.3px)`
      : `linear-gradient(${maj} 1px,transparent 1px),linear-gradient(90deg,${maj} 1px,transparent 1px),linear-gradient(${min} 1px,transparent 1px),linear-gradient(90deg,${min} 1px,transparent 1px)`;
    $('v-desk').classList.toggle('lightboard', light);
    applyView(); syncBgPanel();
  }
  function setBg(patch) {
    board.view.bg = { ...bgOf(), ...patch }; bgLast = board.view.bg;
    try { localStorage.setItem('na-desk-bg', JSON.stringify(bgLast)); } catch {}
    paintBg(); saveView();
  }
  function syncBgPanel() {
    const b = bgOf();
    $('bgSwatches').querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('on', x.dataset.c.toLowerCase() === b.color.toLowerCase()));
    $('bgColor').value = b.color;
    $('bgOpacity').value = Math.round(b.opacity * 100); $('bgOpacityOut').textContent = Math.round(b.opacity * 100) + '%';
    $('bgGrid').querySelectorAll('[data-g]').forEach((x) => x.classList.toggle('on', x.dataset.g === b.grid));
    $('bgSize').value = String(b.size); $('bgSize').disabled = $('bgGridOp').disabled = b.grid === 'none';
    $('bgGridOp').value = Math.round(b.gridOpacity * 100); $('bgGridOpOut').textContent = Math.round(b.gridOpacity * 100) + '%';
  }
  $('bgSwatches').innerHTML = Object.entries(BG_PRESETS).map(([n, c]) => `<button data-c="${c}" title="${n}" style="background:${c}"></button>`).join('') +
    '<label class="bg-custom" title="Choose any colour"><input type="color" id="bgColor"></label>';
  $('bgSwatches').querySelectorAll('[data-c]').forEach((x) => x.onclick = () => setBg({ color: x.dataset.c }));
  $('bgColor').addEventListener('input', (e) => setBg({ color: e.target.value }));
  $('bgOpacity').addEventListener('input', (e) => setBg({ opacity: +e.target.value / 100 }));
  $('bgGrid').querySelectorAll('[data-g]').forEach((x) => x.onclick = () => setBg({ grid: x.dataset.g }));
  $('bgSize').addEventListener('change', (e) => setBg({ size: +e.target.value }));
  $('bgGridOp').addEventListener('input', (e) => setBg({ gridOpacity: +e.target.value / 100 }));
  $('bgReset').onclick = () => setBg({ ...BG_DEFAULT });
  $('bgBtn').onclick = (e) => { e.stopPropagation(); const pnl = $('bgPanel'); pnl.hidden = !pnl.hidden; $('boardMenu').hidden = true; if (!pnl.hidden) syncBgPanel(); };
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#bgPanel, #bgBtn')) $('bgPanel').hidden = true; });
  const toWorld = (cx, cy) => { const r = vp.getBoundingClientRect(), { x, y, z } = view(); return { x: (cx - r.left - x) / z, y: (cy - r.top - y) / z }; };
  function zoomAt(nz, cx, cy, persist = true) {
    const r = vp.getBoundingClientRect(), v = view();
    nz = Math.min(MAX_Z, Math.max(MIN_Z, nz));
    const wx = (cx - r.left - v.x) / v.z, wy = (cy - r.top - v.y) / v.z;
    v.x = cx - r.left - wx * nz; v.y = cy - r.top - wy * nz; v.z = nz;
    touchView(); if (persist) saveView();
  }
  // Photoshop's zoom levels.
  const STEPS = [0.1, 0.125, 0.167, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3];
  function stepZoom(dir, cx, cy) {
    const z = view().z;
    const next = dir > 0 ? (STEPS.find((v) => v > z * 1.01) || MAX_Z) : ([...STEPS].reverse().find((v) => v < z * 0.99) || MIN_Z);
    if (cx == null) [cx, cy] = vpCenter();
    zoomAt(next, cx, cy);
  }
  const vpCenter = () => { const r = vp.getBoundingClientRect(); return [r.left + vp.clientWidth / 2, r.top + vp.clientHeight / 2]; };
  function fitAll() {
    if (!board.items.length) { board.view = { x: vp.clientWidth / 2 - 408 * 0.6, y: 60, z: 0.6 }; applyView(); return; }
    const xs = board.items.flatMap((i) => [i.x, i.x + i.w]), ys = board.items.flatMap((i) => [i.y, i.y + i.h]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const z = Math.min(1, Math.max(MIN_Z, Math.min((vp.clientWidth - 120) / (maxX - minX), (vp.clientHeight - 120) / (maxY - minY))));
    board.view = { z, x: (vp.clientWidth - (maxX - minX) * z) / 2 - minX * z, y: (vp.clientHeight - (maxY - minY) * z) / 2 - minY * z };
    applyView(); saveView();
  }
  function zoomToItem(it) {
    const z = Math.min(1.25, Math.max(MIN_Z, (vp.clientWidth - 100) / it.w));
    board.view = { z, x: (vp.clientWidth - it.w * z) / 2 - it.x * z, y: 40 - it.y * z };
    applyView(); saveView();
  }
  function drawRulers() {
    const dpr = devicePixelRatio || 1, { x, y, z } = view();
    const W = rulerX.clientWidth, H = rulerY.clientHeight;
    if (rulerSize.w !== W || rulerSize.h !== H || rulerSize.dpr !== dpr) {
      rulerSize = { w: W, h: H, dpr };
      rulerX.width = W * dpr; rulerX.height = rulerX.clientHeight * dpr; rulerY.width = rulerY.clientWidth * dpr; rulerY.height = H * dpr;
    }
    // Tick spacing in inches, coarser as you zoom out; labels every inch (or every 6/12 in).
    const step = z >= 0.8 ? 0.25 : z >= 0.35 ? 0.5 : z >= 0.18 ? 1 : 2;
    const labelEvery = z >= 0.3 ? 1 : z >= 0.15 ? 6 : 12;
    [[rulerX, true], [rulerY, false]].forEach(([cv, horiz]) => {
      const g = cv.getContext('2d'), cw = cv.clientWidth, ch = cv.clientHeight;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cw, ch);
      g.strokeStyle = 'rgba(233,226,210,.45)'; g.fillStyle = 'rgba(233,226,210,.65)'; g.font = '10px "EB Garamond", serif'; g.lineWidth = 1;
      const len = horiz ? cw : ch, off = horiz ? x : y, depth = horiz ? ch : cw;
      const startIn = Math.floor(-off / z / IN / step) * step;
      g.beginPath();
      for (let n = startIn; n * IN * z + off < len; n += step) {
        const p = Math.round(n * IN * z + off) + 0.5, whole = Math.abs(n - Math.round(n)) < 1e-6, half = Math.abs(n * 2 - Math.round(n * 2)) < 1e-6;
        const t = whole ? 10 : half ? 6 : 4;
        if (horiz) { g.moveTo(p, depth); g.lineTo(p, depth - t); } else { g.moveTo(depth, p); g.lineTo(depth - t, p); }
        if (whole && Math.round(n) % labelEvery === 0) {
          const label = String(Math.round(n));
          if (horiz) g.fillText(label, p + 3, 10); else { g.save(); g.translate(10, p + 3); g.rotate(-Math.PI / 2); g.fillText(label, 0, 0); g.restore(); }
        }
      }
      g.stroke();
    });
  }

  /* ------------------------------------------------------------ items */
  function itemHTML(it) {
    switch (it.type) {
      case 'sheet': return `<div class="grip"><span class="sz">${escH(sizeLabel(it))}</span><button class="mini" data-act="post" title="Turn this sheet into a post">→ Post</button></div><div class="page"><input class="sh-title" value="${escH(it.title || '')}" placeholder="Untitled sheet" spellcheck="false"><div class="sh-body" contenteditable="true" data-ph="Write…">${it.html || ''}</div></div>${it.collapsible ? `<button class="more" data-act="more">${it.collapsed ? 'Show full transcript ▾' : 'Show less ▴'}</button>` : ''}<div class="rz"></div>`;
      case 'note': return `<div class="nt-body" contenteditable="true" data-ph="Note…">${it.html || ''}</div><div class="rz"></div>`;
      case 'quote': return `<div class="q-mark">“</div><div class="q-body" contenteditable="true" data-ph="Quotation…">${it.html || ''}</div><div class="q-src" contenteditable="true" data-ph="— Source">${escH(it.source || '')}</div><div class="rz"></div>`;
      case 'image': return `<img src="${escH(it.url)}" alt="" draggable="false"><div class="im-cap" contenteditable="true" data-ph="Caption">${escH(it.caption || '')}</div><div class="rz"></div>`;
      case 'text': return `<div class="tx-body" contenteditable="true" data-ph="Text">${it.html || ''}</div><div class="rz"></div>`;
      case 'rect': case 'ellipse': return `<svg class="shp"></svg><div class="rz"></div>`;
      case 'line': return `<svg class="ln"></svg>`;
      case 'pdf': return `<div class="pdf-bar"><span class="pdf-t">${escH(it.title || 'PDF')}</span><span class="pdf-n">…</span><button class="mini" data-act="openpdf" title="Open the PDF in a new tab">Open</button></div><div class="pdf-scroll"></div><div class="rz"></div>`;
      case 'link': return `${it.image ? `<img class="lk-img" src="${escH(it.image)}" alt="" draggable="false" referrerpolicy="no-referrer">` : ''}<div class="lk-b"><p class="lk-site">${escH(it.site || '')}</p><p class="lk-t">${escH(it.title || it.url)}</p>${it.description ? `<p class="lk-d">${escH(it.description)}</p>` : ''}<div class="lk-acts"><a class="mini" href="${escH(it.url)}" target="_blank" rel="noopener">Open ↗</a><button class="mini" data-act="clip" title="Bring the article's text onto the board as sheets">Clip text → sheets</button></div></div><div class="rz"></div>`;
      case 'video': return `<div class="vd-bar"><span class="vd-t">${escH(it.title || 'YouTube video')}</span><span class="vd-c">${escH(it.channel || '')}</span></div><div class="vd-frame"><iframe src="https://www.youtube-nocookie.com/embed/${escH(it.vid)}?rel=0" title="${escH(it.title || 'YouTube video')}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div><div class="vd-acts"><a class="mini" href="https://www.youtube.com/watch?v=${escH(it.vid)}" target="_blank" rel="noopener">Open on YouTube ↗</a><button class="mini" data-act="transcript">Transcript → sheet</button></div><div class="vd-paste" hidden><p>YouTube didn't let the board fetch this transcript. On YouTube, under the video open <b>…more → Show transcript</b>, select all of it, copy, and paste it here:</p><textarea placeholder="Paste the transcript"></textarea><div><button class="mini" data-act="tpaste">Make transcript sheet</button><button class="mini" data-act="tcancel">Cancel</button></div></div><div class="rz"></div>`;
      case 'post': return `<p class="pc-k">${escH(it.status || 'Post')}</p><p class="pc-t">${escH(it.title || 'Untitled')}</p>${it.subtitle ? `<p class="pc-s">${escH(it.subtitle)}</p>` : ''}<button class="mini" data-act="open">Open in editor</button>`;
    }
    return '';
  }
  function mount(it) {
    const el = document.createElement('div');
    el.className = `it ${it.type}`; el.dataset.id = it.id; el.innerHTML = itemHTML(it);
    // Eight resize dots (corners + edges); text boxes get left/right only.
    const rz0 = el.querySelector(':scope > .rz');
    if (rz0) {
      const dirs = it.type === 'text' ? ['e', 'w'] : ['se', 'nw', 'n', 'ne', 'e', 's', 'sw', 'w'];
      rz0.dataset.h = dirs[0];
      dirs.slice(1).forEach((d) => { const h = document.createElement('div'); h.className = 'rz'; h.dataset.h = d; el.appendChild(h); });
    }
    if (it.type === 'note') el.style.background = NOTE_COLORS[it.color || 'yellow'];
    if ((it.page || 1) > 1) el.classList.add('contpage');
    const ub = document.createElement('button'); ub.className = 'unlock'; ub.title = 'Locked: click to unlock'; ub.innerHTML = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'; el.appendChild(ub);
    world.appendChild(el); els.set(it.id, el); place(it);
    el.querySelectorAll('[contenteditable]').forEach((ed) => ed.addEventListener('input', () => {
      if (ed.classList.contains('sh-body') || ed.classList.contains('nt-body') || ed.classList.contains('q-body')) it.html = ed.innerHTML;
      if (ed.classList.contains('q-src')) it.source = ed.textContent;
      if (ed.classList.contains('im-cap')) it.caption = ed.textContent;
      if (ed.classList.contains('tx-body')) it.html = ed.innerHTML;
      save();
    }));
    el.querySelectorAll('.page, .nt-body, .q-body, .pdf-scroll').forEach((sc) => sc.addEventListener('scroll', () => { if (board.links.some((l) => l.anc)) { dirty.items.add('_anc'); schedule(); } }, { passive: true }));
    el.addEventListener('input', () => { if (board.links.some((l) => l.anc)) { dirty.items.add('_anc'); schedule(); } });
    el.addEventListener('focusin', () => el.classList.add('editing'));
    el.addEventListener('focusout', () => setTimeout(() => { if (!el.contains(document.activeElement)) el.classList.remove('editing'); }));
    el.querySelector('.sh-title')?.addEventListener('input', (e) => { it.title = e.target.value; save(); });
    el.querySelector('[data-act=post]')?.addEventListener('click', () => sheetToPost(it));
    el.querySelector('[data-act=open]')?.addEventListener('click', () => it.postId && openPost(it.postId));
    if (it.type === 'post') el.addEventListener('dblclick', () => it.postId && openPost(it.postId));
    if (it.type === 'text') {
      el.querySelector('.tx-body').addEventListener('input', () => { it.html = el.querySelector('.tx-body').innerHTML; measureText(it); });
    }
    if (it.type === 'pdf') {
      el.querySelector('[data-act=openpdf]').onclick = async () => { const u = await signedUrl(it.path); if (u) open(u, '_blank', 'noopener'); };
      renderPdf(it);
    }
    if (it.type === 'image') {
      // Take the picture's own proportions (no cropping).
      const im = el.querySelector('img');
      const fit = () => { const ar = im.naturalHeight / im.naturalWidth; if (!ar || Math.abs((it.ar || 0) - ar) < 0.002) return; it.ar = ar; it.h = Math.round(it.w * ar); place(it); updateLinks(new Set([it.id])); save(); };
      if (im.complete) fit(); else im.onload = fit;
    }
    if (it.type === 'video') {
      el.querySelector('[data-act=transcript]').onclick = () => fetchTranscript(it);
      const closePaste = () => { el.querySelector('.vd-paste').hidden = true; it.h = SIZES.video[1]; place(it); updateLinks(new Set([it.id])); save(); };
      el.querySelector('[data-act=tcancel]').onclick = closePaste;
      el.querySelector('[data-act=tpaste]').onclick = () => { const t = el.querySelector('.vd-paste textarea').value; const lines = parsePastedTranscript(t); if (!lines.length) { toast('Nothing to use there. Paste the transcript text.'); return; } closePaste(); makeTranscriptSheet(it, lines, it.title); };
    }
    if (it.collapsible) el.querySelector('[data-act=more]').onclick = () => {
      it.collapsed = !it.collapsed; it.h = it.collapsed ? Math.round(3.25 * IN) : paperSize('letter')[1];
      el.classList.toggle('collapsed', it.collapsed); el.querySelector('[data-act=more]').textContent = it.collapsed ? 'Show full transcript ▾' : 'Show less ▴';
      el.querySelector('.page').scrollTop = 0; place(it); updateLinks(new Set([it.id])); save();
    };
    if (it.collapsed) el.classList.add('collapsed');
    if (it.type === 'link') { el.querySelector('[data-act=clip]').onclick = () => clipLink(it); const im = el.querySelector('.lk-img'); if (im) im.onerror = () => im.remove(); }
    paint(it); if (BODY[it.type] && it.type !== 'text' && it.fs) applyFs(it);
    return el;
  }
  function place(it) {
    const el = els.get(it.id); if (!el) return;
    el.style.left = it.x + 'px'; el.style.top = it.y + 'px'; el.style.zIndex = it.z || 1;
    const ro = !!(it.locked || it.readonly);
    el.classList.toggle('locked', !!it.locked); el.classList.toggle('readonly', !!it.readonly);
    if (el.dataset.ro !== String(ro)) {
      el.dataset.ro = String(ro);
      el.querySelectorAll('[contenteditable]').forEach((ed) => { ed.contentEditable = ro ? 'false' : 'true'; });
      el.querySelectorAll('input').forEach((i) => { i.readOnly = ro; });
    }
    if (it.type === 'pdf' && it.pw) el.querySelectorAll('.pdf-pg').forEach((w) => w.style.setProperty('--scale-factor', String(it.w / it.pw)));
    const autoW = it.type === 'text' && it.autoW !== false;
    el.style.width = autoW ? 'max-content' : it.w + 'px';
    el.classList.toggle('autow', autoW);
    el.style.height = it.type === 'text' ? 'auto' : it.h + 'px';
    if (it.rot) el.style.setProperty('--rot', it.rot + 'deg');
  }

  /* ------------------------------------------------------------ text, shapes, lines */
  function paint(it) {
    const el = els.get(it.id); if (!el) return;
    if (it.type === 'text') {
      const b = el.querySelector('.tx-body'); b.style.fontSize = fsOf(it) + 'px'; b.style.color = INK[it.color || 'ivory'];
      requestAnimationFrame(() => measureText(it));
    }
    if (it.type === 'rect' || it.type === 'ellipse') {
      const w = it.w, h = it.h, sw = it.weight || 2, c = INK[it.color || 'ivory'], d = dashArray(it.dash, sw);
      const attrs = `fill="${it.fill ? c : 'none'}" fill-opacity="${it.fill ? 0.14 : 0}" stroke="${c}" stroke-width="${sw}" stroke-dasharray="${d}" stroke-linecap="round" vector-effect="none"`;
      const svg = el.querySelector('.shp'); svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.innerHTML = it.type === 'rect' ? `<rect x="${sw / 2}" y="${sw / 2}" width="${Math.max(0, w - sw)}" height="${Math.max(0, h - sw)}" ${attrs}/>` : `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(0, w / 2 - sw / 2)}" ry="${Math.max(0, h / 2 - sw / 2)}" ${attrs}/>`;
    }
    if (it.type === 'line') paintLine(it);
  }
  const FS_DEFAULT = { text: 24, note: 16, quote: 16, sheet: 16 };
  const BODY = { text: '.tx-body', note: '.nt-body', quote: '.q-body', sheet: '.sh-body' };
  const fsOf = (it) => it.fs || (it.type === 'text' && it.size ? TEXT_SIZES[it.size] : FS_DEFAULT[it.type]);
  function applyFs(it) {
    const b = els.get(it.id)?.querySelector(BODY[it.type]); if (!b) return;
    b.style.fontSize = fsOf(it) + 'px';
    if (it.type === 'text') measureText(it);
  }
  function measureText(it) { const el = els.get(it.id); if (!el) return; it.h = el.offsetHeight || it.h; if (it.autoW !== false) it.w = el.offsetWidth || it.w; updateLinks(new Set([it.id])); }
  // A line stores its ends relative to its box (it.p = [x1, y1, x2, y2]) so it moves like any piece.
  function setLineEnds(it, a, b) {
    it.x = Math.round(Math.min(a.x, b.x)); it.y = Math.round(Math.min(a.y, b.y));
    it.w = Math.max(1, Math.round(Math.abs(b.x - a.x))); it.h = Math.max(1, Math.round(Math.abs(b.y - a.y)));
    it.p = [Math.round(a.x - it.x), Math.round(a.y - it.y), Math.round(b.x - it.x), Math.round(b.y - it.y)];
  }
  const lineEnds = (it) => { const p = it.p || [0, 0, it.w, 0]; return [{ x: it.x + p[0], y: it.y + p[1] }, { x: it.x + p[2], y: it.y + p[3] }]; };
  function paintLine(it) {
    const el = els.get(it.id); if (!el) return;
    const [x1, y1, x2, y2] = it.p || [0, 0, it.w, 0], sw = it.weight || 2, c = INK[it.color || 'ivory'];
    const head = (ax, ay, bx, by) => { // arrowhead at (bx,by) pointing away from (ax,ay)
      const L = Math.max(10, sw * 4 + 6), W = L * 0.55, a = Math.atan2(by - ay, bx - ax);
      const p = (r, t) => `${bx - r * Math.cos(a) + t * Math.sin(a)},${by - r * Math.sin(a) - t * Math.cos(a)}`;
      return `<polygon points="${bx},${by} ${p(L, W)} ${p(L, -W)}" fill="${c}"/>`;
    };
    const ends = it.ends || 'none', sel = el.classList.contains('sel') && !it.locked;
    el.querySelector('.ln').innerHTML = `<line class="hitln" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>` +
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${sw}" stroke-dasharray="${dashArray(it.dash, sw)}" stroke-linecap="round"/>` +
      (ends === 'end' || ends === 'both' ? head(x1, y1, x2, y2) : '') + (ends === 'both' ? head(x2, y2, x1, y1) : '') +
      (sel ? `<circle class="lend" data-end="0" cx="${x1}" cy="${y1}" r="7"/><circle class="lend" data-end="1" cx="${x2}" cy="${y2}" r="7"/>` : '');
  }
  function styleControls(it) {
    const cur = (k, d) => (it[k] ?? d);
    let s = Object.entries(INK).map(([k, c]) => `<button class="sw${cur('color', 'ivory') === k ? ' on' : ''}" data-ink="${k}" style="background:${c}" title="${k}"></button>`).join('');
    if (it.type === 'text') return s;
    s += '<i class="dv"></i>' + WEIGHTS.map((w) => `<button class="sb${cur('weight', 2) === w ? ' on' : ''}" data-w="${w}" title="Line weight ${w}"><svg viewBox="0 0 26 12"><line x1="3" y1="6" x2="23" y2="6" stroke-width="${Math.min(w, 7)}"/></svg></button>`).join('');
    s += '<i class="dv"></i>' + [['solid', ''], ['dashed', '5 3'], ['dotted', '0.1 4']].map(([k, d]) => `<button class="sb${cur('dash', 'solid') === k ? ' on' : ''}" data-dash="${k}" title="${k}"><svg viewBox="0 0 26 12"><line x1="3" y1="6" x2="23" y2="6" stroke-width="2.2" stroke-dasharray="${d}" stroke-linecap="round"/></svg></button>`).join('');
    if (it.type === 'line') s += '<i class="dv"></i>' + [['none', '—'], ['end', '→'], ['both', '↔']].map(([k, l]) => `<button class="sb${cur('ends', 'none') === k ? ' on' : ''}" data-ends="${k}" title="Arrowheads">${l}</button>`).join('');
    else s += `<button class="sb${it.fill ? ' on' : ''}" data-fill="1" title="Tinted fill">Fill</button>`;
    return s;
  }
  function wireStyle(bar, it) {
    const set = (patch) => { Object.assign(it, patch); remember(patch); paint(it); renderSelBar(); save(); };
    bar.querySelectorAll('[data-ink]').forEach((b) => b.onclick = () => set({ color: b.dataset.ink }));
    bar.querySelectorAll('[data-size]').forEach((b) => b.onclick = () => set({ size: b.dataset.size }));
    bar.querySelectorAll('[data-w]').forEach((b) => b.onclick = () => set({ weight: +b.dataset.w }));
    bar.querySelectorAll('[data-dash]').forEach((b) => b.onclick = () => set({ dash: b.dataset.dash }));
    bar.querySelectorAll('[data-ends]').forEach((b) => b.onclick = () => set({ ends: b.dataset.ends }));
    bar.querySelector('[data-fill]')?.addEventListener('click', () => set({ fill: !it.fill }));
  }
  function addItem(type, cx, cy, extra = {}) {
    let w, h;
    if (type === 'sheet') { extra.paper ||= 'letter'; [w, h] = paperSize(extra.paper, extra.land); } else [w, h] = SIZES[type];
    if (extra.w) w = extra.w; if (extra.h) h = extra.h;
    const looks = type === 'text' ? { color: style.color, ...(style.fs ? { fs: style.fs } : {}) } : ['rect', 'ellipse', 'line'].includes(type) ? { color: style.color, weight: style.weight, dash: style.dash, fill: style.fill, ends: style.ends } : {};
    const at = type === 'text' ? { x: Math.round(cx), y: Math.round(cy - 20) } : { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2) };
    const it = { id: uid(), type, ...at, w, h, z: ++zTop, rot: 0, ...looks, ...extra };
    board.items.push(it); mount(it); select(it.id); save(); return it;
  }
  const viewCenter = () => toWorld(...vpCenter());
  const byId = (id) => board.items.find((i) => i.id === id);

  // `sel` holds every selected piece; `selected` is the primary one (the last clicked),
  // or null when several are selected.
  function setSel(ids) {
    const linkWas = selLink; selLink = null;
    const same = !linkWas && ids.length === sel.size && ids.every((i) => sel.has(i));
    const before = sel;
    sel = new Set(ids); selected = sel.size === 1 ? ids[0] : null;
    els.forEach((el, k) => el.classList.toggle('sel', sel.has(k)));
    [...before, ...sel].forEach((i) => { const it = byId(i); if (it?.type === 'line') paintLine(it); });
    if (ink && ink.id !== selected) setInk(null);
    ids.forEach((i) => { const it = byId(i); if (it && (it.z || 0) < zTop && ids.length === 1) { it.z = ++zTop; place(it); } });
    if (!same) { if (linkWas) drawLinks(); renderSelBar(); }
    drawGroupBox();
  }
  const select = (id) => setSel(id ? [id] : []);
  // Groups: pieces sharing it.group are selected and moved together.
  const groupIds = (g) => board.items.filter((i) => i.group === g).map((i) => i.id);
  const withGroups = (ids) => [...new Set(ids.flatMap((id) => { const g = byId(id)?.group; return g ? groupIds(g) : [id]; }))];
  const selGroup = () => { const gs = new Set([...sel].map((i) => byId(i)?.group)); if (gs.size !== 1) return null; const g = [...gs][0]; return g && groupIds(g).length === sel.size ? g : null; };
  const pick = (it) => setSel(it.group ? groupIds(it.group) : [it.id]);
  function drawGroupBox() {
    let box = $('deskGroupBox');
    if (!box) { box = document.createElement('div'); box.id = 'deskGroupBox'; box.className = 'group-box'; world.appendChild(box); }
    const g = sel.size > 1 && selGroup(); world.classList.toggle('gsel', !!g);
    if (!g) { box.hidden = true; return; }
    const its = [...sel].map(byId).filter(Boolean);
    const x1 = Math.min(...its.map((i) => i.x)), y1 = Math.min(...its.map((i) => i.y)), x2 = Math.max(...its.map((i) => i.x + i.w)), y2 = Math.max(...its.map((i) => i.y + i.h));
    Object.assign(box.style, { left: x1 - 10 + 'px', top: y1 - 10 + 'px', width: x2 - x1 + 20 + 'px', height: y2 - y1 + 20 + 'px' }); box.hidden = false;
  }
  function groupSel() { if (sel.size < 2) return; const g = uid(); sel.forEach((id) => { const it = byId(id); if (it) it.group = g; }); drawGroupBox(); renderSelBar(); save(); toast(`Grouped ${sel.size} pieces`); }
  function ungroupSel() { sel.forEach((id) => { const it = byId(id); if (it) delete it.group; }); drawGroupBox(); renderSelBar(); save(); toast('Ungrouped'); }
  function toggleSel(id) { const ids = [...sel]; setSel(sel.has(id) ? ids.filter((i) => i !== id) : [...ids, id]); }
  function selectLink(id) {
    selected = null; sel = new Set(); selLink = id;
    els.forEach((el) => el.classList.remove('sel'));
    drawLinks(); renderSelBar();
  }
  function renderSelBar() {
    const bar = $('deskSel');
    if (selLink) {
      const l = board.links.find((x) => x.id === selLink);
      bar.innerHTML = '<span>String</span>' +
        Object.entries(STRING_COLORS).map(([k, c]) => `<button class="sw${(l.color || 'red') === k ? ' on' : ''}" data-sc="${k}" style="background:${c}" title="${k}"></button>`).join('') +
        '<button data-a="slack">Slack</button><button data-a="taut">Taut</button><button data-a="del">Cut</button><em>Drag the string or its knob to bend it</em>';
      bar.hidden = false;
      bar.querySelectorAll('[data-sc]').forEach((b) => b.onclick = () => { l.color = b.dataset.sc; drawLinks(); renderSelBar(); save(); });
      bar.querySelector('[data-a=slack]').onclick = () => { delete l.bend; drawLinks(); save(); };
      bar.querySelector('[data-a=taut]').onclick = () => { l.bend = { x: 0, y: 0 }; drawLinks(); save(); };
    } else if (sel.size > 1) {
      const anyUnlocked = [...sel].some((i) => !byId(i)?.locked);
      const g = selGroup();
      bar.innerHTML = `<span>${g ? 'Group of ' + sel.size : sel.size + ' pieces'}</span>` + (g ? `<button data-a="ungroup" title="Ungroup (Ctrl+Shift+G)"><svg viewBox="0 0 24 24" class="ic"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M7 15v4h4M17 9V5h-4" stroke-dasharray="2 2"/></svg> Ungroup</button>` : `<button data-a="group" title="Group (Ctrl+G)"><svg viewBox="0 0 24 24" class="ic"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M7 15v4h4M17 9V5h-4" stroke-dasharray="2 2"/></svg> Group</button>`) + `<button data-a="lockall" title="Lock or unlock (Ctrl+Shift+L)">${anyUnlocked ? '<svg viewBox="0 0 24 24" class="ic"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg> Lock all' : '<svg viewBox="0 0 24 24" class="ic"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg> Unlock all'}</button><button data-a="chain" title="Tie them together in the order you selected them">Tie together</button><button data-a="dup">Duplicate</button><button data-a="del">Delete</button><em>Shift-click to add or remove</em>`;
      bar.hidden = false;
      bar.querySelector('[data-a=chain]').onclick = () => {
        const ids = [...sel]; let n = 0;
        for (let i = 1; i < ids.length; i++) {
          const a = ids[i - 1], b = ids[i];
          if (!board.links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))) { board.links.push({ id: uid(), a, b }); n++; }
        }
        drawLinks(); save(); toast(n ? `Tied ${n} string${n > 1 ? 's' : ''}` : 'Already tied');
      };
      bar.querySelector('[data-a=dup]').onclick = duplicateSel;
      bar.querySelector('[data-a=lockall]').onclick = () => toggleLock(anyUnlocked);
      bar.querySelector('[data-a=group]')?.addEventListener('click', groupSel);
      bar.querySelector('[data-a=ungroup]')?.addEventListener('click', ungroupSel);
      if (g) bar.querySelector('em').textContent = 'Double-click a piece to edit it alone';
    } else if (selected) {
      const it = byId(selected);
      let extra = '';
      if (['text', 'rect', 'ellipse', 'line'].includes(it.type)) extra = styleControls(it);
      if (it.type === 'pdf') extra = `<button data-a="pdflayout" title="Switch between one scrolling document and separate pages">${it.mode === 'page' ? 'Join pages' : 'Separate pages'}</button><i class="dv"></i>` +
        [['pen', 'Pen'], ['hl', 'Highlight'], ['erase', 'Erase']].map(([k, l]) => `<button class="sb${ink?.mode === k ? ' on' : ''}" data-ink-mode="${k}">${l}</button>`).join('') +
        (ink && ink.mode !== 'erase' ? Object.entries(PEN).map(([k, c]) => `<button class="sw${ink.color === k ? ' on' : ''}" data-pen="${k}" style="background:${c}" title="${k}"></button>`).join('') : '') +
        '<button data-a="clearpg" title="Remove every pen mark and highlight">Clear marks</button><i class="dv"></i>';
      if (it.type === 'note') extra = `<span class="fsz" title="Margin inside every sticky note (your preference)">Margin<input type="number" class="npad" min="0" max="72" step="1" value="${Math.round(prefs.notePad * 0.75)}"><em>pt</em></span><i class="dv"></i>` + Object.keys(NOTE_COLORS).map((c) => `<button class="sw" data-c="${c}" style="background:${NOTE_COLORS[c]}" title="${c}"></button>`).join('');
      if (it.type === 'sheet') {
        extra = `<select data-a="paper" title="Paper size">${Object.entries(PAPER).map(([k, [n, w, h]]) => `<option value="${k}"${it.paper === k ? ' selected' : ''}>${n} (${w} × ${h})</option>`).join('')}<option value="custom"${!it.paper || it.paper === 'custom' ? ' selected' : ''}>Custom (${fmtIn(it.w)} × ${fmtIn(it.h)})</option></select>` +
          `<button data-a="orient" title="Portrait / landscape">${it.w > it.h ? 'Landscape' : 'Portrait'}</button><button data-a="zoom">Zoom to sheet</button>` +
          (overflows(it) ? '<button data-a="split" title="Flow the overflow onto new pages">Split into pages</button>' : '') +
          (chainOf(it).length > 1 ? '<button data-a="join" title="Put the pages back into one sheet">Join pages</button>' : '') +
          (it.readonly ? '<button data-a="ro" title="Allow typing in this sheet">Make editable</button>' : '');
      }
      if (BODY[it.type] && !it.readonly && !it.locked) {
        extra = `<span class="lists"><button data-list="insertUnorderedList" title="Bulleted list (type - then a space)"><svg viewBox="0 0 24 24" class="ic"><circle cx="5" cy="7" r="1.3"/><circle cx="5" cy="12" r="1.3"/><circle cx="5" cy="17" r="1.3"/><path d="M9 7h11M9 12h11M9 17h11"/></svg></button><button data-list="insertOrderedList" title="Numbered list (type 1. then a space)"><svg viewBox="0 0 24 24" class="ic"><path d="M4 5h1.5v4M4 9h3M4 14.5c0-1 2.8-1 2.8.3 0 1-2.8 1.7-2.8 3.2h3M10 7h10M10 12h10M10 17h10"/></svg></button><button data-list="indent" title="Indent (Tab)"><svg viewBox="0 0 24 24" class="ic"><path d="M4 5h16M10 10h10M10 14h10M4 19h16M4 9.5l3 2.5-3 2.5"/></svg></button><button data-list="outdent" title="Outdent (Shift+Tab)"><svg viewBox="0 0 24 24" class="ic"><path d="M4 5h16M10 10h10M10 14h10M4 19h16M7 9.5L4 12l3 2.5"/></svg></button></span><i class="dv"></i>` + extra;
      }
      if (BODY[it.type]) {
        const pt = Math.round(fsOf(it) * 0.75 * 10) / 10;
        extra = `<span class="fsz" title="Text size in points"><button data-fs="-1" title="Smaller">A−</button><input type="number" min="6" max="144" step="1" value="${pt}" aria-label="Text size in points"><em>pt</em><button data-fs="1" title="Larger">A+</button></span><i class="dv"></i>` + extra;
      }
      bar.innerHTML = `<span>${LABEL[it.type] || 'Piece'}</span>${extra}` +
        `<button data-a="lock" title="Lock or unlock (Ctrl+Shift+L)">${it.locked ? '<svg viewBox="0 0 24 24" class="ic"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg> Unlock' : '<svg viewBox="0 0 24 24" class="ic"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg> Lock'}</button>` +
        '<button data-a="tie">Tie string</button><button data-a="dup">Duplicate</button>' + (it.locked ? '' : '<button data-a="del">Delete</button>');
      bar.hidden = false;
      bar.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { it.color = b.dataset.c; els.get(it.id).style.background = NOTE_COLORS[it.color]; save(); });
      bar.querySelector('[data-a=paper]')?.addEventListener('change', (e) => {
        const k = e.target.value; if (k === 'custom') return;
        const cx = it.x + it.w / 2; it.paper = k; [it.w, it.h] = paperSize(k, it.w > it.h); it.x = Math.round(cx - it.w / 2);
        resized(it); renderSelBar();
      });
      bar.querySelector('[data-a=orient]')?.addEventListener('click', () => {
        const cx = it.x + it.w / 2; [it.w, it.h] = [it.h, it.w]; it.x = Math.round(cx - it.w / 2); resized(it); renderSelBar();
      });
      bar.querySelector('[data-a=zoom]')?.addEventListener('click', () => zoomToItem(it));
      if (['text', 'rect', 'ellipse', 'line'].includes(it.type)) wireStyle(bar, it);
      bar.querySelectorAll('[data-list]').forEach((b) => {
        b.addEventListener('pointerdown', (e) => e.preventDefault()); b.addEventListener('mousedown', (e) => e.preventDefault());
        b.onclick = () => {
          const ed = els.get(it.id)?.querySelector(BODY[it.type]); if (!ed) return;
          if (!ed.contains(document.activeElement) && document.activeElement !== ed) { ed.focus({ preventScroll: true }); const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const s2 = getSelection(); s2.removeAllRanges(); s2.addRange(r); }
          listCmd(b.dataset.list); ed.dispatchEvent(new Event('input', { bubbles: true }));
        };
      });
      const np = bar.querySelector('.npad');
      if (np) {
        const setPad = () => { const pt = Math.min(72, Math.max(0, Math.round(+np.value || 0))); np.value = pt; setPref({ notePad: Math.round(pt / 0.75) }); updateLinks(); toast(`Sticky-note margins set to ${pt} pt on all notes`); };
        np.addEventListener('change', setPad); np.addEventListener('keydown', (e) => { if (e.key === 'Enter') { setPad(); np.blur(); } });
      }
      const fsIn = bar.querySelector('.fsz input:not(.npad)');
      if (fsIn) {
        const setPt = (pt) => { pt = Math.min(144, Math.max(6, Math.round(pt * 2) / 2)); it.fs = Math.round(pt / 0.75 * 100) / 100; fsIn.value = pt; applyFs(it); if (it.type === 'text') remember({ fs: it.fs }); updateLinks(new Set([it.id])); save(); };
        fsIn.addEventListener('change', () => setPt(+fsIn.value || 12));
        fsIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { setPt(+fsIn.value || 12); fsIn.blur(); } });
        bar.querySelectorAll('[data-fs]').forEach((b) => b.onclick = () => setPt(Math.round(fsOf(it) * 0.75) + +b.dataset.fs));
      }
      if (it.type === 'pdf') {
        bar.querySelector('[data-a=pdflayout]').onclick = () => (it.mode === 'page' ? pdfJoin(it) : pdfToPages(it));
        bar.querySelectorAll('[data-ink-mode]').forEach((b) => b.onclick = () => {
          const m = b.dataset.inkMode;
          setInk(ink?.mode === m ? null : { id: it.id, mode: m, color: m === 'hl' ? (ink?.mode === 'hl' ? ink.color : 'yellow') : m === 'pen' ? (ink?.mode === 'pen' ? ink.color : 'red') : null });
        });
        bar.querySelectorAll('[data-pen]').forEach((b) => b.onclick = () => { ink.color = b.dataset.pen; renderSelBar(); });
        bar.querySelector('[data-a=clearpg]').onclick = async () => {
          if (!(await confirmBox('Clear the marks?', '<p>Pen marks, highlights and underlines on this PDF will be removed. Notes tied to passages stay.</p>', 'Clear'))) return;
          for (const k of Object.keys(it.marks || {})) it.marks[k] = it.marks[k].filter((m) => m.t === 'anc'); renderMarks(it); save();
        };
      }
      bar.querySelector('[data-a=split]')?.addEventListener('click', () => splitSheet(it));
      bar.querySelector('[data-a=ro]')?.addEventListener('click', () => { chainOf(it).forEach((pg) => { delete pg.readonly; place(pg); }); renderSelBar(); save(); toast('You can type in it now.'); });
      bar.querySelector('[data-a=join]')?.addEventListener('click', () => joinSheets(it));
      bar.querySelector('[data-a=dup]').onclick = duplicateSel;
      bar.querySelector('[data-a=lock]').onclick = () => toggleLock(!it.locked);
      bar.querySelector('[data-a=tie]').onclick = () => { setTool('string'); tieFrom = selected; els.get(selected)?.classList.add('tie-from'); };
    } else { bar.hidden = true; return; }
    const del = bar.querySelector('[data-a=del]'); if (del) del.onclick = removeSelected;
  }
  function resized(it) {
    place(it); updateLinks(new Set([it.id]));
    const sz = els.get(it.id)?.querySelector('.sz'); if (sz) sz.textContent = sizeLabel(it);
    save();
  }
  function duplicateSel() {
    const map = new Map(), out = [];
    const gmap = new Map();
    [...sel].map(byId).filter(Boolean).forEach((it) => { const c = JSON.parse(JSON.stringify(it)); c.id = uid(); c.x += 48; c.y += 48; c.z = ++zTop; if (c.group) { if (!gmap.has(c.group)) gmap.set(c.group, uid()); c.group = gmap.get(c.group); } map.set(it.id, c.id); board.items.push(c); mount(c); out.push(c.id); });
    // Strings between duplicated pieces are duplicated too.
    board.links.filter((l) => map.has(l.a) && map.has(l.b)).forEach((l) => board.links.push({ ...l, id: uid(), a: map.get(l.a), b: map.get(l.b) }));
    drawLinks(); setSel(out); save();
  }
  function cleanAnchors() {
    const live = new Set(board.links.map((l) => l.anc).filter(Boolean));
    const touched = new Set();
    world.querySelectorAll('.anc').forEach((sp) => {
      if (live.has(sp.dataset.anc)) return;
      const ed = sp.closest('[contenteditable]'); sp.replaceWith(...sp.childNodes); if (ed) touched.add(ed);
    });
    touched.forEach((ed) => { ed.normalize(); ed.dispatchEvent(new Event('input', { bubbles: true })); });
    board.items.forEach((it) => {
      if (it.type !== 'pdf' || !it.marks) return; let changed = false;
      for (const k of Object.keys(it.marks)) { const n = it.marks[k].filter((m) => m.t !== 'anc' || live.has(m.id)); if (n.length !== it.marks[k].length) { it.marks[k] = n; changed = true; } }
      if (changed) renderMarks(it);
    });
  }
  function toggleLock(on) {
    const n = sel.size;
    sel.forEach((id) => { const it = byId(id); if (!it) return; if (on) it.locked = true; else delete it.locked; place(it); if (it.type === 'line') paintLine(it); });
    if (on) { document.activeElement?.blur?.(); setSel([]); } else renderSelBar();
    save(); toast(on ? (n > 1 ? `Locked ${n} pieces. To unlock several, Alt-drag a box over them.` : 'Locked. Use the lock at its bottom-left corner to unlock.') : (n > 1 ? `Unlocked ${n} pieces` : 'Unlocked'));
  }
  function removeSelected() {
    if (selLink) { board.links = board.links.filter((l) => l.id !== selLink); selLink = null; cleanAnchors(); drawLinks(); renderSelBar(); save(); return; }
    if (!sel.size) return;
    const gone = new Set([...sel].filter((id) => !byId(id)?.locked));
    if (gone.size < sel.size) toast('Locked pieces were kept. Unlock them to delete.');
    if (!gone.size) return;
    board.items = board.items.filter((i) => !gone.has(i.id));
    board.links = board.links.filter((l) => !gone.has(l.a) && !gone.has(l.b));
    gone.forEach((id) => { els.get(id)?.remove(); els.delete(id); });
    sel = new Set(); selected = null; cleanAnchors(); drawLinks(); renderSelBar(); save();
  }

  /* ------------------------------------------------------------ pages: split & join */
  // A sheet whose text runs past its bottom margin can be split: the overflow moves
  // onto new sheets of the same size, placed to the right, breaking mid-paragraph at
  // the last line that fits. Pages share a `chain` (the first page's id) and `page` no.
  const PAD_BOTTOM = 72;
  function overflows(it) { const pg = els.get(it.id)?.querySelector('.page'); return !!pg && pg.scrollHeight > pg.clientHeight + 2; }
  function chainOf(it) {
    const root = it.chain || it.id;
    return board.items.filter((i) => i.type === 'sheet' && (i.id === root || i.chain === root)).sort((a, b) => (a.page || 1) - (b.page || 1));
  }
  function splitPoint(block, limit) {
    // First word in `block` whose line falls below `limit` (screen px), as a DOM position.
    const tw = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const r = document.createRange();
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const re = /\S+/g; let m;
      while ((m = re.exec(n.data))) {
        r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
        const rc = r.getClientRects()[0]; if (rc && rc.bottom > limit + 0.5) return { node: n, offset: m.index };
      }
    }
    return null;
  }
  function splitOnce(it) {
    const el = els.get(it.id), page = el.querySelector('.page'), body = el.querySelector('.sh-body');
    page.scrollTop = 0;
    if (page.scrollHeight <= page.clientHeight + 2) return null;
    if (!body.children.length && body.textContent.trim()) body.innerHTML = `<p>${body.innerHTML}</p>`;
    const z = view().z, limit = page.getBoundingClientRect().bottom - PAD_BOTTOM * z;
    const blocks = [...body.children];
    const i = blocks.findIndex((b) => b.getBoundingClientRect().bottom > limit + 0.5);
    if (i < 0) return null;
    const moved = document.createElement('div');
    const first = blocks[i], sp = first.getBoundingClientRect().top < limit - 4 ? splitPoint(first, limit) : null;
    if (sp && !(i === 0 && sp.node === first.firstChild && sp.offset === 0)) {
      const r = document.createRange(); r.setStart(sp.node, sp.offset); r.setEnd(first, first.childNodes.length);
      const tail = first.cloneNode(false); tail.appendChild(r.extractContents()); tail.classList.add('cont');
      moved.appendChild(tail); blocks.slice(i + 1).forEach((b) => moved.appendChild(b));
    } else {
      if (i === 0) return null; // a single block taller than the page: leave it
      blocks.slice(i).forEach((b) => moved.appendChild(b));
    }
    it.html = body.innerHTML;
    const root = it.chain || it.id; it.chain = root; it.page ||= 1;
    // Make room: later pages shift one number along.
    board.items.forEach((o) => { if (o.chain === root && o.id !== it.id && o.page > it.page) { o.page++; refreshLabel(o); } });
    const nx = { id: uid(), type: 'sheet', paper: it.paper, w: it.w, h: it.h, x: it.x + it.w + 48, y: it.y, z: ++zTop, rot: 0, title: it.title || '', html: moved.innerHTML, chain: root, page: it.page + 1, ...(it.readonly ? { readonly: true } : {}) };
    board.items.forEach((o) => { if (o.chain === root && o.page > nx.page) { o.x += it.w + 48; place(o); } });
    board.items.push(nx); mount(nx); refreshLabel(it);
    return nx;
  }
  function splitSheet(it) {
    let cur = it, made = 0;
    while (cur && made < 60) { cur = splitOnce(cur); if (cur) made++; }
    drawLinks(); renderSelBar(); save();
    toast(made ? `Split into ${made + 1} pages` : 'Nothing to split');
  }
  function joinSheets(it) {
    const pages = chainOf(it); if (pages.length < 2) return;
    const head = pages[0];
    head.html = joinedHtml(pages); delete head.chain; delete head.page;
    const gone = new Set(pages.slice(1).map((p) => p.id));
    board.links.forEach((l) => { if (gone.has(l.a)) l.a = head.id; if (gone.has(l.b)) l.b = head.id; });
    board.links = board.links.filter((l) => l.a !== l.b);
    board.items = board.items.filter((i) => !gone.has(i.id));
    gone.forEach((id) => { els.get(id)?.remove(); els.delete(id); });
    const el = els.get(head.id); el.querySelector('.sh-body').innerHTML = head.html; refreshLabel(head);
    setSel([head.id]); drawLinks(); renderSelBar(); save(); toast('Pages joined');
  }
  function joinedHtml(pages) {
    const tmp = document.createElement('div');
    tmp.innerHTML = pages.map((p) => p.html || '').join('');
    // Re-join paragraphs that a split cut in two.
    tmp.querySelectorAll('.cont').forEach((c) => {
      const prev = c.previousElementSibling;
      if (prev && prev.tagName === c.tagName) { prev.append(...c.childNodes); c.remove(); } else { c.classList.remove('cont'); if (!c.className) c.removeAttribute('class'); }
    });
    return tmp.innerHTML;
  }
  function refreshLabel(it) {
    const el = els.get(it.id); if (!el) return;
    const sz = el.querySelector('.sz'); if (sz) sz.textContent = sizeLabel(it);
    el.classList.toggle('contpage', (it.page || 1) > 1);
  }

  /* ------------------------------------------------------------ strings */
  // A string is a quadratic curve between two pins. Its shape is set by the "apex"
  // (the curve's midpoint), stored as an offset from the straight-line midpoint so the
  // bend travels with the pieces. No offset = natural slack.
  const pinOf = (it) => ({ x: it.x + it.w / 2, y: it.y + 12 });
  // A string tied to a passage (l.anc) ends at those words, wherever they now are.
  function anchorPoint(l, toward) {
    const spans = world.querySelectorAll(`.anc[data-anc="${l.anc}"]`);
    if (!spans.length) {
      const host = byId(l.b); if (host?.type !== 'pdf') return null;
      for (const [p, list] of Object.entries(host.marks || {})) {
        const m = list.find((x) => x.t === 'anc' && x.id === l.anc); if (!m) continue;
        const w = pageEl(host, +p); if (!w) return null;
        const sr = w.querySelector('.marks').getBoundingClientRect(), H = markH(host, +p), r = m.r[0];
        const scr = (x, y) => [sr.left + x / 1000 * sr.width, sr.top + y / H * sr.height];
        const right = toward && toWorld(...scr(r[0] + r[2], 0)).x < toward.x;
        let [cx, cy] = scr(right ? r[0] + r[2] + 2 : r[0] - 2, r[1] + r[3] / 2);
        const box = w.closest('.pdf-scroll').getBoundingClientRect(); cy = Math.min(Math.max(cy, box.top + 6), box.bottom - 6);
        return toWorld(cx, cy);
      }
      return null;
    }
    const first = spans[0].getClientRects()[0], last = [...spans[spans.length - 1].getClientRects()].pop();
    if (!first || !last) return null;
    const right = toward && toWorld(last.right, last.top).x < toward.x;
    const r = right ? last : first;
    let cx = right ? r.right + 2 : r.left - 2, cy = r.top + r.height / 2;
    const box = spans[0].closest('.page, .nt-body, .q-body, .tx-body');
    if (box) { const br = box.getBoundingClientRect(); cy = Math.min(Math.max(cy, br.top + 6), br.bottom - 6); }
    return toWorld(cx, cy);
  }
  function geom(l) {
    const a = byId(l.a), b = byId(l.b); if (!a || !b) return null;
    let p = pinOf(a), q = (l.anc && anchorPoint(l, p)) || pinOf(b);
    if (l.anc) p = { x: q.x < a.x + a.w / 2 ? a.x + 4 : a.x + a.w - 4, y: a.y + 28 }; // from the note's near side
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const apex = l.bend ? { x: m.x + l.bend.x, y: m.y + l.bend.y } : { x: m.x, y: m.y + Math.min(200, d * (l.anc ? 0.05 : 0.14)) };
    const c = { x: 2 * apex.x - m.x, y: 2 * apex.y - m.y };
    return { p, q, m, apex, d: `M${p.x},${p.y} Q${c.x},${c.y} ${q.x},${q.y}` };
  }
  const mk = (tag, cls) => { const n = document.createElementNS(NS, tag); if (cls) n.setAttribute('class', cls); return n; };
  function drawLinks() {
    svg.textContent = ''; linkEls.clear();
    for (const l of board.links) {
      const g = mk('g', 'lk' + (selLink === l.id ? ' sel' : '')); g.dataset.id = l.id;
      const r = { g, shadow: mk('path', 'shd'), hit: mk('path', 'hit'), str: mk('path', 'str'), p1: mk('circle', 'pin'), p2: mk('circle', 'pin'), knob: null };
      r.str.style.stroke = STRING_COLORS[l.color || 'red'];
      [r.p1, r.p2].forEach((c) => c.setAttribute('r', 7));
      if (l.anc) r.p2.setAttribute('r', 4);
      g.append(r.shadow, r.hit, r.str, r.p1, r.p2);
      if (selLink === l.id) { r.knob = mk('circle', 'knob'); r.knob.setAttribute('r', 9); g.append(r.knob); }
      svg.append(g); linkEls.set(l.id, r);
    }
    updateLinks();
  }
  function updateLinks(only) {
    for (const l of board.links) {
      if (only && !l.anc && !only.has(l.a) && !only.has(l.b) && !only.has(l.id)) continue;
      const r = linkEls.get(l.id), gm = geom(l); if (!r || !gm) continue;
      r.str.setAttribute('d', gm.d); r.hit.setAttribute('d', gm.d); r.shadow.setAttribute('d', gm.d);
      r.p1.setAttribute('cx', gm.p.x); r.p1.setAttribute('cy', gm.p.y); r.p2.setAttribute('cx', gm.q.x); r.p2.setAttribute('cy', gm.q.y);
      if (r.knob) { r.knob.setAttribute('cx', gm.apex.x); r.knob.setAttribute('cy', gm.apex.y); }
    }
  }

  /* ------------------------------------------------------------ lists and indents */
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}
  function listCmd(cmd) {
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(cmd);
    // Chrome indents plain paragraphs with a <blockquote>; mark it so it isn't styled as a quotation.
    world.querySelectorAll('blockquote[style*="margin"]').forEach((q) => q.classList.add('ind'));
  }
  world.addEventListener('keydown', (e) => {
    const ed = e.target.closest?.('[contenteditable="true"]'); if (!ed) return;
    if (e.key === 'Tab') { e.preventDefault(); listCmd(e.shiftKey ? 'outdent' : 'indent'); ed.dispatchEvent(new Event('input', { bubbles: true })); return; }
    if (e.key === ' ') {
      // "- " / "* " / "• " starts a bulleted list, "1. " a numbered one.
      const sel = getSelection(); if (!sel.rangeCount || !sel.isCollapsed) return;
      const r = sel.getRangeAt(0), node = r.startContainer; if (node.nodeType !== 3) return;
      const before = node.data.slice(0, r.startOffset);
      const block = node.parentElement.closest('p, div, li, h3, blockquote') || ed;
      const pre = document.createRange(); pre.selectNodeContents(block); pre.setEnd(r.startContainer, r.startOffset);
      const prev = node.previousSibling;
      const lead = block === ed ? ((!prev || prev.nodeType === 1) ? before : '') : pre.toString();
      const kind = /^[-*•]$/.test(lead) ? 'insertUnorderedList' : /^1[.)]$/.test(lead) ? 'insertOrderedList' : null;
      if (!kind || block.closest('li')) return;
      e.preventDefault();
      node.data = node.data.slice(before.length); // drop the marker
      const r2 = document.createRange();
      if (node.data) r2.setStart(node, 0); else { const p = node.parentNode; node.remove(); r2.selectNodeContents(block === ed ? ed : block); if (!block.textContent) block.innerHTML = '<br>'; r2.setStart(block, 0); }
      r2.collapse(true); sel.removeAllRanges(); sel.addRange(r2);
      listCmd(kind); ed.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      // Enter on an empty bullet steps out one level, or leaves the list.
      const sel = getSelection(); if (!sel.rangeCount) return;
      const n = sel.getRangeAt(0).startContainer, li = (n.nodeType === 1 ? n : n.parentElement).closest('li');
      if (!li || !ed.contains(li) || li.textContent.replace(/\u200b/g, '').trim()) return;
      e.preventDefault();
      const nested = li.parentElement.parentElement.closest('ul, ol, li') && ed.contains(li.parentElement.parentElement);
      if (nested) listCmd('outdent');
      else { // leave the list: an empty paragraph takes the empty bullet's place
        const list = li.parentElement, para = document.createElement('p'); para.innerHTML = '<br>';
        const rest = []; for (let x = li.nextSibling; x; x = x.nextSibling) rest.push(x);
        list.after(para);
        if (rest.length) { const l2 = list.cloneNode(false); rest.forEach((x) => l2.appendChild(x)); para.after(l2); }
        li.remove(); if (!list.children.length) list.remove();
        const r3 = document.createRange(); r3.setStart(para, 0); r3.collapse(true); sel.removeAllRanges(); sel.addRange(r3);
      }
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  /* ------------------------------------------------------------ formatting bar: highlight, underline, + note */
  const HL = { yellow: '#F6E27A', green: '#BFE3A8', pink: '#F4B6C8', blue: '#B8D6F2' };
  const fmt = $('deskFmt');
  fmt.innerHTML = Object.entries(HL).map(([k, c]) => `<button class="hlsw" data-hl="${c}" title="Highlight ${k}" style="background:${c}"></button>`).join('') +
    '<i class="dv"></i><button data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button><button data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button><button data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>' +
    '<button data-cmd="clear" title="Remove highlight and formatting">Clear</button><i class="dv"></i><button data-cmd="note" class="fmt-note" title="Tie a sticky note to this passage">+ Note</button>';
  let fmtRange = null, fmtEd = null;
  const hideFmt = () => { fmt.hidden = true; fmtRange = null; fmtEd = null; };
  document.addEventListener('selectionchange', () => {
    if (!board || !$('v-desk').classList.contains('on') || drag) return;
    const s = getSelection(); if (!s.rangeCount || s.isCollapsed) { hideFmt(); return; }
    const r = s.getRangeAt(0), host = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
    const ed = host?.closest('[contenteditable], .textLayer'); if (!ed || !world.contains(ed)) { hideFmt(); return; }
    fmtRange = r.cloneRange(); fmtEd = ed;
    const hostIt = byId(ed.closest('.it')?.dataset.id);
    fmt.classList.toggle('pdfmode', ed.classList.contains('textLayer') || !!hostIt?.locked || !!hostIt?.readonly);
    const rr = r.getBoundingClientRect(), mr = $('deskVp').parentElement.getBoundingClientRect();
    fmt.hidden = false;
    const w = fmt.offsetWidth, top = rr.top - mr.top - fmt.offsetHeight - 10;
    fmt.style.left = Math.min(Math.max(8, rr.left - mr.left + rr.width / 2 - w / 2), mr.width - w - 8) + 'px';
    fmt.style.top = (top < 30 ? rr.bottom - mr.top + 10 : top) + 'px';
  });
  fmt.addEventListener('pointerdown', (e) => e.preventDefault());
  fmt.addEventListener('mousedown', (e) => e.preventDefault());
  fmt.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !fmtRange) return;
    if (fmtEd?.classList.contains('textLayer')) { pdfFormat(b); return; }
    const s = getSelection();
    const lockedEd = fmtEd?.isContentEditable === false && fmtEd.getAttribute('contenteditable') === 'false';
    if (lockedEd) fmtEd.contentEditable = 'true'; // briefly, so the mark can be applied
    s.removeAllRanges(); s.addRange(fmtRange);
    document.execCommand('styleWithCSS', false, true);
    if (b.dataset.hl) document.execCommand('hiliteColor', false, b.dataset.hl);
    else if (b.dataset.cmd === 'clear') { document.execCommand('removeFormat'); document.execCommand('hiliteColor', false, 'transparent'); }
    else if (b.dataset.cmd === 'note') { if (lockedEd) fmtEd.contentEditable = 'false'; noteOnSelection(); return; }
    else document.execCommand(b.dataset.cmd);
    if (lockedEd) { fmtEd.contentEditable = 'false'; }
    fmtEd?.dispatchEvent(new Event('input', { bubbles: true }));
    if (s.rangeCount) fmtRange = s.getRangeAt(0).cloneRange();
  });
  // PDFs: highlights, underlines and passage anchors are stored as rectangles on the page.
  function pdfSelRects(it, range) {
    const out = new Map(), rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    els.get(it.id).querySelectorAll('.pdf-pg').forEach((w) => {
      const p = +w.dataset.p, sr = w.querySelector('.marks').getBoundingClientRect(), H = markH(it, p), seen = new Set();
      const list = rects.filter((r) => r.top < sr.bottom && r.bottom > sr.top && r.left < sr.right && r.right > sr.left)
        .map((r) => [(r.left - sr.left) / sr.width * 1000, (r.top - sr.top) / sr.height * H, r.width / sr.width * 1000, r.height / sr.height * H].map((v) => Math.round(v * 10) / 10))
        .filter((r) => { const k = r.join(','); if (seen.has(k)) return false; seen.add(k); return true; });
      if (list.length) out.set(p, list);
    });
    return out;
  }
  const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
  function pdfFormat(b) {
    const it = byId(fmtEd.closest('.it').dataset.id), byPage = pdfSelRects(it, fmtRange); if (!byPage.size) return;
    it.marks ||= {};
    const add = (m) => byPage.forEach((r, p) => (it.marks[p] ||= []).push({ ...m, r }));
    if (b.dataset.hl) add({ t: 'box', c: b.dataset.hl });
    else if (b.dataset.cmd === 'underline') add({ t: 'box', c: '#C0392B', u: 1 });
    else if (b.dataset.cmd === 'clear') byPage.forEach((rects, p) => { it.marks[p] = (it.marks[p] || []).filter((m) => m.t !== 'box' || !m.r.some((r) => rects.some((q) => overlaps(r, q)))); });
    else if (b.dataset.cmd === 'note') {
      const id = uid(); add({ t: 'anc', id });
      const [p0, r0] = [...byPage.entries()][0];
      const sr = pageEl(it, p0).querySelector('.marks').getBoundingClientRect();
      const at = toWorld(sr.left, sr.top + r0[0][1] / markH(it, p0) * sr.height);
      getSelection().removeAllRanges(); hideFmt(); renderMarks(it);
      const [nw, nh] = SIZES.note;
      const note = addItem('note', it.x + it.w + 72 + nw / 2, at.y - 24 + nh / 2, { color: 'yellow', rot: 0 });
      board.links.push({ id: uid(), a: note.id, b: it.id, anc: id });
      drawLinks(); save(); els.get(note.id).querySelector('.nt-body').focus({ preventScroll: true });
      return;
    } else return;
    getSelection().removeAllRanges(); hideFmt(); renderMarks(it); save();
  }
  // Wrap each piece of selected text in <span class="anc" data-anc="…"> (works across paragraphs).
  function wrapRange(range, id) {
    const root = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode;
    const nodes = []; const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) if (range.intersectsNode(n) && n.data.length) nodes.push(n);
    if (root.nodeType === 3) nodes.push(root);
    nodes.forEach((n) => {
      let a = 0, z = n.data.length;
      if (n === range.startContainer) a = range.startOffset;
      if (n === range.endContainer) z = range.endOffset;
      if (a >= z || !n.data.slice(a, z).trim()) return;
      let t = n; if (z < t.data.length) t.splitText(z); if (a > 0) t = t.splitText(a);
      const sp = document.createElement('span'); sp.className = 'anc'; sp.dataset.anc = id;
      t.parentNode.insertBefore(sp, t); sp.appendChild(t);
    });
  }
  function noteOnSelection() {
    const ed = fmtEd, range = fmtRange; if (!ed || !range) return;
    const hostEl = ed.closest('.it'), host = byId(hostEl.dataset.id), id = uid();
    wrapRange(range, id); getSelection().removeAllRanges(); hideFmt();
    ed.dispatchEvent(new Event('input', { bubbles: true }));
    const sp = world.querySelector(`.anc[data-anc="${id}"]`); if (!sp) return;
    const r = sp.getClientRects()[0], at = toWorld(r.right, r.top);
    const [nw, nh] = SIZES.note;
    const note = addItem('note', host.x + host.w + 72 + nw / 2, at.y - 24 + nh / 2, { color: 'yellow', rot: 0 });
    board.links.push({ id: uid(), a: note.id, b: host.id, anc: id });
    drawLinks(); save();
    els.get(note.id).querySelector('.nt-body').focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------ tools */
  function setTool(t) {
    tool = t; tieFrom = null; els.forEach((el) => el.classList.remove('tie-from'));
    document.querySelectorAll('#deskTools [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    vp.classList.toggle('tying', t === 'string');
    vp.classList.toggle('drawing', ['text', 'line', 'rect', 'ellipse'].includes(t));
    vp.classList.toggle('handtool', t === 'hand'); vp.classList.toggle('zoomtool', t === 'zoom');
    $('deskHint').textContent = { hand: 'Drag to move around the board. Double-click the Hand to fit everything.', zoom: 'Click to zoom in, Alt-click to zoom out, or drag left and right.', string: 'Click a piece, then another, to tie them with string. Esc to stop.', text: 'Click where the text should go.', line: 'Drag to draw a line. Hold Shift to keep it straight.', rect: 'Drag to draw a box. Hold Shift for a square.', ellipse: 'Drag to draw an ellipse. Hold Shift for a circle.' }[t] || '';
  }
  document.querySelectorAll('#deskTools [data-tool]').forEach((b) => b.onclick = () => {
    const t = b.dataset.tool, c = viewCenter(), jitter = () => (Math.random() - 0.5) * 120;
    if (t === 'sheet' || t === 'note' || t === 'quote') {
      addItem(t, c.x + jitter(), c.y + jitter()); setTool('select');
      const f = els.get(selected)?.querySelector(t === 'sheet' ? '.sh-title' : '[contenteditable]'); f?.focus({ preventScroll: true }); return;
    }
    if (t === 'image') { $('deskImgInput').click(); return; }
    if (t === 'pdf') { $('deskPdfInput').click(); return; }
    if (t === 'link') { const r = $('linkRow'); r.hidden = !r.hidden; if (!r.hidden) $('linkInput').focus(); return; }
    if (t === 'transcript') { const r = $('trRow'); r.hidden = !r.hidden; if (!r.hidden) $('trUrl').focus(); return; }
    setTool(t);
  });
  $('deskPdfInput').onchange = async () => { const files = [...$('deskPdfInput').files]; $('deskPdfInput').value = ''; const c = viewCenter(); for (const f of files) { const r = await uploadPdf(f); if (r) await placePdf(r, c.x, c.y); c.x += 60; c.y += 60; } };
  const addFromLinkRow = () => { const u = $('linkInput').value.trim(); if (!u) return; $('linkInput').value = ''; $('linkRow').hidden = true; const c = viewCenter(); addLink(u, c.x, c.y); };
  $('linkAdd').onclick = addFromLinkRow;
  $('linkInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addFromLinkRow(); if (e.key === 'Escape') $('linkRow').hidden = true; });
  $('deskImgInput').onchange = async () => { const files = [...$('deskImgInput').files]; $('deskImgInput').value = ''; const c = viewCenter(); for (const f of files) await dropImage(f, c.x, c.y); };
  $('zoomIn').onclick = () => stepZoom(1);
  $('zoomOut').onclick = () => stepZoom(-1);
  $('zoomPct').ondblclick = () => zoomAt(1, ...vpCenter());
  // Photoshop: double-click the Hand to fit everything, the Zoom tool for 100%.
  document.querySelector('#deskTools [data-tool=hand]').ondblclick = fitAll;
  document.querySelector('#deskTools [data-tool=zoom]').ondblclick = () => zoomAt(1, ...vpCenter());
  $('zoomFit').onclick = fitAll;

  /* ------------------------------------------------------------ pointer: pan, move, resize, bend, tie */
  // Pieces move when dragged from anywhere. A click without movement puts the cursor
  // where you clicked; once a piece is being edited, its text behaves like text, and
  // its margins (or Alt-drag) still move it.
  function placeCaret(ed, x, y) {
    ed.focus({ preventScroll: true });
    let r = document.caretRangeFromPoint?.(x, y);
    if (!r && document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); } }
    if (!r || !ed.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); }
    r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  let drag = null, eatMouse = false;
  vp.addEventListener('mousedown', (e) => { if (eatMouse) { e.preventDefault(); eatMouse = false; } }, true);
  vp.addEventListener('pointerdown', (e) => {
    eatMouse = false; $('deskAsk').hidden = true;
    if (e.button === 1) { e.preventDefault(); startPan(e); return; }
    if (e.button !== 0) return;
    const lk = e.target.closest('.lk');
    if (lk) {
      e.preventDefault(); eatMouse = true;
      if (selLink !== lk.dataset.id) selectLink(lk.dataset.id);
      const l = board.links.find((x) => x.id === lk.dataset.id);
      drag = { mode: 'bend', l, sx: e.clientX, sy: e.clientY, moved: false }; vp.setPointerCapture(e.pointerId); return;
    }
    const zoomish = tool === 'zoom' || (spaceDown && (e.ctrlKey || e.metaKey || e.altKey));
    if (zoomish) {
      e.preventDefault(); eatMouse = true; document.activeElement?.blur?.();
      drag = { mode: 'zoomdrag', sx: e.clientX, sy: e.clientY, z0: view().z, out: e.altKey, moved: false }; vp.setPointerCapture(e.pointerId); return;
    }
    if (tool === 'hand' || spaceDown) { e.preventDefault(); startPan(e); return; }
    // Drawing tools work anywhere on the board, over pieces too.
    if (tool === 'text' || tool === 'line' || tool === 'rect' || tool === 'ellipse') {
      e.preventDefault(); eatMouse = true; document.activeElement?.blur?.();
      const p0 = toWorld(e.clientX, e.clientY);
      if (tool === 'text') {
        const it = addItem('text', p0.x, p0.y, {}); setTool('select');
        els.get(it.id).querySelector('.tx-body').focus({ preventScroll: true }); return;
      }
      drag = { mode: 'draw', type: tool, p0, it: null, sx: e.clientX, sy: e.clientY, moved: false }; vp.setPointerCapture(e.pointerId); return;
    }
    const lend = e.target.closest('.lend');
    if (lend && !byId(lend.closest('.it').dataset.id)?.locked) {
      e.preventDefault(); eatMouse = true;
      const it = byId(lend.closest('.it').dataset.id), [a, b] = lineEnds(it);
      drag = { mode: 'lineEnd', it, end: +lend.dataset.end, fixed: +lend.dataset.end ? a : b, moved: true }; vp.setPointerCapture(e.pointerId); return;
    }
    const itEl = e.target.closest('.it');
    if (itEl && ink && itEl.dataset.id === ink.id && e.target.closest('.pdf-pg')) {
      e.preventDefault(); eatMouse = true;
      const it = byId(ink.id), pgn = +e.target.closest('.pdf-pg').dataset.p;
      if (ink.mode === 'erase') { eraseAt(it, e.clientX, e.clientY); drag = { mode: 'erase', it, moved: true }; }
      else drag = { mode: 'ink', it, p: pgn, pts: [markPoint(it, pgn, e.clientX, e.clientY)], path: null, moved: true };
      vp.setPointerCapture(e.pointerId); return;
    }
    if (itEl && byId(itEl.dataset.id)?.locked && tool !== 'string') {
      const it = byId(itEl.dataset.id);
      if (e.target.closest('.unlock')) { // the only way to unlock
        e.preventDefault(); eatMouse = true;
        const members = it.group ? groupIds(it.group).map(byId) : [it];
        members.forEach((m) => { delete m.locked; place(m); if (m.type === 'line') paintLine(m); });
        pick(it); save(); toast(members.length > 1 ? `Unlocked the group (${members.length} pieces)` : 'Unlocked'); return;
      }
      // Text stays selectable (to highlight or tie a note); anything else acts like the board.
      if (e.target.closest('a.ts')) return;
      if (e.target.closest('[contenteditable], .textLayer span') && !e.shiftKey) { if (sel.size) setSel([]); return; }
      document.activeElement?.blur?.(); if (spaceDown) startPan(e); else startMarquee(e); return;
    }
    if (itEl) {
      const it = byId(itEl.dataset.id);
      if (tool === 'string') {
        e.preventDefault(); eatMouse = true;
        if (!tieFrom) { tieFrom = it.id; itEl.classList.add('tie-from'); }
        else if (tieFrom !== it.id) {
          if (!board.links.some((l) => (l.a === tieFrom && l.b === it.id) || (l.b === tieFrom && l.a === it.id))) board.links.push({ id: uid(), a: tieFrom, b: it.id });
          els.get(tieFrom)?.classList.remove('tie-from'); tieFrom = it.id; itEl.classList.add('tie-from');
          drawLinks(); save(); toast('Tied. Click another piece to keep going, or Esc.');
        }
        return;
      }
      if (e.shiftKey && !e.target.classList.contains('rz')) {
        e.preventDefault(); eatMouse = true; document.activeElement?.blur?.();
        const members = it.group ? groupIds(it.group) : [it.id], had = sel.has(it.id);
        setSel(had ? [...sel].filter((i) => !members.includes(i)) : [...sel, ...members]);
        if (had) return; // removed from the selection: nothing to drag
      } else if (e.target.classList.contains('rz')) select(it.id);
      else if (!sel.has(it.id)) pick(it);
      if (e.target.classList.contains('rz') && !it.locked) {
        e.preventDefault(); eatMouse = true;
        if (it.type === 'text') { it.w = itEl.offsetWidth; it.autoW = false; place(it); }
        drag = { mode: 'resize', it, hd: e.target.dataset.h || 'se', sx: e.clientX, sy: e.clientY, x: it.x, y: it.y, w: it.w, h: it.h, ratio: it.w / it.h, moved: true };
        itEl.classList.add('resizing'); vp.setPointerCapture(e.pointerId); return;
      }
      if (!e.shiftKey && e.target.closest('input, button, select, a, textarea, iframe, .tr-who')) return;
      if (it.type === 'pdf' && sel.has(it.id) && !e.shiftKey && !e.altKey && e.target.closest('.textLayer')) return; // select the PDF's text
      if (it.readonly && sel.has(it.id) && !e.shiftKey && !e.altKey && e.target.closest('.sh-body')) return; // select a clipped article's text
      const ed = !e.shiftKey && e.target.closest('[contenteditable]');
      if (ed && document.activeElement === ed && !e.altKey) return; // already writing here: native text behaviour
      e.preventDefault(); eatMouse = true;
      const group = [...sel].map(byId).filter((g) => g && !g.locked).map((g) => ({ it: g, x: g.x, y: g.y, el: els.get(g.id) }));
      drag = { mode: 'move', it, el: itEl, ed, group, sx: e.clientX, sy: e.clientY, moved: false };
      vp.setPointerCapture(e.pointerId); return;
    }
    // Background: drag a box to select everything it touches (Shift adds). Space-drag pans.
    document.activeElement?.blur?.();
    if (spaceDown) { startPan(e); return; }
    startMarquee(e);
  });
  function startMarquee(e) {
    e.preventDefault();
    if (!e.shiftKey) { select(null); if (selLink) { selLink = null; drawLinks(); renderSelBar(); } }
    const box = document.createElement('div'); box.className = 'desk-marquee'; vp.appendChild(box);
    if (e.altKey) box.classList.add('locked-only');
    drag = { mode: 'marquee', box, sx: e.clientX, sy: e.clientY, base: e.shiftKey ? [...sel] : [], lockedOnly: e.altKey, moved: false }; vp.setPointerCapture(e.pointerId);
  }
  let spaceDown = false;
  addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || !board || !$('v-desk').classList.contains('on') || e.target.closest?.('[contenteditable], input, textarea, select, button')) return;
    e.preventDefault(); if (!spaceDown) { spaceDown = true; vp.classList.add('space'); }
    vp.classList.toggle('zoomin', e.ctrlKey || e.metaKey); vp.classList.toggle('zoomout', e.altKey);
  });
  addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceDown = false; vp.classList.remove('space', 'zoomin', 'zoomout'); } });
  addEventListener('keydown', (e) => { if (spaceDown) { vp.classList.toggle('zoomin', e.ctrlKey || e.metaKey); vp.classList.toggle('zoomout', e.altKey); } if (tool === 'zoom') vp.classList.toggle('zoomout', e.altKey); });
  addEventListener('keyup', (e) => { if (spaceDown || tool === 'zoom') { vp.classList.toggle('zoomin', spaceDown && (e.ctrlKey || e.metaKey)); vp.classList.toggle('zoomout', e.altKey); } });
  function startPan(e) { drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, x: view().x, y: view().y, moved: true }; vp.classList.add('panning'); vp.setPointerCapture(e.pointerId); }
  vp.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const z = view().z, dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      if (drag.mode === 'move') { drag.group.forEach((g) => g.el?.classList.add('dragging')); if (world.contains(document.activeElement)) document.activeElement.blur(); }
    }
    if (drag.mode === 'pan') { view().x = drag.x + dx; view().y = drag.y + dy; touchView(); }
    else if (drag.mode === 'zoomdrag') { zoomAt(drag.z0 * Math.exp(dx * 0.008), drag.sx, drag.sy, false); }
    else if (drag.mode === 'move') { drag.group.forEach((g) => { g.it.x = Math.round(g.x + dx / z); g.it.y = Math.round(g.y + dy / z); touchItem(g.it.id); }); }
    else if (drag.mode === 'marquee') {
      const r = vp.getBoundingClientRect(), x1 = Math.min(e.clientX, drag.sx), y1 = Math.min(e.clientY, drag.sy), x2 = Math.max(e.clientX, drag.sx), y2 = Math.max(e.clientY, drag.sy);
      Object.assign(drag.box.style, { left: x1 - r.left + 'px', top: y1 - r.top + 'px', width: x2 - x1 + 'px', height: y2 - y1 + 'px' });
      const a = toWorld(x1, y1), b = toWorld(x2, y2);
      const hit = withGroups(board.items.filter((i) => (drag.lockedOnly ? i.locked : !i.locked) && i.x < b.x && i.x + i.w > a.x && i.y < b.y && i.y + i.h > a.y).map((i) => i.id));
      setSel([...new Set([...drag.base, ...hit])]);
    }
    else if (drag.mode === 'resize') {
      const it = drag.it, hd = drag.hd, ddx = dx / z, ddy = dy / z, snap = (v) => Math.round(v / (IN / 4)) * (IN / 4);
      const E = hd.includes('e'), W = hd.includes('w'), S = hd.includes('s'), N = hd.includes('n');
      if (it.type === 'text') {
        const w = Math.max(24, Math.round(drag.w + (E ? ddx : -ddx)));
        it.w = w; if (W) it.x = Math.round(drag.x + drag.w - w); place(it); measureText(it); return;
      }
      const small = ['rect', 'ellipse', 'link', 'image', 'pdf'].includes(it.type);
      const minW = small ? 24 : IN, minH = small ? 24 : IN * 0.75;
      let w = drag.w + (E ? ddx : W ? -ddx : 0), h = drag.h + (S ? ddy : N ? -ddy : 0);
      // Proportions: always for PDFs and images (Alt frees an image), with Shift for anything else.
      const onePage = it.type === 'pdf' && it.mode === 'page';
      const bar = onePage ? PDF_BAR : 0;
      const ar = onePage ? arOf(it, it.page || 1) : it.type === 'image' && it.ar && !e.altKey ? it.ar : e.shiftKey ? drag.h / drag.w : 0;
      if (ar) { if (E || W) h = w * ar + bar; else w = (h - bar) / ar; }
      w = Math.max(minW, w); h = Math.max(minH, h);
      if (!ar) { w = snap(w); h = snap(h); }
      if (it.type === 'sheet') {
        // Snap to a standard paper size when close to one (either orientation).
        it.paper = 'custom';
        for (const [k, [, pw, ph]] of Object.entries(PAPER)) {
          for (const [pa, pb] of [[pw, ph], [ph, pw]]) if (Math.abs(w - pa * IN) < IN * 0.3 && Math.abs(h - pb * IN) < IN * 0.3) { w = pa * IN; h = pb * IN; it.paper = k; }
        }
      }
      it.w = Math.round(w); it.h = Math.round(h);
      it.x = W ? Math.round(drag.x + drag.w - it.w) : drag.x;
      it.y = N ? Math.round(drag.y + drag.h - it.h) : drag.y;
      const sz = els.get(it.id)?.querySelector('.sz'); if (sz) sz.textContent = sizeLabel(it);
      touchItem(it.id); if (it.type === 'rect' || it.type === 'ellipse') paint(it);
    } else if (drag.mode === 'draw') {
      let p = toWorld(e.clientX, e.clientY); const p0 = drag.p0;
      if (!drag.it) {
        const t = drag.type, looks = { color: style.color, weight: style.weight, dash: style.dash, fill: style.fill, ends: style.ends };
        drag.it = { id: uid(), type: t, x: p0.x, y: p0.y, w: 1, h: 1, z: ++zTop, rot: 0, ...looks };
        board.items.push(drag.it); mount(drag.it);
      }
      const it = drag.it;
      if (it.type === 'line') {
        if (e.shiftKey) { // snap to 45°
          const a = Math.round(Math.atan2(p.y - p0.y, p.x - p0.x) / (Math.PI / 4)) * (Math.PI / 4), r = Math.hypot(p.x - p0.x, p.y - p0.y);
          p = { x: p0.x + r * Math.cos(a), y: p0.y + r * Math.sin(a) };
        }
        setLineEnds(it, p0, p);
      } else {
        let w = p.x - p0.x, h = p.y - p0.y;
        if (e.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
        it.x = Math.round(Math.min(p0.x, p0.x + w)); it.y = Math.round(Math.min(p0.y, p0.y + h)); it.w = Math.max(2, Math.round(Math.abs(w))); it.h = Math.max(2, Math.round(Math.abs(h)));
      }
      place(it); paint(it);
    } else if (drag.mode === 'lineEnd') {
      let p = toWorld(e.clientX, e.clientY); const f = drag.fixed;
      if (e.shiftKey) { const a = Math.round(Math.atan2(p.y - f.y, p.x - f.x) / (Math.PI / 4)) * (Math.PI / 4), r = Math.hypot(p.x - f.x, p.y - f.y); p = { x: f.x + r * Math.cos(a), y: f.y + r * Math.sin(a) }; }
      if (drag.end) setLineEnds(drag.it, f, p); else setLineEnds(drag.it, p, f);
      place(drag.it); paintLine(drag.it); updateLinks(new Set([drag.it.id]));
    } else if (drag.mode === 'ink') {
      const pt = markPoint(drag.it, drag.p, e.clientX, e.clientY), last = drag.pts[drag.pts.length - 1];
      if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 2) return;
      drag.pts.push(pt);
      const svg = pageEl(drag.it, drag.p).querySelector('.marks');
      if (!drag.path) { drag.path = document.createElementNS(NS, 'path'); svg.appendChild(drag.path); }
      Object.entries(markAttrs(ink)).forEach(([k, v]) => drag.path.setAttribute(k, v));
      drag.path.setAttribute('d', ptsToD(drag.pts));
    } else if (drag.mode === 'erase') {
      eraseAt(drag.it, e.clientX, e.clientY);
    } else if (drag.mode === 'bend') {
      const gm = geom(drag.l); if (!gm) return;
      const p = toWorld(e.clientX, e.clientY);
      drag.l.bend = { x: Math.round(p.x - gm.m.x), y: Math.round(p.y - gm.m.y) };
      dirty.items.add(drag.l.id); schedule();
    }
  });
  const endDrag = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    vp.classList.remove('panning');
    d.group?.forEach((g) => g.el?.classList.remove('dragging'));
    d.box?.remove();
    if (d.mode === 'resize') { els.get(d.it.id)?.classList.remove('resizing'); if (d.it.type === 'pdf') renderPdf(d.it); renderSelBar(); }
    if (d.mode === 'draw') {
      let it = d.it;
      if (!it || (it.w < 8 && it.h < 8)) { // a click: drop one at the default size
        if (it) { board.items = board.items.filter((i) => i !== it); els.get(it.id)?.remove(); els.delete(it.id); }
        const [w, h] = SIZES[d.type];
        if (d.type === 'line') { it = addItem('line', d.p0.x, d.p0.y, {}); setLineEnds(it, { x: d.p0.x - w / 2, y: d.p0.y }, { x: d.p0.x + w / 2, y: d.p0.y }); place(it); paint(it); }
        else it = addItem(d.type, d.p0.x, d.p0.y, {});
      }
      setTool('select'); select(it.id); save(); return;
    }
    if (d.mode === 'ink') {
      if (d.pts.length > 1) { d.it.marks ||= {}; (d.it.marks[d.p] ||= []).push({ ...markStyle(ink), d: ptsToD(d.pts) }); }
      renderMarks(d.it, d.p); save(); return;
    }
    if (d.mode === 'erase' || d.mode === 'lineEnd') { save(); return; }
    if (d.mode === 'move' && !d.moved && e?.type === 'pointerup' && !e.shiftKey) {
      const inGroup = d.it.group && selGroup() === d.it.group;
      if (!inGroup) {
        if (sel.size > 1) select(d.it.id); // a plain click inside a multi-selection picks that one piece
        if (d.ed) placeCaret(d.ed, e.clientX, e.clientY);
      }
    }
    if (d.mode === 'zoomdrag') { if (!d.moved) stepZoom(d.out || e?.altKey ? -1 : 1, d.sx, d.sy); else saveView(); return; }
    if (d.mode === 'pan') saveView(); else if (d.moved && d.mode !== 'marquee') save();
  };
  vp.addEventListener('pointerup', endDrag); vp.addEventListener('pointercancel', endDrag);
  vp.addEventListener('dblclick', (e) => {
    // The board captures the pointer while pressed, so find what is really under the cursor.
    const under = document.elementsFromPoint(e.clientX, e.clientY).filter((n) => world.contains(n));
    const gEl = under.map((n) => n.closest('.it')).find(Boolean), gIt = gEl && byId(gEl.dataset.id);
    if (gIt?.group && !gIt.locked) {
      select(gIt.id);
      const ed = under.map((n) => n.closest('[contenteditable="true"]')).find(Boolean); if (ed) placeCaret(ed, e.clientX, e.clientY);
      return;
    }
    if (gEl) return;
    // Double-click a text box's width handle: back to one line (auto width).
    const rz = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.classList?.contains('rz') && n.closest('.it.text'));
    if (rz) { const it = byId(rz.closest('.it').dataset.id); it.autoW = true; place(it); measureText(it); save(); return; }
    const hitPiece = document.elementsFromPoint(e.clientX, e.clientY).some((n) => n.closest?.('.it, .lk') && world.contains(n));
    if (!hitPiece && tool === 'select') { const p = toWorld(e.clientX, e.clientY); const it = addItem('text', p.x, p.y, {}); els.get(it.id).querySelector('.tx-body').focus({ preventScroll: true }); }
  });
  vp.addEventListener('dblclick', (e) => { const k = e.target.closest('.knob'); if (k && selLink) { const l = board.links.find((x) => x.id === selLink); delete l.bend; updateLinks(new Set([l.id])); save(); } });
  vp.addEventListener('wheel', (e) => {
    const sc = e.target.closest('.page, .nt-body, .q-body, .pdf-scroll'), host = e.target.closest('.it');
    if (sc && !e.ctrlKey && !e.metaKey && sc.scrollHeight > sc.clientHeight && host && (host.classList.contains('editing') || host.classList.contains('sel'))) return; // scroll the selected piece's text
    e.preventDefault();
    // The wheel zooms at the cursor; hold Space and drag to pan.
    zoomAt(view().z * Math.exp(-(e.deltaY || e.deltaX) * (e.deltaMode ? 0.05 : 0.0025)), e.clientX, e.clientY);
  }, { passive: false });
  addEventListener('resize', () => { if (board) applyView(); });
  document.addEventListener('keydown', (e) => {
    if (!board || !$('v-desk').classList.contains('on')) return;
    const typing = e.target.closest?.('[contenteditable], input, textarea, select');
    if (e.key === 'Escape' && ink) { setInk(null); return; }
    if (e.key === 'Escape') { const was = world.contains(document.activeElement); setTool('select'); document.activeElement?.blur?.(); if (!was && !typing) select(null); }
    if (typing) return;
    if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); if (e.shiftKey) ungroupSel(); else if (sel.size > 1 && !selGroup()) groupSel(); return; }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'l' || e.key === 'L') && sel.size) { e.preventDefault(); toggleLock([...sel].some((i) => !byId(i)?.locked)); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && (sel.size || selLink)) { e.preventDefault(); removeSelected(); }
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === 'v' || e.key === 'm') setTool('select');
      if (e.key === 'h') setTool('hand');
      if (e.key === 'z') setTool('zoom');
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); stepZoom(1); }
    if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) { e.preventDefault(); stepZoom(-1); }
    if ((e.ctrlKey || e.metaKey) && e.key === '1') { e.preventDefault(); zoomAt(1, ...vpCenter()); }
    if (e.key === 't') setTool('string');
    if (e.key === '0' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); fitAll(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'd' && sel.size) { e.preventDefault(); duplicateSel(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') { e.preventDefault(); setSel(board.items.filter((i) => !i.locked).map((i) => i.id)); }
    const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (nudge && sel.size) { e.preventDefault(); const s = e.shiftKey ? IN : IN / 8; sel.forEach((id) => { const it = byId(id); if (it && !it.locked) { it.x += nudge[0] * s; it.y += nudge[1] * s; touchItem(id); } }); save(); }
  });

  /* ------------------------------------------------------------ drop: from sidebar (pointer drag), files */
  function dropData(d, x, y) {
    if (d.kind === 'note') addItem('note', x, y, { html: escH(d.body).replace(/\n/g, '<br>'), color: d.color || 'yellow' });
    if (d.kind === 'quote') addItem('quote', x, y, { html: escH(d.body).replace(/\n/g, '<br>'), source: d.source ? `— ${d.source}` : '' });
    if (d.kind === 'freewrite') { const m = mdToHtml(d.body); addItem('sheet', x, y, { title: d.title || m.title, html: m.html }); }
    if (d.kind === 'image') addItem('image', x, y, { url: d.url, caption: d.title || '' });
    if (d.kind === 'pdf' && d.meta?.path) placePdf({ path: d.meta.path, title: d.title }, x, y);
    if (d.kind === 'link' && (d.meta?.video || ytId(d.url))) { addItem('video', x, y, { vid: d.meta?.video || ytId(d.url), url: d.url, title: d.title, channel: d.meta?.channel || '' }); return; }
    if (d.kind === 'link') addItem('link', x, y, { url: d.url, title: d.title, site: d.source || d.meta?.site, description: d.body || d.meta?.description, image: d.meta?.image, h: d.meta?.image ? 330 : 176 });
    if (d.kind === 'post') addItem('post', x, y, { postId: d.id, title: d.title, subtitle: d.subtitle, status: d.status === 'published' ? 'Published' : 'Draft' });
  }
  const overVp = (e) => { const r = vp.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; };
  let libDrag = null;
  document.addEventListener('pointermove', (e) => {
    if (!libDrag) return;
    const d = libDrag;
    if (!d.ghost) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
      const r = d.el.getBoundingClientRect();
      d.ghost = d.el.cloneNode(true); d.ghost.classList.add('lib-ghost'); d.ghost.style.width = r.width + 'px';
      d.ox = d.sx - r.left; d.oy = d.sy - r.top; document.body.appendChild(d.ghost); d.el.classList.add('lifted');
    }
    d.ghost.style.transform = `translate3d(${e.clientX - d.ox}px,${e.clientY - d.oy}px,0) rotate(-2deg)`;
    vp.classList.toggle('dropping', overVp(e));
  });
  const endLib = (e) => {
    if (!libDrag) return;
    const d = libDrag; libDrag = null;
    d.el.classList.remove('lifted'); vp.classList.remove('dropping');
    if (!d.ghost) return;
    d.ghost.remove();
    if (e.type === 'pointerup' && overVp(e)) { const p = toWorld(e.clientX, e.clientY); dropData(d.r, p.x, p.y); }
  };
  document.addEventListener('pointerup', endLib); document.addEventListener('pointercancel', endLib);

  vp.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/uri-list')) { e.preventDefault(); vp.classList.add('dropping'); } });
  vp.addEventListener('dragleave', (e) => { if (e.target === vp || !vp.contains(e.relatedTarget)) vp.classList.remove('dropping'); });
  vp.addEventListener('drop', async (e) => {
    e.preventDefault(); vp.classList.remove('dropping');
    const p = toWorld(e.clientX, e.clientY);
    if (!e.dataTransfer.files.length) {
      const u = (e.dataTransfer.getData('text/uri-list') || '').split('\n').find((l) => l && !l.startsWith('#'));
      if (u) addLink(u.trim(), p.x, p.y);
      return;
    }
    for (const f of e.dataTransfer.files) {
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) { const r = await uploadPdf(f); if (r) await placePdf(r, p.x, p.y); }
      else if (f.type.startsWith('image/')) await dropImage(f, p.x, p.y);
      else if (/\.(md|markdown|txt)$/i.test(f.name) || f.type.startsWith('text/')) {
        const text = await f.text(), m = mdToHtml(text);
        addItem('sheet', p.x, p.y, { title: m.title || f.name.replace(/\.\w+$/, ''), html: m.html });
        await sb.from('snippets').insert({ kind: 'freewrite', title: m.title || f.name, body: text }); loadLib();
      }
      p.x += 60; p.y += 60;
    }
  });
  async function dropImage(f, x, y) {
    toast('Uploading image…');
    const url = await upload(f, 'desk'); if (!url) return;
    addItem('image', x, y, { url, caption: '' });
    await sb.from('snippets').insert({ kind: 'image', title: f.name.replace(/\.\w+$/, ''), url }); loadLib();
  }

  /* ------------------------------------------------------------ sheet → post */
  async function sheetToPost(it) {
    const ok = await confirmBox('Make a post from this sheet?', `<p>A new draft called “${escH(it.title || 'Untitled')}” will open in the editor with this sheet's text. The sheet stays on your board.</p>`, 'Create draft');
    if (!ok) return;
    const tmp = document.createElement('div'); tmp.innerHTML = joinedHtml(chainOf(it));
    tmp.querySelectorAll('.anc').forEach((sp) => sp.replaceWith(...sp.childNodes));
    tmp.querySelectorAll('[style]').forEach((n) => { n.style.removeProperty('background-color'); if (!n.getAttribute('style')) n.removeAttribute('style'); });
    tmp.querySelectorAll('span:not([class]):not([style])').forEach((sp) => sp.replaceWith(...sp.childNodes));
    const html = tmp.innerHTML.replace(/<div>/g, '<p>').replace(/<\/div>/g, '</p>').replace(/<p><br><\/p>/g, '');
    const { data, error } = await sb.from('posts').insert({ title: it.title || '', body_html: html, source: 'studio' }).select('id').single();
    if (error) { toast('Could not create the draft: ' + error.message); return; }
    it.postId = data.id; save(); openPost(data.id);
  }

  /* ------------------------------------------------------------ sidebar library */
  let libTab = 'note', lib = [], posts = [];
  document.querySelectorAll('#deskTabs button').forEach((b) => b.onclick = () => { libTab = b.dataset.t; document.querySelectorAll('#deskTabs button').forEach((x) => x.classList.toggle('on', x === b)); renderLib(); });
  async function loadLib() {
    const [{ data: s }, { data: p }] = await Promise.all([
      sb.from('snippets').select('*').order('created_at', { ascending: false }),
      sb.from('posts').select('id,title,subtitle,status,published_at,updated_at').order('updated_at', { ascending: false }),
    ]);
    lib = s || []; posts = p || []; renderLib();
  }
  function renderLib() {
    const box = $('deskLib'), cap = $('deskCapture');
    cap.hidden = libTab !== 'note'; $('linkCap').hidden = libTab !== 'link'; $('deskUpload').hidden = !(libTab === 'freewrite' || libTab === 'files');
    $('deskUploadLabel').textContent = libTab === 'files' ? 'Drop images or PDFs here, or choose files' : 'Drop Freewrite .md files here, or choose files';
    $('deskUploadInput').accept = libTab === 'files' ? 'image/*,application/pdf,.pdf' : '.md,.markdown,.txt,text/markdown,text/plain';
    let rows = [];
    if (libTab === 'note') rows = lib.filter((s) => s.kind === 'note' || s.kind === 'quote');
    if (libTab === 'freewrite') rows = lib.filter((s) => s.kind === 'freewrite');
    if (libTab === 'files') rows = lib.filter((s) => s.kind === 'image' || s.kind === 'pdf');
    if (libTab === 'link') rows = lib.filter((s) => s.kind === 'link');
    if (libTab === 'post') rows = posts.map((p) => ({ ...p, kind: 'post' }));
    box.className = 'desk-lib' + (libTab === 'files' ? ' grid' : '');
    box.innerHTML = rows.length ? rows.map((r) => {
      if (r.kind === 'image') return `<div class="lib-it img" data-id="${r.id}" title="${escH(r.title)}"><img src="${escH(r.url)}" alt="" draggable="false"><button class="x" data-del="${r.id}" title="Remove from library">×</button></div>`;
      if (r.kind === 'pdf') return `<div class="lib-it pdfc" data-id="${r.id}" title="${escH(r.title)}"><span class="k">PDF</span><b>${escH(r.title || 'Untitled')}</b><button class="x" data-del="${r.id}" title="Remove from library">×</button></div>`;
      if (r.kind === 'link') return `<div class="lib-it lnk" data-id="${r.id}"><span class="k">${escH(r.source || 'Link')}</span><b>${escH(r.title || r.url)}</b><button class="x" data-del="${r.id}" title="Remove from library">×</button></div>`;
      if (r.kind === 'post') return `<div class="lib-it post" data-id="${r.id}"><span class="k">${r.status === 'published' ? 'Published' : 'Draft'}</span><b>${escH(r.title || 'Untitled')}</b>${r.subtitle ? `<i>${escH(r.subtitle)}</i>` : ''}</div>`;
      if (r.kind === 'freewrite') return `<div class="lib-it fw" data-id="${r.id}"><span class="k">Freewrite · ${new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span><b>${escH(r.title || 'Untitled')}</b><i>${escH(mdToHtml(r.body).html.replace(/<[^>]+>/g, ' ').slice(0, 110))}…</i><button class="x" data-del="${r.id}" title="Remove from library">×</button></div>`;
      return `<div class="lib-it ${r.kind}" data-id="${r.id}" style="${r.kind === 'note' ? `--nc:${NOTE_COLORS[r.color || 'yellow']}` : ''}">${r.kind === 'quote' ? '<span class="k">Quote</span>' : ''}<p>${escH(r.body).replace(/\n/g, '<br>')}</p>${r.source ? `<span class="src">— ${escH(r.source)}</span>` : ''}<button class="x" data-del="${r.id}" title="Delete">×</button></div>`;
    }).join('') : `<p class="lib-empty">${{ note: 'No notes yet. Write one above.', freewrite: 'No Freewrite drafts yet.', files: 'No images or PDFs yet.', link: 'No links yet. Paste one above.', post: 'No posts yet.' }[libTab]}</p>`;
    box.querySelectorAll('.lib-it').forEach((el) => {
      const r = rows.find((x) => x.id === el.dataset.id);
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('.x')) return;
        e.preventDefault(); libDrag = { r, el, sx: e.clientX, sy: e.clientY, ghost: null };
      });
      el.addEventListener('dblclick', () => { const c = viewCenter(); dropData(r, c.x, c.y); });
    });
    box.querySelectorAll('[data-del]').forEach((b) => b.onclick = async (e) => {
      e.stopPropagation();
      if (!(await confirmBox('Remove from the library?', '<p>Copies already on boards stay where they are.</p>', 'Remove'))) return;
      await sb.from('snippets').delete().eq('id', b.dataset.del); loadLib();
    });
  }
  // Quick capture
  let capKind = 'note';
  document.querySelectorAll('#capKind button').forEach((b) => b.onclick = () => { capKind = b.dataset.k; document.querySelectorAll('#capKind button').forEach((x) => x.classList.toggle('on', x === b)); $('capSource').hidden = capKind !== 'quote'; $('capText').placeholder = capKind === 'quote' ? 'Paste or type a quotation…' : 'Jot a note…'; });
  $('capAdd').onclick = async () => {
    const body = $('capText').value.trim(); if (!body) return;
    const row = { kind: capKind, body, source: capKind === 'quote' ? $('capSource').value.trim() || null : null, color: 'yellow' };
    const { error } = await sb.from('snippets').insert(row);
    if (error) { toast('Could not save: ' + error.message); return; }
    $('capText').value = ''; $('capSource').value = ''; loadLib(); toast(capKind === 'quote' ? 'Quote saved. Drag it onto the board.' : 'Note saved. Drag it onto the board.');
  };
  $('capText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('capAdd').click(); });
  // Uploads to library
  const up = $('deskUpload');
  $('deskUploadInput').onchange = async () => { const files = [...$('deskUploadInput').files]; $('deskUploadInput').value = ''; await uploadToLib(files); };
  up.addEventListener('dragover', (e) => { e.preventDefault(); up.classList.add('over'); });
  up.addEventListener('dragleave', () => up.classList.remove('over'));
  up.addEventListener('drop', async (e) => { e.preventDefault(); up.classList.remove('over'); await uploadToLib([...e.dataTransfer.files]); });
  async function uploadToLib(files) {
    for (const f of files) {
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) { await uploadPdf(f, true); continue; }
      if (f.type.startsWith('image/')) { const url = await upload(f, 'desk'); if (url) await sb.from('snippets').insert({ kind: 'image', title: f.name.replace(/\.\w+$/, ''), url }); }
      else { const text = await f.text(); const m = mdToHtml(text); await sb.from('snippets').insert({ kind: 'freewrite', title: m.title || f.name.replace(/\.\w+$/, ''), body: text }); }
    }
    loadLib(); toast(files.length === 1 ? 'Added to the library' : `${files.length} files added`);
  }

  /* ------------------------------------------------------------ PDFs: render & mark up */
  // PDFs live in the private `desk` bucket and are read through short-lived signed links.
  let pdfjsP = null; const pdfDocs = new Map(), signedCache = new Map(), renderTok = new Map();
  const loadPdfjs = () => pdfjsP ||= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
    .then(([lib, w]) => { lib.GlobalWorkerOptions.workerSrc = w.default; return lib; });
  async function signedUrl(path) {
    const c = signedCache.get(path); if (c && c.exp > Date.now()) return c.url;
    const { data, error } = await sb.storage.from('desk').createSignedUrl(path, 3600);
    if (error) { toast('Could not open the PDF: ' + error.message); return null; }
    signedCache.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 }); return data.signedUrl;
  }
  function pdfDoc(path) {
    if (!pdfDocs.has(path)) pdfDocs.set(path, (async () => { const lib = await loadPdfjs(); const url = await signedUrl(path); return lib.getDocument({ url }).promise; })().catch((e) => { pdfDocs.delete(path); throw e; }));
    return pdfDocs.get(path);
  }
  async function uploadPdf(f, libOnly) {
    toast('Uploading PDF…');
    const path = `pdf/${crypto.randomUUID()}.pdf`;
    const { error } = await sb.storage.from('desk').upload(path, f, { contentType: 'application/pdf' });
    if (error) { toast('Upload failed: ' + error.message); return null; }
    const title = f.name.replace(/\.pdf$/i, '');
    await sb.from('snippets').insert({ kind: 'pdf', title, meta: { path } }); loadLib();
    if (libOnly) toast('PDF added to the library');
    return { path, title };
  }
  // A PDF piece is either a single page (mode 'page') or the whole document stacked in one
  // scrolling piece (mode 'joined'). Every page has its own canvas, selectable text and marks;
  // marks are kept per page number in it.marks.
  const pagesOf = (it) => it.mode === 'page' ? [it.page || 1] : Array.from({ length: it.pages || 1 }, (_, i) => i + 1);
  const arOf = (it, p) => it.ars?.[p] || it.ar || 1.294;
  const markH = (it, p) => Math.round(1000 * arOf(it, p));
  const pageEl = (it, p) => els.get(it.id)?.querySelector(`.pdf-pg[data-p="${p}"]`);
  const pdfObs = new Map();
  async function renderPdf(it) {
    const el = els.get(it.id); if (!el || !it.path) return;
    const tok = (renderTok.get(it.id) || 0) + 1; renderTok.set(it.id, tok);
    try {
      const doc = await pdfDoc(it.path);
      if (renderTok.get(it.id) !== tok) return;
      it.pages = doc.numPages; if (it.mode === 'page') it.page = Math.min(Math.max(1, it.page || 1), it.pages);
      const v1 = (await doc.getPage(pagesOf(it)[0])).getViewport({ scale: 1 });
      it.pw = v1.width; if (!it.ar) it.ar = v1.height / v1.width;
      if (it.mode === 'page' && Math.abs((it.h - PDF_BAR) - it.w * arOf(it, it.page)) > 2) { it.h = Math.round(it.w * arOf(it, it.page)) + PDF_BAR; place(it); updateLinks(new Set([it.id])); }
      el.classList.toggle('joined', it.mode !== 'page');
      const sc = el.querySelector('.pdf-scroll'), keep = sc.scrollTop;
      pdfObs.get(it.id)?.disconnect();
      sc.innerHTML = pagesOf(it).map((p) => `<div class="pdf-pg" data-p="${p}" style="aspect-ratio:1/${arOf(it, p)};--scale-factor:${it.w / it.pw}"><svg class="marks"></svg></div>`).join('');
      sc.scrollTop = keep;
      el.querySelector('.pdf-n').textContent = it.mode === 'page' ? `p. ${it.page} of ${it.pages}` : `${it.pages} page${it.pages > 1 ? 's' : ''}`;
      renderMarks(it);
      const io = new IntersectionObserver((ents) => ents.forEach((en) => {
        if (en.isIntersecting && !en.target.dataset.done) { en.target.dataset.done = '1'; drawPage(it, doc, +en.target.dataset.p, en.target, tok); }
      }), { root: it.mode === 'page' ? null : sc, rootMargin: '800px 0px' });
      sc.querySelectorAll('.pdf-pg').forEach((w) => io.observe(w)); pdfObs.set(it.id, io);
    } catch (e) { el.querySelector('.pdf-n').textContent = 'Could not load'; console.error(e); }
  }
  async function drawPage(it, doc, p, wrap, tok) {
    try {
      const pg = await doc.getPage(p), v1 = pg.getViewport({ scale: 1 }), ar = v1.height / v1.width;
      if (Math.abs(arOf(it, p) - ar) > 0.002) { (it.ars ||= {})[p] = +ar.toFixed(4); wrap.style.aspectRatio = `1/${ar}`; renderMarks(it, p); }
      const scale = Math.min(2600 / v1.width, (it.w * 2) / v1.width), vpp = pg.getViewport({ scale });
      const cv = document.createElement('canvas'); cv.width = Math.floor(vpp.width); cv.height = Math.floor(vpp.height);
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vpp }).promise;
      if (renderTok.get(it.id) !== tok) return;
      wrap.prepend(cv);
      const tl = document.createElement('div'); tl.className = 'textLayer'; wrap.appendChild(tl);
      const lib = await loadPdfjs();
      await new lib.TextLayer({ textContentSource: pg.streamTextContent(), container: tl, viewport: v1 }).render().catch(() => {});
      if (board.links.some((l) => l.anc && l.b === it.id)) updateLinks();
    } catch (e) { console.error(e); }
  }
  // Ask how a multi-page PDF should sit on the board.
  async function placePdf(r, x, y) {
    const it = addItem('pdf', x, y, { path: r.path, title: r.title, mode: 'joined', marks: {} });
    try { const doc = await pdfDoc(r.path); if (doc.numPages > 1) askPdfLayout(it, doc.numPages); } catch {}
    return it;
  }
  function askPdfLayout(it, n) {
    const box = $('deskAsk');
    box.innerHTML = `<p>“${escH(it.title || 'PDF')}” has ${n} pages. Put it on the board as:</p><div><button data-k="joined">One document (scroll)</button><button data-k="pages">Separate pages</button></div>`;
    box.hidden = false;
    box.querySelectorAll('button').forEach((b) => b.onclick = () => { box.hidden = true; const cur = byId(it.id); if (b.dataset.k === 'pages' && cur && cur.mode !== 'page') pdfToPages(cur); });
  }
  function pdfToPages(it) {
    const n = it.pages || 1; if (n < 2) { toast('This PDF has one page.'); return; }
    const marks = it.marks || {}, made = [];
    for (let p = 2; p <= n; p++) {
      const h = Math.round(it.w * arOf(it, p)) + PDF_BAR;
      const pg = { id: uid(), type: 'pdf', path: it.path, title: it.title, mode: 'page', page: p, pages: n, chain: it.id, marks: { [p]: marks[p] || [] }, ars: { [p]: arOf(it, p) }, ar: arOf(it, p), w: it.w, h, x: it.x + (p - 1) * (it.w + 48), y: it.y, z: ++zTop, rot: 0 };
      board.items.push(pg); made.push(pg);
    }
    // Strings tied to a passage follow it to its page.
    board.links.forEach((l) => { if (!l.anc || l.b !== it.id) return; const m = made.find((pg) => (pg.marks[pg.page] || []).some((x) => x.id === l.anc)); if (m) l.b = m.id; });
    Object.assign(it, { mode: 'page', page: 1, chain: it.id, marks: { 1: marks[1] || [] }, ars: { 1: arOf(it, 1) }, ar: arOf(it, 1) });
    it.h = Math.round(it.w * it.ar) + PDF_BAR; place(it);
    made.forEach(mount); renderPdf(it); drawLinks(); setSel([it.id]); renderSelBar(); save(); toast(`Laid out as ${n} pages`);
  }
  function pdfJoin(it) {
    const root = it.chain || it.id;
    const pages = board.items.filter((i) => i.type === 'pdf' && (i.id === root || i.chain === root)).sort((a, b) => (a.page || 1) - (b.page || 1));
    const head = pages[0], marks = {}, ars = {};
    pages.forEach((pg) => { Object.assign(marks, pg.marks || {}); Object.assign(ars, pg.ars || {}); });
    const gone = new Set(pages.slice(1).map((pg) => pg.id));
    board.links.forEach((l) => { if (gone.has(l.a)) l.a = head.id; if (gone.has(l.b)) l.b = head.id; });
    board.links = board.links.filter((l) => l.a !== l.b);
    board.items = board.items.filter((i) => !gone.has(i.id)); gone.forEach((id) => { els.get(id)?.remove(); els.delete(id); });
    Object.assign(head, { mode: 'joined', marks, ars, ar: ars[1] || head.ar }); delete head.chain; delete head.page;
    head.h = Math.round(head.w * arOf(head, 1)) + PDF_BAR; place(head);
    renderPdf(head); drawLinks(); setSel([head.id]); renderSelBar(); save(); toast('Joined into one scrolling document');
  }
  function markPoint(it, p, cx, cy) {
    const r = pageEl(it, p).querySelector('.marks').getBoundingClientRect();
    return [Math.round(((cx - r.left) / r.width) * 10000) / 10, Math.round(((cy - r.top) / r.height) * markH(it, p) * 10) / 10];
  }
  const ptsToD = (pts) => 'M' + pts.map((p) => p.join(' ')).join(' L');
  const markStyle = (k) => k.mode === 'hl' ? { c: PEN[k.color] || PEN.yellow, w: 18, hl: 1 } : { c: PEN[k.color] || PEN.red, w: 2.6 };
  const markAttrs = (k) => { const m = markStyle(k); return { stroke: m.c, 'stroke-width': m.w, fill: 'none', 'stroke-linecap': m.hl ? 'butt' : 'round', 'stroke-linejoin': 'round', 'stroke-opacity': m.hl ? 0.38 : 1 }; };
  function renderMarks(it, p) {
    if (p == null) { pagesOf(it).forEach((q) => renderMarks(it, q)); return; }
    const svg = pageEl(it, p)?.querySelector('.marks'); if (!svg) return;
    svg.setAttribute('viewBox', `0 0 1000 ${markH(it, p)}`); svg.setAttribute('preserveAspectRatio', 'none');
    svg.classList.toggle('erasing', !!ink && ink.id === it.id && ink.mode === 'erase');
    svg.innerHTML = (it.marks?.[p] || []).map((m, i) => {
      if (m.t === 'box') return m.r.map((r) => m.u ? `<rect data-i="${i}" x="${r[0]}" y="${r[1] + r[3] - 2.4}" width="${r[2]}" height="2.4" fill="${m.c}"/>` : `<rect data-i="${i}" x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" fill="${m.c}" fill-opacity="0.4"/>`).join('');
      if (m.t === 'anc') return m.r.map((r) => `<rect data-i="${i}" x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" fill="#C0392B" fill-opacity="0.08"/><rect data-i="${i}" x="${r[0]}" y="${r[1] + r[3] - 1.6}" width="${r[2]}" height="1.6" fill="#C0392B" fill-opacity="0.75"/>`).join('');
      return `<path data-i="${i}" d="${m.d}" stroke="${m.c}" stroke-width="${m.w}" fill="none" stroke-linecap="${m.hl ? 'butt' : 'round'}" stroke-linejoin="round" stroke-opacity="${m.hl ? 0.38 : 1}"/>`;
    }).join('');
  }
  function eraseAt(it, cx, cy) {
    const el = els.get(it.id);
    const hit = document.elementsFromPoint(cx, cy).find((n) => (n.tagName === 'path' || n.tagName === 'rect') && n.closest('.marks') && el.contains(n));
    if (!hit) return; const p = +hit.closest('.pdf-pg').dataset.p;
    it.marks[p].splice(+hit.dataset.i, 1); renderMarks(it, p);
  }
  function setInk(k) {
    ink = k;
    els.forEach((el, id) => { el.classList.toggle('inking', !!k && k.id === id); el.querySelectorAll('.marks').forEach((m) => m.classList.toggle('erasing', !!k && k.id === id && k.mode === 'erase')); });
    $('deskHint').textContent = k ? (k.mode === 'erase' ? 'Click or drag over marks to erase. Esc when done.' : 'Draw on the page. Esc when done.') : '';
    renderSelBar();
  }

  /* ------------------------------------------------------------ YouTube */
  const ytId = (u) => { const m = String(u).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/i); return m ? m[1] : null; };
  async function yt(body) { const { data, error } = await sb.functions.invoke('youtube', { body }); if (error) throw new Error(error.message); return data; }
  async function addVideo(url, vid, x, y) {
    toast('Adding the video…');
    let d = { title: 'YouTube video', channel: '' }; try { d = await yt({ action: 'meta', id: vid }); } catch {}
    addItem('video', x, y, { vid, url, title: d.title, channel: d.channel });
    await sb.from('snippets').insert({ kind: 'link', title: d.title, url: `https://www.youtube.com/watch?v=${vid}`, body: '', source: d.channel ? `YouTube · ${d.channel}` : 'YouTube', meta: { video: vid, channel: d.channel } }); loadLib();
  }
  const fmtTs = (s) => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
  async function fetchTranscript(it) {
    toast('Fetching the transcript…');
    try {
      const d = await yt({ action: 'transcript', id: it.vid });
      if (d?.lines?.length) { makeTranscriptSheet(it, d.lines, d.title || it.title, d.auto); return; }
    } catch {}
    const box = els.get(it.id)?.querySelector('.vd-paste'); if (box) { box.hidden = false; box.querySelector('textarea').focus(); }
    if (it.h < SIZES.video[1] + 150) { it.h = SIZES.video[1] + 170; place(it); }
  }
  // Text copied from YouTube's "Show transcript" panel: timestamps on their own lines, text after each.
  function parsePastedTranscript(text) {
    const ts = /^(\d{1,2}:)?\d{1,2}:\d{2}$/, toSec = (t) => t.split(':').reduce((a, v) => a * 60 + +v, 0);
    const out = []; let cur = null;
    for (const raw of String(text).replace(/\r/g, '').split('\n')) {
      const l = raw.trim(); if (!l) continue;
      if (ts.test(l)) { cur = { s: toSec(l), t: '' }; out.push(cur); continue; }
      const inline = l.match(/^((?:\d{1,2}:)?\d{1,2}:\d{2})\s+(.+)$/);
      if (inline) { cur = { s: toSec(inline[1]), t: inline[2] }; out.push(cur); continue; }
      if (/^\d+ (seconds?|minutes?|hours?)(, \d+ (seconds?|minutes?))*$/i.test(l)) continue; // screen-reader duplicates
      if (!cur) { cur = { s: -1, t: '' }; out.push(cur); }
      cur.t += (cur.t ? ' ' : '') + l;
    }
    return out.filter((x) => x.t);
  }
  // Turn caption lines into readable speaker turns. Captions mark a change of speaker with
  // ">>" (or a leading dash) and sometimes name the speaker ("JOHN SMITH:"). Unnamed speakers
  // alternate as Speaker 1 / Speaker 2; click a name on the sheet to rename it everywhere.
  const titleCase = (x) => x.toLowerCase().replace(/(^|[\s'’-])\p{L}/gu, (c) => c.toUpperCase());
  function transcriptHtml(vid, lines, note) {
    const NAMED = /^((?:\p{Lu}[\p{L}.'’-]*\s?){1,3}|[\p{Lu} .'’-]{2,32}):\s+/u, NOT_NAME = /^(And|But|So|Well|Yes|No|Now|Then|Here|Note|Question|Answer)\b/;
    const turns = []; let cur = null, changes = 0;
    for (const l of lines) {
      let t = String(l.t).replace(/\s+/g, ' ').trim(), who = null, change = false;
      if (/^(>>|&gt;&gt;|[-–—])\s*/.test(t)) { change = true; t = t.replace(/^(>>|&gt;&gt;|[-–—])\s*/, ''); }
      const m = t.match(NAMED);
      if (m && !NOT_NAME.test(m[1]) && m[1].trim().split(' ').length <= 3) { who = titleCase(m[1].trim()); t = t.slice(m[0].length); change = true; }
      if (change) changes++;
      if (!cur || change) { cur = { who, s: l.s, parts: [] }; turns.push(cur); }
      t = t.replace(/>>/g, '').trim(); if (t) cur.parts.push({ s: l.s, t });
    }
    let alt = 0;
    turns.forEach((tn) => { if (!tn.who && changes) tn.who = `Speaker ${(alt++ % 2) + 1}`; });
    // Each caption segment stays its own line, exactly as YouTube lists them.
    const paras = (tn) => tn.parts.map((part) => ({ s: part.s, t: part.t }));
    const cap = (x) => x.replace(/\[(music|applause|laughter|inaudible)[^\]]*\]/gi, (m) => `<i>${m}</i>`);
    const ts = (sec) => sec >= 0 ? `<a class="ts" data-t="${Math.floor(sec)}" href="https://www.youtube.com/watch?v=${escH(vid)}&amp;t=${Math.floor(sec)}s" title="Play from here">${fmtTs(sec)}</a>` : '';
    return `<div class="tr" data-v="${escH(vid)}">${note ? `<p class="src"><i>${escH(note)}</i></p>` : ''}` +
      turns.filter((tn) => tn.parts.length).map((tn) => `<section class="tr-turn">${tn.who ? `<h4 class="tr-who" data-who="${escH(tn.who)}" title="Click to rename this speaker">${escH(tn.who)}</h4>` : ''}` +
        paras(tn).map((p) => `<p>${ts(p.s)}${cap(escH(p.t))}</p>`).join('') + '</section>').join('') + '</div>';
  }
  function makeTranscriptSheet(v, lines, title, auto) {
    const html = transcriptHtml(v.vid, lines, `${v.channel || 'YouTube'}${auto ? ' · automatic captions' : ''}`);
    const [w] = paperSize('letter');
    const sh = { id: uid(), type: 'sheet', paper: 'custom', w, h: Math.round(3.25 * IN), x: v.x + v.w + 96, y: v.y, z: ++zTop, rot: 0, title: `Transcript: ${title || 'YouTube video'}`, html, collapsible: true, collapsed: true, readonly: true, vid: v.vid };
    board.items.push(sh); mount(sh); board.links.push({ id: uid(), a: v.id, b: sh.id });
    drawLinks(); setSel([sh.id]); save(); toast('Transcript added. Click a time to play the video from there.');
  }
  // Older transcript sheets (one paragraph per time stamp) are rebuilt into speaker turns.
  function upgradeTranscript(it) {
    const tmp = document.createElement('div'); tmp.innerHTML = it.html || '';
    if (tmp.querySelector('.tr')) return;
    const lines = []; let vid = it.vid || '';
    tmp.querySelectorAll('p').forEach((p) => {
      if (p.classList.contains('src')) return;
      const a = p.querySelector('a.ts'); let s = -1;
      if (a) { s = +(a.getAttribute('href').match(/[?&]t=(\d+)/) || [])[1] || 0; vid ||= (a.getAttribute('href').match(/v=([\w-]{11})/) || [])[1] || ''; a.remove(); }
      const t = p.textContent.trim(); if (t) lines.push({ s, t });
    });
    if (!lines.length || !vid) return;
    const note = tmp.querySelector('.src')?.textContent.trim() || '';
    it.html = transcriptHtml(vid, lines, note); it.vid = vid;
  }
  // Transcript tool: link + (optional) pasted text → video card and transcript sheet, tied together.
  $('trCancel').onclick = () => { $('trRow').hidden = true; };
  $('trGo').onclick = async () => {
    const vid = ytId($('trUrl').value.trim()); if (!vid) { toast('Paste a YouTube link first.'); $('trUrl').focus(); return; }
    const pasted = $('trText').value.trim();
    let v = board.items.find((i) => i.type === 'video' && i.vid === vid);
    if (!v) {
      let d = { title: 'YouTube video', channel: '' }; try { d = await yt({ action: 'meta', id: vid }); } catch {}
      const c = viewCenter(); v = addItem('video', c.x - 4 * IN, c.y, { vid, url: `https://www.youtube.com/watch?v=${vid}`, title: d.title, channel: d.channel });
    }
    if (pasted) {
      const lines = parsePastedTranscript(pasted);
      if (!lines.length) { toast('That text has no transcript lines in it.'); return; }
      makeTranscriptSheet(v, lines, v.title);
    } else {
      toast('Fetching the transcript…');
      let d = null; try { d = await yt({ action: 'transcript', id: vid }); } catch {}
      if (!d?.lines?.length) { toast('YouTube blocked the automatic fetch. Paste the transcript text into the box and press Create.'); $('trText').focus(); return; }
      makeTranscriptSheet(v, d.lines, d.title || v.title, d.auto);
    }
    $('trRow').hidden = true; $('trUrl').value = ''; $('trText').value = '';
    const sh = byId([...sel][0]); if (sh?.collapsed) els.get(sh.id)?.querySelector('[data-act=more]')?.click(); // open it fully
  };

  // Click a time: play the video on the board from that moment.
  function seekVideo(vid, t) {
    const v = board.items.find((i) => i.type === 'video' && i.vid === vid);
    if (!v) { open(`https://www.youtube.com/watch?v=${vid}&t=${t}s`, '_blank', 'noopener'); return; }
    const el = els.get(v.id), f = el.querySelector('iframe');
    f.src = `https://www.youtube-nocookie.com/embed/${vid}?rel=0&autoplay=1&start=${Math.floor(t)}`;
    const r = el.getBoundingClientRect(), vr = vp.getBoundingClientRect();
    if (r.right < vr.left + 40 || r.left > vr.right - 40 || r.bottom < vr.top + 40 || r.top > vr.bottom - 40) {
      const z = view().z; board.view.x = vp.clientWidth / 2 - (v.x + v.w / 2) * z; board.view.y = vp.clientHeight / 2 - (v.y + v.h / 2) * z; touchView(); saveView();
    }
    el.classList.add('playing'); setTimeout(() => el.classList.remove('playing'), 900);
  }
  world.addEventListener('click', (e) => {
    const a = e.target.closest('a.ts'); if (!a) return;
    e.preventDefault();
    const t = +a.dataset.t || +(a.getAttribute('href').match(/[?&]t=(\d+)/) || [])[1] || 0;
    const vid = a.closest('.tr')?.dataset.v || (a.getAttribute('href').match(/v=([\w-]{11})/) || [])[1];
    if (vid) seekVideo(vid, t);
  });
  // Click a speaker's name to rename them throughout the transcript.
  world.addEventListener('click', (e) => {
    const h = e.target.closest('.tr-who'); if (!h || h.isContentEditable) return;
    const sheet = byId(h.closest('.it').dataset.id), old = h.dataset.who;
    h.contentEditable = 'true'; h.focus(); getSelection().selectAllChildren(h);
    const done = (keep) => {
      h.contentEditable = 'false'; h.onblur = null; h.onkeydown = null;
      const name = h.textContent.trim();
      if (!keep || !name || name === old) { h.textContent = old; return; }
      chainOf(sheet).forEach((pg) => {
        const el = els.get(pg.id); if (!el) return;
        el.querySelectorAll(`.tr-who[data-who="${CSS.escape(old)}"]`).forEach((x) => { x.textContent = name; x.dataset.who = name; });
        pg.html = el.querySelector('.sh-body').innerHTML;
      });
      save(); toast(`Renamed “${old}” to “${name}”`);
    };
    h.onkeydown = (k) => { if (k.key === 'Enter') { k.preventDefault(); done(true); } if (k.key === 'Escape') done(false); };
    h.onblur = () => done(true);
  });

  /* ------------------------------------------------------------ links to articles */
  async function fetchLink(url, clip = false) {
    const { data, error } = await sb.functions.invoke('link-preview', { body: { url, clip } });
    if (error) throw new Error(error.message || 'Could not read the link');
    if (data?.error && !data.title) throw new Error(data.error);
    return data;
  }
  const normUrl = (u) => (/^https?:\/\//i.test(u) ? u : 'https://' + u).trim();
  async function addLink(url, x, y) {
    url = normUrl(url);
    const vid = ytId(url); if (vid) return addVideo(url, vid, x, y);
    toast('Reading the link…');
    let d; try { d = await fetchLink(url); } catch (e) { toast('Could not read that page; added the link alone.'); let host = url; try { host = new URL(url).hostname; } catch {} d = { url, title: url, site: host }; }
    const meta = { site: d.site || '', description: d.description || '', image: d.image || '' };
    addItem('link', x, y, { url: d.url || url, title: d.title, site: meta.site, description: meta.description, image: meta.image, h: meta.image ? 330 : 176 });
    await sb.from('snippets').insert({ kind: 'link', title: d.title || url, url: d.url || url, body: meta.description, source: meta.site, meta }); loadLib();
  }
  async function saveLinkToLib() {
    const u = $('linkCapInput').value.trim(); if (!u) return;
    const vid = ytId(u);
    if (vid) { $('linkCapInput').value = ''; let d = { title: 'YouTube video', channel: '' }; try { d = await yt({ action: 'meta', id: vid }); } catch {} await sb.from('snippets').insert({ kind: 'link', title: d.title, url: `https://www.youtube.com/watch?v=${vid}`, body: '', source: d.channel ? `YouTube · ${d.channel}` : 'YouTube', meta: { video: vid, channel: d.channel } }); loadLib(); toast('Video saved. Drag it onto the board.'); return; }
    $('linkCapInput').value = ''; toast('Reading the link…');
    let d; try { d = await fetchLink(normUrl(u)); } catch { d = { url: normUrl(u), title: normUrl(u) }; }
    const meta = { site: d.site || '', description: d.description || '', image: d.image || '' };
    await sb.from('snippets').insert({ kind: 'link', title: d.title || d.url, url: d.url, body: meta.description, source: meta.site, meta }); loadLib(); toast('Link saved. Drag it onto the board.');
  }
  $('linkCapAdd').onclick = saveLinkToLib;
  $('linkCapInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveLinkToLib(); });
  async function clipLink(it) {
    toast('Clipping the article…');
    let d; try { d = await fetchLink(it.url, true); } catch (e) { toast('Could not clip: ' + e.message); return; }
    const blocks = d.blocks || []; if (!blocks.length) { toast('No article text found on that page (it may be behind a paywall).'); return; }
    const head = `<p class="src"><i>${escH(d.site || it.site || '')}${d.author ? ' · ' + escH(d.author) : ''}</i></p>`;
    const html = head + blocks.map((b) => b.t === 'h' ? `<h3>${escH(b.text)}</h3>` : b.t === 'q' ? `<blockquote>${escH(b.text)}</blockquote>` : `<p>${escH(b.text)}</p>`).join('');
    const [w, h] = paperSize('letter');
    const sh = { id: uid(), type: 'sheet', paper: 'letter', w, h, x: it.x + it.w + 96, y: it.y, z: ++zTop, rot: 0, title: d.title || it.title || '', html, readonly: true };
    board.items.push(sh); mount(sh); board.links.push({ id: uid(), a: it.id, b: sh.id });
    setSel([sh.id]); splitSheet(sh);
  }
  // Paste a link (or plain text) straight onto the board.
  document.addEventListener('paste', (e) => {
    if (!board || !$('v-desk').classList.contains('on') || e.target.closest?.('[contenteditable], input, textarea')) return;
    const t = (e.clipboardData?.getData('text/plain') || '').trim(); if (!t) return;
    e.preventDefault(); const c = viewCenter();
    if (/^(https?:\/\/|www\.)\S+$/i.test(t)) addLink(t, c.x, c.y);
    else addItem('text', c.x - 150, c.y, { html: escH(t).replace(/\n/g, '<br>') });
  });

  /* ------------------------------------------------------------ tabs */
  // Open boards show as tabs. Closing a tab only hides it; every board stays under "All boards".
  let tabIds = []; try { tabIds = JSON.parse(localStorage.getItem('na-desk-tabs') || '[]'); } catch {}
  let boardList = [];
  const saveTabs = () => { try { localStorage.setItem('na-desk-tabs', JSON.stringify(tabIds)); } catch {} };
  async function renderTabs(refresh) {
    if (refresh) boardList = await listBoards();
    const known = new Set(boardList.map((b) => b.id));
    tabIds = tabIds.filter((id) => known.has(id));
    if (board && !tabIds.includes(board.id)) tabIds.push(board.id);
    saveTabs();
    const box = $('boardTabs');
    box.innerHTML = tabIds.map((id) => {
      const t = board?.id === id ? board.title : boardList.find((b) => b.id === id)?.title;
      return `<div class="btab${board?.id === id ? ' on' : ''}" data-id="${id}" title="Double-click to rename"><span class="bt-t">${escH(t || 'Untitled board')}</span>${tabIds.length > 1 ? '<button class="bt-x" title="Close tab">×</button>' : ''}</div>`;
    }).join('');
    box.querySelectorAll('.btab').forEach((tab) => {
      const id = tab.dataset.id, label = tab.querySelector('.bt-t');
      tab.onclick = (e) => { if (e.target.closest('.bt-x') || label.isContentEditable) return; if (board?.id !== id) location.hash = `#/desk/${id}`; };
      tab.querySelector('.bt-x')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = tabIds.indexOf(id); tabIds.splice(i, 1); saveTabs();
        if (board?.id === id) location.hash = `#/desk/${tabIds[Math.max(0, i - 1)]}`; else renderTabs();
      });
      label.ondblclick = () => {
        label.contentEditable = 'true'; label.focus(); getSelection().selectAllChildren(label);
        const done = async (keep) => {
          label.contentEditable = 'false'; const v = label.textContent.trim() || 'Untitled board';
          if (!keep) { renderTabs(); return; }
          if (board?.id === id) { board.title = v; save(); } else await sb.from('boards').update({ title: v }).eq('id', id);
          const b = boardList.find((x) => x.id === id); if (b) b.title = v; renderTabs();
        };
        label.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); label.onblur = null; done(true); } if (e.key === 'Escape') { label.onblur = null; done(false); } };
        label.onblur = () => done(true);
      };
    });
  }
  $('boardNew').onclick = async () => { const id = await newBoard(); if (id) { tabIds.push(id); saveTabs(); location.hash = `#/desk/${id}`; } };

  /* ------------------------------------------------------------ boards */
  async function listBoards() {
    const { data } = await sb.from('boards').select('id,title,updated_at').order('updated_at', { ascending: false });
    return data || [];
  }
  $('boardMenuBtn').onclick = async (e) => {
    e.stopPropagation();
    const m = $('boardMenu'); if (!m.hidden) { m.hidden = true; return; }
    const boards = await listBoards();
    m.innerHTML = boards.map((b) => `<button data-b="${b.id}" class="${board?.id === b.id ? 'cur' : ''}">${escH(b.title)}<small>${new Date(b.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</small></button>`).join('') +
      '<hr><button data-new="1">+ New board</button>' + (board && board.items.some((i) => i.locked) ? '<button data-unlockall="1">Unlock every piece on this board</button>' : '') + (board ? '<button data-delb="1" class="danger">Delete this board</button>' : '');
    m.hidden = false;
    m.querySelectorAll('[data-b]').forEach((b) => b.onclick = () => { m.hidden = true; if (!tabIds.includes(b.dataset.b)) { tabIds.push(b.dataset.b); saveTabs(); } location.hash = `#/desk/${b.dataset.b}`; });
    m.querySelector('[data-new]').onclick = async () => { m.hidden = true; const id = await newBoard(); if (id) { tabIds.push(id); saveTabs(); location.hash = `#/desk/${id}`; } };
    m.querySelector('[data-unlockall]')?.addEventListener('click', () => {
      m.hidden = true; let n = 0;
      board.items.forEach((i) => { if (i.locked) { delete i.locked; place(i); if (i.type === 'line') paintLine(i); n++; } });
      save(); toast(`Unlocked ${n} piece${n === 1 ? '' : 's'}`);
    });
    m.querySelector('[data-delb]')?.addEventListener('click', async () => {
      m.hidden = true;
      if (!(await confirmBox('Delete this board?', `<p>“${escH(board.title)}” and everything on it will be deleted. Library notes and images stay.</p>`, 'Delete'))) return;
      const gone = board.id; await sb.from('boards').delete().eq('id', gone); board = null; tabIds = tabIds.filter((x) => x !== gone); saveTabs();
      location.hash = tabIds.length ? `#/desk/${tabIds[tabIds.length - 1]}` : '#/desk';
    });
  };
  document.addEventListener('click', (e) => { if (!e.target.closest('#boardMenu, #boardMenuBtn')) $('boardMenu').hidden = true; });
  async function newBoard() {
    const { data, error } = await sb.from('boards').insert({ title: 'Untitled board' }).select('id').single();
    if (error) { toast('Could not create a board: ' + error.message); return null; }
    return data.id;
  }

  // Content changes save after a short pause; view changes (pan/zoom) save quietly.
  let savedText = '';
  const setSaved = (t) => { if (savedText !== t) { savedText = t; $('deskSaved').textContent = t; } };
  // Back/Forward: snapshots of the pieces and strings, taken as changes settle.
  let hist = [], fut = [], histT = 0, restoring = false;
  const snapshot = () => JSON.stringify({ items: board.items, links: board.links });
  function updHist() { $('undoBtn').disabled = hist.length < 2; $('redoBtn').disabled = !fut.length; }
  function commitHist() { clearTimeout(histT); histT = 0; if (!board || restoring) return; const s = snapshot(); if (hist[hist.length - 1] !== s) { hist.push(s); if (hist.length > 150) hist.shift(); fut = []; } updHist(); }
  function recordSoon() { if (restoring) return; clearTimeout(histT); histT = setTimeout(commitHist, 400); }
  function restoreSnap(snap) {
    restoring = true;
    const d = JSON.parse(snap); board.items = d.items; board.links = d.links;
    els.forEach((el) => el.remove()); els.clear(); hideFmt();
    board.items.forEach(mount); sel = new Set(); selected = null; selLink = null; ink = null;
    drawLinks(); renderSelBar(); zTop = Math.max(1, ...board.items.map((i) => i.z || 1));
    save(); restoring = false; updHist();
  }
  function undo() { if (histT) commitHist(); if (hist.length < 2) return; fut.push(hist.pop()); restoreSnap(hist[hist.length - 1]); }
  function redo() { if (!fut.length) return; const s = fut.pop(); hist.push(s); restoreSnap(s); }
  $('undoBtn').onclick = () => { document.activeElement?.blur?.(); undo(); };
  $('redoBtn').onclick = () => { document.activeElement?.blur?.(); redo(); };
  function save() { if (!board) return; recordSoon(); setSaved('Saving…'); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 800); }
  function saveView() { if (!board) return; if (saveTimer && savedText === 'Saving…') return; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 1500); }
  async function flush() {
    if (!board || !saveTimer) return; saveTimer = null;
    const { id, title, items, links, view } = board;
    const { error } = await sb.from('boards').update({ title, items, links, view }).eq('id', id);
    setSaved(error ? 'Not saved' : 'Saved');
  }

  async function open(id) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = 'x'; await flush(); }
    if (!id) {
      const boards = await listBoards(), ids = new Set(boards.map((b) => b.id));
      id = [...tabIds].reverse().find((t) => ids.has(t)) || boards[0]?.id || await newBoard();
      if (!id) return;
      history.replaceState(null, '', `#/desk/${id}`);
    }
    if (board?.id === id) { applyView(); renderTabs(); return; }
    const { data, error } = await sb.from('boards').select('*').eq('id', id).single();
    if (error || !data) { toast('Board not found'); location.hash = '#/desk'; return; }
    board = data; els.clear(); world.querySelectorAll('.it').forEach((n) => n.remove()); world.classList.remove('gsel');
    board.items ||= []; board.links ||= [];
    zTop = Math.max(1, ...board.items.map((i) => i.z || 1));
    board.items.forEach((i) => { if (i.type === 'sheet' && i.collapsible && /class="ts"/.test(i.html || '')) upgradeTranscript(i); });
    board.items.forEach((i) => { if (i.type === 'sheet' && i.readonly === undefined && /^<p class="src">/.test(i.html || '')) i.readonly = true; });
    board.items.forEach((i) => { if (i.rot) i.rot = 0; }); // every piece sits square
    selected = null; sel = new Set(); selLink = null;
    board.items.forEach(mount); drawLinks(); renderSelBar(); setTool('select');
    if (!data.items.length && (!data.view || (data.view.x === 0 && data.view.y === 0))) board.view = { x: vp.clientWidth / 2 - 408 * 0.6, y: 60, z: 0.6 };
    if (!board.view.bg && bgLast.color) board.view.bg = { ...bgLast };
    paintBg();
    hist = [snapshot()]; fut = []; clearTimeout(histT); histT = 0; updHist();
    applyView(); loadLib(); renderTabs(true);
    setSaved('Saved');
  }
  addEventListener('beforeunload', () => { if (saveTimer) flush(); });
  return { open, flush: async () => { if (saveTimer) { await flush(); } } };
}
