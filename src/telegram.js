const db = require('./db');
const config = require('./config');

/**
 * Format currency with proper commas and decimals
 */
function formatUsd(val) {
  const num = parseFloat(val);
  if (isNaN(num)) return '$0.00';
  return '$' + num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Format short address 0x1234...5678
 */
function shortAddr(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * Size change % for alerts: two decimals under 1% (a 0.01% threshold would otherwise print "%0.0")
 */
function fmtDiff(d) {
  return d < 1 ? d.toFixed(2) : d.toFixed(1);
}

/**
 * Compact USD for the headline: $1.21M / $850K / $9,500
 */
function shortUsd(val) {
  const n = Math.abs(parseFloat(val));
  if (isNaN(n)) return '$?';
  if (n >= 999.995e6) return `$${(n / 1e9).toFixed(2)}B`;   // eşikler yuvarlamadan sonra: $999,999 → $1.00M (not $1000K)
  if (n >= 999.5e3) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `$${Math.round(n / 1e3)}K`;
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * Escape text for Telegram HTML (wallet labels are free text: "A<B fund" would break parse_mode HTML)
 */
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Coin name for the headline: full name, dex prefix kept ("xyz:CRWD") so the same ticker on two HIP-3 dexes
 * never reads the same
 */
function shortCoin(coin) {
  return esc(coin);
}

/**
 * First line of every alert. The phone lock-screen / notification preview shows only this line,
 * so it carries everything: what happened, side, coin, size, who.
 * e.g. "🟢 LONG xyz:CRWD büyüttü +%12.2 → $1.21M · injbalina". "kapandı", not "kapattı": the tracker only sees
 * the position is gone (it may have been liquidated).
 */
function headline({ type, wallet, current, previous, diffPct = 0 }) {
  const who = esc(wallet.label || shortAddr(wallet.address));
  const sideEmoji = side => (side === 'LONG' ? '🟢' : '🔴');
  if (type === 'NEW_POSITION') {
    return `${sideEmoji(current.side)} ${current.side} ${shortCoin(current.coin)} açtı ${shortUsd(current.positionValue)} · ${who}`;
  }
  if (type === 'FLIP') {
    return `🔄 ${shortCoin(current.coin)} ${previous.side} → ${current.side} çevirdi ${shortUsd(current.positionValue)} · ${who}`;
  }
  if (type === 'SIZE_CHANGE') {
    const up = current.size > previous.size;
    return `${sideEmoji(current.side)} ${current.side} ${shortCoin(current.coin)} ${up ? 'büyüttü +' : 'küçülttü −'}%${fmtDiff(diffPct)} → ${shortUsd(current.positionValue)} · ${who}`;
  }
  if (type === 'CLOSED_POSITION') {
    return `🏁 ${previous.side} ${shortCoin(previous.coin)} kapandı (${shortUsd(previous.positionValue)}) · ${who}`;
  }
  if (type === 'LIQUIDATION_RISK') {
    return `🔥 ${current.side} ${shortCoin(current.coin)} liq'e %${current.liqDistancePct.toFixed(1)} · ${shortUsd(current.positionValue)} · ${who}`;
  }
  return `${who}`;
}

/**
 * Send raw Telegram HTML message
 */
async function sendTelegramMessage(text, customChatId = null) {
  const settings = db.getSettings();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = customChatId || process.env.TELEGRAM_DEFAULT_CHAT_ID || config.DEFAULT_MAIN_CHAT_ID;

  if (!token || !token.trim()) {
    return { 
      success: false, 
      reason: 'TELEGRAM_BOT_TOKEN tanımlı değil. Lütfen Railway Dashboard -> Variables sekmesine TELEGRAM_BOT_TOKEN ekleyin.' 
    };
  }
  if (!chatId || !chatId.trim()) {
    return { 
      success: false, 
      reason: 'TELEGRAM_DEFAULT_CHAT_ID tanımlı değil. Lütfen Railway Variables veya cüzdana özel Chat ID ekleyin.' 
    };
  }

  // Check if notifications are globally enabled
  if (settings.notifications_enabled === '0') {
    return { success: false, reason: 'Bildirimler kullanıcı tarafından duraklatılmış.' };
  }

  const url = `https://api.telegram.org/bot${token.trim()}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: false
      })
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      console.error('[Telegram] Gönderim hatası:', data.description || res.statusText);
      return { success: false, reason: data.description || 'Telegram API hatası' };
    }

    return { success: true, messageId: data.result?.message_id };
  } catch (err) {
    console.error('[Telegram] İstek hatası:', err.message);
    return { success: false, reason: err.message };
  }
}

/**
 * Send test alert
 */
async function sendTestMessage(customChatId = null) {
  const testText = `
🚀 <b>HYPERLIQUID TAKİP SİSTEMİ TEST BİLDİRİMİ</b> 🚀

✅ <b>Telegram Entegrasyonu Başarılı!</b>
Bu bildirimi alıyorsanız, Railway üzerinden eklediğiniz Telegram botu sorunsuz çalışmaktadır.

📊 <b>Sistem Durumu:</b> 🟢 Aktif & Canlı Takipte
⏱️ <b>Zaman:</b> ${new Date().toLocaleString('tr-TR')}

<i>Artık takip ettiğiniz cüzdanlarda yeni pozisyon açıldığında veya pozisyon boyutu değiştiğinde buradan anlık bildirim alacaksınız!</i>
`.trim();

  return await sendTelegramMessage(testText, customChatId);
}

/**
 * Format and send Position Alert to Telegram & save to Alerts history
 */
async function notifyPositionAlert({ type, wallet, current, previous = null, diffPct = 0 }) {
  const settings = db.getSettings();
  const addressShort = shortAddr(wallet.address);
  const hypurrscanUrl = `https://hypurrscan.io/address/${wallet.address}`;
  const hyperdashUrl = `https://hyperdash.com/address/${wallet.address}`;
  const targetChatId = wallet.telegram_chat_id || process.env.TELEGRAM_DEFAULT_CHAT_ID || config.DEFAULT_MAIN_CHAT_ID;

  let title = '';
  let body = '';
  let alertType = type;
  let coinName = current ? current.coin : (previous ? previous.coin : 'HL');

  // Long -> Short (or back) arrives from the tracker as SIZE_CHANGE with diffPct 100; it is a flip, not a resize
  if (type === 'SIZE_CHANGE' && previous && current && previous.side !== current.side) {
    type = 'FLIP';
  }
  const head = `<b>${headline({ type, wallet, current, previous, diffPct })}</b>`;

  if (type === 'NEW_POSITION') {
    const sideEmoji = current.side === 'LONG' ? '🟢' : '🔴';
    title = head;
    body = `
${title}

👤 <b>Balina:</b> ${esc(wallet.label)} (<code>${addressShort}</code>)
🪙 <b>Parite:</b> ${sideEmoji} <b>${current.side} ${current.coin}</b>
📊 <b>Pozisyon Değeri:</b> ${formatUsd(current.positionValue)} (${current.size.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${current.coin})
🎯 <b>Giriş Fiyatı:</b> $${current.entryPrice}
⚡ <b>Kaldıraç:</b> ${current.leverage}
🛡️ <b>Kullanılan Teminat:</b> ${formatUsd(current.marginUsed)}
${current.liquidationPrice ? `⚠️ <b>Likidasyon Fiyatı:</b> $${current.liquidationPrice} (${current.liqDistancePct ? `%${current.liqDistancePct.toFixed(1)} uzaklık` : ''})` : ''}
⏱️ <b>Zaman:</b> ${new Date().toLocaleString('tr-TR')}

🔗 <a href="${hypurrscanUrl}"><b>Hypurrscan'de İncele</b></a> | <a href="${hyperdashUrl}">Hyperdash</a> | <a href="https://app.hyperliquid.xyz/trade/${current.coin}">Trade</a>
    `.trim();

  } else if (type === 'SIZE_CHANGE' || type === 'FLIP') {
    const sideEmoji = current.side === 'LONG' ? '🟢' : '🔴';
    const isIncrease = current.size > previous.size;
    const actionText = type === 'FLIP'
      ? `🔄 Yön çevrildi (${previous.side} → ${current.side})`
      : (isIncrease ? `📈 Pozisyon Büyütüldü (+%${fmtDiff(diffPct)})` : `📉 Pozisyon Küçültüldü / Kâr Alındı (-%${fmtDiff(diffPct)})`);
    const pnlEmoji = current.unrealizedPnl >= 0 ? '🟢 +' : '🔴 ';

    title = head;
    body = `
${title}

👤 <b>Balina:</b> ${esc(wallet.label)} (<code>${addressShort}</code>)
🪙 <b>Parite:</b> ${sideEmoji} <b>${current.side} ${current.coin}</b>
⚡ <b>Hareket:</b> ${actionText}
📦 <b>Önceki Boyut:</b> ${previous.size.toLocaleString('en-US', { maximumFractionDigits: 4 })} (${formatUsd(previous.positionValue)})
🚀 <b>Yeni Boyut:</b> ${current.size.toLocaleString('en-US', { maximumFractionDigits: 4 })} (${formatUsd(current.positionValue)})
🎯 <b>Ort. Giriş:</b> $${current.entryPrice} | <b>Güncel:</b> $${current.currentPrice.toFixed(4)}
💰 <b>Anlık Kâr/Zarar:</b> ${pnlEmoji}${formatUsd(current.unrealizedPnl)} (%${current.roePct.toFixed(1)} ROE)
⚡ <b>Kaldıraç:</b> ${current.leverage}
⏱️ <b>Zaman:</b> ${new Date().toLocaleString('tr-TR')}

🔗 <a href="${hypurrscanUrl}"><b>Hypurrscan'de İncele</b></a> | <a href="${hyperdashUrl}">Hyperdash</a>
    `.trim();

  } else if (type === 'CLOSED_POSITION') {
    const prevSideEmoji = previous.side === 'LONG' ? '🟢' : '🔴';
    title = head;
    body = `
${title}

👤 <b>Balina:</b> ${esc(wallet.label)} (<code>${addressShort}</code>)
🪙 <b>Kapanan Parite:</b> ${prevSideEmoji} <b>${previous.side} ${previous.coin}</b>
📦 <b>Kapanan Boyut:</b> ${previous.size.toLocaleString('en-US', { maximumFractionDigits: 4 })} (${formatUsd(previous.positionValue)})
🎯 <b>Giriş Fiyatı:</b> $${previous.entryPrice}
⏱️ <b>Zaman:</b> ${new Date().toLocaleString('tr-TR')}

🔗 <a href="${hypurrscanUrl}"><b>Hypurrscan'de İncele</b></a> | <a href="${hyperdashUrl}">Hyperdash</a>
    `.trim();

  } else if (type === 'LIQUIDATION_RISK') {
    title = head;
    body = `
${title}

👤 <b>Balina:</b> ${esc(wallet.label)} (<code>${addressShort}</code>)
🪙 <b>Parite:</b> <b>${current.side} ${current.coin}</b>
⚠️ <b>Likidasyona Mesafe:</b> Sadece <b>%${current.liqDistancePct.toFixed(1)}</b> kaldı!
🎯 <b>Likidasyon Fiyatı:</b> $${current.liquidationPrice} | <b>Güncel:</b> $${current.currentPrice.toFixed(4)}
📊 <b>Risk Altındaki Değer:</b> ${formatUsd(current.positionValue)}
⏱️ <b>Zaman:</b> ${new Date().toLocaleString('tr-TR')}

🔗 <a href="${hypurrscanUrl}"><b>Acil Hypurrscan'de İncele</b></a> | <a href="${hyperdashUrl}">Hyperdash</a>
    `.trim();
  }

  // Save to database alerts table
  db.addAlert({
    wallet_address: wallet.address,
    wallet_label: wallet.label,
    coin: coinName,
    alert_type: alertType,
    message: body,
    details: {
      diffPct,
      current: current || null,
      previous: previous || null
    }
  });

  // Send to Telegram
  const result = await sendTelegramMessage(body, targetChatId);
  return result;
}

/**
 * 📝 New order alert (orderstream.js). First line = phone preview: side, coin, size, price, who.
 * The stream does not say open/close or reduce-only, so the current position is shown instead of guessing.
 */
let spotNames = { at: 0, map: {} };
/** '@142' → 'UBTC/USDC' (HL spotMeta, cached 1 h). Falls back to the raw '@N'. */
async function spotName(coin) {
  if (!coin.startsWith('@')) return coin;
  if (Date.now() - spotNames.at > 3_600_000) {
    try {
      const hl = require('./hyperliquid');
      const meta = await hl.postHyperliquid({ type: 'spotMeta' }, 5000);
      const toks = meta?.tokens || [];
      const map = {};
      for (const u of meta?.universe || []) {
        const [a, b] = u.tokens || [];
        if (u.name && toks[a] && toks[b]) map[u.name] = `${toks[a].name}/${toks[b].name}`;
      }
      spotNames = { at: Date.now(), map };
    } catch (e) {
      spotNames.at = Date.now() - 3_000_000;   // retry in ~10 min
    }
  }
  return spotNames.map[coin] || coin;
}

/** Order type from HL orderStatus (the stream has no trigger flag: a TP/SL looked like a plain limit). */
async function orderKind(address, oid) {
  try {
    const hl = require('./hyperliquid');
    const r = await hl.postHyperliquid({ type: 'orderStatus', user: address, oid }, 5000);
    const o = r?.order?.order;
    if (!o) return null;
    return { isTrigger: !!o.isTrigger, orderType: o.orderType || null, triggerPx: o.triggerPx || null,
             triggerCondition: o.triggerCondition || null };
  } catch (e) {
    return null;
  }
}

async function notifyOrderAlert({ wallet, order }) {
  const tracker = require('./tracker');
  const who = esc(wallet.label || shortAddr(wallet.address));
  const buy = order.side === 'B';
  const px = parseFloat(order.limitPx || 0);
  const sz = Math.abs(parseFloat(order.sz || 0));
  const usd = sz * px;
  const coin = String(order.coin || '');
  const spot = coin.startsWith('@') || coin.includes('/');
  const name = await spotName(coin);
  const kind = await orderKind(wallet.address, order.oid);
  const trig = kind?.isTrigger;
  const ro = order.reduceOnly ? ' · reduce-only' : '';
  const typeTxt = kind ? (trig ? `${kind.orderType || 'tetikli'} (TP/SL)` : (kind.orderType || 'Limit')) : 'emir tipi bilinmiyor';
  const refPx = trig && kind.triggerPx ? parseFloat(kind.triggerPx) : parseFloat(order.limitPx || 0);
  const st = tracker.getCachedState(wallet.address);
  const pos = (st?.positions || []).find(p => p.coin === coin);
  const posTxt = pos
    ? `${pos.side === 'LONG' ? '🟢' : '🔴'} ${pos.side} ${formatUsd(pos.positionValue)}`
    : (spot ? 'spot (pozisyon yok)' : 'bu coinde açık pozisyon yok');
  const mark = pos?.currentPrice ? parseFloat(pos.currentPrice) : null;
  const dist = mark ? ` (güncel fiyata %${(Math.abs(refPx - mark) / mark * 100).toFixed(2)})` : '';
  const head = trig
    ? `📝 ${buy ? '🟢 ALIŞ' : '🔴 SATIŞ'} TP/SL ${esc(name)} ${shortUsd(usd)} tetik ${refPx}${ro} · ${who}`
    : `📝 ${buy ? '🟢 ALIŞ' : '🔴 SATIŞ'} emri ${esc(name)} ${shortUsd(usd)} @ ${px}${ro} · ${who}`;
  const hypurrscanUrl = `https://hypurrscan.io/address/${wallet.address}`;
  const hyperdashUrl = `https://hyperdash.com/address/${wallet.address}`;
  const body = `
<b>${head}</b>

👤 <b>Balina:</b> ${who} (<code>${shortAddr(wallet.address)}</code>)
🧾 <b>Emir:</b> ${buy ? 'ALIŞ' : 'SATIŞ'} ${esc(typeTxt)}${ro} · ${sz.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${esc(name)} @ $${px}${trig && kind.triggerCondition ? ` · ${esc(kind.triggerCondition)}` : ''}${dist}
💵 <b>Tutar:</b> ${formatUsd(usd)}
📦 <b>Mevcut pozisyon:</b> ${posTxt}
⏱️ <b>Zaman:</b> ${new Date(Number(order.timestamp) || Date.now()).toLocaleString('tr-TR')}
<i>Chase emirlerde aynı coin ve yöndeki yeni emirler ${Math.round((parseInt(process.env.ORDER_CHASE_SEC || '600', 10)) / 60)} dk susturulur.</i>

🔗 <a href="${hypurrscanUrl}"><b>Hypurrscan'de İncele</b></a> | <a href="${hyperdashUrl}">Hyperdash</a>
  `.trim();
  db.addAlert({
    wallet_address: wallet.address, wallet_label: wallet.label, coin, alert_type: 'NEW_ORDER', message: body,
    details: { order }
  });
  return await sendTelegramMessage(body, wallet.telegram_chat_id || process.env.TELEGRAM_DEFAULT_CHAT_ID || config.DEFAULT_MAIN_CHAT_ID);
}

/**
 * 🪙 Spot fills batched per (coin, side) by orderstream.js. First line: side, pair, total $, avg price, who.
 */
async function notifySpotAlert({ wallet, fills }) {
  const who = esc(wallet.label || shortAddr(wallet.address));
  const coin = String(fills[0].coin || '');
  const name = await spotName(coin);
  const buy = fills[0].side === 'B';
  let qty = 0, usd = 0, taker = 0, twap = false;
  for (const f of fills) {
    const q = Math.abs(parseFloat(f.sz || 0)), p = parseFloat(f.px || 0);
    qty += q; usd += q * p;
    if (f.crossed) taker += q * p;
    if (f.twapId) twap = true;
  }
  const avg = qty ? usd / qty : 0;
  const t0 = Math.min(...fills.map(f => Number(f.time) || Date.now()));
  const head = `🪙 ${buy ? '🟢 SPOT ALIŞ' : '🔴 SPOT SATIŞ'} ${esc(name)} ${shortUsd(usd)} · ort. ${avg.toPrecision(6)}${twap ? ' · TWAP' : ''} · ${who}`;
  const body = `
<b>${head}</b>

👤 <b>Balina:</b> ${who} (<code>${shortAddr(wallet.address)}</code>)
🧾 <b>İşlem:</b> ${buy ? 'ALIŞ' : 'SATIŞ'} · ${qty.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${esc(name.split('/')[0])} · ${fills.length} dolum
💵 <b>Tutar:</b> ${formatUsd(usd)} · piyasadan %${usd ? Math.round(taker / usd * 100) : 0}${twap ? ' · HL TWAP dilimi' : ''}
⏱️ <b>Zaman:</b> ${new Date(t0).toLocaleString('tr-TR')}
<i>Aynı çiftte aynı yönde ${Math.round((parseInt(process.env.ORDER_CHASE_SEC || '600', 10)) / 60)} dk boyunca sonraki dolumlar susturulur.</i>

🔗 <a href="https://hypurrscan.io/address/${wallet.address}"><b>Hypurrscan'de İncele</b></a> | <a href="https://hyperdash.com/address/${wallet.address}">Hyperdash</a>
  `.trim();
  db.addAlert({ wallet_address: wallet.address, wallet_label: wallet.label, coin, alert_type: 'SPOT_TRADE',
                message: body, details: { n: fills.length, usd, avg } });
  return await sendTelegramMessage(body, wallet.telegram_chat_id || process.env.TELEGRAM_DEFAULT_CHAT_ID || config.DEFAULT_MAIN_CHAT_ID);
}

/**
 * 💸 Money leaving the wallet (orderstream.outgoing). First line: kind, amount, destination, who.
 */
async function notifyTransferAlert({ wallet, transfer, hash, time }) {
  const who = esc(wallet.label || shortAddr(wallet.address));
  const t = transfer;
  const amt = t.token === 'USDC' ? shortUsd(t.usd) : `${t.amount.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${esc(t.token)} (${shortUsd(t.usd)})`;
  const dest = t.to ? ` → ${shortAddr(t.to)}` : '';
  const head = `💸 DIŞARI ${esc(t.kind).toUpperCase()} ${amt}${dest} · ${who}`;
  const body = `
<b>${head}</b>

👤 <b>Balina:</b> ${who} (<code>${shortAddr(wallet.address)}</code>)
🧾 <b>Hareket:</b> ${esc(t.kind)} · ${amt}
${t.to ? `📍 <b>Hedef:</b> <a href="https://hypurrscan.io/address/${t.to}"><code>${t.to}</code></a>
` : ''}⏱️ <b>Zaman:</b> ${new Date(Number(time) || Date.now()).toLocaleString('tr-TR')}

🔗 ${hash ? `<a href="https://hypurrscan.io/tx/${hash}"><b>İşlemi gör</b></a> | ` : ''}<a href="https://hypurrscan.io/address/${wallet.address}">Hypurrscan</a>
  `.trim();
  db.addAlert({ wallet_address: wallet.address, wallet_label: wallet.label, coin: t.token, alert_type: 'TRANSFER_OUT',
                message: body, details: { transfer: t, hash } });
  return await sendTelegramMessage(body, wallet.telegram_chat_id || process.env.TELEGRAM_DEFAULT_CHAT_ID || config.DEFAULT_MAIN_CHAT_ID);
}

module.exports = {
  notifySpotAlert,
  notifyTransferAlert,
  notifyOrderAlert,
  sendTelegramMessage,
  sendTestMessage,
  notifyPositionAlert,
  headline,
  shortUsd,
  formatUsd,
  shortAddr
};
