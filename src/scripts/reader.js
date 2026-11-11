// Reader behavior: drop cap geometry, click-to-open side notes, book-rail placement.
// initReader(root) is also used by the Studio's preview.

const cv = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
export function fontMetrics(weight, txt) {
  cv.font = `${weight} 200px "EB Garamond"`;
  const m = cv.measureText(txt);
  return { cap: m.actualBoundingBoxAscent / 200, asc: m.fontBoundingBoxAscent / 200, desc: m.fontBoundingBoxDescent / 200,
    adv: m.width / 200, l: m.actualBoundingBoxLeft / 200, r: m.actualBoundingBoxRight / 200 };
}

/**
 * Size a ::first-letter drop cap from the typeface's real cap height.
 * Unframed: cap top on line 1's cap height, baseline on line N's baseline.
 * Framed: square frame spanning the same height, letter centered by its ink.
 * Sets CSS custom properties on `host`; `lead` is the first paragraph.
 */
export function fitDropcap(host, lead, s) {
  const letter = lead ? lead.textContent.trim().charAt(0) : '';
  if (!letter || !/[\p{L}\p{N}]/u.test(letter)) return false;
  const set = (k, v) => host.style.setProperty(k, v);
  const cs = getComputedStyle(lead), fsb = parseFloat(cs.fontSize), LH = parseFloat(cs.lineHeight) || fsb * 1.6;
  const b = fontMetrics(400, 'H'), g = fontMetrics(s.weight, letter);
  const capTop = (LH - fsb * (b.asc + b.desc)) / 2 + fsb * b.asc - fsb * b.cap;
  const span = (s.lines - 1) * LH + fsb * b.cap;
  set('--dc-color', s.color); set('--dc-weight', s.weight);
  if (!s.frame) {
    const fs = span / g.cap, glyphTop = fs * ((1 - (g.asc + g.desc)) / 2 + g.asc) - fs * g.cap, mt = capTop - glyphTop;
    set('--dc-size', fs + 'px'); set('--dc-mt', mt + 'px'); set('--dc-mr', fsb * 0.18 + 'px'); set('--dc-mb', Math.min(0, s.lines * LH - mt - fs - 2) + 'px');
    set('--dc-pad', '0'); set('--dc-border', '0 solid transparent'); set('--dc-bg', 'transparent'); set('--dc-fg', 'var(--dc-color)');
    return true;
  }
  const H = span, bw = s.frame === 'orn-double' ? Math.max(4, Math.round((H * 0.07) / 3) * 3) : s.frame === 'orn-box' ? 1.5 : 0, inner = H - 2 * bw;
  const fs = (inner * 0.6) / g.cap, glyphTop = fs * ((1 - (g.asc + g.desc)) / 2 + g.asc) - fs * g.cap;
  const pt = (inner - fs * g.cap) / 2 - glyphTop, pb = inner - fs - pt;
  const pl = inner / 2 - (fs * (g.r - g.l)) / 2, pr = inner - fs * g.adv - pl;
  set('--dc-size', fs + 'px'); set('--dc-pad', `${pt}px ${pr}px ${pb}px ${pl}px`);
  set('--dc-border', s.frame === 'orn-filled' ? '0 solid transparent' : `${bw}px ${s.frame === 'orn-double' ? 'double' : 'solid'} ${s.color}`);
  set('--dc-bg', s.frame === 'orn-filled' ? s.color : 'transparent');
  set('--dc-fg', s.frame === 'orn-filled' ? 'var(--paper)' : 'var(--dc-color)');
  set('--dc-mt', capTop + 'px'); set('--dc-mr', fsb * 0.55 + 'px'); set('--dc-mb', '0px');
  return true;
}

export function initReader(root = document) {
  const article = root.querySelector('article.post');
  if (!article) return () => {};
  const layout = article.closest('.layout');
  const margin = layout.querySelector('aside.margin');
  const narrow = () => matchMedia('(max-width:1060px)').matches;
  const open = new Set();
  const refs = [...article.querySelectorAll('sup.ref')];
  const noteHTML = (n) => { const s = margin.querySelector(`#sn-${n}`); if (!s) return ''; const c = s.cloneNode(true); c.querySelectorAll('.x,.n').forEach((e) => e.remove()); return c.innerHTML; };

  function dropcap() {
    if (!article.classList.contains('dc')) return;
    const lead = article.querySelector('.body > p');
    const d = article.dataset;
    const ok = fitDropcap(article, lead, { lines: +d.dcLines || 3, weight: +d.dcWeight || 400, frame: d.dcFrame || '', color: d.dcColor || 'var(--ink)' });
    article.classList.toggle('fitted', ok);
  }
  function placeRail() {
    const by = article.querySelector('.lead-cover') || article.querySelector('.byline');
    if (!by) return;
    article.style.setProperty('--rail-top', matchMedia('(max-width:1260px)').matches ? '0px' : by.getBoundingClientRect().bottom - article.getBoundingClientRect().top + 34 + 'px');
  }
  function layoutNotes() {
    if (narrow()) return;
    const base = margin.getBoundingClientRect().top; let floor = 0;
    refs.forEach((sup) => {
      const n = sup.dataset.note; if (!open.has(n)) return;
      const side = margin.querySelector(`#sn-${n}`); if (!side) return;
      const top = Math.max(sup.getBoundingClientRect().top - base - 4, floor);
      side.style.top = top + 'px'; floor = top + side.offsetHeight + 14;
    });
  }
  function toggle(n, force) {
    const will = force === undefined ? !open.has(n) : force;
    will ? open.add(n) : open.delete(n);
    const sup = article.querySelector(`sup[data-note="${n}"]`), btn = sup.querySelector('button');
    btn.setAttribute('aria-expanded', String(will));
    margin.querySelector(`#sn-${n}`)?.classList.toggle('open', will && !narrow());
    const ex = article.querySelector(`.inline-note[data-for="${n}"]`);
    if (narrow()) {
      if (will && !ex) {
        const block = sup.closest('p,li,blockquote') || sup.parentElement;
        let after = block.nextElementSibling;
        while (after && after.classList.contains('inline-note')) after = after.nextElementSibling;
        const d = document.createElement('span'); d.className = 'inline-note'; d.dataset.for = n; d.setAttribute('role', 'note');
        d.innerHTML = `<b>${n}</b>${noteHTML(n)}`; block.parentNode.insertBefore(d, after);
      } else if (!will && ex) ex.remove();
    }
    layoutNotes();
  }
  refs.forEach((sup) => sup.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); toggle(sup.dataset.note); }));
  margin.querySelectorAll('.sidenote .x').forEach((x) => x.addEventListener('click', () => toggle(x.closest('.sidenote').id.slice(3), false)));
  const onKey = (e) => { if (e.key === 'Escape') [...open].forEach((n) => toggle(n, false)); };
  const relayout = () => { dropcap(); placeRail(); layoutNotes(); };
  const onResize = () => {
    const was = [...open]; was.forEach((n) => toggle(n, false));
    article.querySelectorAll('.inline-note').forEach((e) => e.remove());
    relayout(); was.forEach((n) => toggle(n, true));
  };
  document.addEventListener('keydown', onKey);
  addEventListener('resize', onResize);
  relayout();
  if (document.fonts) {
    document.fonts.ready.then(relayout);
    [400, 600, 800].forEach((w) => document.fonts.load(`${w} 20px "EB Garamond"`).then(relayout).catch(() => {}));
  }
  return () => { document.removeEventListener('keydown', onKey); removeEventListener('resize', onResize); };
}
