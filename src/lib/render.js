// Shared article renderer: used at build time (Astro), in the /read/ fallback,
// and in the Studio preview, so every view of a post is typeset identically.
import { AUTHOR } from './config.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const slugify = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80);

export const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' }) : '';

export const readingMinutes = (html) => {
  const words = String(html || '').replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
};

export const DEFAULT_DROP_CAP = { on: true, lines: 3, weight: 400, color: 'var(--ink)', frame: 'orn-double' };

/** Turn the editor's <sup class="fn" data-id> markers into numbered, clickable references. */
export function processBody(bodyHtml, notes) {
  const byId = Object.fromEntries((notes || []).map((n) => [n.id, n.body]));
  const ordered = [];
  let html = String(bodyHtml || '')
    .replace(/\s+contenteditable="(true|false)"/g, '')
    .replace(/<figcaption[^>]*>\s*<\/figcaption>/g, '')
    .replace(/<sup\b[^>]*\bclass="fn"[^>]*>[\s\S]*?<\/sup>/g, (m) => {
      const id = (m.match(/data-id="([^"]+)"/) || [])[1];
      ordered.push({ id, body: byId[id] || '' });
      const n = ordered.length;
      return `<sup class="ref" data-note="${n}"><button type="button" aria-expanded="false" aria-controls="sn-${n}" aria-label="Note ${n}">${n}</button></sup>`;
    });
  // Strip the editor's empty trailing paragraphs
  html = html.replace(/(<p>(<br>|\s|&nbsp;)*<\/p>)+$/g, '');
  return { html, notes: ordered };
}

export function bookRail(books) {
  if (!books || !books.length) return '';
  return `<aside class="rail" aria-label="${books.length > 1 ? 'Books' : 'Book'} reviewed"><span class="caps">${books.length > 1 ? 'Books' : 'Book'} Reviewed</span>` +
    books.map((b) => {
      const pub = [b.publisher, b.year].filter(Boolean).map(esc).join(', ') + (b.pages ? ` · ${esc(b.pages)} pp.` : '') + (b.price ? ` · ${esc(b.price)}` : '');
      const cover = b.cover_path
        ? `<img class="cover" src="${esc(b.cover_path)}" alt="Cover of ${esc(b.title)}" loading="lazy">`
        : `<div class="gencover" role="img" aria-label="Cover of ${esc(b.title)}"><span class="a">${esc(b.author)}</span><span class="t">${esc(b.title)}</span><span class="orn"></span></div>`;
      return `<div class="bk">${cover}<div><p class="title">${esc(b.title)}</p>${b.author ? `<p class="author">${esc(b.author)}</p>` : ''}${pub ? `<p class="pub">${pub}</p>` : ''}${b.buy_url ? `<a class="buy" href="${esc(b.buy_url)}" target="_blank" rel="noopener">Buy</a>` : ''}</div></div>`;
    }).join('') + '</aside>';
}

/** Full article block: grid with article + margin of side notes. */
export function renderArticle(post, books = []) {
  const dc = { ...DEFAULT_DROP_CAP, ...(post.drop_cap || {}) };
  const { html, notes } = processBody(post.body_html, post.notes);
  const review = post.kind === 'review' && books.length > 0;
  const cls = ['post', post.paragraph_style === 'web' ? '' : 'book', post.align === 'justify' ? 'justify' : '', dc.on ? 'dc' : '']
    .filter(Boolean).join(' ');
  const date = formatDate(post.published_at || post.updated_at || new Date());
  const side = notes.map((n, i) => `<div class="sidenote" id="sn-${i + 1}" role="note"><button type="button" class="x" aria-label="Close note">×</button><span class="n">${i + 1}</span>${n.body}</div>`).join('');
  const end = notes.length ? `<section class="endnotes"><h3>Notes</h3><ol>${notes.map((n) => `<li>${n.body}</li>`).join('')}</ol></section>` : '';
  return `<div class="layout${review ? ' review' : ''}">
  <article class="${cls}" data-dc-lines="${+dc.lines || 3}" data-dc-weight="${+dc.weight || 400}" data-dc-frame="${esc(dc.frame || '')}" data-dc-color="${esc(dc.color || 'var(--ink)')}">
    <p class="kicker caps">${esc(kickerOf(post))}</p>
    <h1>${esc(post.title || 'Untitled')}</h1>
    ${post.subtitle ? `<p class="dek">${esc(post.subtitle)}</p>` : ''}
    <div class="byline"><span class="by">${esc(AUTHOR)}</span> · ${esc(date)} · ${readingMinutes(post.body_html)} min read</div>
    ${coverFigure(post)}
    ${review ? bookRail(books) : ''}
    <div class="body">${html}</div>
    ${end}
  </article>
  <aside class="margin" aria-label="Notes">${side}</aside>
</div>`;
}

export function coverFigure(post) {
  if (!post.cover_url) return '';
  return `<figure class="lead-cover"><img src="${esc(post.cover_url)}" alt="${esc(post.cover_caption || post.title || '')}">${post.cover_caption ? `<figcaption>${esc(post.cover_caption)}</figcaption>` : ''}</figure>`;
}

/** Home / archive list. The first post can be set as a large lead story. */
export function postListHTML(posts, base, { lead = false, prefix = 'p/' } = {}) {
  if (!posts.length) return '<p class="empty">The first essay is on its way.</p>';
  const meta = (p) => {
    const books = (p.post_books || []).sort((a, b) => a.position - b.position).map((x) => x.books?.title).filter(Boolean);
    return `<div class="meta">${esc(kickerOf(p))}${books.length ? `<span class="d"> · <i class="bt">${books.map(esc).join(', ')}</i></span>` : ''} <span class="d">· ${esc(formatDate(p.published_at))}</span></div>`;
  };
  const href = (p) => `${base}${prefix}${encodeURIComponent(p.slug)}/`;
  let out = '';
  let rest = posts;
  if (lead) {
    const p = posts[0]; rest = posts.slice(1);
    out += `<article class="leadstory">${p.cover_url ? `<a class="lc" href="${href(p)}" tabindex="-1" aria-hidden="true"><img src="${esc(p.cover_url)}" alt=""></a>` : ''}
      <div class="lt">${meta(p)}<h2><a href="${href(p)}">${esc(p.title)}</a></h2>${p.subtitle ? `<p>${esc(p.subtitle)}</p>` : ''}</div></article>`;
  }
  if (rest.length) {
    out += '<ul class="postlist">' + rest.map((p) => `<li class="${p.cover_url ? 'has-thumb' : ''}"><div class="pt">${meta(p)}<h2><a href="${href(p)}">${esc(p.title)}</a></h2>${p.subtitle ? `<p>${esc(p.subtitle)}</p>` : ''}</div>${p.cover_url ? `<a class="thumb" href="${href(p)}" tabindex="-1" aria-hidden="true"><img src="${esc(p.cover_url)}" alt="" loading="lazy"></a>` : ''}</li>`).join('') + '</ul>';
  }
  return out;
}

export const kickerOf = (p) => p.kind === 'review' ? 'Review' : (p.section || 'Essay');
const booksOf = (p) => (p.post_books || p.books?.map((b, i) => ({ position: i, books: b })) || [])
  .slice().sort((a, b) => a.position - b.position).map((x) => x.books).filter(Boolean);

/**
 * Magazine front page: masthead-led lead story with a "latest" column, a grid of
 * recent pieces, a reviews band with book covers, and an archive list.
 */
export function magazineHTML(posts, base, { prefix = 'p/' } = {}) {
  if (!posts.length) return '<p class="empty" style="padding:60px 0">The first essay is on its way.</p>';
  const href = (p) => `${base}${prefix}${encodeURIComponent(p.slug)}/`;
  const by = (p) => `<p class="by">${esc(AUTHOR)} · ${esc(formatDate(p.published_at))}</p>`;
  const kick = (p) => `<p class="mk">${esc(kickerOf(p))}</p>`;
  const pic = (p, cls = '') => p.cover_url ? `<a class="pic ${cls}" href="${href(p)}" tabindex="-1" aria-hidden="true"><img src="${esc(p.cover_url)}" alt="" loading="lazy"></a>` : '';
  const [lead, ...rest] = posts;
  const side = rest.slice(0, 3);
  const used = new Set([lead, ...side]);
  const reviews = posts.filter((p) => p.kind === 'review' && booksOf(p).length);
  const grid = rest.slice(3).filter((p) => p.kind !== 'review').slice(0, 6);
  grid.forEach((p) => used.add(p));
  const archive = posts.filter((p) => !used.has(p) && p.kind !== 'review');

  let h = `<section class="mag-top">
    <article class="mag-lead">${pic(lead, 'r32')}${kick(lead)}<h2><a href="${href(lead)}">${esc(lead.title)}</a></h2>${lead.subtitle ? `<p class="dek">${esc(lead.subtitle)}</p>` : ''}${by(lead)}</article>
    <aside class="mag-side"><h3 class="mag-h">Latest</h3>${side.map((p, i) => `<article class="mag-s">${i === 0 ? pic(p, 'r32') : ''}${kick(p)}<h4><a href="${href(p)}">${esc(p.title)}</a></h4>${i === 0 && p.subtitle ? `<p class="dek">${esc(p.subtitle)}</p>` : ''}${by(p)}</article>`).join('')}</aside>
  </section>`;
  if (grid.length) h += `<section class="mag-sec"><h3 class="mag-h">Essays</h3><div class="mag-grid">${grid.map((p) => `<article class="mag-card">${pic(p, 'r32')}${kick(p)}<h4><a href="${href(p)}">${esc(p.title)}</a></h4>${p.subtitle ? `<p class="dek">${esc(p.subtitle)}</p>` : ''}${by(p)}</article>`).join('')}</div></section>`;
  if (reviews.length) h += `<section class="mag-reviews"><div class="mag-in"><h3 class="mag-h">Books Reviewed</h3><div class="mag-books">${reviews.slice(0, 4).map((p) => {
    const b = booksOf(p)[0];
    const cover = b.cover_path ? `<img src="${esc(b.cover_path)}" alt="">` : `<div class="gencover"><span class="a">${esc(b.author)}</span><span class="t">${esc(b.title)}</span><span class="orn"></span></div>`;
    return `<article class="mag-book"><a class="bc" href="${href(p)}" tabindex="-1" aria-hidden="true">${cover}</a><div><p class="bt"><i>${esc(b.title)}</i>${b.author ? `<br><span>${esc(b.author)}</span>` : ''}</p><h4><a href="${href(p)}">${esc(p.title)}</a></h4>${by(p)}</div></article>`;
  }).join('')}</div></div></section>`;
  if (archive.length) h += `<section class="mag-sec"><h3 class="mag-h">From the Archive</h3><ul class="mag-arch">${archive.slice(0, 8).map((p) => `<li><span class="mk">${esc(kickerOf(p))}</span><a href="${href(p)}">${esc(p.title)}</a><span class="d">${esc(formatDate(p.published_at))}</span></li>`).join('')}</ul></section>`;
  return h;
}

export function mastheadHTML(base, sections = [], { archive = 'archive/' } = {}) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });
  return `<header class="mast"><div class="mast-strip"><span>${esc(today)}</span><span>Est. 2026</span></div>
  <h1 class="mast-name"><a href="${base}">Notes &amp; Asides.</a></h1>
  <p class="mast-tag">A blog of conservative thought and Reformed musings.</p>
  <nav class="mast-nav">${sections.map((s) => `<a href="${base}${archive}?s=${encodeURIComponent(s)}">${esc(s)}</a>`).join('')}<a href="${base}${archive}">Archive</a><a href="${base}about/">About</a><a href="#subscribe" class="sub">Subscribe</a></nav></header>`;
}
