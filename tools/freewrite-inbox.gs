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
// Only Freewrite drafts (sent by Postbox) are imported; other mail is left alone.
const SENDER = 'postbox@getfreewrite.com';

function setup() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkInbox').timeBased().everyMinutes(1).create();
  checkInbox();
}

function checkInbox() {
  const label = GmailApp.getUserLabelByName('Imported') || GmailApp.createLabel('Imported');
  // Not limited to the inbox: a Gmail filter archives these so they don't notify.
  const threads = GmailApp.search('from:' + SENDER + ' is:unread', 0, 20);
  threads.forEach((thread) => {
    thread.getMessages().forEach((m) => {
      if (!m.isUnread()) return;
      const from = m.getFrom();
      if (!from.toLowerCase().includes(SENDER)) return;
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

// Postbox emails: the subject is the draft title; the body repeats the title,
// then the text (every return on the Freewrite is a new paragraph), then a dashed
// line and "Sent from …'s Freewrite". A .md/.txt attachment, if any, wins.
function readDraft(m) {
  let text = '';
  const att = m.getAttachments().find((a) => /\.(md|markdown|txt)$/i.test(a.getName()) || /^text\//.test(a.getContentType()));
  if (att) text = att.getDataAsString('UTF-8');
  else text = m.getPlainBody() || '';
  text = text.replace(/\r/g, '')
    .replace(/\n[ \t]*-{5,}[ \t]*\n[\s\S]*$/, '')                       // footer after the dashed line
    .replace(/^.*Sent (from|with) .*Freewrite.*$/gim, '')
    .replace(/^Heads up: this copy last synced[\s\S]*?(\n\s*\n|$)/im, '')
    .trim();
  const subject = m.getSubject().replace(/^(fwd?|re):\s*/i, '').trim();
  let lines = text.split('\n');
  const h = lines[0] && lines[0].match(/^#\s+(.+)$/);
  const title = h ? h[1].trim() : subject || (lines[0] || 'Untitled').slice(0, 120);
  if (h || (lines[0] || '').trim() === title || (!subject && lines.length)) lines.shift();
  const markdown = lines.map((l) => l.trim()).filter(Boolean).join('\n\n');
  return { title, markdown };
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
