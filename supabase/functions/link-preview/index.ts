// link-preview: fetches an article for the Drafting Board.
// POST { url, clip?: boolean } (Studio admins only)
// → { url, title, site, description, image, author, published, blocks?: [{ t: 'p'|'h'|'q', text }] }
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©' };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
const text = (h: string) => decode(h.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

function meta(html: string, ...names: string[]) {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${n}["'][^>]*>`, 'i');
    const tag = html.match(re)?.[0];
    const c = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    if (c) return decode(c).trim();
  }
  return '';
}

function privateHost(h: string) {
  return /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|metadata)/i.test(h) || h.endsWith('.internal') || h.endsWith('.local');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // Only Studio admins may use this.
  const auth = req.headers.get('Authorization') || '';
  const ok = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/is_admin`, {
    method: 'POST', headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY')!, Authorization: auth, 'Content-Type': 'application/json' }, body: '{}',
  }).then((r) => r.ok ? r.json() : false).catch(() => false);
  if (ok !== true) return json({ error: 'not allowed' }, 403);

  let body: { url?: string; clip?: boolean };
  try { body = await req.json(); } catch { return json({ error: 'bad request' }, 400); }
  let u: URL;
  try { u = new URL(String(body.url || '').trim()); } catch { return json({ error: 'That is not a valid link' }, 400); }
  if (!/^https?:$/.test(u.protocol) || privateHost(u.hostname)) return json({ error: 'That link cannot be fetched' }, 400);

  let html = '';
  let finalUrl = u.toString();
  try {
    const r = await fetch(u, {
      redirect: 'follow', signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NotesAndAsides/1.0; +https://notesasides.com)', Accept: 'text/html,application/xhtml+xml' },
    });
    finalUrl = r.url || finalUrl;
    if (!(r.headers.get('content-type') || '').includes('html')) return json({ url: finalUrl, title: u.hostname, site: u.hostname, description: '', image: '' });
    html = (await r.text()).slice(0, 3_000_000);
  } catch (e) {
    return json({ url: finalUrl, title: u.hostname, site: u.hostname, description: '', image: '', error: 'Could not reach the page' });
  }

  const abs = (s: string) => { try { return s ? new URL(s, finalUrl).toString() : ''; } catch { return ''; } };
  const out: Record<string, unknown> = {
    url: finalUrl,
    title: meta(html, 'og:title', 'twitter:title') || text(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '') || u.hostname,
    site: meta(html, 'og:site_name', 'application-name') || u.hostname.replace(/^www\./, ''),
    description: meta(html, 'og:description', 'twitter:description', 'description'),
    image: abs(meta(html, 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src')),
    author: meta(html, 'author', 'article:author', 'parsely-author'),
    published: meta(html, 'article:published_time', 'date', 'pubdate'),
  };

  if (body.clip) {
    const clean = html.replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|figure)[\s\S]*?<\/\1>/gi, '');
    const scope = clean.match(/<article[\s\S]*<\/article>/i)?.[0] || clean.match(/<main[\s\S]*<\/main>/i)?.[0] || clean;
    const blocks: { t: string; text: string }[] = [];
    const re = /<(p|h2|h3|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let m;
    while ((m = re.exec(scope)) && blocks.length < 400) {
      const t = text(m[2]); if (!t) continue;
      const tag = m[1].toLowerCase();
      if (tag === 'p' && t.length < 40 && !/[.!?”"]$/.test(t)) continue; // bylines, captions, buttons
      blocks.push({ t: tag === 'p' ? 'p' : tag === 'blockquote' ? 'q' : 'h', text: t });
    }
    out.blocks = blocks;
  }
  return json(out);
});
