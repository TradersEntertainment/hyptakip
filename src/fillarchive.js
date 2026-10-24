// ⏰ Fill archive + trading-hours map. User (24.10): "takip ettiğimiz şu balinanın genelde hangi saatler arasında işlem
// yaptığını bulmamız lazım, belki genel bir özellik olarak da ekleyebiliriz".
// HL serves only the last ~10,000 fills (for a very active wallet: ~4 days), so every ARCHIVE_MIN minutes the new fills
// of each tracked wallet are copied into the `fills` table (first run: whatever HL still has). The map is built from
// that table: orders = fills of the same coin and direction within 2 min; hours in TSİ (UTC+3).
const db = require('./db');
const hyperliquid = require('./hyperliquid');

const EVERY_MS = Math.max(1, Number(process.env.ARCHIVE_MIN || 5)) * 60_000;
const KEEP_DAYS = Math.max(7, Number(process.env.ARCHIVE_KEEP_DAYS || 180));
const TZ_OFF = 3 * 3600_000;   // TSİ, no DST
const status = { lastRun: null, lastError: null, inserted: 0 };
let timer = null;

async function archiveWallet(address) {
  const a = address.toLowerCase();
  const d = db.getDb();
  const last = d.prepare('SELECT MAX(time) t FROM fills WHERE address = ?').get(a).t || 0;
  const ins = d.prepare('INSERT OR IGNORE INTO fills (address, tid, time, coin, dir, px, sz, closed_pnl, fee) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  let start = last ? last + 1 : 0, n = 0;
  for (let page = 0; page < 10; page++) {
    const fills = await hyperliquid.postHyperliquid({ type: 'userFillsByTime', user: a, startTime: start, aggregateByTime: true }, 20000);
    if (!Array.isArray(fills) || !fills.length) break;
    d.transaction(rows => {
      for (const f of rows) {
        const r = ins.run(a, Number(f.tid) || Number(f.time), Number(f.time), f.coin, f.dir || f.side, parseFloat(f.px) || 0, parseFloat(f.sz) || 0,
                          parseFloat(f.closedPnl) || 0, parseFloat(f.fee) || 0);
        n += r.changes;
      }
    })(fills);
    if (fills.length < 2000) break;
    start = Math.max(...fills.map(f => Number(f.time) || 0)) + 1;
  }
  return n;
}

async function run() {
  for (const w of db.getWallets()) {
    try { status.inserted += await archiveWallet(w.address); status.lastError = null; }
    catch (err) { status.lastError = `${w.address.slice(0, 8)}: ${err.message}`; }
  }
  try { db.getDb().prepare('DELETE FROM fills WHERE time < ?').run(Date.now() - KEEP_DAYS * 86_400_000); } catch (e) { /* ignore */ }
  status.lastRun = new Date().toISOString();
}

function start() {
  if (timer) return;
  const loop = async () => { try { await run(); } finally { timer = setTimeout(loop, EVERY_MS); } };
  timer = setTimeout(loop, 20_000);
}
function stop() { if (timer) clearTimeout(timer); timer = null; }

// hour ranges covering most of the volume, e.g. [1,2,4,14,16,17] → "01–03, 04–05, 14–15, 16–18"
function ranges(hours) {
  const hs = [...hours].sort((a, b) => a - b), out = [];
  for (const h of hs) {
    const r = out[out.length - 1];
    if (r && h === r[1] + 1) r[1] = h; else out.push([h, h]);
  }
  // 23 and 00 belong together
  if (out.length > 1 && out[0][0] === 0 && out[out.length - 1][1] === 23) { const f = out.shift(); out[out.length - 1][1] = f[1] + 24; }
  const p = h => String(h % 24).padStart(2, '0');
  return out.map(([a, b]) => `${p(a)}:00–${p(b + 1)}:00`);
}

// trading-hours map of one wallet over the last `days` (0 = everything archived)
function hours(address, days = 0) {
  const a = address.toLowerCase();
  const since = days ? Date.now() - days * 86_400_000 : 0;
  const rows = db.getDb().prepare('SELECT time, coin, dir, px, sz FROM fills WHERE address = ? AND time >= ? ORDER BY time').all(a, since);
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ n: 0, v: 0 })));
  const byHour = Array.from({ length: 24 }, () => ({ n: 0, v: 0 })), byDow = Array.from({ length: 7 }, () => ({ n: 0, v: 0 }));
  const daysSeen = new Set();
  const slots = new Set();                                   // "YYYY-MM-DD|h" with at least one order
  let o = null, orders = 0, vol = 0;
  const flush = () => {
    if (!o) return;
    const d = new Date(o.t + TZ_OFF);
    const h = d.getUTCHours(), w = (d.getUTCDay() + 6) % 7;   // 0 = Monday
    for (const c of [grid[w][h], byHour[h], byDow[w]]) { c.n++; c.v += o.v; }
    daysSeen.add(d.toISOString().slice(0, 10));
    slots.add(`${d.toISOString().slice(0, 10)}|${h}`);
    orders++; vol += o.v;
  };
  for (const r of rows) {
    const v = r.px * r.sz;
    if (o && o.coin === r.coin && o.dir === r.dir && r.time - o.last <= 120_000) { o.v += v; o.last = r.time; }
    else { flush(); o = { coin: r.coin, dir: r.dir, t: r.time, last: r.time, v }; }
  }
  flush();
  // smallest set of hours holding 80% of the volume
  const order = byHour.map((c, h) => ({ h, v: c.v })).sort((x, y) => y.v - x.v);
  const core = [];
  let acc = 0;
  for (const x of order) { if (!vol || acc >= vol * 0.8 || !x.v) break; core.push(x.h); acc += x.v; }
  const quiet = byHour.map((c, h) => ({ h, v: c.v })).filter(x => vol && x.v / vol < 0.005).map(x => x.h);
  const rest = restWindow(rows.length ? rows[0].time : null, rows.length ? rows[rows.length - 1].time : null, slots, byHour, vol);
  return {
    rest,
    address: a, from: rows.length ? rows[0].time : null, to: rows.length ? rows[rows.length - 1].time : null,
    fills: rows.length, orders, volume: vol, activeDays: daysSeen.size,
    grid, byHour, byDow, core: ranges(core), coreShare: vol ? acc / vol : 0, quiet: ranges(quiet),
  };
}

// 😴 Estimated rest (sleep) window — user (24.10): "tahmini hangi saatlerde uyuduğunu da sitede göster, tüm cüzdanlara
// uygun bir formül bulup". The longest unbroken circular stretch of hours (TSİ, 4–16 h) that holds at most 3% of the
// wallet's orders and 3% of its volume is the rest window. Its middle is taken as ~03:00 local time to guess a time zone. Confidence
// from the number of covered days and how many days the window was really empty. Measured, not known: bots and
// other wallets can trade while the owner sleeps, so it is shown as "tahmini".
const ZONES = [
  [-8, 'ABD batı yakası (LA)'], [-7, 'ABD batı / dağ'], [-6, 'ABD orta'], [-5, 'ABD doğu yakası (New York)'],
  [-4, 'ABD doğu yakası (New York)'], [-3, 'Güney Amerika (Brezilya / Arjantin)'], [0, 'Londra / Batı Avrupa'],
  [1, 'Orta Avrupa'], [2, 'Doğu Avrupa'], [3, 'Türkiye / Moskova / Körfez'], [4, 'Dubai'], [5, 'Pakistan'],
  [6, 'Orta Asya'], [7, 'Tayland / Vietnam'], [8, 'Singapur / Hong Kong / Çin'], [9, 'Kore / Japonya'], [10, 'Doğu Avustralya'],
];
function restWindow(from, to, slots, byHour, vol) {
  if (!from || !to || !vol) return null;
  const H = 3600_000;
  const covered = Array(24).fill(0), active = Array(24).fill(0);
  for (let t = Math.ceil(from / H) * H; t + H <= to; t += H) {      // hour slots fully inside the archived range
    const d = new Date(t + TZ_OFF), h = d.getUTCHours();
    covered[h]++;
    if (slots.has(`${d.toISOString().slice(0, 10)}|${h}`)) active[h]++;
  }
  const days = Math.min(...covered);
  if (days < 2) return { status: 'az', days };
  // longest circular window (4–16 h) holding ≤ 3% of the orders AND ≤ 3% of the volume (a stray order or two does not
  // break it); among equally long windows the emptiest one
  const totN = byHour.reduce((t, c) => t + c.n, 0);
  let best = { start: -1, len: 0, share: 1 };
  for (let len = 16; len >= 4 && best.len === 0; len--) {
    for (let st = 0; st < 24; st++) {
      let n = 0, v = 0;
      for (let i = 0; i < len; i++) { const c = byHour[(st + i) % 24]; n += c.n; v += c.v; }
      const sh = Math.max(n / totN, v / vol);
      if (n / totN <= 0.03 && v / vol <= 0.03 && (best.len === 0 || sh < best.share)) best = { start: st, len, share: sh };
    }
  }
  if (best.len < 4) return { status: 'yok', days, note: 'günün her saatinde işlem var, 4 saatten uzun sessiz aralık yok (otomatik işlem olabilir)' };
  const hrs = Array.from({ length: best.len }, (_, i) => (best.start + i) % 24);
  // how many covered days had no order at all in the window
  const empty = (() => {
    const perDay = new Map();
    for (let t = Math.ceil(from / H) * H; t + H <= to; t += H) {
      const d = new Date(t + TZ_OFF), h = d.getUTCHours();
      if (!hrs.includes(h)) continue;
      // the window may cross midnight: count it on the day it starts
      const startDay = new Date(t + TZ_OFF - ((h - best.start + 24) % 24) * H).toISOString().slice(0, 10);
      const e = perDay.get(startDay) || { n: 0, act: false };
      e.n++; if (slots.has(`${d.toISOString().slice(0, 10)}|${h}`)) e.act = true;
      perDay.set(startDay, e);
    }
    const full = [...perDay.values()].filter(e => e.n === best.len);
    return { days: full.length, empty: full.filter(e => !e.act).length };
  })();
  const mid = (best.start + best.len / 2) % 24;                     // TSİ hour of the window's middle
  // window middle ≈ 03:00 local time → UTC offset = 3 − (mid − 3); sleep habits vary by ±1 h, so zones within 1 h of
  // that are all named (e.g. −3.5 → "ABD doğu yakası (New York) / Güney Amerika")
  let raw = 6 - mid;
  while (raw > 12) raw -= 24;
  while (raw < -11) raw += 24;
  const near = ZONES.filter(z => Math.abs(z[0] - raw) <= 1).sort((x, y) => Math.abs(x[0] - raw) - Math.abs(y[0] - raw));
  const names = [...new Set(near.map(z => z[1]))].slice(0, 2);
  const zone = names.length ? names.join(' / ') : 'bilinmiyor';
  const off = Math.round(raw);
  const share = empty.days ? empty.empty / empty.days : 0;
  const conf = days >= 14 && share >= 0.8 ? 'yüksek' : days >= 7 && share >= 0.6 ? 'orta' : 'düşük';
  const p = h => String(((h % 24) + 24) % 24).padStart(2, '0') + ':00';
  const ny = h => p(h - 7);                                        // New York: EDT (UTC−4) = TSİ − 7
  return {
    status: 'ok', days, start: best.start, hours: best.len, label: `${p(best.start)}–${p(best.start + best.len)}`,
    ny: `${ny(best.start)}–${ny(best.start + best.len)}`, utcOffset: off, zone, confidence: conf,
    emptyDays: empty.empty, windowDays: empty.days,
  };
}

// 🪙 Tickers a wallet trades (user 24.10: "trade ettiği tickerlar diye bir kısım koyar mısın her balina için"), from the
// archive: per coin volume, orders (fills of one coin + direction within 2 min), buy / sell volume, realized − fee,
// first / last trade. Buy = Open Long, Close Short, Buy (spot); sell = the rest.
function tickers(address, days = 0) {
  const a = address.toLowerCase();
  const since = days ? Date.now() - days * 86_400_000 : 0;
  const rows = db.getDb().prepare('SELECT time, coin, dir, px, sz, closed_pnl, fee FROM fills WHERE address = ? AND time >= ? ORDER BY time').all(a, since);
  const by = new Map();
  let total = 0, prev = null;
  for (const r of rows) {
    const v = r.px * r.sz;
    total += v;
    const c = by.get(r.coin) || { coin: r.coin, volume: 0, buy: 0, sell: 0, orders: 0, fills: 0, net: 0, first: r.time, last: r.time };
    c.volume += v; c.fills++; c.net += (r.closed_pnl || 0) - (r.fee || 0); c.last = r.time;
    if (/Open Long|Close Short|^Buy|^B$/i.test(r.dir || '')) c.buy += v; else c.sell += v;
    if (!(prev && prev.coin === r.coin && prev.dir === r.dir && r.time - prev.time <= 120_000)) c.orders++;
    prev = r;
    by.set(r.coin, c);
  }
  const list = [...by.values()].sort((x, y) => y.volume - x.volume).map(c => ({ ...c, share: total ? c.volume / total : 0 }));
  return { address: a, total, coins: list, from: rows.length ? rows[0].time : null, to: rows.length ? rows[rows.length - 1].time : null };
}

module.exports = { tickers, start, stop, run, archiveWallet, hours, ranges, status: () => ({ ...status }) };
