// Notes & Asides — Studio. Substack-style editor, typeset like the site, backed by Supabase.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY, AUTHOR } from '../lib/config.js';
import { esc, slugify, formatDate, readingMinutes, renderArticle, DEFAULT_DROP_CAP } from '../lib/render.js';
import { fitDropcap, initReader } from '../scripts/reader.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } });
const $ = (id) => document.getElementById(id);
const BASE = document.body.dataset.base || '/';
const STUDIO_URL = () => location.origin + BASE + 'studio/';
const raf = (fn) => { let q = false; return () => { if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(); }); }; };
const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2600); };
const show = (id) => document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === id));

function confirmBox(title, html, okLabel = 'OK') {
  return new Promise((resolve) => {
    const d = $('confirmdlg'); $('cfTitle').textContent = title; $('cfBody').innerHTML = html; $('cfOk').textContent = okLabel;
    d.returnValue = ''; d.showModal();
    d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
  });
}

/* =================================================================== auth & routing */
let user = null;
export async function start() {
  $('signinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('signinEmail').value.trim(); if (!email) return;
    $('signinMsg').textContent = 'Sending…';
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: STUDIO_URL(), shouldCreateUser: true } });
    $('signinMsg').textContent = error ? `Couldn't send the link: ${error.message}` : 'Check your email for a sign-in link. Open it in this browser.';
  });
  const signOut = async () => { await sb.auth.signOut(); location.hash = ''; route(); };
  $('signout').onclick = signOut; $('signoutDenied').onclick = signOut;
  sb.auth.onAuthStateChange((_evt, session) => { const changed = (session?.user?.id || null) !== (user?.id || null); user = session?.user || null; if (changed) route(); });
  const { data } = await sb.auth.getSession(); user = data.session?.user || null;
  addEventListener('hashchange', route);
  wireEditor(); wireDash();
  route();
}

let admin = null;
async function route() {
  if (!user) { admin = null; show('v-signin'); return; }
  if (admin === null) { const { data } = await sb.rpc('is_admin'); admin = !!data; }
  if (!admin) { $('deniedId').textContent = user.id; show('v-denied'); return; }
  const m = location.hash.match(/^#\/post\/([0-9a-f-]{36})$/);
  if (m) { await openPost(m[1]); show('v-editor'); }
  else { await flushSave(); setPreview(false); show('v-dash'); loadDash(); }
}

/* =================================================================== dashboard */
let tab = 'draft';
function wireDash() {
  $('tabs').querySelectorAll('button').forEach((b) => b.onclick = () => { tab = b.dataset.t; $('tabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); loadDash(); });
  $('newPost').onclick = async () => {
    const { data, error } = await sb.from('posts').insert({ title: '' }).select('id').single();
    if (error) { toast('Could not create a post: ' + error.message); return; }
    location.hash = `#/post/${data.id}`;
  };
}
async function loadDash() {
  const { data, error } = await sb.from('posts').select('id,title,subtitle,status,kind,updated_at,published_at').order('updated_at', { ascending: false });
  const rows = $('rows');
  if (error) { rows.innerHTML = `<li>Couldn't load posts: ${esc(error.message)}</li>`; return; }
  const now = Date.now();
  const state = (p) => p.status !== 'published' ? 'draft' : (new Date(p.published_at).getTime() > now ? 'scheduled' : 'published');
  const list = data.filter((p) => state(p) === tab);
  rows.innerHTML = list.length ? list.map((p) => {
    const st = state(p);
    const when = st === 'draft' ? `Edited ${formatDate(p.updated_at)}` : `${st === 'scheduled' ? 'Goes live' : 'Published'} ${formatDate(p.published_at)}`;
    return `<li data-id="${p.id}"><div><div class="t">${esc(p.title || 'Untitled')}</div>${p.subtitle ? `<div class="s">${esc(p.subtitle)}</div>` : ''}</div>
      <div class="m"><span class="st ${st}">${st}</span><br>${esc(when)}</div><button class="del" data-del="${p.id}" title="Delete post">Delete</button></li>`;
  }).join('') : `<li style="cursor:default;color:var(--muted);font-style:italic">${tab === 'draft' ? 'No drafts. Start one with “New post.”' : tab === 'scheduled' ? 'Nothing scheduled.' : 'Nothing published yet.'}</li>`;
  rows.querySelectorAll('li[data-id]').forEach((li) => li.onclick = (e) => { if (e.target.closest('[data-del]')) return; location.hash = `#/post/${li.dataset.id}`; });
  rows.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    const p = data.find((x) => x.id === b.dataset.del);
    if (!(await confirmBox('Delete this post?', `<p>“${esc(p.title || 'Untitled')}” and its saved versions will be deleted permanently.</p>`, 'Delete'))) return;
    const { error: e2 } = await sb.from('posts').delete().eq('id', p.id);
    if (e2) toast('Could not delete: ' + e2.message); else { toast('Post deleted'); loadDash(); }
  });
}

/* =================================================================== editor state */
const titleEl = () => $('title'), subEl = () => $('subtitle'), bodyEl = () => $('body'), fnList = () => $('fnlist');
let cur = null;           // { post, books }
let S = null;             // typesetting & delivery settings
let fnSeq = Date.now();
let lastVersionAt = 0;

function settingsFrom(p) {
  const dc = { ...DEFAULT_DROP_CAP, ...(p.drop_cap || {}) };
  return { coverUrl: p.cover_url || '', coverCaption: p.cover_caption || '', kind: p.kind, para: p.paragraph_style, align: p.align, dcOn: !!dc.on, dcLines: +dc.lines, dcFrame: dc.frame || '', dcWeight: +dc.weight, dcColor: dc.color, slug: p.slug || '', sendEmail: !!p.send_email };
}
function makeNote(id, html) { const li = document.createElement('li'); li.dataset.id = id; li.contentEditable = 'true'; li.innerHTML = html || ''; return li; }

async function openPost(id) {
  if (cur?.post.id === id) return;
  await flushSave();
  const { data, error } = await sb.from('posts').select('*, post_books(position, books(*))').eq('id', id).single();
  if (error || !data) { toast('Post not found'); location.hash = ''; return; }
  const books = (data.post_books || []).sort((a, b) => a.position - b.position).map((x) => x.books).filter(Boolean);
  delete data.post_books;
  cur = { post: data, books }; S = settingsFrom(data); lastVersionAt = Date.now();
  titleEl().textContent = data.title || ''; subEl().textContent = data.subtitle || '';
  bodyEl().innerHTML = data.body_html || '';
  fnList().innerHTML = ''; (data.notes || []).forEach((n) => fnList().appendChild(makeNote(n.id, n.body)));
  $('schedule').value = data.status === 'published' && new Date(data.published_at) > new Date() ? toLocalInput(data.published_at) : '';
  renumber(); applySettings(); updateByline(); updateStatus(); setPreview(false);
  $('saved').textContent = 'Saved';
  requestAnimationFrame(relayout);
  if (!data.title) titleEl().focus();
}
const toLocalInput = (iso) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

function collect() {
  const notes = [...fnList().querySelectorAll('li')].map((li) => ({ id: li.dataset.id, body: li.innerHTML }));
  return {
    title: titleEl().textContent.trim(), subtitle: subEl().textContent.trim(), body_html: bodyEl().innerHTML, notes,
    kind: S.kind, paragraph_style: S.para, align: S.align, send_email: S.sendEmail,
    drop_cap: { on: S.dcOn, lines: S.dcLines, weight: S.dcWeight, color: S.dcColor, frame: S.dcFrame },
    slug: S.slug ? slugify(S.slug) : cur.post.slug,
    cover_url: S.coverUrl || null, cover_caption: S.coverCaption || null,
  };
}
let saveTimer = null, saving = Promise.resolve();
function save() { if (!cur) return; $('saved').textContent = 'Saving…'; clearTimeout(saveTimer); saveTimer = setTimeout(doSave, 700); }
async function flushSave() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; await doSave(); } await saving; }
function doSave() {
  saveTimer = null; if (!cur) return Promise.resolve();
  const patch = collect(), id = cur.post.id;
  saving = saving.then(async () => {
    const { error } = await sb.from('posts').update(patch).eq('id', id);
    if (error) { $('saved').textContent = 'Not saved, retrying…'; setTimeout(save, 3000); return; }
    Object.assign(cur.post, patch);
    $('saved').textContent = 'Saved';
    if (Date.now() - lastVersionAt > 10 * 60 * 1000) snapshot();
  });
  return saving;
}
async function snapshot() {
  lastVersionAt = Date.now();
  const p = cur.post; await sb.from('post_versions').insert({ post_id: p.id, title: p.title, subtitle: p.subtitle, body_html: p.body_html, notes: p.notes });
}
addEventListener('beforeunload', (e) => { if (saveTimer) { doSave(); e.preventDefault(); } });

function updateByline() {
  const d = cur?.post.status === 'published' ? cur.post.published_at : new Date();
  $('byline').innerHTML = `<span class="by">${esc(AUTHOR)}</span> · ${esc(formatDate(d))} · ${readingMinutes(bodyEl().innerHTML)} min read`;
}
function updateStatus() {
  const p = cur.post, pub = p.status === 'published', future = pub && new Date(p.published_at) > new Date();
  $('statusPill').textContent = pub ? (future ? 'Scheduled' : 'Published') : 'Draft';
  $('publishBtn').textContent = pub ? 'Update' : ($('schedule').value ? 'Schedule' : 'Publish now');
  $('unpublishBtn').style.display = pub ? '' : 'none';
}

/* =================================================================== editor wiring */
let savedRange = null;
const relayout = raf(() => { if (!cur) return; dropcap(); placeRail(); layoutNotes(); });

function wireEditor() {
  const body = bodyEl();
  [titleEl(), subEl(), body, fnList()].forEach((el) => el.addEventListener('input', () => {
    if (el === body) { renumber(); updateByline(); }
    if (el === titleEl()) $('slug').placeholder = slugify(titleEl().textContent) || 'post-url';
    save(); relayout();
  }));
  titleEl().addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); subEl().focus(); } });
  subEl().addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); body.focus(); } });
  fnList().addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); body.focus(); } });
  [titleEl(), subEl(), fnList()].forEach((el) => el.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' ')); }));
  body.addEventListener('paste', (e) => {
    e.preventDefault();
    const t = (e.clipboardData.getData('text/plain') || '').replace(/\r/g, '');
    const paras = t.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
    if (paras.length <= 1) document.execCommand('insertText', false, t);
    else document.execCommand('insertHTML', false, paras.map((p) => '<p>' + esc(p).replace(/\n/g, ' ') + '</p>').join(''));
  });
  document.execCommand('defaultParagraphSeparator', false, 'p');
  document.addEventListener('selectionchange', () => { saveSel(); updateToolbarState(); });

  // Toolbar
  const tb = $('toolbar');
  tb.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  tb.querySelectorAll('.tbtn[data-cmd]').forEach((b) => b.onclick = () => { restoreSel(); document.execCommand(b.dataset.cmd); renumber(); save(); updateToolbarState(); relayout(); });
  $('styleSel').addEventListener('change', (e) => { restoreSel(); document.execCommand('formatBlock', false, e.target.value); save(); relayout(); });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && body.contains(getSelection().anchorNode)) { e.preventDefault(); openLink(); }
    if (e.key === 'Escape') { closeMenus(); document.querySelectorAll('.drawer.open').forEach((d) => d.classList.remove('open')); }
  });
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('.menu,.linkpop,#quoteBtn,#moreBtn,#linkBtn')) closeMenus(); });

  $('quoteBtn').onclick = () => toggleMenu($('quoteMenu'), $('quoteBtn'));
  $('quoteMenu').addEventListener('mousedown', (e) => e.preventDefault());
  $('quoteMenu').querySelectorAll('button').forEach((b) => b.onclick = () => { restoreSel(); closeMenus(); setQuote(b.dataset.q); save(); relayout(); });
  $('moreBtn').onclick = () => toggleMenu($('moreMenu'), $('moreBtn'));
  $('moreMenu').addEventListener('mousedown', (e) => e.preventDefault());
  $('moreMenu').querySelectorAll('button').forEach((b) => b.onclick = () => {
    closeMenus();
    if (b.dataset.m === 'hr') { restoreSel(); document.execCommand('insertHorizontalRule'); save(); relayout(); }
    if (b.dataset.m === 'fw') openDrawer('inbox');
    if (b.dataset.m === 'clear') { restoreSel(); document.execCommand('removeFormat'); document.execCommand('formatBlock', false, 'p'); save(); relayout(); }
  });
  $('linkBtn').onclick = openLink;
  $('linkApply').onclick = () => { const url = $('linkInput').value.trim(); closeMenus(); restoreSel(); if (url) document.execCommand('createLink', false, /^https?:|^mailto:/.test(url) ? url : 'https://' + url); save(); };
  $('linkInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('linkApply').click(); } if (e.key === 'Escape') closeMenus(); });
  $('linkRemove').onclick = () => { closeMenus(); restoreSel(); document.execCommand('unlink'); save(); };

  $('imgBtn').onclick = () => $('imgInput').click();
  $('imgInput').onchange = async () => {
    const f = $('imgInput').files[0]; $('imgInput').value = ''; if (!f) return;
    toast('Uploading image…');
    const url = await upload(f, 'images'); if (!url) return;
    restoreSel();
    document.execCommand('insertHTML', false, `<figure contenteditable="false"><img src="${esc(url)}" alt=""><figcaption contenteditable="true" data-ph="Add a caption…"></figcaption></figure><p><br></p>`);
    save(); relayout();
  };

  // Notes
  $('fnBtn').onclick = addNote;
  body.addEventListener('click', (e) => {
    const sup = e.target.closest('sup.fn'); if (!sup) return;
    const li = fnList().querySelector(`li[data-id="${sup.dataset.id}"]`); if (!li) return;
    li.focus(); const r = document.createRange(); r.selectNodeContents(li); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    li.classList.add('flash'); setTimeout(() => li.classList.remove('flash'), 1000);
    if (narrow()) li.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  fnList().addEventListener('focusin', (e) => { const li = e.target.closest('li'); if (!li) return; body.querySelectorAll('sup.fn.active').forEach((s) => s.classList.remove('active')); body.querySelector(`sup.fn[data-id="${li.dataset.id}"]`)?.classList.add('active'); });
  fnList().addEventListener('focusout', () => body.querySelectorAll('sup.fn.active').forEach((s) => s.classList.remove('active')));

  // Books
  $('bookBtn').onclick = () => { if (S.kind !== 'review') { S.kind = 'review'; applySettings(); save(); } editBook(-1); };
  $('addBook2').onclick = () => editBook(-1);
  $('cancelBook').onclick = () => $('bookdlg').close();
  $('delBook').onclick = removeBook;
  $('bookform').addEventListener('submit', saveBook);

  // Drawers & settings
  document.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => $(b.dataset.close).classList.remove('open'));
  $('continueBtn').onclick = () => openDrawer('settings');
  $('openInbox').onclick = () => openDrawer('inbox');
  $('back').onclick = () => { location.hash = ''; };
  const seg = (id, key, conv = (v) => v) => $(id).querySelectorAll('button').forEach((b) => b.onclick = () => { S[key] = conv(b.dataset.v); applySettings(); save(); if (previewing) renderPreview(); });
  seg('kindSeg', 'kind'); seg('paraSeg', 'para'); seg('alignSeg', 'align');
  seg('dcOnSeg', 'dcOn', (v) => v === 'on'); seg('dcLinesSeg', 'dcLines', Number); seg('dcFrameSeg', 'dcFrame'); seg('dcWeightSeg', 'dcWeight', Number);
  $('dcColor').querySelectorAll('button').forEach((b) => b.onclick = () => { S.dcColor = b.dataset.v; applySettings(); save(); if (previewing) renderPreview(); });
  $('slug').oninput = (e) => { S.slug = e.target.value; save(); };
  $('coverCaption').oninput = (e) => { S.coverCaption = e.target.value; renderCover(); save(); };
  $('coverInput').onchange = async () => {
    const f = $('coverInput').files[0]; $('coverInput').value = ''; if (!f) return;
    toast('Uploading cover image…');
    const url = await upload(f, 'covers'); if (!url) return;
    S.coverUrl = url; renderCover(); save(); toast('Cover image added');
  };
  $('sendEmail').onchange = (e) => { S.sendEmail = e.target.checked; save(); };
  $('schedule').oninput = updateStatus;
  $('publishBtn').onclick = publish;
  $('unpublishBtn').onclick = unpublish;

  // Freewrite import
  const drop = $('fwDrop');
  $('fwFile').onchange = () => { const f = $('fwFile').files[0]; $('fwFile').value = ''; if (f) importFile(f); };
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) importFile(f); });

  // Preview
  $('previewBtn').onclick = () => setPreview(!previewing);
  $('settingsPreview').onclick = () => { $('settings').classList.remove('open'); setPreview(true); };

  addEventListener('resize', () => { relayout(); if (previewing) renderPreview(); });
  document.fonts?.ready.then(relayout);
}

function saveSel() { const s = getSelection(); if (s.rangeCount && bodyEl().contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange(); }
function restoreSel() { if (!savedRange) { bodyEl().focus(); return; } const s = getSelection(); s.removeAllRanges(); s.addRange(savedRange); bodyEl().focus(); }
function currentBlock() {
  const s = getSelection(); if (!s.rangeCount) return null; let n = s.anchorNode;
  while (n && n !== bodyEl()) { if (n.nodeType === 1 && /^(P|H2|H3|BLOCKQUOTE|LI|FIGURE)$/.test(n.tagName)) return n; n = n.parentNode; }
  return null;
}
function updateToolbarState() {
  if (!bodyEl().contains(getSelection().anchorNode)) return;
  document.querySelectorAll('.tbtn[data-cmd]').forEach((b) => { try { b.classList.toggle('on', ['bold', 'italic', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'].includes(b.dataset.cmd) && document.queryCommandState(b.dataset.cmd)); } catch {} });
  const blk = currentBlock(), tag = blk ? blk.tagName.toLowerCase() : 'p';
  $('styleSel').value = tag === 'h2' || tag === 'h3' ? tag : 'p';
  $('quoteBtn').classList.toggle('on', !!(blk && blk.closest('blockquote')));
}
function placeMenu(menu, btn) { const r = btn.getBoundingClientRect(); menu.style.left = r.left + scrollX + 'px'; menu.style.top = r.bottom + scrollY + 6 + 'px'; }
function toggleMenu(menu, btn) { const o = !menu.classList.contains('open'); closeMenus(); if (o) { placeMenu(menu, btn); menu.classList.add('open'); } }
function closeMenus() { document.querySelectorAll('.menu.open,.linkpop.open').forEach((m) => m.classList.remove('open')); }
function openLink() {
  saveSel(); const pop = $('linkPop'); closeMenus(); placeMenu(pop, $('linkBtn')); pop.classList.add('open');
  const n = getSelection().anchorNode, a = n && n.parentElement && n.parentElement.closest('a');
  $('linkInput').value = a ? a.getAttribute('href') : ''; $('linkInput').focus();
}
function setQuote(kind) {
  const blk = currentBlock(), bq = blk && blk.closest('blockquote');
  if (kind === 'none') { if (bq) { while (bq.firstChild) bq.parentNode.insertBefore(bq.firstChild, bq); bq.remove(); } return; }
  if (bq) { bq.classList.toggle('pull', kind === 'pull'); return; }
  if (!blk) return;
  const q = document.createElement('blockquote'); if (kind === 'pull') q.className = 'pull';
  let target = blk.tagName === 'LI' ? blk.closest('ul,ol') : blk;
  if (/^(H2|H3)$/.test(target.tagName)) { const p = document.createElement('p'); p.innerHTML = target.innerHTML; target.replaceWith(p); target = p; }
  target.parentNode.insertBefore(q, target); q.appendChild(target);
}

/* ---------- notes ---------- */
const narrow = () => matchMedia('(max-width:1060px)').matches;
function addNote() {
  restoreSel();
  const s = getSelection(); if (!s.rangeCount || !bodyEl().contains(s.anchorNode)) { toast('Place the cursor in the text first'); return; }
  const id = 'n' + fnSeq++, r = s.getRangeAt(0); r.collapse(false);
  const sup = document.createElement('sup'); sup.className = 'fn'; sup.contentEditable = 'false'; sup.dataset.id = id; sup.textContent = '•';
  r.insertNode(sup); r.setStartAfter(sup); r.collapse(true); s.removeAllRanges(); s.addRange(r);
  const li = makeNote(id, ''); fnList().appendChild(li);
  renumber(); save(); layoutNotes(); li.focus();
}
function renumber() {
  const refs = [...bodyEl().querySelectorAll('sup.fn')], byId = {};
  fnList().querySelectorAll('li').forEach((li) => byId[li.dataset.id] = li);
  refs.forEach((sup, i) => { const n = String(i + 1); sup.textContent = n; const li = byId[sup.dataset.id] || makeNote(sup.dataset.id, ''); li.dataset.n = n; fnList().appendChild(li); });
  const used = new Set(refs.map((r) => r.dataset.id));
  fnList().querySelectorAll('li').forEach((li) => { if (!used.has(li.dataset.id)) li.remove(); });
  $('margin').classList.toggle('has', refs.length > 0);
}
function layoutNotes() {
  const lis = [...fnList().querySelectorAll('li')];
  if (narrow()) { lis.forEach((li) => li.style.top = ''); return; }
  const base = $('margin').getBoundingClientRect().top; let floor = 0;
  lis.forEach((li) => {
    const sup = bodyEl().querySelector(`sup.fn[data-id="${li.dataset.id}"]`); if (!sup) return;
    const top = Math.max(sup.getBoundingClientRect().top - base - 3, floor);
    li.style.top = top + 'px'; floor = top + li.offsetHeight + 14;
  });
}

/* ---------- drop cap & rail ---------- */
function dropcap() {
  const lead = bodyEl().querySelector(':scope > p');
  const ok = S.dcOn && fitDropcap($('sheet'), lead, { lines: S.dcLines, weight: S.dcWeight, frame: S.dcFrame, color: S.dcColor });
  $('sheet').classList.toggle('dc', !!ok);
}
function placeRail() {
  const sheet = $('sheet');
  if (matchMedia('(max-width:1260px)').matches) { sheet.style.setProperty('--rail-top', '0px'); return; }
  const anchor = S.coverUrl ? $('edCover') : $('byline');
  sheet.style.setProperty('--rail-top', anchor.getBoundingClientRect().bottom - $('art').getBoundingClientRect().top + 34 + 'px');
}

/* ---------- books ---------- */
function renderBooks() {
  const books = cur.books;
  const cover = (b) => b.cover_path ? `<img class="cover" src="${esc(b.cover_path)}" alt="">` : `<div class="gencover"><span class="a">${esc(b.author)}</span><span class="t">${esc(b.title)}</span><span class="orn"></span></div>`;
  $('rail').innerHTML = `<span class="caps">${books.length > 1 ? 'Books' : 'Book'} Reviewed</span>` + books.map((b, i) => {
    const pub = [b.publisher, b.year].filter(Boolean).map(esc).join(', ') + (b.pages ? ` · ${esc(b.pages)} pp.` : '') + (b.price ? ` · ${esc(b.price)}` : '');
    return `<div class="bk" data-i="${i}" title="Edit book">${cover(b)}<div><div class="title">${esc(b.title)}</div>${b.author ? `<div class="author">${esc(b.author)}</div>` : ''}${pub ? `<div class="pub">${pub}</div>` : ''}<div class="edit">Edit</div></div></div>`;
  }).join('') + '<button class="addbk" id="railAdd">+ Add book</button>';
  $('rail').querySelectorAll('.bk').forEach((el) => el.onclick = () => editBook(+el.dataset.i));
  $('railAdd').onclick = () => editBook(-1);
  $('booksList').innerHTML = books.map((b, i) => `<div class="booksmall"><span class="c" style="${b.cover_path ? `background-image:url('${esc(b.cover_path)}')` : ''}"></span><span><b>${esc(b.title)}</b>${esc(b.author)}</span><button data-i="${i}">Edit</button></div>`).join('') || '<div class="note" style="padding:0 0 8px">No books yet.</div>';
  $('booksList').querySelectorAll('button').forEach((b) => b.onclick = () => editBook(+b.dataset.i));
  relayout();
}
let editing = -1;
const BF = ['title', 'author', 'publisher', 'year', 'pages', 'price', 'buy_url'];
function editBook(i) {
  editing = i; const b = i >= 0 ? cur.books[i] : {}, form = $('bookform');
  $('dlgTitle').textContent = i >= 0 ? 'Edit book' : 'Add a book';
  BF.forEach((k) => form.elements[k].value = b[k] || ''); form.elements.cover.value = '';
  $('delBook').style.visibility = i >= 0 ? 'visible' : 'hidden'; $('bookdlg').showModal();
}
async function saveBook(e) {
  e.preventDefault();
  const form = $('bookform'), row = {};
  BF.forEach((k) => row[k] = form.elements[k].value.trim() || null);
  const f = form.elements.cover.files[0];
  if (f) { toast('Uploading cover…'); const url = await upload(f, 'covers'); if (url) row.cover_path = url; }
  if (editing >= 0) {
    const b = cur.books[editing];
    const { data, error } = await sb.from('books').update(row).eq('id', b.id).select().single();
    if (error) { toast('Could not save book: ' + error.message); return; }
    cur.books[editing] = data;
  } else {
    const { data, error } = await sb.from('books').insert(row).select().single();
    if (error) { toast('Could not save book: ' + error.message); return; }
    const { error: e2 } = await sb.from('post_books').insert({ post_id: cur.post.id, book_id: data.id, position: cur.books.length });
    if (e2) { toast('Could not attach book: ' + e2.message); return; }
    cur.books.push(data);
  }
  $('bookdlg').close(); renderBooks(); toast(editing >= 0 ? 'Book updated' : 'Book added');
}
async function removeBook() {
  const b = cur.books[editing]; $('bookdlg').close();
  await sb.from('post_books').delete().eq('post_id', cur.post.id).eq('book_id', b.id);
  await sb.from('books').delete().eq('id', b.id);
  cur.books.splice(editing, 1); renderBooks(); toast('Book removed');
}
async function upload(file, folder) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from('media').upload(path, file, { cacheControl: '31536000', contentType: file.type || undefined });
  if (error) { toast('Upload failed: ' + error.message); return null; }
  return sb.storage.from('media').getPublicUrl(path).data.publicUrl;
}

/* ---------- settings ---------- */
function openDrawer(id) { document.querySelectorAll('.drawer.open').forEach((d) => d.classList.remove('open')); $(id).classList.add('open'); }
function renderCover() {
  const fig = $('edCover');
  if (S.coverUrl) {
    fig.innerHTML = `<img src="${esc(S.coverUrl)}" alt="" title="Change cover image">${S.coverCaption ? `<figcaption>${esc(S.coverCaption)}</figcaption>` : ''}<div class="tools"><button data-c="change">Change</button><button data-c="caption">Caption</button><button data-c="remove">Remove</button></div>`;
    fig.querySelector('img').onclick = () => $('coverInput').click();
    fig.querySelector('[data-c=change]').onclick = () => $('coverInput').click();
    fig.querySelector('[data-c=caption]').onclick = () => { openDrawer('settings'); $('coverCaption').focus(); };
    fig.querySelector('[data-c=remove]').onclick = () => { S.coverUrl = ''; renderCover(); save(); };
  } else {
    fig.innerHTML = '<button class="addcover">+ Add a cover image</button>';
    fig.querySelector('button').onclick = () => $('coverInput').click();
  }
  $('coverField').innerHTML = S.coverUrl
    ? `<div class="coverthumb"><img src="${esc(S.coverUrl)}" alt=""><button class="btn" id="cfChange">Change</button><button class="btn" id="cfRemove">Remove</button></div>`
    : '<button class="btn" id="cfChange">Upload image</button>';
  $('cfChange').onclick = () => $('coverInput').click();
  $('cfRemove')?.addEventListener('click', () => { S.coverUrl = ''; renderCover(); save(); });
  relayout();
}
function applySettings() {
  const sheet = $('sheet');
  sheet.classList.toggle('review', S.kind === 'review'); sheet.classList.toggle('book', S.para === 'book'); sheet.classList.toggle('justify', S.align === 'justify');
  $('kicker').textContent = S.kind === 'review' ? 'Review' : 'Essay';
  const on = (id, val) => $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(val)));
  on('kindSeg', S.kind); on('paraSeg', S.para); on('alignSeg', S.align); on('dcOnSeg', S.dcOn ? 'on' : 'off');
  on('dcLinesSeg', S.dcLines); on('dcFrameSeg', S.dcFrame); on('dcWeightSeg', S.dcWeight); on('dcColor', S.dcColor);
  $('booksBox').style.display = S.kind === 'review' ? '' : 'none';
  $('slug').value = S.slug || ''; $('slug').placeholder = slugify(titleEl().textContent) || 'post-url';
  $('sendEmail').checked = S.sendEmail;
  $('coverCaption').value = S.coverCaption || '';
  renderCover();
  renderBooks();
}

/* ---------- publish ---------- */
async function uniqueSlug(base) {
  let slug = base || 'untitled', n = 1;
  for (;;) {
    const { data } = await sb.from('posts').select('id').eq('slug', slug).neq('id', cur.post.id).limit(1);
    if (!data || !data.length) return slug;
    slug = `${base}-${++n}`;
  }
}
async function publish() {
  if (!titleEl().textContent.trim()) { toast('Give the post a title first'); return; }
  await flushSave();
  const p = cur.post, already = p.status === 'published';
  const when = $('schedule').value ? new Date($('schedule').value) : null;
  if (when && when < new Date()) { toast('The scheduled time is in the past'); return; }
  const slug = await uniqueSlug(slugify(S.slug || p.slug || titleEl().textContent));
  const live = `${location.origin}${BASE}p/${slug}/`;
  const verb = already ? 'Update' : when ? 'Schedule' : 'Publish';
  const ok = await confirmBox(`${verb} this post?`,
    `<p>${already ? 'Readers will see your changes' : when ? `It goes live ${esc(when.toLocaleString())}` : 'It goes live now'} at<br><i>${esc(live)}</i></p>` +
    (S.sendEmail && !already ? '<p style="font-size:14px;opacity:.75"><i>Email delivery isn\'t connected yet, so no email will be sent.</i></p>' : ''), verb);
  if (!ok) return;
  const patch = { slug, status: 'published', published_at: already && !when ? p.published_at : (when || new Date()).toISOString() };
  const { error } = await sb.from('posts').update(patch).eq('id', p.id);
  if (error) { toast('Could not publish: ' + error.message); return; }
  Object.assign(p, patch); S.slug = slug; $('slug').value = slug;
  await snapshot(); updateStatus(); updateByline();
  $('settings').classList.remove('open');
  toast(when ? 'Scheduled' : already ? 'Updated' : 'Published');
}
async function unpublish() {
  if (!(await confirmBox('Unpublish this post?', '<p>It will return to your drafts and disappear from the site.</p>', 'Unpublish'))) return;
  const { error } = await sb.from('posts').update({ status: 'draft' }).eq('id', cur.post.id);
  if (error) { toast('Could not unpublish: ' + error.message); return; }
  cur.post.status = 'draft'; updateStatus(); $('settings').classList.remove('open'); toast('Moved to drafts');
}

/* ---------- Freewrite / Markdown import ---------- */
function inlineMD(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>').replace(/(^|\W)_(?!\s)(.+?)_(?=\W|$)/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
}
async function importFile(file) {
  const text = (await file.text()).replace(/\r/g, '');
  const hasContent = bodyEl().textContent.trim().length > 0;
  if (hasContent && !(await confirmBox('Replace this draft?', `<p>Importing “${esc(file.name)}” replaces this draft's title, text and notes.</p>`, 'Import'))) return;
  const defs = {}; const md = text.replace(/^\[\^(\w+)\]:\s*(.+)$/gm, (m, k, v) => { defs[k] = v; return ''; });
  let title = ''; const notes = [];
  const html = md.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean).map((b) => {
    if (/^# /.test(b) && !title) { title = b.slice(2).trim(); return ''; }
    if (/^## /.test(b)) return '<h2>' + inlineMD(b.slice(3)) + '</h2>';
    if (/^### /.test(b)) return '<h3>' + inlineMD(b.slice(4)) + '</h3>';
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(b)) return '<hr>';
    if (/^> /.test(b)) return '<blockquote><p>' + inlineMD(b.replace(/^> ?/gm, '').replace(/\n/g, ' ')) + '</p></blockquote>';
    if (/^[-*] /.test(b)) return '<ul>' + b.split('\n').map((l) => '<li>' + inlineMD(l.replace(/^[-*] /, '')) + '</li>').join('') + '</ul>';
    const p = inlineMD(b.replace(/\n/g, ' ')).replace(/\[\^(\w+)\]/g, (m, k) => { const id = 'n' + fnSeq++; notes.push({ id, body: esc(defs[k] || '') }); return `<sup class="fn" contenteditable="false" data-id="${id}">•</sup>`; });
    return '<p>' + p + '</p>';
  }).join('');
  if (title) titleEl().textContent = title;
  bodyEl().innerHTML = html; fnList().innerHTML = ''; notes.forEach((n) => fnList().appendChild(makeNote(n.id, n.body)));
  cur.post.source = 'freewrite'; cur.post.source_file_id = file.name;
  await sb.from('posts').update({ source: 'freewrite', source_file_id: file.name }).eq('id', cur.post.id);
  renumber(); updateByline(); save(); relayout(); $('inbox').classList.remove('open'); toast(`Imported “${file.name}”`);
}

/* ---------- preview ---------- */
let previewing = false, disposeReader = null;
function setPreview(on) {
  previewing = on; document.body.classList.toggle('previewing', on);
  $('previewBtn').textContent = on ? 'Back to editing' : 'Preview'; $('previewBtn').classList.toggle('on', on);
  if (on) { renderPreview(); scrollTo(0, 0); } else if (disposeReader) { disposeReader(); disposeReader = null; }
}
function renderPreview() {
  if (disposeReader) disposeReader();
  const post = { ...cur.post, ...collect(), published_at: cur.post.status === 'published' ? cur.post.published_at : new Date().toISOString() };
  $('preview').innerHTML = renderArticle(post, post.kind === 'review' ? cur.books : []);
  disposeReader = initReader($('preview'));
}
