const config = require('./config');

/**
 * Fetch wrapper with timeout
 */
async function postHyperliquid(body, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(config.HYPERLIQUID_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Hyperliquid API HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Get all current mid prices
 */
async function getAllMids() {
  try {
    return await postHyperliquid({ type: 'allMids' });
  } catch (err) {
    console.error('[Hyperliquid] getAllMids hatası:', err.message);
    return {};
  }
}

// HIP-3 dex list (xyz = stocks, para, ...). Each dex has its OWN clearinghouse: a plain
// clearinghouseState call only returns main-dex (crypto) positions, so stock perps such as
// xyz:CBRS were invisible. Cached for 1 hour.
const DEX_TTL_MS = 60 * 60 * 1000;
let dexCache = { names: null, at: 0 };

async function getPerpDexNames() {
  if (dexCache.names && Date.now() - dexCache.at < DEX_TTL_MS) return dexCache.names;
  try {
    const raw = await postHyperliquid({ type: 'perpDexs' });
    const names = (Array.isArray(raw) ? raw : [])
      .filter(d => d && typeof d.name === 'string' && d.name)
      .map(d => d.name);
    dexCache = { names, at: Date.now() };
    return names;
  } catch (err) {
    console.error('[Hyperliquid] perpDexs hatası:', err.message);
    return dexCache.names || [];
  }
}

/**
 * Fetch and normalize clearinghouse state for an address, across the main dex AND every HIP-3 dex.
 * Main dex failure throws (as before); a failing HIP-3 dex is skipped and listed in `failedDexes`
 * so the tracker does not report its positions as closed.
 */
async function getClearinghouseState(userAddress) {
  if (!userAddress || !userAddress.startsWith('0x')) {
    throw new Error('Geçersiz cüzdan adresi');
  }
  const user = userAddress.toLowerCase();
  const dexes = await getPerpDexNames();

  const [main, ...others] = await Promise.allSettled([
    postHyperliquid({ type: 'clearinghouseState', user }),
    ...dexes.map(dex => postHyperliquid({ type: 'clearinghouseState', user, dex }))
  ]);

  if (main.status !== 'fulfilled') throw main.reason;
  if (!main.value) {
    throw new Error('Hyperliquid boş yanıt döndürdü');
  }

  const failedDexes = [];
  const raws = [{ dex: '', raw: main.value }];
  others.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) raws.push({ dex: dexes[i], raw: r.value });
    else {
      failedDexes.push(dexes[i]);
      console.error(`[Hyperliquid] clearinghouseState (${dexes[i]}) hatası (${user}):`, r.reason ? r.reason.message : 'boş yanıt');
    }
  });

  let accountValue = 0, totalNtlPos = 0, totalMarginUsed = 0, withdrawable = 0;
  const rawPositions = [];
  for (const { raw } of raws) {
    const marginSummary = raw.marginSummary || {};
    const crossMarginSummary = raw.crossMarginSummary || {};
    accountValue += parseFloat(marginSummary.accountValue || crossMarginSummary.accountValue || 0);
    totalNtlPos += parseFloat(marginSummary.totalNtlPos || crossMarginSummary.totalNtlPos || 0);
    totalMarginUsed += parseFloat(marginSummary.totalMarginUsed || crossMarginSummary.totalMarginUsed || 0);
    withdrawable += parseFloat(raw.withdrawable || 0);
    rawPositions.push(...(raw.assetPositions || []));
  }

  // Normalize positions
  const positions = [];

  let totalUnrealizedPnl = 0;

  for (const item of rawPositions) {
    const p = item.position;
    if (!p) continue;

    const szi = parseFloat(p.szi || 0);
    if (szi === 0) continue; // Skip zero/closed positions

    const side = szi > 0 ? 'LONG' : 'SHORT';
    const size = Math.abs(szi);
    const entryPx = parseFloat(p.entryPx || 0);
    const positionValue = parseFloat(p.positionValue || 0);
    const unrealizedPnl = parseFloat(p.unrealizedPnl || 0);
    const returnOnEquity = parseFloat(p.returnOnEquity || 0);
    const liquidationPx = p.liquidationPx ? parseFloat(p.liquidationPx) : null;
    const marginUsed = parseFloat(p.marginUsed || 0);
    const maxLeverage = p.maxLeverage || 1;

    let levStr = 'Cross';
    let levVal = 1;
    if (p.leverage) {
      if (typeof p.leverage === 'object') {
        levVal = p.leverage.value || 1;
        levStr = `${levVal}x (${p.leverage.type || 'cross'})`;
      } else {
        levVal = p.leverage;
        levStr = `${levVal}x`;
      }
    }

    // Estimate current price: positionValue / size
    const currentPrice = size > 0 ? positionValue / size : entryPx;

    // Distance to liquidation %
    let liqDistancePct = null;
    if (liquidationPx && currentPrice > 0) {
      liqDistancePct = Math.abs((currentPrice - liquidationPx) / currentPrice) * 100;
    }

    totalUnrealizedPnl += unrealizedPnl;

    positions.push({
      coin: p.coin,
      side,
      size,
      szi,
      entryPrice: entryPx,
      currentPrice,
      positionValue,
      unrealizedPnl,
      roePct: returnOnEquity * 100,
      liquidationPrice: liquidationPx,
      liqDistancePct,
      marginUsed,
      leverage: levStr,
      leverageValue: levVal,
      maxLeverage,
      cumFunding: p.cumFunding || null
    });
  }

  // Sort by position value descending
  positions.sort((a, b) => b.positionValue - a.positionValue);

  return {
    address: userAddress.toLowerCase(),
    accountValue,
    totalNtlPos,
    totalMarginUsed,
    withdrawable,
    totalUnrealizedPnl,
    positions,
    positionCount: positions.length,
    allDexes: true,
    failedDexes,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Get recent fills for an address
 */
async function getUserFills(userAddress) {
  if (!userAddress || !userAddress.startsWith('0x')) {
    return [];
  }

  try {
    const rawFills = await postHyperliquid({
      type: 'userFills',
      user: userAddress.toLowerCase()
    });

    if (!Array.isArray(rawFills)) return [];

    return rawFills.map(f => ({
      coin: f.coin,
      px: parseFloat(f.px || 0),
      sz: parseFloat(f.sz || 0),
      side: f.side === 'B' ? 'BUY' : 'SELL',
      dir: f.dir || '',
      closedPnl: parseFloat(f.closedPnl || 0),
      fee: parseFloat(f.fee || 0),
      feeToken: f.feeToken || 'USDC',
      time: f.time,
      hash: f.hash,
      oid: f.oid
    }));
  } catch (err) {
    console.error(`[Hyperliquid] userFills hatası (${userAddress}):`, err.message);
    return [];
  }
}

module.exports = {
  postHyperliquid,
  getAllMids,
  getClearinghouseState,
  getPerpDexNames,
  getUserFills
};
