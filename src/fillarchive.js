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
  let o = null, orders = 0, vol = 0;
  const flush = () => {
    if (!o) return;
    const d = new Date(o.t + TZ_OFF);
    const h = d.getUTCHours(), w = (d.getUTCDay() + 6) % 7;   // 0 = Monday
    for (const c of [grid[w][h], byHour[h], byDow[w]]) { c.n++; c.v += o.v; }
    daysSeen.add(d.toISOString().slice(0, 10));
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
  return {
    address: a, from: rows.length ? rows[0].time : null, to: rows.length ? rows[rows.length - 1].time : null,
    fills: rows.length, orders, volume: vol, activeDays: daysSeen.size,
    grid, byHour, byDow, core: ranges(core), coreShare: vol ? acc / vol : 0, quiet: ranges(quiet),
  };
}

module.exports = { start, stop, run, archiveWallet, hours, ranges, status: () => ({ ...status }) };
