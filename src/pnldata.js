// 📊 Wallet PnL data shared by the site (/portfolio, /coin-pnl) and the detailed /pnl report (Telegram).
const hyperliquid = require('./hyperliquid');
const telegram = require('./telegram');
const tracker = require('./tracker');

const portfolioCache = new Map();
const coinPnlCache = new Map();

// HL portfolio: day / week / month / allTime → {pnl: [[t, v]], av: [[t, v]], vlm}. Cached 60 s.
async function getPortfolio(address) {
  const hit = portfolioCache.get(address);
  if (hit && Date.now() - hit.at < 60_000) return hit.data;
  const raw = await hyperliquid.postHyperliquid({ type: 'portfolio', user: address });
  const periods = {};
  for (const [k, v] of Array.isArray(raw) ? raw : []) {
    if (!['day', 'week', 'month', 'allTime'].includes(k)) continue;
    const num = rows => (rows || []).map(([t, x]) => [Number(t), parseFloat(x)]).filter(r => Number.isFinite(r[1]));
    periods[k] = { pnl: num(v.pnlHistory), av: num(v.accountValueHistory), vlm: parseFloat(v.vlm || 0) || 0 };
  }
  const data = { periods, ratios: ratios(periods), ts: Date.now() };
  portfolioCache.set(address, { at: Date.now(), data });
  if (portfolioCache.size > 200) portfolioCache.delete(portfolioCache.keys().next().value);
  return data;
}

// PnL per coin over the last `days` (0 = all time) + track record from closing fills. Cached 5 min (all time 15 min).
async function getCoinPnl(address, days) {
  const key = `${address}|${days}`;
  const hit = coinPnlCache.get(key);
  if (hit && Date.now() - hit.at < (days ? 300_000 : 900_000)) return hit.data;
  const end = Date.now();
  const start = days ? end - days * 86_400_000 : 0;
  const by = new Map();
  let s = start, pages = 0, n = 0, oldest = null, capped = false;
  // track record: closing fills (closedPnl ≠ 0) counted as wins / losses, plus the biggest single win / loss
  const rec = { wins: 0, losses: 0, sumWin: 0, sumLoss: 0, best: null, worst: null };
  const closes = [];   // closing fills, for the newest-closes list
  while (pages < 10) {
    const fills = await hyperliquid.postHyperliquid({ type: 'userFillsByTime', user: address, startTime: s, endTime: end, aggregateByTime: true }, 15000);
    pages++;
    if (!Array.isArray(fills) || !fills.length) break;
    for (const f of fills) {
      n++;
      const t = Number(f.time) || 0;
      if (oldest === null || t < oldest) oldest = t;
      const c = by.get(f.coin) || { coin: f.coin, realized: 0, fees: 0, volume: 0, trades: 0 };
      c.realized += parseFloat(f.closedPnl || 0) || 0;
      c.fees += parseFloat(f.fee || 0) || 0;
      c.volume += Math.abs(parseFloat(f.sz || 0)) * (parseFloat(f.px || 0) || 0);
      c.trades += 1;
      // all-time pass also keeps the last 30 / 7 days per coin, so the /pnl report needs one fills download
      if (days === 0 && t >= end - 30 * 86_400_000) {
        const v = (parseFloat(f.closedPnl || 0) || 0) - (parseFloat(f.fee || 0) || 0);
        c.w30 = (c.w30 || 0) + v;
        if (t >= end - 7 * 86_400_000) c.w7 = (c.w7 || 0) + v;
      }
      by.set(f.coin, c);
      const cp = parseFloat(f.closedPnl || 0) || 0;
      if (cp > 0) { rec.wins++; rec.sumWin += cp; } else if (cp < 0) { rec.losses++; rec.sumLoss += cp; }
      if (cp) closes.push({ coin: f.coin, dir: f.dir || '', px: parseFloat(f.px) || 0, sz: parseFloat(f.sz) || 0, pnl: cp, fee: parseFloat(f.fee) || 0, time: t });
      if (cp > 0 && (!rec.best || cp > rec.best.pnl)) rec.best = { coin: f.coin, pnl: cp, time: t };
      if (cp < 0 && (!rec.worst || cp < rec.worst.pnl)) rec.worst = { coin: f.coin, pnl: cp, time: t };
    }
    if (fills.length < 2000) break;
    s = Math.max(...fills.map(f => Number(f.time) || 0)) + 1;
    if (pages === 10) capped = true;
  }
  // HL keeps only the ~10,000 most recent fills: near that count with the oldest fill well after `start`
  // means the older part of the period is not available (a quiet wallet just has no older fills).
  // All time: `start` is 0, so only the count tells.
  const truncated = capped || (oldest !== null && (days === 0 || oldest - start > 3_600_000) && n >= 9000);
  // funding per coin (500 rows per page, oldest first)
  let fs = start, fpages = 0, nFund = 0, fundingPartial = false;
  while (fpages < 10) {
    const rows = await hyperliquid.postHyperliquid({ type: 'userFunding', user: address, startTime: fs, endTime: end }, 15000);
    fpages++;
    if (!Array.isArray(rows) || !rows.length) break;
    for (const r of rows) {
      const d = r.delta || {};
      if (d.type !== 'funding' || !d.coin) continue;
      nFund++;
      const c = by.get(d.coin) || { coin: d.coin, realized: 0, fees: 0, volume: 0, trades: 0 };
      c.funding = (c.funding || 0) + (parseFloat(d.usdc || 0) || 0);
      by.set(d.coin, c);
    }
    if (rows.length < 500) break;
    fs = Math.max(...rows.map(r => Number(r.time) || 0)) + 1;
    if (fpages === 10) fundingPartial = true;   // 5000 hourly rows: older-first, so the newest part is missing
  }
  if (days === 0) {
    let ws = end - 30 * 86_400_000;
    for (let p = 0; p < 6; p++) {
      const rows = await hyperliquid.postHyperliquid({ type: 'userFunding', user: address, startTime: ws, endTime: end }, 15000);
      if (!Array.isArray(rows) || !rows.length) break;
      for (const r of rows) {
        const d = r.delta || {};
        if (d.type !== 'funding' || !d.coin) continue;
        const c = by.get(d.coin) || { coin: d.coin, realized: 0, fees: 0, volume: 0, trades: 0 };
        const u = parseFloat(d.usdc || 0) || 0;
        c.w30 = (c.w30 || 0) + u;
        if (Number(r.time) >= end - 7 * 86_400_000) c.w7 = (c.w7 || 0) + u;
        by.set(d.coin, c);
      }
      if (rows.length < 500) break;
      ws = Math.max(...rows.map(r => Number(r.time) || 0)) + 1;
    }
  }
  let portfolioPnl = null;
  try {
    const pk = { 0: 'allTime', 1: 'day', 7: 'week', 30: 'month' }[days];
    const h = ((await getPortfolio(address)).periods[pk] || {}).pnl || [];
    if (h.length) portfolioPnl = h[h.length - 1][1] - h[0][1];
  } catch (e) { /* reconciliation line is optional */ }
  const st = tracker.getCachedState(address) || await hyperliquid.getClearinghouseState(address).catch(() => null);
  for (const p of st?.positions || []) {
    const c = by.get(p.coin) || { coin: p.coin, realized: 0, fees: 0, volume: 0, trades: 0 };
    c.unrealized = (c.unrealized || 0) + (parseFloat(p.unrealizedPnl) || 0);
    by.set(p.coin, c);
  }
  const rows = [];
  for (const c of by.values()) {
    c.unrealized = c.unrealized || 0;
    c.funding = c.funding || 0;
    c.net = c.realized - c.fees + c.funding;            // period only; unrealized shown apart
    c.name = String(c.coin).startsWith('@') ? await telegram.spotName(c.coin) : c.coin;
    rows.push(c);
  }
  rows.sort((a, b) => a.net - b.net);
  for (const x of [rec.best, rec.worst]) if (x) x.name = String(x.coin).startsWith('@') ? await telegram.spotName(x.coin) : x.coin;
  const data = { days, rows, fills: n, fundingRows: nFund, fundingPartial, coveredFrom: oldest, truncated, portfolioPnl, record: rec, closes: closes.sort((a, b) => b.time - a.time).slice(0, 600),
                 ts: Date.now() };
  coinPnlCache.set(key, { at: Date.now(), data });
  if (coinPnlCache.size > 300) coinPnlCache.delete(coinPnlCache.keys().next().value);
  return data;
}

// 📐 Risk / return ratios from HL's portfolio curves (user 23.10: "win rate yanına sharpe ratio vs önemli ratioları").
// Daily return = that day's PnL change / account value at the start of the day (TSİ days, last 30 days, 'month'
// curve). Sharpe and Sortino are annualized with √365 (crypto trades every day), risk-free rate 0.
// Max drawdown: biggest peak-to-trough fall of the all-time PnL curve ($), and that fall as a share of the account
// value at the peak (%). Deposits / withdrawals do not move the PnL curve, so they do not count as drawdown.
const TZ = 'Europe/Istanbul';
function ratios(periods) {
  const out = { days: 0 };
  const m = periods.month;
  if (m && m.pnl && m.pnl.length >= 2) {
    const key = t => new Date(t).toLocaleDateString('en-CA', { timeZone: TZ });
    const avAt = t => { let v = null; for (const [ta, a] of m.av || []) { if (ta <= t) v = a; else break; } return v; };
    const lastOf = new Map();
    for (const [t, v] of m.pnl) lastOf.set(key(t), [t, v]);
    let prevT = m.pnl[0][0], prevV = m.pnl[0][1];
    const rets = [], pnls = [];
    for (const [, [t, v]] of lastOf) {
      const a = avAt(prevT), d = v - prevV;
      pnls.push(d);
      if (a && a > 0) rets.push(d / a);
      prevT = t; prevV = v;
    }
    out.days = pnls.length;
    out.greenDays = pnls.filter(x => x > 0).length;
    out.bestDay = pnls.length ? Math.max(...pnls) : null;
    out.worstDay = pnls.length ? Math.min(...pnls) : null;
    if (rets.length >= 5) {
      const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
      const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1));
      const dd = Math.sqrt(rets.reduce((s, x) => s + Math.min(0, x) ** 2, 0) / rets.length);
      out.meanDailyPct = mean * 100;
      out.dailyVolPct = sd * 100;
      out.sharpe = sd > 0 ? (mean / sd) * Math.sqrt(365) : null;
      out.sortino = dd > 0 ? (mean / dd) * Math.sqrt(365) : null;
    }
  }
  const at = periods.allTime;
  if (at && at.pnl && at.pnl.length >= 2) {
    let peak = at.pnl[0][1], peakT = at.pnl[0][0], best = { usd: 0 };
    for (const [t, v] of at.pnl) {
      if (v > peak) { peak = v; peakT = t; }
      if (peak - v > best.usd) best = { usd: peak - v, peakT, troughT: t };
    }
    if (best.usd > 0) {
      // % of the largest account value between peak and trough (deposits made later can not inflate it); never past −100%
      let avMax = null;
      for (const [t, a] of at.av || []) if (t >= best.peakT && t <= best.troughT && (avMax === null || a > avMax)) avMax = a;
      out.maxDdUsd = -best.usd;
      out.maxDdPct = avMax > 0 ? Math.max(-100, -(best.usd / avMax) * 100) : null;
      out.maxDdFrom = best.peakT; out.maxDdTo = best.troughT;
      const total = at.pnl[at.pnl.length - 1][1];
      out.recovery = total / best.usd;           // total PnL ÷ max drawdown ("recovery factor")
    } else out.maxDdUsd = 0;
  }
  return out;
}

module.exports = { getPortfolio, getCoinPnl, ratios };
