// 📞 Telegram call when a tracked whale trades. User (24.10): "bi balina işlem yaparsa telegramdan aranmak istiyorum".
// Telegram bots cannot call, so CallMeBot (free, personal use) calls your Telegram account and reads the alert's first
// line aloud. One-time permission: send /start to @CallMeBot_txtbot. The main radar bot's /alarm uses the same
// service (WAKE_TELEGRAM_USER), so the same permission works here.
//
// Per wallet: the "📞 Ara" box in the edit window (off by default). Alerts of one wallet arriving close together
// (a TWAP, a chase) are merged into one call (CALL_MERGE_SEC, 20 s); after a call that wallet stays quiet for
// CALL_COOLDOWN_SEC (300 s) — the Telegram messages still arrive. Calls go one at a time (a call rings ~30 s).
// Who is called: the "Aranacak Telegram" field in Settings, else env CALL_TELEGRAM_USER / WAKE_TELEGRAM_USER.
const db = require('./db');

const URL = 'https://api.callmebot.com/start.php';
const MERGE_MS = Math.max(0, Number(process.env.CALL_MERGE_SEC || 20)) * 1000;
const COOLDOWN_MS = Math.max(0, Number(process.env.CALL_COOLDOWN_SEC || 300)) * 1000;
const GAP_MS = 45_000;                       // between two calls (the first one is still ringing before that)
const SPEECH_MAX = 256;                      // CallMeBot text limit

const pending = new Map();                   // address → { texts: [], timer }
const lastCall = new Map();                  // address → ms
const queue = [];
let busy = false, lastAt = 0;
const status = { calls: 0, lastAt: null, lastNote: null, lastError: null };

function user() {
  let u = String(db.getSettings().call_telegram_user || process.env.CALL_TELEGRAM_USER || process.env.WAKE_TELEGRAM_USER || '').trim();
  if (u && !u.startsWith('@') && !u.startsWith('+')) u = '@' + u;
  return u;
}

// alert first line → something a voice can read: no tags / emoji, "$1.21M" → "1.21 milyon dolar", "%12" → "yüzde 12"
function speech(text) {
  let s = String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, 've').replace(/&lt;|&gt;/g, ' ')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/\b[a-z]+:([A-Z0-9]+)/g, '$1')                                           // xyz:CRWD → CRWD
    .replace(/[−-]?\$([\d.,]+)\s*([KMB])\b/g, (m, n, u) => `${n.replace(',', '.')} ${{ K: 'bin', M: 'milyon', B: 'milyar' }[u]} dolar`)
    .replace(/\$([\d.,]+)/g, '$1 dolar')
    .replace(/%\s*([\d.,]+)/g, 'yüzde $1')
    .replace(/\(\s*0x[0-9a-f]+\s*\)|0x[0-9a-f]{6,}\S*/gi, ' ')                    // addresses are noise when read aloud
    .replace(/\+(?=\s*yüzde|\s*\d)/g, '')
    .replace(/[→·|]/g, ', ')
    .replace(/\s+/g, ' ').trim();
  s = 'Balina hareketi. ' + s;
  return s.length > SPEECH_MAX ? s.slice(0, SPEECH_MAX - 1) : s;
}

async function callNow(text) {
  const u = user();
  if (!u) { status.lastError = 'aranacak Telegram kullanıcısı yok (Ayarlar → Aranacak Telegram)'; return { ok: false, note: status.lastError }; }
  const qs = new URLSearchParams({ user: u, text: text.slice(0, SPEECH_MAX), lang: process.env.CALL_TTS_LANG || 'tr-TR-Standard-A', rpt: '2', cc: 'no' });
  try {
    const res = await fetch(`${URL}?${qs}`, { signal: AbortSignal.timeout(90_000) });
    const body = (await res.text()).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const low = body.toLowerCase();
    if (low.includes('not authori') || (low.includes('authorize') && low.includes('not'))) {
      status.lastError = 'izin yok: Telegram\'da @CallMeBot_txtbot\'a /start yaz';
      return { ok: false, note: status.lastError };
    }
    if (!res.ok) { status.lastError = `HTTP ${res.status}: ${body.slice(0, 120)}`; return { ok: false, note: status.lastError }; }
    status.calls++; status.lastAt = new Date().toISOString(); status.lastNote = body.slice(0, 160); status.lastError = null;
    return { ok: true, note: body.slice(0, 160) };
  } catch (err) {
    status.lastError = err.message;
    return { ok: false, note: err.message };
  }
}

async function drain() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const wait = lastAt + GAP_MS - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      const text = queue.shift();
      const r = await callNow(text);
      lastAt = Date.now();
      if (!r.ok) console.error('[Caller] arama başlamadı:', r.note);
    }
  } finally { busy = false; }
}

function flush(address) {
  const p = pending.get(address);
  pending.delete(address);
  if (!p || !p.texts.length) return;
  lastCall.set(address, Date.now());
  const more = p.texts.length > 1 ? ` Ve ${p.texts.length - 1} hareket daha.` : '';
  queue.push(speech(p.texts[0]) + more);
  if (queue.length > 5) queue.splice(0, queue.length - 5);
  drain();
}

// called from every alert (telegram.js) with the alert's first line
function ring(wallet, headline) {
  try {
    if (!wallet || Number(wallet.call_alert) !== 1) return;
    const a = String(wallet.address).toLowerCase();
    if (Date.now() - (lastCall.get(a) || 0) < COOLDOWN_MS && !pending.has(a)) return;
    const p = pending.get(a) || { texts: [], timer: null };
    p.texts.push(headline);
    if (!p.timer) p.timer = setTimeout(() => flush(a), MERGE_MS);
    pending.set(a, p);
  } catch (err) {
    console.error('[Caller]', err.message);
  }
}

module.exports = { ring, callNow, speech, user, status: () => ({ ...status, user: user() || null, queued: queue.length }) };
