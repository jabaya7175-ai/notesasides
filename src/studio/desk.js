// Drafting Board: a large pannable, zoomable surface for sheets, sticky notes,
// quotes, images and post cards, tied together with string. Boards are saved to
// Supabase as JSON; the sidebar library (notes, quotes, Freewrite drafts, images)
// lives in the `snippets` table.

const uid = () => Math.random().toString(36).slice(2, 10);
const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NOTE_COLORS = { yellow: '#F2E27A', pink: '#F2B5B0', blue: '#A9CBE8', green: '#B9DDB0', paper: '#F3ECDD' };
const SIZES = { sheet: [380, 492], note: [210, 190], quote: [320, 180], image: [320, 240], post: [300, 150] };

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
  const vp = $('deskVp'), world = $('deskWorld'), svg = $('deskLinks');
  const rulerX = $('rulerX'), rulerY = $('rulerY');
  let board = null, els = new Map(), selected = null, selLink = null, tool = 'select', tieFrom = null, zTop = 1;
  let saveTimer = null;

  /* ------------------------------------------------------------ view */
  const view = () => board.view;
  function applyView() {
    const { x, y, z } = view();
    world.style.transform = `translate(${x}px,${y}px) scale(${z})`;
    const minor = 24 * z, major = 120 * z;
    vp.style.backgroundSize = `${major}px ${major}px, ${major}px ${major}px, ${minor}px ${minor}px, ${minor}px ${minor}px`;
    vp.style.backgroundPosition = `${x}px ${y}px, ${x}px ${y}px, ${x}px ${y}px, ${x}px ${y}px`;
    $('zoomPct').textContent = Math.round(z * 100) + '%';
    drawRulers();
  }
  const toWorld = (cx, cy) => { const r = vp.getBoundingClientRect(), { x, y, z } = view(); return { x: (cx - r.left - x) / z, y: (cy - r.top - y) / z }; };
  function zoomAt(nz, cx, cy) {
    const r = vp.getBoundingClientRect(), v = view();
    nz = Math.min(2.5, Math.max(0.15, nz));
    const wx = (cx - r.left - v.x) / v.z, wy = (cy - r.top - v.y) / v.z;
    v.x = cx - r.left - wx * nz; v.y = cy - r.top - wy * nz; v.z = nz;
    applyView(); save();
  }
  function fitAll() {
    if (!board.items.length) { board.view = { x: vp.clientWidth / 2 - 200, y: 80, z: 1 }; applyView(); return; }
    const xs = board.items.flatMap((i) => [i.x, i.x + i.w]), ys = board.items.flatMap((i) => [i.y, i.y + i.h]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const z = Math.min(1.2, Math.max(0.15, Math.min((vp.clientWidth - 120) / (maxX - minX), (vp.clientHeight - 120) / (maxY - minY))));
    board.view = { z, x: (vp.clientWidth - (maxX - minX) * z) / 2 - minX * z, y: (vp.clientHeight - (maxY - minY) * z) / 2 - minY * z };
    applyView(); save();
  }
  function drawRulers() {
    const dpr = devicePixelRatio || 1, { x, y, z } = view();
    [[rulerX, true], [rulerY, false]].forEach(([cv, horiz]) => {
      const W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
      const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
      g.strokeStyle = 'rgba(233,226,210,.45)'; g.fillStyle = 'rgba(233,226,210,.6)'; g.font = '10px "EB Garamond", serif'; g.lineWidth = 1;
      const step = z < 0.4 ? 120 : z < 0.8 ? 48 : 24; // world units between ticks (24 = 1 in)
      const len = horiz ? W : H, off = horiz ? x : y;
      const start = Math.floor(-off / z / step) * step;
      for (let w = start; w * z + off < len; w += step) {
        const p = Math.round(w * z + off) + 0.5, major = w % (step * 5) === 0;
        g.beginPath();
        if (horiz) { g.moveTo(p, H); g.lineTo(p, H - (major ? 10 : 5)); } else { g.moveTo(W, p); g.lineTo(W - (major ? 10 : 5), p); }
        g.stroke();
        if (major) {
          const label = String(Math.round(w / 24));
          if (horiz) g.fillText(label, p + 3, 10); else { g.save(); g.translate(10, p + 3); g.rotate(-Math.PI / 2); g.fillText(label, 0, 0); g.restore(); }
        }
      }
    });
  }

  /* ------------------------------------------------------------ items */
  function itemHTML(it) {
    const grip = (extra = '') => `<div class="grip" title="Drag to move">${extra}</div>`;
    switch (it.type) {
      case 'sheet': return `${grip(`<input class="sh-title" value="${escH(it.title || '')}" placeholder="Untitled sheet" spellcheck="false"><button class="mini" data-act="post" title="Turn this sheet into a post">→ Post</button>`)}<div class="sh-body" contenteditable="true" data-ph="Write…">${it.html || ''}</div><div class="rz"></div>`;
      case 'note': return `${grip()}<div class="nt-body" contenteditable="true" data-ph="Note…">${it.html || ''}</div><div class="rz"></div>`;
      case 'quote': return `${grip()}<div class="q-mark">“</div><div class="q-body" contenteditable="true" data-ph="Quotation…">${it.html || ''}</div><div class="q-src" contenteditable="true" data-ph="— Source">${escH(it.source || '')}</div><div class="rz"></div>`;
      case 'image': return `<span class="tape t1"></span><span class="tape t2"></span><img src="${escH(it.url)}" alt="" draggable="false"><div class="im-cap" contenteditable="true" data-ph="Caption…">${escH(it.caption || '')}</div><div class="rz"></div>`;
      case 'post': return `${grip()}<p class="pc-k">${escH(it.status || 'Post')}</p><p class="pc-t">${escH(it.title || 'Untitled')}</p>${it.subtitle ? `<p class="pc-s">${escH(it.subtitle)}</p>` : ''}<button class="mini" data-act="open">Open in editor</button>`;
    }
    return '';
  }
  function mount(it) {
    const el = document.createElement('div');
    el.className = `it ${it.type}`; el.dataset.id = it.id; el.innerHTML = itemHTML(it);
    if (it.type === 'note') el.style.background = NOTE_COLORS[it.color || 'yellow'];
    world.appendChild(el); els.set(it.id, el); place(it);
    // Edits
    el.querySelectorAll('[contenteditable]').forEach((ed) => ed.addEventListener('input', () => {
      if (ed.classList.contains('sh-body') || ed.classList.contains('nt-body') || ed.classList.contains('q-body')) it.html = ed.innerHTML;
      if (ed.classList.contains('q-src')) it.source = ed.textContent;
      if (ed.classList.contains('im-cap')) it.caption = ed.textContent;
      save(); drawLinks();
    }));
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
  function addItem(type, x, y, extra = {}) {
    const [w, h] = SIZES[type];
    const it = { id: uid(), type, x: Math.round(x - w / 2), y: Math.round(y - 20), w, h, z: ++zTop, rot: type === 'note' ? (Math.random() * 4 - 2).toFixed(1) : 0, ...extra };
    board.items.push(it); mount(it); select(it.id); save(); return it;
  }
  const viewCenter = () => toWorld(vp.getBoundingClientRect().left + vp.clientWidth / 2, vp.getBoundingClientRect().top + vp.clientHeight / 2);
  const byId = (id) => board.items.find((i) => i.id === id);

  function select(id) {
    selected = id; selLink = null;
    els.forEach((el, k) => el.classList.toggle('sel', k === id));
    svg.querySelectorAll('.lk').forEach((p) => p.classList.remove('sel'));
    const it = id && byId(id);
    if (it && (it.z || 0) < zTop) { it.z = ++zTop; place(it); }
    renderSelBar();
  }
  function renderSelBar() {
    const bar = $('deskSel');
    if (selLink) { bar.innerHTML = '<span>String</span><button data-a="del">Cut string</button>'; bar.hidden = false; }
    else if (selected) {
      const it = byId(selected);
      bar.innerHTML = `<span>${{ sheet: 'Sheet', note: 'Note', quote: 'Quote', image: 'Image', post: 'Post card' }[it.type]}</span>` +
        (it.type === 'note' ? Object.keys(NOTE_COLORS).map((c) => `<button class="sw" data-c="${c}" style="background:${NOTE_COLORS[c]}" title="${c}"></button>`).join('') : '') +
        '<button data-a="tie">Tie string</button><button data-a="dup">Duplicate</button><button data-a="del">Delete</button>';
      bar.hidden = false;
    } else bar.hidden = true;
    bar.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { const it = byId(selected); it.color = b.dataset.c; els.get(it.id).style.background = NOTE_COLORS[it.color]; save(); });
    bar.querySelector('[data-a=del]')?.addEventListener('click', removeSelected);
    bar.querySelector('[data-a=dup]')?.addEventListener('click', () => { const it = byId(selected); const c = JSON.parse(JSON.stringify(it)); c.id = uid(); c.x += 30; c.y += 30; c.z = ++zTop; board.items.push(c); mount(c); select(c.id); save(); });
    bar.querySelector('[data-a=tie]')?.addEventListener('click', () => { setTool('string'); tieFrom = selected; els.get(selected)?.classList.add('tie-from'); });
  }
  function removeSelected() {
    if (selLink) { board.links = board.links.filter((l) => l.id !== selLink); selLink = null; drawLinks(); renderSelBar(); save(); return; }
    if (!selected) return;
    board.items = board.items.filter((i) => i.id !== selected);
    board.links = board.links.filter((l) => l.a !== selected && l.b !== selected);
    els.get(selected)?.remove(); els.delete(selected); selected = null; drawLinks(); renderSelBar(); save();
  }

  /* ------------------------------------------------------------ strings */
  function drawLinks() {
    const pin = (it) => ({ x: it.x + it.w / 2, y: it.y + 10 });
    svg.innerHTML = board.links.map((l) => {
      const a = byId(l.a), b = byId(l.b); if (!a || !b) return '';
      const p = pin(a), q = pin(b), d = Math.hypot(q.x - p.x, q.y - p.y), sag = Math.min(160, d * 0.22);
      const c = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 + sag };
      const path = `M${p.x},${p.y} Q${c.x},${c.y} ${q.x},${q.y}`;
      return `<g class="lk${selLink === l.id ? ' sel' : ''}" data-id="${l.id}"><path class="hit" d="${path}"/><path class="str" d="${path}"/><circle class="pin" cx="${p.x}" cy="${p.y}" r="6"/><circle class="pin" cx="${q.x}" cy="${q.y}" r="6"/></g>`;
    }).join('');
    svg.querySelectorAll('.lk').forEach((g) => g.addEventListener('pointerdown', (e) => { e.stopPropagation(); selected = null; els.forEach((el) => el.classList.remove('sel')); selLink = g.dataset.id; drawLinks(); renderSelBar(); }));
  }

  /* ------------------------------------------------------------ tools */
  function setTool(t) {
    tool = t; tieFrom = null; els.forEach((el) => el.classList.remove('tie-from'));
    document.querySelectorAll('#deskTools [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    vp.classList.toggle('tying', t === 'string');
    $('deskHint').textContent = t === 'string' ? 'Click a piece, then another, to tie them with string. Esc to stop.' : '';
  }
  document.querySelectorAll('#deskTools [data-tool]').forEach((b) => b.onclick = () => {
    const t = b.dataset.tool, c = viewCenter(), jitter = () => (Math.random() - 0.5) * 80;
    if (t === 'sheet' || t === 'note' || t === 'quote') { addItem(t, c.x + jitter(), c.y - 150 + jitter()); setTool('select'); const f = els.get(selected)?.querySelector(t === 'sheet' ? '.sh-title' : '[contenteditable]'); f?.focus(); return; }
    if (t === 'image') { $('deskImgInput').click(); return; }
    setTool(t);
  });
  $('deskImgInput').onchange = async () => { const files = [...$('deskImgInput').files]; $('deskImgInput').value = ''; const c = viewCenter(); for (const f of files) await dropImage(f, c.x, c.y - 120); };
  $('zoomIn').onclick = () => zoomAt(view().z * 1.2, vp.getBoundingClientRect().left + vp.clientWidth / 2, vp.getBoundingClientRect().top + vp.clientHeight / 2);
  $('zoomOut').onclick = () => zoomAt(view().z / 1.2, vp.getBoundingClientRect().left + vp.clientWidth / 2, vp.getBoundingClientRect().top + vp.clientHeight / 2);
  $('zoomFit').onclick = fitAll;

  /* ------------------------------------------------------------ pointer: pan, drag, resize, tie */
  let drag = null, spaceDown = false;
  vp.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return;
    const itEl = e.target.closest('.it');
    const editing = e.target.closest('[contenteditable], input, button');
    if (itEl) {
      const it = byId(itEl.dataset.id);
      if (tool === 'string') {
        e.preventDefault();
        if (!tieFrom) { tieFrom = it.id; itEl.classList.add('tie-from'); }
        else if (tieFrom !== it.id) {
          if (!board.links.some((l) => (l.a === tieFrom && l.b === it.id) || (l.b === tieFrom && l.a === it.id))) board.links.push({ id: uid(), a: tieFrom, b: it.id });
          els.get(tieFrom)?.classList.remove('tie-from'); tieFrom = it.id; itEl.classList.add('tie-from');
          drawLinks(); save(); toast('Tied. Click another piece to keep going, or Esc.');
        }
        return;
      }
      if (selected !== it.id) select(it.id);
      if (e.target.classList.contains('rz')) { e.preventDefault(); drag = { mode: 'resize', it, sx: e.clientX, sy: e.clientY, w: it.w, h: it.h }; vp.setPointerCapture(e.pointerId); return; }
      const grab = e.target.closest('.grip') || it.type === 'image' && !editing || it.type === 'post' && !editing || e.altKey;
      if (grab && !e.target.closest('input, button')) { e.preventDefault(); drag = { mode: 'move', it, sx: e.clientX, sy: e.clientY, x: it.x, y: it.y }; itEl.classList.add('dragging'); vp.setPointerCapture(e.pointerId); }
      return;
    }
    if (e.target.closest('.lk')) return;
    // background
    select(null); document.activeElement?.blur?.();
    drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, x: view().x, y: view().y }; vp.classList.add('panning'); vp.setPointerCapture(e.pointerId);
  });
  vp.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const z = view().z, dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (drag.mode === 'pan') { view().x = drag.x + dx; view().y = drag.y + dy; applyView(); }
    else if (drag.mode === 'move') { drag.it.x = Math.round(drag.x + dx / z); drag.it.y = Math.round(drag.y + dy / z); place(drag.it); drawLinks(); }
    else if (drag.mode === 'resize') { drag.it.w = Math.max(140, Math.round(drag.w + dx / z)); drag.it.h = Math.max(90, Math.round(drag.h + dy / z)); place(drag.it); drawLinks(); }
  });
  const endDrag = () => { if (!drag) return; if (drag.it) els.get(drag.it.id)?.classList.remove('dragging'); vp.classList.remove('panning'); drag = null; save(); };
  vp.addEventListener('pointerup', endDrag); vp.addEventListener('pointercancel', endDrag);
  vp.addEventListener('wheel', (e) => {
    if (e.target.closest('.sh-body, .nt-body, .q-body') && !e.ctrlKey && e.target.closest('.it')?.classList.contains('sel')) return; // scroll inside a selected sheet
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(view().z * Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY);
    else { view().x -= e.deltaX; view().y -= e.deltaY; applyView(); save(); }
  }, { passive: false });
  addEventListener('resize', () => { if (board) applyView(); });
  document.addEventListener('keydown', (e) => {
    if (!board || !$('v-desk').classList.contains('on')) return;
    const typing = e.target.closest?.('[contenteditable], input, textarea');
    if (e.key === 'Escape') { setTool('select'); document.activeElement?.blur?.(); }
    if (typing) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && (selected || selLink)) { e.preventDefault(); removeSelected(); }
    if (e.key === 'v') setTool('select');
    if (e.key === 't') setTool('string');
    if ((e.metaKey || e.ctrlKey) && e.key === 'd' && selected) { e.preventDefault(); $('deskSel').querySelector('[data-a=dup]')?.click(); }
  });

  /* ------------------------------------------------------------ drop: from sidebar, files */
  vp.addEventListener('dragover', (e) => { e.preventDefault(); vp.classList.add('dropping'); });
  vp.addEventListener('dragleave', (e) => { if (e.target === vp) vp.classList.remove('dropping'); });
  vp.addEventListener('drop', async (e) => {
    e.preventDefault(); vp.classList.remove('dropping');
    const p = toWorld(e.clientX, e.clientY);
    const raw = e.dataTransfer.getData('application/x-na');
    if (raw) {
      const d = JSON.parse(raw);
      if (d.kind === 'note') addItem('note', p.x, p.y, { html: escH(d.body).replace(/\n/g, '<br>'), color: d.color || 'yellow' });
      if (d.kind === 'quote') addItem('quote', p.x, p.y, { html: escH(d.body).replace(/\n/g, '<br>'), source: d.source ? `— ${d.source}` : '' });
      if (d.kind === 'freewrite') { const m = mdToHtml(d.body); addItem('sheet', p.x, p.y, { title: d.title || m.title, html: m.html }); }
      if (d.kind === 'image') addItem('image', p.x, p.y, { url: d.url, caption: d.title || '' });
      if (d.kind === 'post') addItem('post', p.x, p.y, { postId: d.id, title: d.title, subtitle: d.subtitle, status: d.status });
      return;
    }
    for (const f of e.dataTransfer.files) {
      if (f.type.startsWith('image/')) await dropImage(f, p.x, p.y);
      else if (/\.(md|markdown|txt)$/i.test(f.name) || f.type.startsWith('text/')) {
        const text = await f.text(), m = mdToHtml(text);
        addItem('sheet', p.x, p.y, { title: m.title || f.name.replace(/\.\w+$/, ''), html: m.html });
        await sb.from('snippets').insert({ kind: 'freewrite', title: m.title || f.name, body: text }); loadLib();
      }
      p.x += 40; p.y += 40;
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
    const html = (it.html || '').replace(/<div>/g, '<p>').replace(/<\/div>/g, '</p>').replace(/<p><br><\/p>/g, '');
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
      if (r.kind === 'image') return `<div class="lib-it img" draggable="true" data-id="${r.id}" title="${escH(r.title)}"><img src="${escH(r.url)}" alt=""><button class="x" data-del="${r.id}" title="Remove from library">×</button></div>`;
      if (r.kind === 'post') return `<div class="lib-it post" draggable="true" data-id="${r.id}"><span class="k">${r.status === 'published' ? 'Published' : 'Draft'}</span><b>${escH(r.title || 'Untitled')}</b>${r.subtitle ? `<i>${escH(r.subtitle)}</i>` : ''}</div>`;
      if (r.kind === 'freewrite') return `<div class="lib-it fw" draggable="true" data-id="${r.id}"><span class="k">Freewrite · ${new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span><b>${escH(r.title || 'Untitled')}</b><i>${escH(mdToHtml(r.body).html.replace(/<[^>]+>/g, ' ').slice(0, 110))}…</i><button class="x" data-del="${r.id}" title="Remove from library">×</button></div>`;
      return `<div class="lib-it ${r.kind}" draggable="true" data-id="${r.id}" style="${r.kind === 'note' ? `--nc:${NOTE_COLORS[r.color || 'yellow']}` : ''}">${r.kind === 'quote' ? '<span class="k">Quote</span>' : ''}<p>${escH(r.body).replace(/\n/g, '<br>')}</p>${r.source ? `<span class="src">— ${escH(r.source)}</span>` : ''}<button class="x" data-del="${r.id}" title="Delete">×</button></div>`;
    }).join('') : `<p class="lib-empty">${{ note: 'No notes yet. Write one above.', freewrite: 'No Freewrite drafts yet.', image: 'No images yet.', post: 'No posts yet.' }[libTab]}</p>`;
    box.querySelectorAll('.lib-it').forEach((el) => el.addEventListener('dragstart', (e) => {
      const r = rows.find((x) => x.id === el.dataset.id);
      e.dataTransfer.setData('application/x-na', JSON.stringify(r)); e.dataTransfer.effectAllowed = 'copy';
    }));
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

  function save() {
    if (!board) return; $('deskSaved').textContent = 'Saving…';
    clearTimeout(saveTimer); saveTimer = setTimeout(flush, 700);
  }
  async function flush() {
    if (!board || !saveTimer) return; saveTimer = null;
    const { id, title, items, links, view } = board;
    const { error } = await sb.from('boards').update({ title, items, links, view }).eq('id', id);
    $('deskSaved').textContent = error ? 'Not saved' : 'Saved';
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
    zTop = Math.max(1, ...board.items.map((i) => i.z || 1));
    $('boardTitle').value = board.title;
    board.items.forEach(mount); drawLinks(); select(null); setTool('select');
    if (!data.items.length && data.view.x === 0 && data.view.y === 0) board.view = { x: vp.clientWidth / 2 - 190, y: 90, z: 1 };
    applyView(); loadLib();
    $('deskSaved').textContent = 'Saved';
  }
  addEventListener('beforeunload', () => { if (saveTimer) flush(); });
  return { open, flush: async () => { if (saveTimer) { await flush(); } } };
}
