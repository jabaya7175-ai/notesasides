// A right-click menu shared by the Studio: dashboard, library and drafting board.
// items: [{ label, act, kbd, danger, disabled, checked, sub: [...] } | '-']
let root = null, onClose = null;

export function closeMenu() {
  if (!root) return;
  document.querySelectorAll('.cmenu').forEach((c) => c.remove()); root = null;
  removeEventListener('blur', closeMenu); removeEventListener('resize', closeMenu);
  document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keys, true); document.removeEventListener('wheel', closeMenu, true);
  onClose?.(); onClose = null;
}
const outside = (e) => { if (!e.target.closest?.('.cmenu')) closeMenu(); };

function build(items, x, y, parent) {
  const m = document.createElement('div');
  m.className = 'cmenu'; m.setAttribute('role', 'menu');
  // Submenus close after a short grace period, so the pointer can cut across other items to reach them.
  let shut = 0;
  const closeSubs = (now) => { clearTimeout(shut); const go = () => { (m._subs || []).forEach((c) => c._kill()); m._subs = []; }; if (now) go(); else shut = setTimeout(go, 280); };
  m._parent = parent || null; m._subs = [];
  m._kill = () => { (m._subs || []).forEach((c) => c._kill()); m.remove(); };
  m.addEventListener('pointerenter', () => parent && parent.dispatchEvent(new CustomEvent('keepsub')));
  m.addEventListener('keepsub', () => clearTimeout(shut));
  // Drop leading, trailing and doubled separators.
  const clean = items.filter(Boolean).filter((it, i, a) => it !== '-' || (i > 0 && i < a.length - 1 && a[i - 1] !== '-'));
  clean.forEach((it) => {
    if (it === '-') { m.appendChild(Object.assign(document.createElement('hr'), {})); return; }
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'menuitem');
    b.className = 'cm-it' + (it.danger ? ' danger' : '') + (it.sub ? ' has-sub' : '');
    b.disabled = !!it.disabled;
    b.innerHTML = `<span class="cm-ck">${it.checked ? '✓' : ''}</span><span class="cm-l"></span><span class="cm-k">${it.sub ? '›' : (it.kbd || '')}</span>`;
    b.querySelector('.cm-l').textContent = it.label;
    if (it.sub) {
      let child = null;
      const open = () => { if (child?.isConnected) { clearTimeout(shut); return; } closeSubs(true); const r = b.getBoundingClientRect(); child = build(it.sub, r.right - 4, r.top - 5, m); };
      b.addEventListener('pointerenter', open); b.addEventListener('click', open);
      b.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { open(); child?.querySelector('.cm-it:not(:disabled)')?.focus(); } });
    } else {
      b.addEventListener('pointerenter', () => closeSubs(false));
      b.addEventListener('click', () => { closeMenu(); it.act?.(); });
    }
    m.appendChild(b);
  });
  document.body.appendChild(m);
  if (parent) parent._subs.push(m);
  const r = m.getBoundingClientRect(), W = innerWidth, H = innerHeight;
  let left = x, top = y;
  if (left + r.width > W - 6) left = parent ? parent.getBoundingClientRect().left - r.width + 4 : W - r.width - 6;
  if (top + r.height > H - 6) top = Math.max(6, H - r.height - 6);
  m.style.left = Math.max(6, left) + 'px'; m.style.top = top + 'px';
  return m;
}

function keys(e) {
  if (!root) return;
  const cur = document.activeElement?.closest?.('.cmenu') || root;
  const btns = [...cur.querySelectorAll(':scope > .cm-it:not(:disabled)')];
  const i = btns.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (cur !== root) { const p = cur._parent; cur._kill(); p?.querySelector('.cm-it')?.focus(); } else closeMenu(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
  if (e.key === 'ArrowLeft' && cur !== root) { e.preventDefault(); const p = cur._parent; cur._kill(); p?.querySelector('.cm-it')?.focus(); }
  if (e.key === 'Enter' || e.key === ' ') { if (i >= 0) { e.preventDefault(); btns[i].click(); } }
}

export function openMenu(x, y, items, closed) {
  closeMenu();
  if (!items.filter((i) => i && i !== '-').length) return;
  root = build(items, x, y); onClose = closed || null;
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', keys, true); document.addEventListener('wheel', closeMenu, true);
    addEventListener('blur', closeMenu); addEventListener('resize', closeMenu);
  });
}
export const menuOpen = () => !!root;
