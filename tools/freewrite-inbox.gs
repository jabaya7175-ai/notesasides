/**
 * Notes & Asides — Freewrite email inbox
 *
 * Runs inside the Gmail account that receives your drafts. Every minute it
 * picks up unread mail, sends each draft to the Studio (Freewrite library +
 * a draft post), marks it read and labels it "Imported".
 *
 * Install: script.google.com → New project → paste this file → fill in INBOX_KEY
 * → run `setup` once and allow access. Run `checkInbox` any time to import now.
 */
const SUPABASE_URL = 'https://cxsyqbvcqkuiidmcqrxo.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_TrZODnGJTHB6gggwhxdYtA_JhpgUX5T';
const INBOX_KEY = 'PASTE-INBOX-KEY-HERE';
// Only import mail from these senders (lowercase, partial matches allowed).
// Leave empty to import everything that arrives at this address.
const ALLOWED_SENDERS = [];

function setup() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkInbox').timeBased().everyMinutes(1).create();
  checkInbox();
}

function checkInbox() {
  const label = GmailApp.getUserLabelByName('Imported') || GmailApp.createLabel('Imported');
  const threads = GmailApp.search('in:inbox is:unread', 0, 20);
  threads.forEach((thread) => {
    thread.getMessages().forEach((m) => {
      if (!m.isUnread()) return;
      const from = m.getFrom();
      if (ALLOWED_SENDERS.length && !ALLOWED_SENDERS.some((s) => from.toLowerCase().includes(s))) return;
      const draft = readDraft(m);
      if (!draft.markdown.trim()) { m.markRead(); return; }
      const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/freewrite_inbox', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { apikey: PUBLISHABLE_KEY },
        payload: JSON.stringify({ p_key: INBOX_KEY, p_title: draft.title, p_markdown: draft.markdown, p_html: mdToHtml(draft.markdown).html, p_from: from }),
      });
      if (res.getResponseCode() >= 300) { console.error('Import failed: ' + res.getContentText()); return; } // stays unread; retried next run
      m.markRead();
      thread.addLabel(label);
    });
  });
}

// A .md/.txt attachment wins; otherwise the plain-text body. Title: the first
// "# " heading, else the subject, else the first line.
function readDraft(m) {
  let text = '';
  const att = m.getAttachments().find((a) => /\.(md|markdown|txt)$/i.test(a.getName()) || /^text\//.test(a.getContentType()));
  if (att) text = att.getDataAsString('UTF-8');
  else text = m.getPlainBody() || '';
  text = text.replace(/\r/g, '').replace(/\n-- ?\n[\s\S]*$/, '').replace(/\n+Sent (from|with) [^\n]*\s*$/i, '').trim();
  // Freewrite drafts often use single returns between paragraphs.
  if (!/\n\s*\n/.test(text)) text = text.replace(/\n/g, '\n\n');
  const h = text.match(/^#\s+(.+)$/m);
  const subject = m.getSubject().replace(/^(fwd?|re):\s*/i, '').trim();
  const title = h ? h[1].trim() : subject || (text.split('\n')[0] || 'Untitled').slice(0, 120);
  if (!h && title && !subject) text = text.split('\n').slice(1).join('\n').trim();
  return { title, markdown: text };
}

// Same converter the Studio uses.
function mdToHtml(md) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>').replace(/\[\^(\w+)\]/g, '<sup>$1</sup>');
  let title = '';
  const html = String(md).split(/\n{2,}/).map((b) => b.trim()).filter(Boolean).map((b) => {
    if (/^# /.test(b) && !title) { title = b.slice(2).trim(); return ''; }
    if (/^#{2,3} /.test(b)) return '<h3>' + inline(b.replace(/^#+ /, '')) + '</h3>';
    if (/^> /.test(b)) return '<blockquote>' + inline(b.replace(/^> ?/gm, ' ').trim()) + '</blockquote>';
    return '<p>' + inline(b.replace(/\n/g, ' ')) + '</p>';
  }).join('');
  return { title, html };
}
