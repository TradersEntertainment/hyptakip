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
 *
 * Same socket, two more streams (user 23.10: "spottan da bir şey yaparlarsa bildirim istiyorum ve dışarı transfer
 * yaparlarsa da bildirim istiyorum"), per-wallet toggles track_spot / track_transfers (default on):
 *  - userFills, spot coins only ('@N' or 'X/Y'): one order fills in many pieces, so fills per (coin, side) are
 *    collected for SPOT_BATCH_SEC and sent as one alert; then quiet for ORDER_CHASE_SEC while buying continues.
 *  - userNonFundingLedgerUpdates: only money leaving the wallet (withdraw to Arbitrum, send / spotTransfer /
 *    internalTransfer to another address, sub-account transfer, vault deposit). perp↔spot moves are not "out".
 * Snapshots (history sent on subscribe) are skipped.
 */
const db = require('./db');
const telegram = require('./telegram');

const URL = process.env.HYPERLIQUID_WS_URL || 'wss://api.hyperliquid.xyz/ws';
const MAX_USERS = 10;
const CHASE_SEC = parseInt(process.env.ORDER_CHASE_SEC || '600', 10);
const MIN_USD = parseFloat(process.env.ORDER_ALERT_MIN_USD || '1000');
const SPOT_MIN_USD = parseFloat(process.env.SPOT_ALERT_MIN_USD || '1000');
const TRANSFER_MIN_USD = parseFloat(process.env.TRANSFER_ALERT_MIN_USD || '1000');
const SPOT_BATCH_SEC = parseInt(process.env.SPOT_BATCH_SEC || '15', 10);
const PING_MS = 30_000;
const STALE_MS = PING_MS * 2 + 10_000;   // no message (pong included) for this long → half-open socket, reconnect

const conns = new Map();          // address → { ws, timer, backoff, since, closed, subs }
const lastAlert = new Map();      // address|coin|side → ms of the last order seen in this chase
const spotBuf = new Map();        // address|coin|side → { fills: [], timer }
const spotQuiet = new Map();      // address|coin|side → ms until which spot fills stay quiet
const spotCarry = new Map();      // address|coin|side → { fills, until } batches under the minimum, added to the next
let stats = { sent: 0, quiet: 0, small: 0, reconnects: 0, spot: 0, spotQuiet: 0, transfers: 0 };

const on = (w, k) => w[k] === undefined || w[k] === null ? k !== 'track_orders' : Number(w[k]) === 1;

/** Streams a wallet needs, e.g. "orders,spot,transfers" ('' = none). */
function subsOf(w) {
  return ['orders', 'spot', 'transfers'].filter(s => on(w, `track_${s}`)).join(',');
}

/** address → subs, at most MAX_USERS wallets (HL limit); order alerts first, then oldest wallets. */
function wanted() {
  const ws = db.getActiveWallets().filter(w => subsOf(w));
  ws.sort((a, b) => (on(b, 'track_orders') - on(a, 'track_orders')) || String(a.created_at).localeCompare(String(b.created_at)));
  return new Map(ws.slice(0, MAX_USERS).map(w => [w.address.toLowerCase(), subsOf(w)]));
}

// HL system addresses: 0x2222…2222 (HYPE) and 0x20 + zeros + token index — a send there bridges to HyperEVM
const isSystem = a => a === '0x2222222222222222222222222222222222222222' || /^0x200{20,}[0-9a-f]*$/.test(a);

const isSpot = coin => String(coin).startsWith('@') || String(coin).includes('/');

/** One ledger update → outgoing transfer {kind, usd, token, amount, to} or null (incoming / internal / other). */
function outgoing(address, upd) {
  const d = upd?.delta || {};
  const me = String(address).toLowerCase();
  const from = String(d.user || '').toLowerCase();
  const to = String(d.destination || '').toLowerCase();
  const num = v => Math.abs(parseFloat(v || 0)) || 0;
  switch (d.type) {
    case 'withdraw':
      return { kind: "çekim (Arbitrum'a)", usd: num(d.usdc), token: 'USDC', amount: num(d.usdc), to: null };
    case 'internalTransfer':
    case 'subAccountTransfer':
      if (from !== me || !to || to === me) return null;
      // the delta has no master/sub direction: neutral label (review: sub → master read "alt hesaba")
      return { kind: d.type === 'subAccountTransfer' ? 'ana/alt hesap arası transfer' : 'başka adrese transfer (perp USDC)',
               usd: num(d.usdc), token: 'USDC', amount: num(d.usdc), to };
    case 'spotTransfer':
    case 'send':
      if (from !== me || !to || to === me) return null;
      if (isSystem(to)) {
        return { kind: "HyperEVM'e köprü (kendi adresi)", usd: num(d.usdcValue), token: d.token || '?',
                 amount: num(d.amount), to: null };
      }
      return { kind: d.type === 'send' ? 'başka adrese gönderim' : 'spot transfer', usd: num(d.usdcValue),
               token: d.token || '?', amount: num(d.amount), to };
    case 'vaultDeposit': {
      const v = String(d.vault || '').toLowerCase();
      if (v === me) return null;                  // the tracked wallet IS the vault: someone deposited into it
      return { kind: "vault'a yatırma", usd: num(d.usdc), token: 'USDC', amount: num(d.usdc), to: v || null };
    }
    default:
      return null;
  }
}

const seenKeys = new Map();       // address → Set of ledger hash / fill tid already handled (reconnect replays)
function firstTime(address, k) {
  let s = seenKeys.get(address);
  if (!s) { s = new Set(); seenKeys.set(address, s); }
  if (s.has(k)) return false;
  s.add(k);
  if (s.size > 5000) s.delete(s.values().next().value);
  return true;
}

async function onTransfer(address, upd, since) {
  if (Number(upd?.time || 0) < since - 5000) return;
  if (!firstTime(address, `l:${upd.hash}:${upd.time}:${upd.delta?.type}`)) return;
  const t = outgoing(address, upd);
  if (!t || !(t.usd >= TRANSFER_MIN_USD)) return;
  const wallet = db.getWallet(address);
  if (!wallet || !on(wallet, 'track_transfers') || Number(wallet.is_active) !== 1) return;
  stats.transfers++;
  try {
    await telegram.notifyTransferAlert({ wallet, transfer: t, hash: upd.hash, time: upd.time });
  } catch (err) {
    console.error('[Transfer] Bildirim hatası:', err.message);
  }
}

/** Spot fill → batch per (coin, side); returns 'quiet' | 'batched' | 'skip'. */
function onSpotFill(address, fill, since, nowMs = Date.now()) {
  if (!fill || !isSpot(fill.coin) || Number(fill.time || 0) < since - 5000) return 'skip';
  if (!firstTime(address, `f:${fill.tid ?? `${fill.hash}:${fill.oid}:${fill.time}`}`)) return 'skip';
  const key = `${address}|${fill.coin}|${fill.side}`;
  if (nowMs < (spotQuiet.get(key) || 0)) {
    spotQuiet.set(key, nowMs + CHASE_SEC * 1000);       // still buying/selling: stay quiet while it continues
    stats.spotQuiet++;
    return 'quiet';
  }
  let b = spotBuf.get(key);
  if (!b) {
    b = { fills: [] };
    spotBuf.set(key, b);
    b.timer = setTimeout(() => flushSpot(address, key), SPOT_BATCH_SEC * 1000);
  }
  b.fills.push(fill);
  return 'batched';
}

async function flushSpot(address, key) {
  const b = spotBuf.get(key);
  spotBuf.delete(key);
  if (!b || !b.fills.length) return;
  // Slices under the minimum add up (review: a TWAP of $347 slices every 30 s never alerted)
  const carry = spotCarry.get(key);
  spotCarry.delete(key);
  if (carry && Date.now() < carry.until) b.fills = carry.fills.concat(b.fills);
  const usd = b.fills.reduce((s, f) => s + Math.abs(parseFloat(f.sz || 0)) * parseFloat(f.px || 0), 0);
  if (!(usd >= SPOT_MIN_USD)) {
    spotCarry.set(key, { fills: b.fills.slice(-500), until: Date.now() + CHASE_SEC * 1000 });
    return;
  }
  const wallet = db.getWallet(address);
  if (!wallet || !on(wallet, 'track_spot') || Number(wallet.is_active) !== 1) return;
  spotQuiet.set(key, Date.now() + CHASE_SEC * 1000);
  stats.spot++;
  try {
    await telegram.notifySpotAlert({ wallet, fills: b.fills });
  } catch (err) {
    console.error('[Spot] Bildirim hatası:', err.message);
  }
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
  if (!wallet || !on(wallet, 'track_orders') || Number(wallet.is_active) !== 1) return;
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
  // Node 22 (undici) fires only 'error' when the handshake fails, never 'close'; newer Node fires both.
  // One guard per socket: retry exactly once either way (review: a failed connect never retried).
  let lost = false;
  const onLost = () => {
    if (lost) return;
    lost = true;
    if (c.ws === ws) { clearInterval(c.timer); c.ws = null; }
    try { ws.close(); } catch (e) { /* not open */ }
    if (!c.closed && !c.ws) retry(address);
  };
  ws.onopen = () => {
    c.backoff = 1000;
    // First connect: only events from now on. Reconnect: keep the old mark, so the snapshot HL sends on
    // subscribe replays what happened while the socket was down (review: those transfers were lost).
    c.mark = c.mark || Date.now();
    c.since = Date.now();
    c.lastMsg = Date.now();
    c.error = null;
    const subs = String(c.subs || '').split(',');
    const types = { orders: 'orderUpdates', spot: 'userFills', transfers: 'userNonFundingLedgerUpdates' };
    for (const s of subs) {
      if (types[s]) ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: types[s], user: address } }));
    }
    clearInterval(c.timer);
    c.timer = setInterval(() => {
      if (Date.now() - (c.lastMsg || 0) > STALE_MS) {         // half-open: pings get no pong, nothing arrives
        console.error(`[Orders] Akış sessiz, yeniden bağlanılıyor: ${address}`);
        return onLost();
      }
      try { ws.send(JSON.stringify({ method: 'ping' })); } catch (e) { /* onLost reconnects */ }
    }, PING_MS);
    console.log(`[Orders] Canlı akış açık: ${address} (${c.subs})`);
  };
  ws.onmessage = (m) => {
    c.lastMsg = Date.now();
    let d;
    try { d = JSON.parse(m.data); } catch (e) { return; }
    if (d.channel === 'error') {                              // e.g. rejected subscription: do not look "open"
      c.error = String(d.data).slice(0, 200);
      stats.errors = (stats.errors || 0) + 1;
      console.error(`[Orders] HL hata (${address}):`, c.error);
      return;
    }
    const since = c.since || Date.now();
    if (d.channel === 'orderUpdates' && Array.isArray(d.data)) {
      for (const item of d.data) onItem(address, item, since);
    } else if (d.channel === 'userFills' && d.data) {
      const items = d.data.fills || [];
      const from = d.data.isSnapshot ? c.mark + 5000 : c.mark;   // snapshot: strictly after the mark
      for (const f of items) onSpotFill(address, f, from);
      c.mark = Math.max(c.mark, ...items.map(f => Number(f.time) || 0));
    } else if (d.channel === 'userNonFundingLedgerUpdates' && d.data) {
      const items = d.data.nonFundingLedgerUpdates || [];
      const from = d.data.isSnapshot ? c.mark + 5000 : c.mark;
      for (const u of items) onTransfer(address, u, from);
      c.mark = Math.max(c.mark, ...items.map(u => Number(u.time) || 0));
    }
  };
  ws.onerror = (e) => {
    console.error(`[Orders] WebSocket hatası (${address}):`, e?.message || 'bilinmiyor');
    onLost();
  };
  ws.onclose = onLost;
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

/** Open / close sockets to match the wallets' toggles. Call after any wallet change. */
function refresh() {
  if (typeof WebSocket === 'undefined') {
    console.error('[Orders] Bu Node sürümünde WebSocket yok (Node 22+ gerekir) — canlı bildirimler kapalı.');
    return;
  }
  const want = wanted();
  for (const [a, c] of [...conns.entries()]) if (want.get(a) !== c.subs) close(a);   // gone or toggles changed
  for (const [a, subs] of want) {
    if (!conns.has(a)) {
      conns.set(a, { backoff: 1000, closed: false, subs });
      open(a);
    }
  }
}

function start() {
  refresh();
  setInterval(refresh, 60_000).unref?.();     // safety net: wallet edits made outside the API
}

function stop() {
  for (const a of [...conns.keys()]) close(a);
}

function status() {
  return { connections: [...conns.entries()].map(([a, c]) => ({
             address: a, subs: c.subs, open: c.ws?.readyState === 1 && !c.error, error: c.error || null,
             lastMsgAgoSec: c.lastMsg ? Math.round((Date.now() - c.lastMsg) / 1000) : null })),
           maxUsers: MAX_USERS, chaseSec: CHASE_SEC, minUsd: MIN_USD, spotMinUsd: SPOT_MIN_USD,
           transferMinUsd: TRANSFER_MIN_USD, ...stats };
}

module.exports = { start, stop, refresh, status, classify, outgoing, onSpotFill, subsOf, wanted, MAX_USERS,
                   _lastAlert: lastAlert, _spotBuf: spotBuf, _spotQuiet: spotQuiet };
