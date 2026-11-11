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
    article.style.setProperty('--rail-top', matchMedia('(max-width:1340px)').matches ? '0px' : by.getBoundingClientRect().bottom - article.getBoundingClientRect().top + 34 + 'px');
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
  const disposeFigures = initFigures(root);
  relayout();
  if (document.fonts) {
    document.fonts.ready.then(relayout);
    [400, 600, 800].forEach((w) => document.fonts.load(`${w} 20px "EB Garamond"`).then(relayout).catch(() => {}));
  }
  return () => { document.removeEventListener('keydown', onKey); removeEventListener('resize', onResize); disposeFigures(); };
}

/* ===================================================================
   Image features inside an article body. Each works without JavaScript
   (everything simply shows in order); these add the interaction.
   =================================================================== */
export function initFigures(root = document) {
  const body = root.querySelector('article.post .body');
  if (!body) return () => {};
  const cleanups = [];

  // Full-bleed images: span the whole window regardless of the column.
  const bleeds = [...body.querySelectorAll('figure.bleed')];
  const fitBleeds = () => bleeds.forEach((f) => {
    f.style.marginLeft = '0px'; f.style.width = '';
    const left = f.getBoundingClientRect().left, vw = document.documentElement.clientWidth;
    f.style.marginLeft = -left + 'px'; f.style.width = vw + 'px';
  });
  if (bleeds.length) { fitBleeds(); addEventListener('resize', fitBleeds); cleanups.push(() => removeEventListener('resize', fitBleeds)); }

  // Hotspots: numbered dots on an image tied to a legend.
  body.querySelectorAll('figure.hotspots').forEach((fig) => {
    const dots = [...fig.querySelectorAll('.hs')], items = [...fig.querySelectorAll('.hs-notes li')];
    const tip = document.createElement('div'); tip.className = 'hs-tip'; tip.setAttribute('role', 'status'); fig.querySelector('.hs-img').appendChild(tip);
    const select = (i) => {
      dots.forEach((d, j) => d.classList.toggle('on', j === i)); items.forEach((li, j) => li.classList.toggle('on', j === i));
      if (i < 0) { tip.classList.remove('show'); return; }
      const d = dots[i]; tip.innerHTML = `<b>${i + 1}</b> ${items[i]?.innerHTML || ''}`;
      tip.style.left = d.style.left; tip.style.top = d.style.top;
      tip.classList.toggle('below', parseFloat(d.style.top) < 30); tip.classList.toggle('flip', parseFloat(d.style.left) > 60);
      tip.classList.add('show');
    };
    let cur = -1;
    dots.forEach((d, i) => d.addEventListener('click', (e) => { e.stopPropagation(); cur = cur === i ? -1 : i; select(cur); }));
    items.forEach((li, i) => li.addEventListener('click', () => { cur = cur === i ? -1 : i; select(cur); }));
    fig.querySelector('.hs-img img').addEventListener('click', (e) => { if (cur >= 0) { e.preventDefault(); cur = -1; select(-1); } }, true);
  });

  // Style explorer: tabs over panels.
  body.querySelectorAll('.explorer').forEach((ex) => {
    const panels = [...ex.querySelectorAll('.ex-panel')];
    const tabs = document.createElement('div'); tabs.className = 'ex-tabs'; tabs.setAttribute('role', 'tablist');
    panels.forEach((p, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab');
      b.innerHTML = `<span class="yr">${p.dataset.years || ''}</span>${p.dataset.label}`;
      b.onclick = () => show(i); tabs.appendChild(b);
    });
    ex.prepend(tabs); ex.classList.add('js');
    const prev = document.createElement('button'), next = document.createElement('button');
    prev.className = 'ex-nav prev'; next.className = 'ex-nav next'; prev.type = next.type = 'button';
    prev.setAttribute('aria-label', 'Previous style'); next.setAttribute('aria-label', 'Next style'); prev.textContent = '‹'; next.textContent = '›';
    ex.querySelector('.ex-stage').append(prev, next);
    let at = 0;
    function show(i) {
      at = (i + panels.length) % panels.length;
      panels.forEach((p, j) => p.classList.toggle('on', j === at));
      [...tabs.children].forEach((b, j) => { b.classList.toggle('on', j === at); b.setAttribute('aria-selected', String(j === at)); });
    }
    prev.onclick = () => show(at - 1); next.onclick = () => show(at + 1);
    show(0);
  });

  // Quiz: pick a style for each picture.
  body.querySelectorAll('.quiz').forEach((qz) => {
    const qs = [...qz.querySelectorAll('.q')]; let right = 0, done = 0;
    const score = document.createElement('p'); score.className = 'q-score'; qz.appendChild(score);
    qs.forEach((q) => q.querySelectorAll('.opts button').forEach((b) => b.addEventListener('click', () => {
      if (q.classList.contains('answered')) return;
      q.classList.add('answered'); done++;
      const ok = b.dataset.v === q.dataset.answer; if (ok) right++;
      b.classList.add(ok ? 'right' : 'wrong');
      q.querySelector(`.opts button[data-v="${q.dataset.answer}"]`)?.classList.add('right');
      if (done === qs.length) score.textContent = `You named ${right} of ${qs.length}. ${right === qs.length ? 'A trained eye.' : right ? 'Not bad at all.' : 'Now you know where to look.'}`;
    })));
  });

  // Lightbox: click any picture to see it large, with its caption.
  const imgs = [...body.querySelectorAll('figure img')].filter((im) => !im.closest('.quiz'));
  if (imgs.length) {
    const lb = document.createElement('div'); lb.className = 'lightbox'; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.setAttribute('aria-label', 'Image viewer');
    lb.innerHTML = '<button class="lb-x" aria-label="Close">×</button><button class="lb-p" aria-label="Previous image">‹</button><figure><img alt=""><figcaption></figcaption></figure><button class="lb-n" aria-label="Next image">›</button><div class="lb-count"></div>';
    document.body.appendChild(lb);
    let at = 0;
    const cap = (im) => im.closest('figure')?.querySelector(':scope > figcaption, .ex-panel figcaption')?.textContent || im.alt || '';
    const open = (i) => {
      at = (i + imgs.length) % imgs.length; const im = imgs[at];
      lb.querySelector('img').src = im.currentSrc || im.src; lb.querySelector('img').alt = im.alt;
      lb.querySelector('figcaption').textContent = cap(im); lb.querySelector('.lb-count').textContent = `${at + 1} / ${imgs.length}`;
      lb.classList.add('open'); document.documentElement.style.overflow = 'hidden'; lb.querySelector('.lb-x').focus();
    };
    const close = () => { lb.classList.remove('open'); document.documentElement.style.overflow = ''; imgs[at]?.focus?.(); };
    imgs.forEach((im, i) => {
      im.classList.add('zoomable'); im.tabIndex = 0; im.setAttribute('role', 'button'); im.setAttribute('aria-label', `Enlarge: ${im.alt || 'image'}`);
      im.addEventListener('click', (e) => { if (e.defaultPrevented) return; open(i); });
      im.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(i); } });
    });
    lb.querySelector('.lb-x').onclick = close; lb.querySelector('.lb-p').onclick = () => open(at - 1); lb.querySelector('.lb-n').onclick = () => open(at + 1);
    lb.addEventListener('click', (e) => { if (e.target === lb) close(); });
    const key = (e) => { if (!lb.classList.contains('open')) return; if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') open(at - 1); if (e.key === 'ArrowRight') open(at + 1); };
    document.addEventListener('keydown', key);
    cleanups.push(() => { document.removeEventListener('keydown', key); lb.remove(); });
  }
  return () => cleanups.forEach((f) => f());
}
