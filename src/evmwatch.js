// 🐋 Ethereum wallet watcher (e.g. Arthur Hayes). User (24.10): "arthur hayes tracker kurabilir miyiz" → "evet kur".
// Hayes trades on Ethereum mainnet, not Hyperliquid, so HL tracking shows nothing for him. Source: Blockscout's free
// public API (no key): token transfers + plain ETH transactions of each watched address, every POLL_SEC.
// On 24.10 his first transfer (1.89M ETHFI) was 08:35 TSİ; Lookonchain's post came 09:14.
//
// Spam: these wallets get dozens of fake transfers (look-alike tokens "Е⁯ΤН⁯", "U⁯S⁯Dꓚ", 0-value transfers from
// look-alike addresses). Only tokens Blockscout prices (exchange_rate) count, not flagged as scam, ASCII symbol,
// value > 0. Wording: "gönderdi / aldı" — the counterparty is often unknown, so no "sattı".
// Messages: one per wallet and direction per poll, when that poll's total ≥ the wallet's min_usd (default $100K).
const db = require('./db');
const telegram = require('./telegram');
const caller = require('./caller');
const hyperliquid = require('./hyperliquid');

const API = 'https://eth.blockscout.com/api/v2';
const POLL_SEC = Math.max(10, Number(process.env.EVM_POLL_SEC || 20));
const TZ = 'Europe/Istanbul';
const status = { running: false, lastPoll: null, lastError: null, alerts: 0, polls: 0 };
const seen = new Map();          // address → Set of item keys already handled (same-second items)
let timer = null, ethPx = { v: null, at: 0 };

async function get(path) {
  const res = await fetch(API + path, { headers: { 'User-Agent': 'hyptakip/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Blockscout HTTP ${res.status}`);
  return res.json();
}

async function ethUsd() {
  if (ethPx.v && Date.now() - ethPx.at < 60_000) return ethPx.v;
  const mids = await hyperliquid.getAllMids();
  const v = parseFloat(mids && mids.ETH);
  if (Number.isFinite(v) && v > 0) ethPx = { v, at: Date.now() };
  return ethPx.v;
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const shortA = a => `${a.slice(0, 6)}…${a.slice(-4)}`;
function usd(v) {
  const a = Math.abs(v);
  return a >= 1e9 ? `$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}K` : `$${a.toFixed(0)}`;
}
function qty(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return v.toLocaleString('en-US', { maximumFractionDigits: a >= 100 ? 0 : 4 });
}
// best name Blockscout has for an address: its own name tag (e.g. "Wintermute 4"), ENS, contract name
function who(x) {
  if (!x) return null;
  const tags = (x.metadata && x.metadata.tags) || [];
  const named = tags.find(t => t.tagType === 'name') || tags.find(t => t.tagType === 'generic');
  return (named && named.name) || x.ens_domain_name || x.name || null;
}

// one Blockscout item → transfer or null (spam / no price / not ours)
function fromToken(it, me) {
  const t = it.token || {};
  if (it.token_type && it.token_type !== 'ERC-20') return null;
  if (!t.exchange_rate || t.reputation === 'scam') return null;
  if (!/^[\x20-\x7E]{1,15}$/.test(String(t.symbol || '').trim())) return null;
  if ((it.from && it.from.is_scam) || (it.to && it.to.is_scam)) return null;
  const dec = Number((it.total && it.total.decimals) ?? t.decimals ?? 18);
  const amount = Number(BigInt((it.total && it.total.value) || '0')) / 10 ** dec;
  if (!(amount > 0)) return null;
  const out = it.from && it.from.hash.toLowerCase() === me;
  const cp = out ? it.to : it.from;
  return {
    key: `${it.transaction_hash}:${it.log_index}`, ts: it.timestamp, dir: out ? 'out' : 'in', sym: String(t.symbol).trim(),
    amount, usd: amount * parseFloat(t.exchange_rate), cp: cp && cp.hash, cpName: who(cp), tx: it.transaction_hash,
  };
}
function fromTx(it, me, px) {
  const v = Number(BigInt(it.value || '0')) / 1e18;
  if (!(v > 0) || (it.result && it.result !== 'success') || (it.status && it.status !== 'ok')) return null;
  const out = it.from && it.from.hash.toLowerCase() === me;
  const cp = out ? it.to : it.from;
  return { key: `${it.hash}:eth`, ts: it.timestamp, dir: out ? 'out' : 'in', sym: 'ETH', amount: v, usd: px ? v * px : 0,
           cp: cp && cp.hash, cpName: who(cp), tx: it.hash };
}

async function checkWallet(w) {
  const me = w.address.toLowerCase();
  const [tok, txs] = await Promise.all([get(`/addresses/${me}/token-transfers`), get(`/addresses/${me}/transactions`)]);
  const px = await ethUsd().catch(() => null);
  const items = [...(tok.items || []).map(it => fromToken(it, me)), ...(txs.items || []).map(it => fromTx(it, me, px))].filter(Boolean);
  const newest = [...(tok.items || []), ...(txs.items || [])].map(it => it.timestamp).filter(Boolean).sort().pop();
  if (!w.last_ts) {                      // first look at this wallet: remember where we are, do not replay history
    db.setEvmLastTs(me, newest || new Date().toISOString());
    seen.set(me, new Set(items.filter(x => x.ts === newest).map(x => x.key)));
    return;
  }
  // new = later than the last poll's newest timestamp, or the same second but not handled yet (after a restart the
  // same-second set is unknown, so only strictly later items count)
  const done = seen.get(me);
  const fresh = items.filter(x => x.ts > w.last_ts || (done && x.ts === w.last_ts && !done.has(x.key)));
  const last = newest && newest > w.last_ts ? newest : w.last_ts;
  if (last !== w.last_ts) db.setEvmLastTs(me, last);
  const keep = new Set(last === w.last_ts && done ? done : []);
  for (const x of items) if (x.ts === last) keep.add(x.key);
  seen.set(me, keep);
  for (const dir of ['out', 'in']) {
    const list = fresh.filter(x => x.dir === dir).sort((a, b) => b.usd - a.usd);
    const total = list.reduce((s, x) => s + x.usd, 0);
    if (!list.length || total < (Number(w.min_usd) || 0)) continue;
    await alert(w, dir, list, total);
  }
}

async function alert(w, dir, list, total) {
  const label = w.label || shortA(w.address);
  const bySym = new Map();
  for (const x of list) { const b = bySym.get(x.sym) || { a: 0, u: 0 }; b.a += x.amount; b.u += x.usd; bySym.set(x.sym, b); }
  // head: the meaningful amounts only (dust "test" transfers of 0.001 ENA stay in the list below)
  const syms = [...bySym.entries()].filter(([, b]) => b.u >= 1000).sort((a, b) => b[1].u - a[1].u).map(([s, b]) => `${qty(b.a)} ${s}`);
  const verb = dir === 'out' ? 'gönderdi' : 'aldı';
  const cps = [...new Set(list.map(x => x.cpName).filter(Boolean))];
  const mainCp = list[0].cpName;            // the biggest transfer's counterparty, only when Blockscout names it
  const head = `🐋 ${dir === 'out' ? '📤' : '📥'} ${esc(label)} ${usd(total)} ${verb}: ${esc(syms.slice(0, 3).join(', '))}${syms.length > 3 ? ` +${syms.length - 3}` : ''}`
    + (mainCp ? ` ${dir === 'out' ? '→' : '←'} ${esc(mainCp)}${list.length > 1 && new Set(list.map(x => x.cp)).size > 1 ? ' …' : ''}` : '');
  const shown = list.filter(x => x.usd >= Math.max(1000, (Number(w.min_usd) || 0) * 0.01)).slice(0, 15);
  const lines = shown.map(x => {
    const t = new Date(x.ts).toLocaleTimeString('tr-TR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
    const other = x.cp ? `<a href="https://etherscan.io/address/${x.cp}">${esc(x.cpName || shortA(x.cp))}</a>` : '?';
    return `• ${t} · <b>${qty(x.amount)} ${esc(x.sym)}</b> (${usd(x.usd)}) ${dir === 'out' ? '→' : '←'} ${other} · <a href="https://etherscan.io/tx/${x.tx}">tx</a>`;
  });
  const body = `<b>${head}</b>\n\n${lines.join('\n')}${list.length > shown.length ? `\n• +${list.length - shown.length} küçük transfer` : ''}\n\n`
    + `👤 <code>${w.address}</code> · <a href="https://etherscan.io/address/${w.address}">Etherscan</a> · <a href="https://intel.arkm.com/explorer/address/${w.address}">Arkham</a>\n`
    + `ℹ️ Ethereum transferi; karşı taraf ${cps.length ? 'Blockscout etiketine göre' : 'bilinmiyor'}. Gözlem aracıdır, yatırım tavsiyesi değildir.`;
  const chat = w.telegram_chat_id || process.env.TELEGRAM_DEFAULT_CHAT_ID;
  const r = await telegram.sendTelegramMessage(body, chat);
  if (!r.success) console.error('[EvmWatch] Telegram:', r.reason);
  try {
    db.addAlert({ wallet_address: w.address, wallet_label: label, coin: [...bySym.keys()].slice(0, 5).join(','), alert_type: 'EVM_TRANSFER', message: body,
                  details: { dir, total, items: list.slice(0, 30) } });
  } catch (e) { /* history is optional */ }
  caller.ring({ address: w.address, call_alert: w.call_alert }, head);
  status.alerts++;
}

async function tick() {
  status.polls++;
  for (const w of db.getEvmWallets().filter(x => Number(x.is_active) === 1)) {
    try { await checkWallet(w); status.lastError = null; } catch (err) { status.lastError = `${shortA(w.address)}: ${err.message}`; console.error('[EvmWatch]', status.lastError); }
  }
  status.lastPoll = new Date().toISOString();
}

function start() {
  if (timer) return;
  status.running = true;
  const loop = async () => { try { await tick(); } finally { timer = setTimeout(loop, POLL_SEC * 1000); } };
  timer = setTimeout(loop, 5000);
}
function stop() { if (timer) clearTimeout(timer); timer = null; status.running = false; }

// 🔎 Wallet page (user 24.10: "arthur hayesi seçip bakamıyorum elinde ne var"): ETH + priced ERC-20 balances,
// and the newest real transfers (same spam filter as the alerts). Cached 60 s. DeFi positions (Aave, staking
// contracts, Pendle PT…) are not balances of the address and do not show up here.
const overviewCache = new Map();
async function overview(address) {
  const me = String(address).toLowerCase();
  const hit = overviewCache.get(me);
  if (hit && Date.now() - hit.at < 60_000) return hit.data;
  const [info, toks, tt, txs] = await Promise.all([
    get(`/addresses/${me}`), get(`/addresses/${me}/tokens?type=ERC-20`),
    get(`/addresses/${me}/token-transfers`), get(`/addresses/${me}/transactions`),
  ]);
  const px = parseFloat(info.exchange_rate) || await ethUsd().catch(() => null);
  const eth = Number(BigInt(info.coin_balance || '0')) / 1e18;
  const tokens = [];
  let unpriced = 0;
  for (const it of toks.items || []) {
    const t = it.token || {};
    if (!t.exchange_rate || t.reputation === 'scam' || !/^[\x20-\x7E]{1,15}$/.test(String(t.symbol || '').trim())) { unpriced++; continue; }
    const amount = Number(BigInt(it.value || '0')) / 10 ** Number(t.decimals ?? 18);
    const value = amount * parseFloat(t.exchange_rate);
    if (value < 1) continue;
    tokens.push({ symbol: String(t.symbol).trim(), name: t.name, address: t.address_hash || t.address, amount, price: parseFloat(t.exchange_rate), usd: value, icon: t.icon_url || null });
  }
  if (eth > 0) tokens.push({ symbol: 'ETH', name: 'Ether', address: null, amount: eth, price: px, usd: px ? eth * px : 0, icon: null });
  tokens.sort((a, b) => b.usd - a.usd);
  const recent = [...(tt.items || []).map(it => fromToken(it, me)), ...(txs.items || []).map(it => fromTx(it, me, px))]
    .filter(x => x && x.usd >= 10).sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 40);   // 1-token "test" transfers hidden
  const tags = ((info.metadata && info.metadata.tags) || []).map(t => t.name);
  const data = { address: me, tags, total: tokens.reduce((s, x) => s + x.usd, 0), tokens, unpriced, recent, ts: Date.now() };
  overviewCache.set(me, { at: Date.now(), data });
  if (overviewCache.size > 50) overviewCache.delete(overviewCache.keys().next().value);
  return data;
}

module.exports = { overview, start, stop, tick, status: () => ({ ...status, pollSec: POLL_SEC, wallets: db.getEvmWallets().length }), fromToken, fromTx };
