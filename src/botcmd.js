// 🤖 Telegram commands: /pnl → detailed PnL report as an album of images (src/pnlreport.js).
// User (23.10): "telegramdan bota /pnl yazınca yollasın tüm detayları" · "birden çok görsel şeklinde de atabilir".
//
// On by default (user 23.10: "defaulttan aç"); TELEGRAM_COMMANDS=0 turns it off. Reading commands means calling
// Telegram's getUpdates, and only ONE program may do that per bot token. If this token is also used by another bot
// program that reads commands, Telegram answers 409: a 409 in the first 3 minutes after start means exactly that,
// so this module steps aside at once (the other bot loses at most one poll); a later 409 (deploy overlap) is retried.
//
//   /pnl            one wallet tracked → its report; several → buttons to pick
//   /pnl 2          2nd wallet in the list · /pnl 0xabc… address prefix · /pnl propr  part of the name
//   /pnl … en       English report
// Only answered in known chats: the default chat, wallets' chats, and PNL_ALLOWED_CHAT_IDS (comma separated).
const config = require('./config');
const db = require('./db');
const pnlreport = require('./pnlreport');

const API = () => `https://api.telegram.org/bot${(process.env.TELEGRAM_BOT_TOKEN || '').trim()}`;
const status = { enabled: false, running: false, username: null, lastError: null, reports: 0 };
let stopped = false, offset = 0;
const queue = { tail: Promise.resolve(), n: 0 };   // one report at a time for all chats (HL rate limit), at most 3 waiting
let startedAt = 0;

async function call(method, body) {
  const res = await fetch(`${API()}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(method === 'getUpdates' ? 70_000 : 30_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) { const e = new Error(data.description || `HTTP ${res.status}`); e.code = data.error_code || res.status; throw e; }
  return data.result;
}

function allowedChats() {
  const s = new Set([process.env.TELEGRAM_DEFAULT_CHAT_ID, config.DEFAULT_MAIN_CHAT_ID, db.getSettings().telegram_default_chat_id]);
  for (const w of db.getWallets()) s.add(w.telegram_chat_id);
  for (const x of String(process.env.PNL_ALLOWED_CHAT_IDS || '').split(',')) s.add(x);
  return new Set([...s].map(x => String(x || '').trim()).filter(Boolean));
}

function pickWallet(wallets, words) {
  const q = words.join(' ').trim();
  if (!q) return null;
  if (/^\d+$/.test(q) && wallets[Number(q) - 1]) return wallets[Number(q) - 1];
  const ql = q.toLocaleLowerCase('tr-TR');
  if (ql.startsWith('0x')) return wallets.find(w => w.address.toLowerCase().startsWith(ql)) || null;
  return wallets.find(w => String(w.label || '').toLocaleLowerCase('tr-TR').includes(ql)) || null;
}

const shortUsd = v => {
  const a = Math.abs(v), s = v < 0 ? '−' : v > 0 ? '+' : '';
  return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(1)}K` : `${s}$${a.toFixed(0)}`;
};
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function sendReport(chatId, wallet, lang, replyTo) {
  if (queue.n >= 3) {
    return call('sendMessage', { chat_id: chatId, text: '⏳ Sırada zaten 3 rapor var, biraz sonra tekrar dene.' }).catch(() => {});
  }
  queue.n++;
  queue.tail = queue.tail.then(() => buildAndSend(chatId, wallet, lang, replyTo)).finally(() => { queue.n--; });
  return queue.tail;
}

async function buildAndSend(chatId, wallet, lang, replyTo) {
  try {
    await call('sendChatAction', { chat_id: chatId, action: 'upload_photo' }).catch(() => {});
    const { pages, data } = await pnlreport.render(wallet, { lang });
    const last = p => (p && p.pnl && p.pnl.length >= 2 ? p.pnl[p.pnl.length - 1][1] : null);
    const at = last(data.periods.allTime), m = last(data.periods.month), w = last(data.periods.week);
    const q = data.ratios || {};
    const en = lang === 'en';
    const caption = `📊 <b>${esc(wallet.label || wallet.address)}</b> · ${en ? 'detailed PnL' : 'detaylı K/Z'}\n`
      + `${en ? 'All time' : 'Tüm zaman'} ${at === null ? '—' : shortUsd(at)} · 30${en ? 'd' : 'g'} ${m === null ? '—' : shortUsd(m)} · 7${en ? 'd' : 'g'} ${w === null ? '—' : shortUsd(w)}`
      + (q.sharpe !== undefined && q.sharpe !== null ? ` · Sharpe ${q.sharpe.toFixed(2)}` : '')
      + `\n<code>${wallet.address}</code>`;
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('media', JSON.stringify(pages.map((_, i) => ({ type: 'photo', media: `attach://p${i + 1}`, ...(i ? {} : { caption, parse_mode: 'HTML' }) }))));
    if (replyTo) form.append('reply_parameters', JSON.stringify({ message_id: replyTo, allow_sending_without_reply: true }));
    pages.forEach((b, i) => form.append(`p${i + 1}`, new Blob([b], { type: 'image/png' }), `pnl_${i + 1}.png`));
    const res = await fetch(`${API()}/sendMediaGroup`, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
    const out = await res.json().catch(() => ({}));
    if (!out.ok) throw new Error(out.description || `HTTP ${res.status}`);
    status.reports++;
  } catch (err) {
    console.error('[BotCmd] /pnl hatası:', err.message);
    await call('sendMessage', { chat_id: chatId, text: `⚠️ /pnl hazırlanamadı: ${err.message}` }).catch(() => {});
  }
}

async function onMessage(msg) {
  const text = String(msg.text || '').trim();
  const m = /^\/pnl(?:@(\w+))?(?:\s+(.*))?$/i.exec(text);
  if (!m) return;
  if (m[1] && status.username && m[1].toLowerCase() !== status.username.toLowerCase()) return;   // meant for another bot
  const chatId = msg.chat.id;
  if (!allowedChats().has(String(chatId))) return;
  if (Number(msg.date) * 1000 < startedAt - 60_000) return;   // backlog from before this start: do not answer old /pnl
  const words = String(m[2] || '').split(/\s+/).filter(Boolean);
  const lang = words.some(x => x.toLowerCase() === 'en') ? 'en' : 'tr';
  const rest = words.filter(x => !['en', 'tr'].includes(x.toLowerCase()));
  const wallets = db.getWallets();
  if (!wallets.length) return call('sendMessage', { chat_id: chatId, text: 'Takip edilen cüzdan yok.' });
  let w = pickWallet(wallets, rest);
  if (!w && !rest.length && wallets.length === 1) w = wallets[0];
  if (w) return sendReport(chatId, w, lang, msg.message_id);
  // several wallets (or no match): buttons
  const kb = wallets.slice(0, 30).map((x, i) => [{ text: `${i + 1}. ${x.label || x.address.slice(0, 10)}`, callback_data: `pnl:${x.address.toLowerCase()}:${lang}` }]);
  return call('sendMessage', {
    chat_id: chatId, reply_markup: { inline_keyboard: kb },
    text: rest.length ? `"${rest.join(' ')}" bulunamadı. Hangi cüzdan?` : 'Hangi cüzdanın detaylı K/Z raporu?',
  });
}

async function onCallback(cq) {
  const m = /^pnl:(0x[0-9a-f]{40}):(tr|en)$/.exec(String(cq.data || ''));
  if (!m) return;
  const chatId = cq.message && cq.message.chat && cq.message.chat.id;
  if (!chatId || !allowedChats().has(String(chatId))) return call('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
  const w = db.getWallets().find(x => x.address.toLowerCase() === m[1]);
  await call('answerCallbackQuery', { callback_query_id: cq.id, text: w ? (m[2] === 'en' ? 'Preparing…' : 'Hazırlanıyor…') : 'Cüzdan bulunamadı' }).catch(() => {});
  if (w) await sendReport(chatId, w, m[2]);
}

async function loop() {
  status.running = true;
  let conflicts = 0;
  while (!stopped) {
    try {
      const ups = await call('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] });
      for (const u of ups) {
        offset = u.update_id + 1;
        if (u.message) onMessage(u.message).catch(e => console.error('[BotCmd]', e.message));
        else if (u.callback_query) onCallback(u.callback_query).catch(e => console.error('[BotCmd]', e.message));
      }
      status.lastError = null;
      conflicts = 0;
    } catch (err) {
      status.lastError = err.message;
      if (err.code === 409) {
        // another program reads this bot's updates (or a webhook is set). A short overlap during a redeploy also gives
        // 409, so wait and retry a few times; if it keeps happening, step aside instead of fighting the other program.
        conflicts++;
        if (Date.now() - startedAt < 180_000) {
          status.lastError = '409: bu bot token\'ı başka bir programda da komut okuyor; /pnl dinleme durduruldu (TELEGRAM_COMMANDS=0 ile kapatılabilir)';
          console.error('[BotCmd]', status.lastError);
          break;
        }
        console.error(`[BotCmd] Telegram 409 (${conflicts}/5): bu bot token'ını başka bir program da okuyor.`, err.message);
        if (conflicts >= 5) { status.lastError = '409: bu token başka bir programda da komut okuyor; /pnl dinleme durduruldu'; break; }
        await new Promise(r => setTimeout(r, 60_000));
        continue;
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  status.running = false;
}

async function start() {
  status.enabled = process.env.TELEGRAM_COMMANDS !== '0' && !!(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!status.enabled) return;
  startedAt = Date.now();
  try { status.username = (await call('getMe', {})).username || null; } catch (e) { status.lastError = e.message; }
  console.log(`[BotCmd] /pnl komutu dinleniyor (@${status.username || '?'})`);
  loop();
}
function stop() { stopped = true; }

module.exports = { start, stop, status: () => ({ ...status }), pickWallet };
