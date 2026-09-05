// State
let wallets = [];
let selectedWallet = null;
let currentTab = 'positions';
let autoRefreshTimer = null;
let appSettings = {};

// Helpers
function formatUsd(num) {
  const n = parseFloat(num);
  if (isNaN(n)) return '$0.00';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCrypto(num, decimals = 4) {
  const n = parseFloat(num);
  if (isNaN(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: decimals });
}

function shortAddress(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const colors = {
    success: 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200',
    error: 'bg-red-950/90 border-red-500/50 text-red-200',
    info: 'bg-slate-900/90 border-cyan-500/50 text-cyan-200'
  };

  toast.className = `px-4 py-3 rounded-xl border shadow-xl text-xs font-semibold flex items-center gap-2 pointer-events-auto transition-all duration-300 transform translate-y-2 opacity-0 ${colors[type] || colors.info}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 10);

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Fetch Wallets
async function loadWallets() {
  try {
    const res = await fetch('/api/wallets');
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    wallets = data.wallets || [];
    renderWalletsList();
    updateTopStats();

    // If no wallet selected yet, select first active or first wallet
    if (wallets.length > 0) {
      if (!selectedWallet || !wallets.find(w => w.address.toLowerCase() === selectedWallet.address.toLowerCase())) {
        selectWallet(wallets[0]);
      } else {
        // Update reference
        const updated = wallets.find(w => w.address.toLowerCase() === selectedWallet.address.toLowerCase());
        selectWallet(updated, false);
      }
    } else {
      selectedWallet = null;
      renderEmptyState();
    }
  } catch (err) {
    console.error('loadWallets error:', err);
  }
}

// Update Top Stats
function updateTopStats() {
  const countEl = document.getElementById('stat-wallet-count');
  const badgeCountEl = document.getElementById('badge-wallet-count');
  const volumeEl = document.getElementById('stat-total-volume');
  const lastUpdatedEl = document.getElementById('stat-last-updated');

  if (countEl) countEl.textContent = wallets.length;
  if (badgeCountEl) badgeCountEl.textContent = wallets.length;

  let totalNtl = 0;
  for (const w of wallets) {
    if (w.state && w.state.totalNtlPos) {
      totalNtl += parseFloat(w.state.totalNtlPos || 0);
    }
  }
  if (volumeEl) volumeEl.textContent = formatUsd(totalNtl);
  if (lastUpdatedEl) lastUpdatedEl.textContent = new Date().toLocaleTimeString('tr-TR');
}

// Render Left Wallets List
function renderWalletsList() {
  const container = document.getElementById('wallets-list-container');
  if (!container) return;

  if (wallets.length === 0) {
    container.innerHTML = `<div class="text-center py-6 text-xs text-slate-500">Takip edilen cüzdan yok.<br>Yeni balina ekleyin.</div>`;
    return;
  }

  container.innerHTML = wallets.map(w => {
    const isSelected = selectedWallet && selectedWallet.address.toLowerCase() === w.address.toLowerCase();
    const state = w.state || {};
    const posCount = (state.positions && state.positions.length) || 0;
    const accVal = state.accountValue ? formatUsd(state.accountValue) : '$0.00';
    const unPnl = state.totalUnrealizedPnl || 0;
    const pnlColor = unPnl > 0 ? 'text-emerald-400' : (unPnl < 0 ? 'text-red-400' : 'text-slate-400');

    return `
      <div 
        onclick="onSelectWallet('${w.address}')"
        class="cursor-pointer p-3 rounded-xl border transition ${
          isSelected 
            ? 'bg-slate-800/90 border-cyan-400/60 shadow-lg shadow-cyan-500/10' 
            : 'bg-slate-900/50 border-white/5 hover:border-white/20 hover:bg-slate-800/40'
        }"
      >
        <div class="flex items-center justify-between mb-1.5">
          <div class="font-bold text-xs text-white truncate max-w-[150px]">${w.label}</div>
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 font-mono">
              %${w.threshold_pct || 10}
            </span>
            ${w.is_active ? '<span class="w-2 h-2 rounded-full bg-emerald-400"></span>' : '<span class="w-2 h-2 rounded-full bg-slate-600"></span>'}
          </div>
        </div>

        <div class="flex items-center justify-between text-[11px] text-slate-400">
          <span class="font-mono text-[10px]">${shortAddress(w.address)}</span>
          <span class="font-semibold text-white">${accVal}</span>
        </div>

        <div class="flex items-center justify-between text-[10px] mt-1 pt-1 border-t border-white/5">
          <span class="text-slate-500">${posCount} Pozisyon</span>
          <span class="${pnlColor} font-medium">${unPnl >= 0 ? '+' : ''}${formatUsd(unPnl)}</span>
        </div>
      </div>
    `;
  }).join('');
}

window.onSelectWallet = function(addr) {
  const target = wallets.find(w => w.address.toLowerCase() === addr.toLowerCase());
  if (target) selectWallet(target);
};

// Select and Display Wallet
async function selectWallet(wallet, fetchFills = true) {
  selectedWallet = wallet;
  renderWalletsList();

  // Update Header UI
  const nameEl = document.getElementById('view-whale-name');
  const addrEl = document.getElementById('view-whale-address');
  const threshLabel = document.getElementById('view-threshold-label');
  const dashLink = document.getElementById('link-hyperdash');
  const hlLink = document.getElementById('link-hyperliquid-app');

  if (nameEl) nameEl.textContent = wallet.label;
  if (addrEl) addrEl.textContent = wallet.address;
  if (threshLabel) threshLabel.textContent = `%${wallet.threshold_pct || 10}`;
  if (dashLink) dashLink.href = `https://hyperdash.com/address/${wallet.address}`;
  if (hlLink) hlLink.href = `https://app.hyperliquid.xyz/explorer/address/${wallet.address}`;

  // Fetch fresh state for this wallet
  try {
    const res = await fetch(`/api/wallets/${wallet.address}/state`);
    const data = await res.json();
    if (data.success && data.state) {
      renderWhaleState(data.state);
    } else if (wallet.state) {
      renderWhaleState(wallet.state);
    }
  } catch (err) {
    if (wallet.state) renderWhaleState(wallet.state);
  }

  // Load current tab data
  if (currentTab === 'fills' && fetchFills) {
    loadFills();
  } else if (currentTab === 'alerts') {
    loadAlerts();
  }
}

// Render Whale Metrics & Positions Table
function renderWhaleState(state) {
  // Metrics
  document.getElementById('metric-account-value').textContent = formatUsd(state.accountValue || 0);
  
  const unPnl = state.totalUnrealizedPnl || 0;
  const unPnlEl = document.getElementById('metric-unrealized-pnl');
  unPnlEl.textContent = `PnL: ${unPnl >= 0 ? '+' : ''}${formatUsd(unPnl)}`;
  unPnlEl.className = `text-xs font-semibold mt-0.5 ${unPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`;

  document.getElementById('metric-margin-used').textContent = formatUsd(state.totalMarginUsed || 0);
  
  const ratio = state.accountValue > 0 ? ((state.totalMarginUsed / state.accountValue) * 100).toFixed(1) : '0';
  document.getElementById('metric-margin-ratio').textContent = `%${ratio} Kullanım`;

  document.getElementById('metric-withdrawable').textContent = formatUsd(state.withdrawable || 0);
  document.getElementById('metric-notional-value').textContent = formatUsd(state.totalNtlPos || 0);

  const posCount = (state.positions && state.positions.length) || 0;
  document.getElementById('metric-pos-count').textContent = `${posCount} Pozisyon`;
  document.getElementById('tab-count-positions').textContent = posCount;

  // Render Table
  renderPositionsTable(state.positions || []);
}

// Render Positions Table
function renderPositionsTable(positions) {
  const tbody = document.getElementById('positions-table-body');
  if (!tbody) return;

  if (positions.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-12 text-slate-500">
          <div class="flex flex-col items-center gap-2">
            <i data-lucide="check-circle-2" class="w-6 h-6 text-slate-600"></i>
            <span>Bu cüzdanda şu an açık pozisyon bulunmuyor.</span>
          </div>
        </td>
      </tr>
    `;
    lucide.createIcons();
    return;
  }

  tbody.innerHTML = positions.map(p => {
    const isLong = p.side === 'LONG';
    const sideBadge = isLong 
      ? `<span class="badge-long px-2 py-0.5 rounded font-bold text-[10px]">🟢 LONG</span>`
      : `<span class="badge-short px-2 py-0.5 rounded font-bold text-[10px]">🔴 SHORT</span>`;

    const pnlColor = p.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400';
    const roeColor = p.roePct >= 0 ? 'text-emerald-400' : 'text-red-400';

    // Liquidation display
    let liqDisplay = `<span class="text-slate-500">-</span>`;
    if (p.liquidationPrice) {
      const dist = p.liqDistancePct !== null ? `${p.liqDistancePct.toFixed(1)}%` : '';
      const distColor = p.liqDistancePct < 15 ? 'text-red-400 font-bold' : 'text-slate-300';
      liqDisplay = `
        <div class="text-right">
          <div class="font-mono text-white">$${p.liquidationPrice.toFixed(4)}</div>
          <div class="text-[10px] ${distColor}">${dist ? dist + ' mesafe' : ''}</div>
        </div>
      `;
    }

    return `
      <tr class="hover:bg-slate-800/40 transition">
        <!-- Coin -->
        <td class="py-3 px-4 font-bold text-white flex items-center gap-2">
          <span class="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-[10px] text-cyan-400 font-black border border-white/10">
            ${p.coin.slice(0, 3)}
          </span>
          <a href="https://app.hyperliquid.xyz/trade/${p.coin}" target="_blank" class="hover:text-cyan-400 transition">
            ${p.coin}
          </a>
        </td>

        <!-- Yön -->
        <td class="py-3 px-3">
          ${sideBadge}
        </td>

        <!-- Boyut -->
        <td class="py-3 px-3 text-right">
          <div class="font-bold text-white font-mono">${formatUsd(p.positionValue)}</div>
          <div class="text-[10px] text-slate-400 font-mono">${formatCrypto(p.size)} ${p.coin}</div>
        </td>

        <!-- Giriş Fiyatı -->
        <td class="py-3 px-3 text-right font-mono text-slate-300">
          $${p.entryPrice}
        </td>

        <!-- Mark Fiyatı -->
        <td class="py-3 px-3 text-right font-mono text-white font-semibold">
          $${p.currentPrice.toFixed(4)}
        </td>

        <!-- PnL -->
        <td class="py-3 px-3 text-right">
          <div class="font-bold font-mono ${pnlColor}">${p.unrealizedPnl >= 0 ? '+' : ''}${formatUsd(p.unrealizedPnl)}</div>
          <div class="text-[10px] font-mono font-semibold ${roeColor}">(${p.roePct >= 0 ? '+' : ''}${p.roePct.toFixed(2)}% ROE)</div>
        </td>

        <!-- Likidasyon -->
        <td class="py-3 px-3">
          ${liqDisplay}
        </td>

        <!-- Kaldıraç & Teminat -->
        <td class="py-3 px-3 text-right">
          <div class="font-semibold text-slate-200 text-[11px]">${p.leverage}</div>
          <div class="text-[10px] text-slate-400 font-mono">${formatUsd(p.marginUsed)}</div>
        </td>
      </tr>
    `;
  }).join('');

  lucide.createIcons();
}

// Load Fills Tab
async function loadFills() {
  if (!selectedWallet) return;
  const tbody = document.getElementById('fills-table-body');
  tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-500">İşlemler yükleniyor...</td></tr>`;

  try {
    const res = await fetch(`/api/wallets/${selectedWallet.address}/fills`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const fills = data.fills || [];
    if (fills.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-500">Son işlem geçmişi bulunamadı.</td></tr>`;
      return;
    }

    tbody.innerHTML = fills.slice(0, 50).map(f => {
      const isBuy = f.side === 'BUY';
      const dirColor = isBuy ? 'text-emerald-400' : 'text-red-400';
      const timeStr = new Date(f.time).toLocaleString('tr-TR');
      const pnl = f.closedPnl || 0;
      const pnlColor = pnl > 0 ? 'text-emerald-400' : (pnl < 0 ? 'text-red-400' : 'text-slate-400');

      return `
        <tr class="hover:bg-slate-800/40 transition">
          <td class="py-2.5 px-4 text-slate-400 font-mono text-[11px]">${timeStr}</td>
          <td class="py-2.5 px-3 font-bold text-white">${f.coin}</td>
          <td class="py-2.5 px-3 font-semibold text-[11px] ${dirColor}">${f.dir || f.side}</td>
          <td class="py-2.5 px-3 text-right font-mono text-white">$${f.px}</td>
          <td class="py-2.5 px-3 text-right font-mono text-slate-300">${formatCrypto(f.sz)}</td>
          <td class="py-2.5 px-3 text-right font-mono font-semibold ${pnlColor}">${pnl !== 0 ? (pnl > 0 ? '+' : '') + formatUsd(pnl) : '-'}</td>
          <td class="py-2.5 px-3 text-right font-mono text-slate-400 text-[10px]">${formatUsd(f.fee)}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-red-400">İşlem geçmişi alınamadı: ${err.message}</td></tr>`;
  }
}

// Load Alerts Tab
async function loadAlerts() {
  const container = document.getElementById('alerts-container');
  const countBadge = document.getElementById('tab-count-alerts');

  try {
    const res = await fetch('/api/alerts?limit=50');
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const alerts = data.alerts || [];
    if (countBadge) countBadge.textContent = alerts.length;

    if (alerts.length === 0) {
      container.innerHTML = `<div class="text-center py-10 text-xs text-slate-500">Henüz bildirim kaydı yok.</div>`;
      return;
    }

    container.innerHTML = alerts.map(a => {
      const typeIcons = {
        NEW_POSITION: '⚡',
        SIZE_CHANGE: '📈',
        CLOSED_POSITION: '🏁',
        LIQUIDATION_RISK: '🔥'
      };

      const typeLabels = {
        NEW_POSITION: 'YENİ POZİSYON',
        SIZE_CHANGE: 'BOYUT DEĞİŞİMİ',
        CLOSED_POSITION: 'KAPATILDI',
        LIQUIDATION_RISK: 'LİKİDASYON RİSKİ'
      };

      const timeStr = new Date(a.created_at).toLocaleString('tr-TR');

      return `
        <div class="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 hover:border-white/10 space-y-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-base">${typeIcons[a.alert_type] || '🔔'}</span>
              <span class="font-bold text-xs text-cyan-400">${typeLabels[a.alert_type] || a.alert_type}</span>
              <span class="text-xs text-slate-400">• ${a.wallet_label}</span>
            </div>
            <span class="text-[10px] font-mono text-slate-500">${timeStr}</span>
          </div>
          <div class="text-xs text-slate-300 font-mono bg-black/40 p-2.5 rounded-lg whitespace-pre-line leading-relaxed">
            ${a.message}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="text-center py-6 text-xs text-red-400">Bildirimler yüklenemedi: ${err.message}</div>`;
  }
}

// Load Settings
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (!data.success) return;

    appSettings = data.settings || {};

    const tokenInput = document.getElementById('settings-bot-token');
    const chatInput = document.getElementById('settings-default-chatid');
    const pollSelect = document.getElementById('settings-poll-interval');
    const banner = document.getElementById('telegram-warning-banner');

    if (tokenInput && appSettings.telegram_bot_token) tokenInput.value = appSettings.telegram_bot_token;
    if (chatInput && appSettings.telegram_default_chat_id) chatInput.value = appSettings.telegram_default_chat_id;
    if (pollSelect && appSettings.poll_interval_seconds) pollSelect.value = appSettings.poll_interval_seconds;

    // Show warning banner if token is empty
    if (!appSettings.telegram_bot_token || !appSettings.telegram_default_chat_id) {
      if (banner) banner.classList.remove('hidden');
    } else {
      if (banner) banner.classList.add('hidden');
    }
  } catch (err) {
    console.error('loadSettings error:', err);
  }
}

// Save Settings Form
document.getElementById('form-settings')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = document.getElementById('settings-bot-token').value.trim();
  const chatId = document.getElementById('settings-default-chatid').value.trim();
  const poll = document.getElementById('settings-poll-interval').value;

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegram_bot_token: token,
        telegram_default_chat_id: chatId,
        poll_interval_seconds: poll
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Ayarlar başarıyla kaydedildi!', 'success');
      document.getElementById('modal-settings').classList.add('hidden');
      loadSettings();
    } else {
      showToast('Kayıt hatası: ' + data.error, 'error');
    }
  } catch (err) {
    showToast('Hata: ' + err.message, 'error');
  }
});

// Test Telegram Button
document.getElementById('btn-test-telegram')?.addEventListener('click', async () => {
  const token = document.getElementById('settings-bot-token').value.trim();
  const chatId = document.getElementById('settings-default-chatid').value.trim();
  const feedback = document.getElementById('test-telegram-feedback');

  feedback.classList.remove('hidden');
  feedback.className = 'text-xs mt-1.5 text-center text-cyan-400';
  feedback.textContent = 'Telegram bildirimi gönderiliyor...';

  try {
    const res = await fetch('/api/settings/test-telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, chatId })
    });
    const data = await res.json();
    if (data.success) {
      feedback.className = 'text-xs mt-1.5 text-center text-emerald-400 font-bold';
      feedback.textContent = '✅ ' + data.message;
      showToast('Telegram bildirimi iletildi!', 'success');
    } else {
      feedback.className = 'text-xs mt-1.5 text-center text-red-400';
      feedback.textContent = '❌ ' + (data.error || 'Gönderilemedi');
      showToast('Telegram hatası: ' + data.error, 'error');
    }
  } catch (err) {
    feedback.className = 'text-xs mt-1.5 text-center text-red-400';
    feedback.textContent = '❌ Hata: ' + err.message;
  }
});

// Add Whale Form (Matches screenshot)
document.getElementById('form-add-wallet')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById('btn-submit-add');
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span>Ekleniyor...</span>`;

  const label = document.getElementById('input-add-label').value.trim();
  const address = document.getElementById('input-add-address').value.trim();
  const chatId = document.getElementById('input-add-chatid').value.trim();
  const threshold = document.getElementById('input-add-threshold').value;

  try {
    const res = await fetch('/api/wallets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: label || undefined,
        address,
        telegram_chat_id: chatId || null,
        threshold_pct: parseFloat(threshold) || 10.0,
        is_active: 1
      })
    });

    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error);
    }

    showToast(`Balina (${data.wallet.label}) başarıyla takibe alındı!`, 'success');
    document.getElementById('modal-add-wallet').classList.add('hidden');
    document.getElementById('form-add-wallet').reset();
    document.getElementById('label-threshold-val').textContent = '%10';

    await loadWallets();
    selectWallet(data.wallet);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>Takibe Başla</span>`;
  }
});

// Delete Selected Whale
document.getElementById('btn-delete-selected-whale')?.addEventListener('click', async () => {
  if (!selectedWallet) return;
  const ok = confirm(`"${selectedWallet.label}" cüzdanını takipten çıkarmak istediğinize emin misiniz?`);
  if (!ok) return;

  try {
    const res = await fetch(`/api/wallets/${selectedWallet.address}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Cüzdan takipten çıkarıldı', 'info');
      selectedWallet = null;
      await loadWallets();
    }
  } catch (err) {
    showToast('Hata: ' + err.message, 'error');
  }
});

// Edit Selected Whale
document.getElementById('btn-edit-selected-whale')?.addEventListener('click', async () => {
  if (!selectedWallet) return;
  const newLabel = prompt('Yeni Balina Adı / Lakabı:', selectedWallet.label);
  if (newLabel === null) return;

  const newThreshold = prompt('Yeni Boyut Değişimi Uyarı Eşiği (%) [Örn: 10]:', selectedWallet.threshold_pct || 10);
  if (newThreshold === null) return;

  const newChatId = prompt('Özel Telegram Chat ID (Boş bırakılırsa genel kullanılır):', selectedWallet.telegram_chat_id || '');
  if (newChatId === null) return;

  try {
    const res = await fetch(`/api/wallets/${selectedWallet.address}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: newLabel.trim(),
        threshold_pct: parseFloat(newThreshold) || 10.0,
        telegram_chat_id: newChatId.trim() || null
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Cüzdan ayarları güncellendi!', 'success');
      await loadWallets();
    }
  } catch (err) {
    showToast('Hata: ' + err.message, 'error');
  }
});

// Copy Address
document.getElementById('btn-copy-address')?.addEventListener('click', () => {
  if (!selectedWallet) return;
  navigator.clipboard.writeText(selectedWallet.address);
  showToast('Cüzdan adresi panoya kopyalandı!', 'info');
});

// Manual Refresh Now
document.getElementById('btn-refresh-now')?.addEventListener('click', async () => {
  const spinner = document.getElementById('refresh-spinner');
  spinner?.classList.add('animate-spin');

  try {
    await fetch('/api/tracker/trigger', { method: 'POST' });
    await loadWallets();
    showToast('Veriler ve pozisyonlar güncellendi!', 'info');
  } catch (err) {
    showToast('Yenileme hatası: ' + err.message, 'error');
  } finally {
    setTimeout(() => spinner?.classList.remove('animate-spin'), 600);
  }
});

// Clear Alerts
document.getElementById('btn-clear-alerts')?.addEventListener('click', async () => {
  if (!confirm('Tüm bildirim geçmişini temizlemek istiyor musunuz?')) return;
  try {
    await fetch('/api/alerts', { method: 'DELETE' });
    loadAlerts();
    showToast('Bildirimler temizlendi', 'info');
  } catch (err) {
    showToast('Hata: ' + err.message, 'error');
  }
});

// Tab Switchers
function setupTabs() {
  const btnPos = document.getElementById('tab-btn-positions');
  const btnFills = document.getElementById('tab-btn-fills');
  const btnAlerts = document.getElementById('tab-btn-alerts');

  const panePos = document.getElementById('tab-pane-positions');
  const paneFills = document.getElementById('tab-pane-fills');
  const paneAlerts = document.getElementById('tab-pane-alerts');

  function activate(activeBtn, activePane, tabName) {
    currentTab = tabName;
    [btnPos, btnFills, btnAlerts].forEach(b => {
      b.className = 'px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 flex items-center gap-2 transition';
    });
    activeBtn.className = 'px-4 py-2 rounded-xl text-xs font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 flex items-center gap-2 transition';

    [panePos, paneFills, paneAlerts].forEach(p => p.classList.add('hidden'));
    activePane.classList.remove('hidden');

    if (tabName === 'fills') loadFills();
    if (tabName === 'alerts') loadAlerts();
  }

  btnPos?.addEventListener('click', () => activate(btnPos, panePos, 'positions'));
  btnFills?.addEventListener('click', () => activate(btnFills, paneFills, 'fills'));
  btnAlerts?.addEventListener('click', () => activate(btnAlerts, paneAlerts, 'alerts'));
}

// Modal Triggers
document.getElementById('btn-open-add-modal')?.addEventListener('click', () => {
  document.getElementById('modal-add-wallet').classList.remove('hidden');
});

document.getElementById('btn-open-settings')?.addEventListener('click', () => {
  document.getElementById('modal-settings').classList.remove('hidden');
});

// Auto-Refresh Loop
function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => {
    loadWallets();
    if (currentTab === 'alerts') loadAlerts();
  }, 6000);
}

// Initialization
window.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  loadSettings();
  loadWallets();
  loadAlerts();
  startAutoRefresh();
});
