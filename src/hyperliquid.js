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

/**
 * Fetch and normalize clearinghouse state for an address
 */
async function getClearinghouseState(userAddress) {
  if (!userAddress || !userAddress.startsWith('0x')) {
    throw new Error('Geçersiz cüzdan adresi');
  }

  const raw = await postHyperliquid({
    type: 'clearinghouseState',
    user: userAddress.toLowerCase()
  });

  if (!raw) {
    throw new Error('Hyperliquid boş yanıt döndürdü');
  }

  const marginSummary = raw.marginSummary || {};
  const crossMarginSummary = raw.crossMarginSummary || {};

  const accountValue = parseFloat(marginSummary.accountValue || crossMarginSummary.accountValue || 0);
  const totalNtlPos = parseFloat(marginSummary.totalNtlPos || crossMarginSummary.totalNtlPos || 0);
  const totalMarginUsed = parseFloat(marginSummary.totalMarginUsed || crossMarginSummary.totalMarginUsed || 0);
  const withdrawable = parseFloat(raw.withdrawable || 0);

  // Normalize positions
  const rawPositions = raw.assetPositions || [];
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
  getUserFills
};
