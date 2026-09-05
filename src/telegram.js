const db = require('./db');

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
 * Send raw Telegram HTML message
 */
async function sendTelegramMessage(text, customChatId = null, overrideToken = null) {
  const settings = db.getSettings();
  const token = overrideToken || settings.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = customChatId || settings.telegram_default_chat_id || process.env.TELEGRAM_DEFAULT_CHAT_ID;

  if (!token) {
    return { success: false, reason: 'Telegram Bot Token girilmemiş. Ayarlar menüsünden ekleyebilirsiniz.' };
  }
  if (!chatId) {
    return { success: false, reason: 'Telegram Chat ID girilmemiş. Ayarlar veya cüzdan detayından ekleyebilirsiniz.' };
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
async function sendTestMessage(token = null, chatId = null) {
  const testText = `
🚀 <b>HYPERLIQUID TAKİP SİSTEMİ TEST BİLDİRİMİ</b> 🚀

✅ <b>Telegram Entegrasyonu Başarılı!</b>
Bu bildirimi alıyorsanız, bot yapılandırmanız sorunsuz çalışmaktadır.

📊 <b>Sistem Durumu:</b> 🟢 Aktif & Canlı Takipte
⏱️ <b>Zaman:</b> ${new Date().toLocaleString('tr-TR')}

<i>Artık takip ettiğiniz cüzdanlarda yeni pozisyon açıldığında veya pozisyon boyutu değiştiğinde buradan anlık bildirim alacaksınız!</i>
`.trim();

  return await sendTelegramMessage(testText, chatId, token);
}

/**
 * Format and send Position Alert to Telegram & save to Alerts history
 */
async function notifyPositionAlert({ type, wallet, current, previous = null, diffPct = 0 }) {
  const settings = db.getSettings();
  const hyperdashUrl = `https://hyperdash.com/address/${wallet.address}`;
  const addressShort = shortAddr(wallet.address);
  const targetChatId = wallet.telegram_chat_id || settings.telegram_default_chat_id;

  let title = '';
  let body = '';
  let alertType = type;
  let coinName = current ? current.coin : (previous ? previous.coin : 'HL');

  if (type === 'NEW_POSITION') {
    const sideEmoji = current.side === 'LONG' ? '🟢' : '🔴';
    title = `🚨 <b>YENİ POZİSYON AÇILDI!</b> 🚨`;
    body = `
${title}

👤 <b>Balina:</b> ${wallet.label} (<code>${addressShort}</code>)
🪙 <b>Parite:</b> ${sideEmoji} <b>${current.side} ${current.coin}</b>
📊 <b>Pozisyon Değeri:</b> ${formatUsd(current.positionValue)} (${current.size.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${current.coin})
🎯 <b>Giriş Fiyatı:</b> $${current.entryPrice}
⚡ <b>Kaldıraç:</b> ${current.leverage}
🛡️ <b>Kullanılan Teminat:</b> ${formatUsd(current.marginUsed)}
${current.liquidationPrice ? `⚠️ <b>Likidasyon Fiyatı:</b> $${current.liquidationPrice} (${current.liqDistancePct ? `%${current.liqDistancePct.toFixed(1)} uzaklık` : ''})` : ''}
⏱️ <b>Zaman:</b> ${new Date().toLocaleString('tr-TR')}

🔗 <a href="${hyperdashUrl}">Hyperdash'ta İncele</a> | <a href="https://app.hyperliquid.xyz/trade/${current.coin}">Hyperliquid Trade</a>
    `.trim();

  } else if (type === 'SIZE_CHANGE') {
    const sideEmoji = current.side === 'LONG' ? '🟢' : '🔴';
    const isIncrease = current.size > previous.size;
    const actionText = isIncrease ? `📈 Pozisyon Büyütüldü (+%${diffPct.toFixed(1)})` : `📉 Pozisyon Küçültüldü / Kâr Alındı (-%${diffPct.toFixed(1)})`;
    const pnlEmoji = current.unrealizedPnl >= 0 ? '🟢 +' : '🔴 ';

    title = `📊 <b>POZİSYON BOYUTU DEĞİŞTİ (%${diffPct.toFixed(1)})</b>`;
    body = `
${title}

👤 <b>Balina:</b> ${wallet.label} (<code>${addressShort}</code>)
🪙 <b>Parite:</b> ${sideEmoji} <b>${current.side} ${current.coin}</b>
⚡ <b>Hareket:</b> ${actionText}
📦 <b>Önceki Boyut:</b> ${previous.size.toLocaleString('en-US', { maximumFractionDigits: 4 })} (${formatUsd(previous.positionValue)})
🚀 <b>Yeni Boyut:</b> ${current.size.toLocaleString('en-US', { maximumFractionDigits: 4 })} (${formatUsd(current.positionValue)})
🎯 <b>Ort. Giriş:</b> $${current.entryPrice} | <b>Güncel:</b> $${current.currentPrice.toFixed(4)}
💰 <b>Anlık Kâr/Zarar:</b> ${pnlEmoji}${formatUsd(current.unrealizedPnl)} (%${current.roePct.toFixed(1)} ROE)
⚡ <b>Kaldıraç:</b> ${current.leverage}
⏱️ <b>Zaman:</b> ${new Date().toLocaleString('tr-TR')}

🔗 <a href="${hyperdashUrl}">Hyperdash'ta İncele</a>
    `.trim();

  } else if (type === 'CLOSED_POSITION') {
    const prevSideEmoji = previous.side === 'LONG' ? '🟢' : '🔴';
    title = `🏁 <b>POZİSYON TAMAMEN KAPATILDI</b>`;
    body = `
${title}

👤 <b>Balina:</b> ${wallet.label} (<code>${addressShort}</code>)
🪙 <b>Kapanan Parite:</b> ${prevSideEmoji} <b>${previous.side} ${previous.coin}</b>
📦 <b>Kapanan Boyut:</b> ${previous.size.toLocaleString('en-US', { maximumFractionDigits: 4 })} (${formatUsd(previous.positionValue)})
🎯 <b>Giriş Fiyatı:</b> $${previous.entryPrice}
⏱️ <b>Zaman:</b> ${new Date().toLocaleString('tr-TR')}

🔗 <a href="${hyperdashUrl}">Hyperdash'ta İncele</a>
    `.trim();

  } else if (type === 'LIQUIDATION_RISK') {
    title = `🔥 <b>LİKİDASYON RİSKİ UYARISI!</b> 🔥`;
    body = `
${title}

👤 <b>Balina:</b> ${wallet.label} (<code>${addressShort}</code>)
🪙 <b>Parite:</b> <b>${current.side} ${current.coin}</b>
⚠️ <b>Likidasyona Mesafe:</b> Sadece <b>%${current.liqDistancePct.toFixed(1)}</b> kaldı!
🎯 <b>Likidasyon Fiyatı:</b> $${current.liquidationPrice} | <b>Güncel:</b> $${current.currentPrice.toFixed(4)}
📊 <b>Risk Altındaki Değer:</b> ${formatUsd(current.positionValue)}
⏱️ <b>Zaman:</b> ${new Date().toLocaleString('tr-TR')}

🔗 <a href="${hyperdashUrl}">Acil Hyperdash'ta İncele</a>
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
  formatUsd,
  shortAddr
};
