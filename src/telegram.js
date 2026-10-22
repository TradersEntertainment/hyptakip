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
    return `${sideEmoji(current.side)} ${current.side} ${shortCoin(current.coin)} ${up ? 'büyüttü +' : 'küçülttü −'}%${diffPct.toFixed(1)} → ${shortUsd(current.positionValue)} · ${who}`;
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
      : (isIncrease ? `📈 Pozisyon Büyütüldü (+%${diffPct.toFixed(1)})` : `📉 Pozisyon Küçültüldü / Kâr Alındı (-%${diffPct.toFixed(1)})`);
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

module.exports = {
  sendTelegramMessage,
  sendTestMessage,
  notifyPositionAlert,
  headline,
  shortUsd,
  formatUsd,
  shortAddr
};
