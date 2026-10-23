/**
 * 📝 Live order alerts for wallets with "Emirleri de bildir" (track_orders = 1).
 *
 * User (22.10): "bazılarının emirlerinin de gelmesini istiyorum çünkü chase limit atıyor daha ilk emri dolmadan
 * yetişirsem daha hızlıdan alırım". Position polling only sees an order after it fills.
 *
 * Why WebSocket and not polling: frontendOpenOrders has weight 20 and must be asked per perp dex (main + every
 * HIP-3 dex), so polling every few seconds would exceed HL's 1200/min IP budget with a single wallet (position
 * polling already uses most of it). HL's `orderUpdates` stream is free, instant and covers every dex and spot
 * (checked live: BTC, xyz:NVDA, @142 on one subscription). Its messages do not say which user they belong to,
 * so each wallet gets its own socket. HL allows at most 10 users on user streams per IP → MAX_USERS.
 *
 * Chase limits cancel and re-post the same order many times: only the first new order per (coin, side) is sent,
 * later ones are silent while the chase keeps going (each new order extends the quiet window, ORDER_CHASE_SEC).
 */
const db = require('./db');
const telegram = require('./telegram');

const URL = process.env.HYPERLIQUID_WS_URL || 'wss://api.hyperliquid.xyz/ws';
const MAX_USERS = 10;
const CHASE_SEC = parseInt(process.env.ORDER_CHASE_SEC || '600', 10);
const MIN_USD = parseFloat(process.env.ORDER_ALERT_MIN_USD || '1000');
const PING_MS = 50_000;

const conns = new Map();          // address → { ws, timer, backoff, since, closed }
const lastAlert = new Map();      // address|coin|side → ms of the last order seen in this chase
let stats = { sent: 0, quiet: 0, small: 0, reconnects: 0 };

function wanted() {
  return db.getActiveWallets()
    .filter(w => Number(w.track_orders) === 1)
    .slice(0, MAX_USERS);
}

/** Decide alert / quiet for one orderUpdates item. Pure apart from lastAlert. Returns 'send' | 'quiet' | 'small' | 'skip'. */
function classify(address, item, sinceMs, nowMs = Date.now()) {
  if (!item || item.status !== 'open' || !item.order) return 'skip';
  const o = item.order;
  if (Number(o.timestamp || 0) < sinceMs - 5000) return 'skip';     // order older than our subscription
  const usd = Math.abs(parseFloat(o.sz || 0)) * parseFloat(o.limitPx || 0);
  if (!(usd >= MIN_USD)) return 'small';
  const key = `${address}|${o.coin}|${o.side}`;
  const prev = lastAlert.get(key) || 0;
  lastAlert.set(key, nowMs);
  return nowMs - prev < CHASE_SEC * 1000 ? 'quiet' : 'send';
}

async function onItem(address, item, since) {
  const verdict = classify(address, item, since);
  if (verdict === 'quiet') stats.quiet++;
  if (verdict === 'small') stats.small++;
  if (verdict !== 'send') return;
  const wallet = db.getWallet(address);
  if (!wallet || Number(wallet.track_orders) !== 1 || Number(wallet.is_active) !== 1) return;
  stats.sent++;
  try {
    await telegram.notifyOrderAlert({ wallet, order: item.order });
  } catch (err) {
    console.error('[Orders] Bildirim hatası:', err.message);
  }
}

function open(address) {
  const c = conns.get(address) || { backoff: 1000, closed: false };
  conns.set(address, c);
  c.closed = false;
  let ws;
  try {
    ws = new WebSocket(URL);
  } catch (err) {
    console.error('[Orders] WebSocket açılamadı:', err.message);
    return retry(address);
  }
  c.ws = ws;
  ws.onopen = () => {
    c.backoff = 1000;
    c.since = Date.now();
    ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'orderUpdates', user: address } }));
    clearInterval(c.timer);
    c.timer = setInterval(() => {
      try { ws.send(JSON.stringify({ method: 'ping' })); } catch (e) { /* onclose reconnects */ }
    }, PING_MS);
    console.log(`[Orders] Emir akışı açık: ${address}`);
  };
  ws.onmessage = (m) => {
    let d;
    try { d = JSON.parse(m.data); } catch (e) { return; }
    if (d.channel !== 'orderUpdates' || !Array.isArray(d.data)) return;
    for (const item of d.data) onItem(address, item, c.since || Date.now());
  };
  ws.onerror = (e) => console.error(`[Orders] WebSocket hatası (${address}):`, e?.message || 'bilinmiyor');
  ws.onclose = () => {
    clearInterval(c.timer);
    if (c.ws === ws) c.ws = null;
    if (!c.closed) retry(address);
  };
}

function retry(address) {
  const c = conns.get(address);
  if (!c || c.closed) return;
  stats.reconnects++;
  const wait = c.backoff;
  c.backoff = Math.min(c.backoff * 2, 60_000);
  setTimeout(() => { if (!c.closed) open(address); }, wait);
}

function close(address) {
  const c = conns.get(address);
  if (!c) return;
  c.closed = true;
  clearInterval(c.timer);
  try { c.ws?.close(); } catch (e) { /* already closed */ }
  conns.delete(address);
}

/** Open / close sockets to match the wallets that have track_orders on. Call after any wallet change. */
function refresh() {
  if (typeof WebSocket === 'undefined') {
    console.error('[Orders] Bu Node sürümünde WebSocket yok (Node 22+ gerekir) — emir bildirimi kapalı.');
    return;
  }
  const want = new Set(wanted().map(w => w.address.toLowerCase()));
  for (const a of [...conns.keys()]) if (!want.has(a)) close(a);
  for (const a of want) if (!conns.has(a)) open(a);
}

function start() {
  refresh();
  setInterval(refresh, 60_000).unref?.();     // safety net: wallet edits made outside the API
}

function stop() {
  for (const a of [...conns.keys()]) close(a);
}

function status() {
  return { connections: [...conns.entries()].map(([a, c]) => ({ address: a, open: c.ws?.readyState === 1 })),
           maxUsers: MAX_USERS, chaseSec: CHASE_SEC, minUsd: MIN_USD, ...stats };
}

module.exports = { start, stop, refresh, status, classify, MAX_USERS, _lastAlert: lastAlert };
