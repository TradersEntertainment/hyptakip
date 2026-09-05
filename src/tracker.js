const db = require('./db');
const hyperliquid = require('./hyperliquid');
const telegram = require('./telegram');
const config = require('./config');

let isRunning = false;
let trackerTimeout = null;
let cachedLatestData = {}; // in-memory cache of latest wallet states for fast UI queries

/**
 * Compare previous positions and current positions, dispatch alerts
 */
async function processWalletState(wallet, currentState) {
  let previousState = null;
  if (wallet.last_state) {
    try {
      previousState = JSON.parse(wallet.last_state);
    } catch (e) {
      previousState = null;
    }
  }

  // Update in-memory cache
  cachedLatestData[wallet.address.toLowerCase()] = currentState;

  // If no previous state recorded (first tracking cycle), initialize without flooding alerts
  if (!previousState || !previousState.positions) {
    db.updateWalletLastState(wallet.address, currentState);
    console.log(`[Tracker] İlk durum kaydedildi: ${wallet.label} (${wallet.address}) - ${currentState.positions.length} aktif pozisyon`);
    return;
  }

  const prevPositions = previousState.positions || [];
  const currPositions = currentState.positions || [];

  const prevMap = new Map();
  for (const p of prevPositions) {
    prevMap.set(p.coin, p);
  }

  const currMap = new Map();
  for (const p of currPositions) {
    currMap.set(p.coin, p);
  }

  const threshold = parseFloat(wallet.threshold_pct) || 10.0;

  // 1. Check for NEW POSITIONS and SIZE CHANGES
  for (const curr of currPositions) {
    const prev = prevMap.get(curr.coin);

    if (!prev) {
      // Brand new position opened!
      console.log(`[Tracker] YENİ POZİSYON TESPİT EDİLDİ: ${wallet.label} -> ${curr.side} ${curr.coin} ($${curr.positionValue})`);
      await telegram.notifyPositionAlert({
        type: 'NEW_POSITION',
        wallet,
        current: curr
      });
    } else {
      // Position already existed, check if side changed or size changed
      if (curr.side !== prev.side) {
        // Flipped position e.g. Long -> Short
        console.log(`[Tracker] POZİSYON YÖN DEĞİŞTİ: ${wallet.label} -> ${prev.side} -> ${curr.side} ${curr.coin}`);
        await telegram.notifyPositionAlert({
          type: 'SIZE_CHANGE',
          wallet,
          current: curr,
          previous: prev,
          diffPct: 100
        });
      } else {
        const prevSz = prev.size || 0;
        const currSz = curr.size || 0;
        if (prevSz > 0) {
          const diffPct = Math.abs((currSz - prevSz) / prevSz) * 100;
          if (diffPct >= threshold) {
            console.log(`[Tracker] POZİSYON BOYUT DEĞİŞİMİ TESPİT EDİLDİ: ${wallet.label} -> ${curr.coin} %${diffPct.toFixed(2)} (Eşik: %${threshold})`);
            await telegram.notifyPositionAlert({
              type: 'SIZE_CHANGE',
              wallet,
              current: curr,
              previous: prev,
              diffPct
            });
          }
        }
      }
    }
  }

  // 2. Check for CLOSED POSITIONS
  for (const prev of prevPositions) {
    if (!currMap.has(prev.coin)) {
      console.log(`[Tracker] POZİSYON KAPATILDI: ${wallet.label} -> ${prev.coin}`);
      await telegram.notifyPositionAlert({
        type: 'CLOSED_POSITION',
        wallet,
        previous: prev
      });
    }
  }

  // Save updated state to SQLite
  db.updateWalletLastState(wallet.address, currentState);
}

/**
 * Check a single wallet immediately
 */
async function checkWallet(wallet) {
  try {
    const state = await hyperliquid.getClearinghouseState(wallet.address);
    await processWalletState(wallet, state);
    return state;
  } catch (err) {
    console.error(`[Tracker] Cüzdan kontrol hatası (${wallet.address}):`, err.message);
    return null;
  }
}

/**
 * Single tick of tracking loop
 */
async function tick() {
  if (!isRunning) return;

  try {
    const activeWallets = db.getActiveWallets();
    for (const wallet of activeWallets) {
      if (!isRunning) break;
      await checkWallet(wallet);
    }
  } catch (err) {
    console.error('[Tracker] Döngü hatası:', err.message);
  } finally {
    if (isRunning) {
      const settings = db.getSettings();
      const intervalSec = parseInt(settings.poll_interval_seconds || '5', 10);
      const intervalMs = Math.max(3000, intervalSec * 1000);
      trackerTimeout = setTimeout(tick, intervalMs);
    }
  }
}

/**
 * Start tracking engine
 */
function startTracker() {
  if (isRunning) return;
  isRunning = true;
  console.log('[Tracker] Pozisyon takip motoru başlatıldı.');
  tick();
}

/**
 * Stop tracking engine
 */
function stopTracker() {
  isRunning = false;
  if (trackerTimeout) {
    clearTimeout(trackerTimeout);
    trackerTimeout = null;
  }
  console.log('[Tracker] Pozisyon takip motoru durduruldu.');
}

/**
 * Get cached state
 */
function getCachedState(address) {
  return cachedLatestData[address.toLowerCase()] || null;
}

module.exports = {
  startTracker,
  stopTracker,
  checkWallet,
  getCachedState
};
