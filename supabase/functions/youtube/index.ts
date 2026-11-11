// youtube: video details and transcripts for the Drafting Board (Studio admins only).
// POST { action: 'meta' | 'transcript', id }
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
const clean = (s: string) => decode(decode(s.replace(/<[^>]+>/g, ''))).replace(/\s+/g, ' ').trim();

async function player(id: string, client: { clientName: string; clientVersion: string; [k: string]: unknown }, ua: string, key: string) {
  const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${key}&prettyPrint=false`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9' },
    body: JSON.stringify({ context: { client: { hl: 'en', gl: 'US', ...client } }, videoId: id }),
  });
  return r.ok ? r.json() : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const auth = req.headers.get('Authorization') || '';
  const ok = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/is_admin`, {
    method: 'POST', headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY')!, Authorization: auth, 'Content-Type': 'application/json' }, body: '{}',
  }).then((r) => r.ok ? r.json() : false).catch(() => false);
  if (ok !== true) return json({ error: 'not allowed' }, 403);

  let body: { action?: string; id?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad request' }, 400); }
  const id = String(body.id || '');
  if (!/^[\w-]{11}$/.test(id)) return json({ error: 'Not a YouTube video id' }, 400);

  if (body.action === 'meta') {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`).catch(() => null);
    const d = r && r.ok ? await r.json() : {};
    return json({ id, title: d.title || 'YouTube video', channel: d.author_name || '', thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
  }

  // Transcript: find the caption tracks, prefer English (human-made over automatic), fetch the text.
  let key = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', title = '';
  try {
    const html = await (await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' } })).text();
    key = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] || key;
    title = decode(html.match(/<meta name="title" content="([^"]*)"/)?.[1] || '');
  } catch { /* use the default key */ }
  const clients = [
    [{ clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34 }, 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip'],
    [{ clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2' }, 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)'],
    [{ clientName: 'WEB', clientVersion: '2.20250312.04.00' }, UA],
    [{ clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', thirdParty: { embedUrl: 'https://www.youtube.com/' } } as any, UA],
    [{ clientName: 'WEB_EMBEDDED_PLAYER', clientVersion: '1.20250310.01.00' }, UA],
    [{ clientName: 'MWEB', clientVersion: '2.20250311.03.00' }, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1'],
  ] as const;
  let tracks: any[] = [], why = '';
  for (const [c, ua] of clients) {
    const pj = await player(id, c as any, ua, key).catch(() => null);
    tracks = pj?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (!title) title = pj?.videoDetails?.title || '';
    if (tracks.length) break;
    why = pj?.playabilityStatus?.reason || pj?.playabilityStatus?.status || why;
  }
  if (!tracks.length) {
    for (const lang of ['en', 'en-US', 'en-GB']) {
      const x = await fetch(`https://www.youtube.com/api/timedtext?v=${id}&lang=${lang}`, { headers: { 'User-Agent': UA } }).then((r) => r.ok ? r.text() : '').catch(() => '');
      if (x.includes('<text')) { tracks = [{ baseUrl: `https://www.youtube.com/api/timedtext?v=${id}&lang=${lang}`, languageCode: lang }]; break; }
    }
  }
  if (!tracks.length) return json({ error: why ? `No transcript available (${why})` : 'This video has no captions to transcribe.' });
  const en = (t: any) => /^en/.test(t.languageCode || '');
  const track = tracks.find((t) => en(t) && t.kind !== 'asr') || tracks.find(en) || tracks.find((t) => t.kind !== 'asr') || tracks[0];
  const xml = await (await fetch(String(track.baseUrl).replace(/&fmt=[^&]+/, ''), { headers: { 'User-Agent': UA } })).text();
  const lines: { s: number; t: string }[] = [];
  let m; const reText = /<text start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  while ((m = reText.exec(xml))) { const t = clean(m[2]); if (t) lines.push({ s: +m[1], t }); }
  if (!lines.length) { const reP = /<p t="(\d+)"[^>]*>([\s\S]*?)<\/p>/g; while ((m = reP.exec(xml))) { const t = clean(m[2]); if (t) lines.push({ s: +m[1] / 1000, t }); } }
  if (!lines.length) return json({ error: 'YouTube returned an empty transcript for this video.' });
  return json({ id, title, lang: track.languageCode, auto: track.kind === 'asr', lines });
});
