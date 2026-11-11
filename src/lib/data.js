// Read published posts through Supabase's REST API. Used at build time and in
// the browser; row-level security limits this key to published posts.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
const POST_FIELDS = 'id,slug,title,subtitle,kind,body_html,notes,published_at,updated_at,paragraph_style,align,drop_cap,cover_url,cover_caption';

async function get(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: H });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function listPosts() {
  try {
    return await get(`posts?select=id,slug,title,subtitle,kind,published_at,cover_url,post_books(position,books(title))&status=eq.published&order=published_at.desc`);
  } catch (e) {
    console.warn('[notes-and-asides] could not load posts:', e.message);
    return [];
  }
}

export async function getPost(slug) {
  const rows = await get(`posts?select=${POST_FIELDS},post_books(position,books(*))&slug=eq.${encodeURIComponent(slug)}&status=eq.published&limit=1`);
  return rows[0] ? withBooks(rows[0]) : null;
}

export function withBooks(row) {
  const books = (row.post_books || []).sort((a, b) => a.position - b.position).map((pb) => pb.books).filter(Boolean);
  return { post: row, books };
}

export async function listFullPosts() {
  try {
    const rows = await get(`posts?select=${POST_FIELDS},post_books(position,books(*))&status=eq.published&order=published_at.desc`);
    return rows.map(withBooks);
  } catch (e) {
    console.warn('[notes-and-asides] could not load posts:', e.message);
    return [];
  }
}

export async function subscribe(email) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/subscribe`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_email: email }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
