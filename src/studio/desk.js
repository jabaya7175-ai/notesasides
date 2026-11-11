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
const SIZES = { note: [3 * IN, 3 * IN], quote: [5 * IN, 3 * IN], image: [4 * IN, 3 * IN], post: [4 * IN, 2 * IN] };
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

  /* ------------------------------------------------------------ frame scheduling */
  // Everything visual that follows the pointer is batched into one animation frame.
  let raf = 0; const dirty = { view: false, items: new Set() };
  function frame() {
    raf = 0;
    if (dirty.view) { dirty.view = false; paintView(); }
    if (dirty.items.size) {
      const ids = [...dirty.items]; dirty.items.clear();
      ids.forEach((id) => { const it = byId(id); if (it) place(it); });
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
    const major = IN * z; let minor = (IN / 4) * z; if (minor < 7) minor = major;
    if (z !== lastGridZ) {
      lastGridZ = z;
      grid.style.backgroundSize = `${major}px ${major}px, ${major}px ${major}px, ${minor}px ${minor}px, ${minor}px ${minor}px`;
      grid.style.width = vp.clientWidth + 2 * major + 'px'; grid.style.height = vp.clientHeight + 2 * major + 'px';
    }
    const ox = ((x % major) + major) % major - major, oy = ((y % major) + major) % major - major;
    grid.style.transform = `translate3d(${ox}px,${oy}px,0)`;
    $('zoomPct').textContent = Math.round(z * 100) + '%';
    drawRulers();
  }
  const applyView = () => { lastGridZ = 0; paintView(); };
  const toWorld = (cx, cy) => { const r = vp.getBoundingClientRect(), { x, y, z } = view(); return { x: (cx - r.left - x) / z, y: (cy - r.top - y) / z }; };
  function zoomAt(nz, cx, cy, persist = true) {
    const r = vp.getBoundingClientRect(), v = view();
    nz = Math.min(MAX_Z, Math.max(MIN_Z, nz));
    const wx = (cx - r.left - v.x) / v.z, wy = (cy - r.top - v.y) / v.z;
    v.x = cx - r.left - wx * nz; v.y = cy - r.top - wy * nz; v.z = nz;
    touchView(); if (persist) saveView();
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
      case 'sheet': return `<div class="grip"><span class="sz">${escH(sizeLabel(it))}</span><button class="mini" data-act="post" title="Turn this sheet into a post">→ Post</button></div><div class="page"><input class="sh-title" value="${escH(it.title || '')}" placeholder="Untitled sheet" spellcheck="false"><div class="sh-body" contenteditable="true" data-ph="Write…">${it.html || ''}</div></div><div class="rz"></div>`;
      case 'note': return `<div class="nt-body" contenteditable="true" data-ph="Note…">${it.html || ''}</div><div class="rz"></div>`;
      case 'quote': return `<div class="q-mark">“</div><div class="q-body" contenteditable="true" data-ph="Quotation…">${it.html || ''}</div><div class="q-src" contenteditable="true" data-ph="— Source">${escH(it.source || '')}</div><div class="rz"></div>`;
      case 'image': return `<span class="tape t1"></span><span class="tape t2"></span><img src="${escH(it.url)}" alt="" draggable="false"><div class="im-cap" contenteditable="true" data-ph="Caption…">${escH(it.caption || '')}</div><div class="rz"></div>`;
      case 'post': return `<p class="pc-k">${escH(it.status || 'Post')}</p><p class="pc-t">${escH(it.title || 'Untitled')}</p>${it.subtitle ? `<p class="pc-s">${escH(it.subtitle)}</p>` : ''}<button class="mini" data-act="open">Open in editor</button>`;
    }
    return '';
  }
  function mount(it) {
    const el = document.createElement('div');
    el.className = `it ${it.type}`; el.dataset.id = it.id; el.innerHTML = itemHTML(it);
    if (it.type === 'note') el.style.background = NOTE_COLORS[it.color || 'yellow'];
    if ((it.page || 1) > 1) el.classList.add('contpage');
    world.appendChild(el); els.set(it.id, el); place(it);
    el.querySelectorAll('[contenteditable]').forEach((ed) => ed.addEventListener('input', () => {
      if (ed.classList.contains('sh-body') || ed.classList.contains('nt-body') || ed.classList.contains('q-body')) it.html = ed.innerHTML;
      if (ed.classList.contains('q-src')) it.source = ed.textContent;
      if (ed.classList.contains('im-cap')) it.caption = ed.textContent;
      save();
    }));
    el.addEventListener('focusin', () => el.classList.add('editing'));
    el.addEventListener('focusout', () => setTimeout(() => { if (!el.contains(document.activeElement)) el.classList.remove('editing'); }));
    el.querySelector('.sh-title')?.addEventListener('input', (e) => { it.title = e.target.value; save(); });
    el.querySelector('[data-act=post]')?.addEventListener('click', () => sheetToPost(it));
    el.querySelector('[data-act=open]')?.addEventListener('click', () => it.postId && openPost(it.postId));
    if (it.type === 'post') el.addEventListener('dblclick', () => it.postId && openPost(it.postId));
    return el;
  }
  function place(it) {
    const el = els.get(it.id); if (!el) return;
    el.style.left = it.x + 'px'; el.style.top = it.y + 'px'; el.style.width = it.w + 'px'; el.style.height = it.h + 'px'; el.style.zIndex = it.z || 1;
    if (it.rot) el.style.setProperty('--rot', it.rot + 'deg');
  }
  function addItem(type, cx, cy, extra = {}) {
    let w, h;
    if (type === 'sheet') { extra.paper ||= 'letter'; [w, h] = paperSize(extra.paper, extra.land); } else [w, h] = SIZES[type];
    const it = { id: uid(), type, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h, z: ++zTop, rot: type === 'note' ? +(Math.random() * 4 - 2).toFixed(1) : 0, ...extra };
    board.items.push(it); mount(it); select(it.id); save(); return it;
  }
  const viewCenter = () => toWorld(...vpCenter());
  const byId = (id) => board.items.find((i) => i.id === id);

  // `sel` holds every selected piece; `selected` is the primary one (the last clicked),
  // or null when several are selected.
  function setSel(ids) {
    const linkWas = selLink; selLink = null;
    const same = !linkWas && ids.length === sel.size && ids.every((i) => sel.has(i));
    sel = new Set(ids); selected = sel.size === 1 ? ids[0] : null;
    els.forEach((el, k) => el.classList.toggle('sel', sel.has(k)));
    ids.forEach((i) => { const it = byId(i); if (it && (it.z || 0) < zTop && ids.length === 1) { it.z = ++zTop; place(it); } });
    if (!same) { if (linkWas) drawLinks(); renderSelBar(); }
  }
  const select = (id) => setSel(id ? [id] : []);
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
      bar.innerHTML = `<span>${sel.size} pieces</span><button data-a="chain" title="Tie them together in the order you selected them">Tie together</button><button data-a="dup">Duplicate</button><button data-a="del">Delete</button><em>Shift-click to add or remove</em>`;
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
    } else if (selected) {
      const it = byId(selected);
      let extra = '';
      if (it.type === 'note') extra = Object.keys(NOTE_COLORS).map((c) => `<button class="sw" data-c="${c}" style="background:${NOTE_COLORS[c]}" title="${c}"></button>`).join('');
      if (it.type === 'sheet') {
        extra = `<select data-a="paper" title="Paper size">${Object.entries(PAPER).map(([k, [n, w, h]]) => `<option value="${k}"${it.paper === k ? ' selected' : ''}>${n} (${w} × ${h})</option>`).join('')}<option value="custom"${!it.paper || it.paper === 'custom' ? ' selected' : ''}>Custom (${fmtIn(it.w)} × ${fmtIn(it.h)})</option></select>` +
          `<button data-a="orient" title="Portrait / landscape">${it.w > it.h ? 'Landscape' : 'Portrait'}</button><button data-a="zoom">Zoom to sheet</button>` +
          (overflows(it) ? '<button data-a="split" title="Flow the overflow onto new pages">Split into pages</button>' : '') +
          (chainOf(it).length > 1 ? '<button data-a="join" title="Put the pages back into one sheet">Join pages</button>' : '');
      }
      bar.innerHTML = `<span>${{ sheet: 'Sheet', note: 'Note', quote: 'Quote', image: 'Image', post: 'Post card' }[it.type]}</span>${extra}` +
        '<button data-a="tie">Tie string</button><button data-a="dup">Duplicate</button><button data-a="del">Delete</button>';
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
      bar.querySelector('[data-a=split]')?.addEventListener('click', () => splitSheet(it));
      bar.querySelector('[data-a=join]')?.addEventListener('click', () => joinSheets(it));
      bar.querySelector('[data-a=dup]').onclick = duplicateSel;
      bar.querySelector('[data-a=tie]').onclick = () => { setTool('string'); tieFrom = selected; els.get(selected)?.classList.add('tie-from'); };
    } else { bar.hidden = true; return; }
    bar.querySelector('[data-a=del]').onclick = removeSelected;
  }
  function resized(it) {
    place(it); updateLinks(new Set([it.id]));
    const sz = els.get(it.id)?.querySelector('.sz'); if (sz) sz.textContent = sizeLabel(it);
    save();
  }
  function duplicateSel() {
    const map = new Map(), out = [];
    [...sel].map(byId).filter(Boolean).forEach((it) => { const c = JSON.parse(JSON.stringify(it)); c.id = uid(); c.x += 48; c.y += 48; c.z = ++zTop; map.set(it.id, c.id); board.items.push(c); mount(c); out.push(c.id); });
    // Strings between duplicated pieces are duplicated too.
    board.links.filter((l) => map.has(l.a) && map.has(l.b)).forEach((l) => board.links.push({ ...l, id: uid(), a: map.get(l.a), b: map.get(l.b) }));
    drawLinks(); setSel(out); save();
  }
  function removeSelected() {
    if (selLink) { board.links = board.links.filter((l) => l.id !== selLink); selLink = null; drawLinks(); renderSelBar(); save(); return; }
    if (!sel.size) return;
    const gone = new Set(sel);
    board.items = board.items.filter((i) => !gone.has(i.id));
    board.links = board.links.filter((l) => !gone.has(l.a) && !gone.has(l.b));
    gone.forEach((id) => { els.get(id)?.remove(); els.delete(id); });
    sel = new Set(); selected = null; drawLinks(); renderSelBar(); save();
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
    const nx = { id: uid(), type: 'sheet', paper: it.paper, w: it.w, h: it.h, x: it.x + it.w + 48, y: it.y, z: ++zTop, rot: 0, title: it.title || '', html: moved.innerHTML, chain: root, page: it.page + 1 };
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
  function geom(l) {
    const a = byId(l.a), b = byId(l.b); if (!a || !b) return null;
    const p = pinOf(a), q = pinOf(b), m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    const apex = l.bend ? { x: m.x + l.bend.x, y: m.y + l.bend.y } : { x: m.x, y: m.y + Math.min(200, d * 0.14) };
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
      g.append(r.shadow, r.hit, r.str, r.p1, r.p2);
      if (selLink === l.id) { r.knob = mk('circle', 'knob'); r.knob.setAttribute('r', 9); g.append(r.knob); }
      svg.append(g); linkEls.set(l.id, r);
    }
    updateLinks();
  }
  function updateLinks(only) {
    for (const l of board.links) {
      if (only && !only.has(l.a) && !only.has(l.b) && !only.has(l.id)) continue;
      const r = linkEls.get(l.id), gm = geom(l); if (!r || !gm) continue;
      r.str.setAttribute('d', gm.d); r.hit.setAttribute('d', gm.d); r.shadow.setAttribute('d', gm.d);
      r.p1.setAttribute('cx', gm.p.x); r.p1.setAttribute('cy', gm.p.y); r.p2.setAttribute('cx', gm.q.x); r.p2.setAttribute('cy', gm.q.y);
      if (r.knob) { r.knob.setAttribute('cx', gm.apex.x); r.knob.setAttribute('cy', gm.apex.y); }
    }
  }

  /* ------------------------------------------------------------ tools */
  function setTool(t) {
    tool = t; tieFrom = null; els.forEach((el) => el.classList.remove('tie-from'));
    document.querySelectorAll('#deskTools [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    vp.classList.toggle('tying', t === 'string');
    $('deskHint').textContent = t === 'string' ? 'Click a piece, then another, to tie them with string. Esc to stop.' : '';
  }
  document.querySelectorAll('#deskTools [data-tool]').forEach((b) => b.onclick = () => {
    const t = b.dataset.tool, c = viewCenter(), jitter = () => (Math.random() - 0.5) * 120;
    if (t === 'sheet' || t === 'note' || t === 'quote') {
      addItem(t, c.x + jitter(), c.y + jitter()); setTool('select');
      const f = els.get(selected)?.querySelector(t === 'sheet' ? '.sh-title' : '[contenteditable]'); f?.focus({ preventScroll: true }); return;
    }
    if (t === 'image') { $('deskImgInput').click(); return; }
    setTool(t);
  });
  $('deskImgInput').onchange = async () => { const files = [...$('deskImgInput').files]; $('deskImgInput').value = ''; const c = viewCenter(); for (const f of files) await dropImage(f, c.x, c.y); };
  $('zoomIn').onclick = () => zoomAt(view().z * 1.25, ...vpCenter());
  $('zoomOut').onclick = () => zoomAt(view().z / 1.25, ...vpCenter());
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
    eatMouse = false;
    if (e.button === 1) { e.preventDefault(); startPan(e); return; }
    if (e.button !== 0) return;
    const lk = e.target.closest('.lk');
    if (lk) {
      e.preventDefault(); eatMouse = true;
      if (selLink !== lk.dataset.id) selectLink(lk.dataset.id);
      const l = board.links.find((x) => x.id === lk.dataset.id);
      drag = { mode: 'bend', l, sx: e.clientX, sy: e.clientY, moved: false }; vp.setPointerCapture(e.pointerId); return;
    }
    const itEl = e.target.closest('.it');
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
        const had = sel.has(it.id); toggleSel(it.id);
        if (had) return; // removed from the selection: nothing to drag
      } else if (!sel.has(it.id) || e.target.classList.contains('rz')) select(it.id);
      if (e.target.classList.contains('rz')) {
        e.preventDefault(); eatMouse = true;
        drag = { mode: 'resize', it, sx: e.clientX, sy: e.clientY, w: it.w, h: it.h, ratio: it.w / it.h, moved: true };
        itEl.classList.add('resizing'); vp.setPointerCapture(e.pointerId); return;
      }
      if (!e.shiftKey && e.target.closest('input, button, select')) return;
      const ed = !e.shiftKey && e.target.closest('[contenteditable]');
      if (ed && document.activeElement === ed && !e.altKey) return; // already writing here: native text behaviour
      e.preventDefault(); eatMouse = true;
      const group = [...sel].map(byId).filter(Boolean).map((g) => ({ it: g, x: g.x, y: g.y, el: els.get(g.id) }));
      drag = { mode: 'move', it, el: itEl, ed, group, sx: e.clientX, sy: e.clientY, moved: false };
      vp.setPointerCapture(e.pointerId); return;
    }
    // Background: Shift-drag draws a selection box; a plain drag pans.
    document.activeElement?.blur?.();
    if (e.shiftKey) {
      e.preventDefault();
      const box = document.createElement('div'); box.className = 'desk-marquee'; vp.appendChild(box);
      drag = { mode: 'marquee', box, sx: e.clientX, sy: e.clientY, base: [...sel], moved: false }; vp.setPointerCapture(e.pointerId); return;
    }
    select(null); if (selLink) { selLink = null; drawLinks(); renderSelBar(); }
    startPan(e);
  });
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
    else if (drag.mode === 'move') { drag.group.forEach((g) => { g.it.x = Math.round(g.x + dx / z); g.it.y = Math.round(g.y + dy / z); touchItem(g.it.id); }); }
    else if (drag.mode === 'marquee') {
      const r = vp.getBoundingClientRect(), x1 = Math.min(e.clientX, drag.sx), y1 = Math.min(e.clientY, drag.sy), x2 = Math.max(e.clientX, drag.sx), y2 = Math.max(e.clientY, drag.sy);
      Object.assign(drag.box.style, { left: x1 - r.left + 'px', top: y1 - r.top + 'px', width: x2 - x1 + 'px', height: y2 - y1 + 'px' });
      const a = toWorld(x1, y1), b = toWorld(x2, y2);
      const hit = board.items.filter((i) => i.x < b.x && i.x + i.w > a.x && i.y < b.y && i.y + i.h > a.y).map((i) => i.id);
      setSel([...new Set([...drag.base, ...hit])]);
    }
    else if (drag.mode === 'resize') {
      const it = drag.it, snap = (v) => Math.round(v / (IN / 4)) * (IN / 4);
      let w = Math.max(IN, drag.w + dx / z), h = Math.max(IN * 0.75, drag.h + dy / z);
      if (e.shiftKey) h = w / drag.ratio;
      w = snap(w); h = snap(h);
      if (it.type === 'sheet') {
        // Snap to a standard paper size when close to one (either orientation).
        it.paper = 'custom';
        for (const [k, [, pw, ph]] of Object.entries(PAPER)) {
          for (const [a, b] of [[pw, ph], [ph, pw]]) if (Math.abs(w - a * IN) < IN * 0.3 && Math.abs(h - b * IN) < IN * 0.3) { w = a * IN; h = b * IN; it.paper = k; }
        }
        const sz = drag.it && els.get(it.id)?.querySelector('.sz'); it.w = w; it.h = h; if (sz) sz.textContent = sizeLabel(it);
      }
      it.w = w; it.h = h; touchItem(it.id);
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
    if (d.mode === 'resize') { els.get(d.it.id)?.classList.remove('resizing'); renderSelBar(); }
    if (d.mode === 'move' && !d.moved && e?.type === 'pointerup' && !e.shiftKey) {
      if (sel.size > 1) select(d.it.id); // a plain click inside a group picks that one piece
      if (d.ed) placeCaret(d.ed, e.clientX, e.clientY);
    }
    if (d.mode === 'pan') saveView(); else if (d.moved && d.mode !== 'marquee') save();
  };
  vp.addEventListener('pointerup', endDrag); vp.addEventListener('pointercancel', endDrag);
  vp.addEventListener('dblclick', (e) => { const k = e.target.closest('.knob'); if (k && selLink) { const l = board.links.find((x) => x.id === selLink); delete l.bend; updateLinks(new Set([l.id])); save(); } });
  vp.addEventListener('wheel', (e) => {
    const sc = e.target.closest('.page, .nt-body, .q-body'), host = e.target.closest('.it');
    if (sc && !e.ctrlKey && !e.metaKey && sc.scrollHeight > sc.clientHeight && host && (host.classList.contains('editing') || host.classList.contains('sel'))) return; // scroll the selected piece's text
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(view().z * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025)), e.clientX, e.clientY);
    else { view().x -= e.deltaX; view().y -= e.deltaY; touchView(); saveView(); }
  }, { passive: false });
  addEventListener('resize', () => { if (board) applyView(); });
  document.addEventListener('keydown', (e) => {
    if (!board || !$('v-desk').classList.contains('on')) return;
    const typing = e.target.closest?.('[contenteditable], input, textarea, select');
    if (e.key === 'Escape') { const was = world.contains(document.activeElement); setTool('select'); document.activeElement?.blur?.(); if (!was && !typing) select(null); }
    if (typing) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && (sel.size || selLink)) { e.preventDefault(); removeSelected(); }
    if (e.key === 'v') setTool('select');
    if (e.key === 't') setTool('string');
    if (e.key === '0' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); fitAll(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'd' && sel.size) { e.preventDefault(); duplicateSel(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') { e.preventDefault(); setSel(board.items.map((i) => i.id)); }
    const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (nudge && sel.size) { e.preventDefault(); const s = e.shiftKey ? IN : IN / 8; sel.forEach((id) => { const it = byId(id); if (it) { it.x += nudge[0] * s; it.y += nudge[1] * s; touchItem(id); } }); save(); }
  });

  /* ------------------------------------------------------------ drop: from sidebar (pointer drag), files */
  function dropData(d, x, y) {
    if (d.kind === 'note') addItem('note', x, y, { html: escH(d.body).replace(/\n/g, '<br>'), color: d.color || 'yellow' });
    if (d.kind === 'quote') addItem('quote', x, y, { html: escH(d.body).replace(/\n/g, '<br>'), source: d.source ? `— ${d.source}` : '' });
    if (d.kind === 'freewrite') { const m = mdToHtml(d.body); addItem('sheet', x, y, { title: d.title || m.title, html: m.html }); }
    if (d.kind === 'image') addItem('image', x, y, { url: d.url, caption: d.title || '' });
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

  vp.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); vp.classList.add('dropping'); } });
  vp.addEventListener('dragleave', (e) => { if (e.target === vp || !vp.contains(e.relatedTarget)) vp.classList.remove('dropping'); });
  vp.addEventListener('drop', async (e) => {
    e.preventDefault(); vp.classList.remove('dropping');
    const p = toWorld(e.clientX, e.clientY);
    for (const f of e.dataTransfer.files) {
      if (f.type.startsWith('image/')) await dropImage(f, p.x, p.y);
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
    const html = joinedHtml(chainOf(it)).replace(/<div>/g, '<p>').replace(/<\/div>/g, '</p>').replace(/<p><br><\/p>/g, '');
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
    cap.hidden = libTab !== 'note'; $('deskUpload').hidden = !(libTab === 'freewrite' || libTab === 'image');
    $('deskUploadLabel').textContent = libTab === 'image' ? 'Drop images here, or choose files' : 'Drop Freewrite .md files here, or choose files';
    $('deskUploadInput').accept = libTab === 'image' ? 'image/*' : '.md,.markdown,.txt,text/markdown,text/plain';
    let rows = [];
    if (libTab === 'note') rows = lib.filter((s) => s.kind === 'note' || s.kind === 'quote');
    if (libTab === 'freewrite') rows = lib.filter((s) => s.kind === 'freewrite');
    if (libTab === 'image') rows = lib.filter((s) => s.kind === 'image');
    if (libTab === 'post') rows = posts.map((p) => ({ ...p, kind: 'post' }));
    box.className = 'desk-lib' + (libTab === 'image' ? ' grid' : '');
    box.innerHTML = rows.length ? rows.map((r) => {
      if (r.kind === 'image') return `<div class="lib-it img" data-id="${r.id}" title="${escH(r.title)}"><img src="${escH(r.url)}" alt="" draggable="false"><button class="x" data-del="${r.id}" title="Remove from library">×</button></div>`;
      if (r.kind === 'post') return `<div class="lib-it post" data-id="${r.id}"><span class="k">${r.status === 'published' ? 'Published' : 'Draft'}</span><b>${escH(r.title || 'Untitled')}</b>${r.subtitle ? `<i>${escH(r.subtitle)}</i>` : ''}</div>`;
      if (r.kind === 'freewrite') return `<div class="lib-it fw" data-id="${r.id}"><span class="k">Freewrite · ${new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span><b>${escH(r.title || 'Untitled')}</b><i>${escH(mdToHtml(r.body).html.replace(/<[^>]+>/g, ' ').slice(0, 110))}…</i><button class="x" data-del="${r.id}" title="Remove from library">×</button></div>`;
      return `<div class="lib-it ${r.kind}" data-id="${r.id}" style="${r.kind === 'note' ? `--nc:${NOTE_COLORS[r.color || 'yellow']}` : ''}">${r.kind === 'quote' ? '<span class="k">Quote</span>' : ''}<p>${escH(r.body).replace(/\n/g, '<br>')}</p>${r.source ? `<span class="src">— ${escH(r.source)}</span>` : ''}<button class="x" data-del="${r.id}" title="Delete">×</button></div>`;
    }).join('') : `<p class="lib-empty">${{ note: 'No notes yet. Write one above.', freewrite: 'No Freewrite drafts yet.', image: 'No images yet.', post: 'No posts yet.' }[libTab]}</p>`;
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
      if (f.type.startsWith('image/')) { const url = await upload(f, 'desk'); if (url) await sb.from('snippets').insert({ kind: 'image', title: f.name.replace(/\.\w+$/, ''), url }); }
      else { const text = await f.text(); const m = mdToHtml(text); await sb.from('snippets').insert({ kind: 'freewrite', title: m.title || f.name.replace(/\.\w+$/, ''), body: text }); }
    }
    loadLib(); toast(files.length === 1 ? 'Added to the library' : `${files.length} files added`);
  }

  /* ------------------------------------------------------------ boards */
  async function listBoards() {
    const { data } = await sb.from('boards').select('id,title,updated_at').order('updated_at', { ascending: false });
    return data || [];
  }
  $('boardTitle').addEventListener('input', (e) => { if (board) { board.title = e.target.value; save(); } });
  $('boardMenuBtn').onclick = async (e) => {
    e.stopPropagation();
    const m = $('boardMenu'); if (!m.hidden) { m.hidden = true; return; }
    const boards = await listBoards();
    m.innerHTML = boards.map((b) => `<button data-b="${b.id}" class="${board?.id === b.id ? 'cur' : ''}">${escH(b.title)}<small>${new Date(b.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</small></button>`).join('') +
      '<hr><button data-new="1">+ New board</button>' + (board ? '<button data-delb="1" class="danger">Delete this board</button>' : '');
    m.hidden = false;
    m.querySelectorAll('[data-b]').forEach((b) => b.onclick = () => { m.hidden = true; location.hash = `#/desk/${b.dataset.b}`; });
    m.querySelector('[data-new]').onclick = async () => { m.hidden = true; const id = await newBoard(); location.hash = `#/desk/${id}`; };
    m.querySelector('[data-delb]')?.addEventListener('click', async () => {
      m.hidden = true;
      if (!(await confirmBox('Delete this board?', `<p>“${escH(board.title)}” and everything on it will be deleted. Library notes and images stay.</p>`, 'Delete'))) return;
      await sb.from('boards').delete().eq('id', board.id); board = null; location.hash = '#/desk';
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
  function save() { if (!board) return; setSaved('Saving…'); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 800); }
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
      const boards = await listBoards();
      id = boards[0]?.id || await newBoard();
      if (!id) return;
      history.replaceState(null, '', `#/desk/${id}`);
    }
    if (board?.id === id) { applyView(); return; }
    const { data, error } = await sb.from('boards').select('*').eq('id', id).single();
    if (error || !data) { toast('Board not found'); location.hash = '#/desk'; return; }
    board = data; els.clear(); world.querySelectorAll('.it').forEach((n) => n.remove());
    board.items ||= []; board.links ||= [];
    zTop = Math.max(1, ...board.items.map((i) => i.z || 1));
    $('boardTitle').value = board.title;
    selected = null; sel = new Set(); selLink = null;
    board.items.forEach(mount); drawLinks(); renderSelBar(); setTool('select');
    if (!data.items.length && (!data.view || (data.view.x === 0 && data.view.y === 0))) board.view = { x: vp.clientWidth / 2 - 408 * 0.6, y: 60, z: 0.6 };
    applyView(); loadLib();
    setSaved('Saved');
  }
  addEventListener('beforeunload', () => { if (saveTimer) flush(); });
  return { open, flush: async () => { if (saveTimer) { await flush(); } } };
}
