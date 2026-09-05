// State
let wallets = [];
let selectedWallet = null;
let currentTab = 'positions';
let autoRefreshTimer = null;
let appSettings = {};
let previousPositionsMap = new Map();
let soundEnabled = localStorage.getItem('sound_enabled') !== 'false';

// Web Audio API Synthesizer (Zero external audio files needed!)
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playClickSound() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.04);
    gain.gain.setValueAtTime(0.04, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  } catch (e) {}
}

function playAlertSound() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    
    // Note 1 (D5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.22);

    // Note 2 (A5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880.00, now + 0.12);
    gain2.gain.setValueAtTime(0.12, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.42);
  } catch (e) {}
}

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
    success: 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200 shadow-emerald-500/20',
    error: 'bg-rose-950/90 border-rose-500/50 text-rose-200 shadow-rose-500/20',
    info: 'bg-[#0b1020]/95 border-cyan-500/50 text-cyan-200 shadow-cyan-500/20'
  };

  toast.className = `px-4 py-3 rounded-xl border shadow-xl text-xs font-semibold flex items-center gap-2 pointer-events-auto transition-all duration-300 transform translate-y-2 opacity-0 backdrop-blur-lg ${colors[type] || colors.info}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  if (type === 'success' || type === 'error') {
    playAlertSound();
  } else {
    playClickSound();
  }

  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 10);

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Fetch Live Market Prices for Ticker
async function loadMarketTicker() {
  try {
    const res = await fetch('/api/mids');
    const data = await res.json();
    if (!data.success || !data.mids) return;

    const mids = data.mids;
    function updateCoin(id, coin) {
      const el = document.getElementById(id);
      if (el && mids[coin]) {
        const val = parseFloat(mids[coin]);
        el.textContent = '$' + (val >= 1 ? val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : val.toFixed(4));
      }
    }

    updateCoin('ticker-price-btc', 'BTC');
    updateCoin('ticker-price-eth', 'ETH');
    updateCoin('ticker-price-sol', 'SOL');
    updateCoin('ticker-price-aster', 'ASTER');
    updateCoin('ticker-price-hype', 'HYPE');

    const tickEl = document.getElementById('stat-last-tick');
    if (tickEl) tickEl.textContent = new Date().toLocaleTimeString('tr-TR');
  } catch (e) {
    console.error('Ticker fetch error:', e);
  }
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

    if (wallets.length > 0) {
      if (!selectedWallet || !wallets.find(w => w.address.toLowerCase() === selectedWallet.address.toLowerCase())) {
        selectWallet(wallets[0]);
      } else {
        const updated = wallets.find(w => w.address.toLowerCase() === selectedWallet.address.toLowerCase());
        selectWallet(updated, false);
      }
    } else {
      selectedWallet = null;
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

  if (countEl) countEl.textContent = wallets.length;
  if (badgeCountEl) badgeCountEl.textContent = wallets.length;

  let totalNtl = 0;
  for (const w of wallets) {
    if (w.state && w.state.totalNtlPos) {
      totalNtl += parseFloat(w.state.totalNtlPos || 0);
    }
  }
  if (volumeEl) volumeEl.textContent = formatUsd(totalNtl);
}

// Render Left Wallets List with Search Filter
function renderWalletsList() {
  const container = document.getElementById('wallets-list-container');
  if (!container) return;

  const query = (document.getElementById('search-wallet-input')?.value || '').trim().toLowerCase();
  const filtered = wallets.filter(w => {
    if (!query) return true;
    return w.label.toLowerCase().includes(query) || w.address.toLowerCase().includes(query);
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="text-center py-6 text-xs text-slate-500">${query ? 'Aramaya uygun balina bulunamadı.' : 'Takip edilen cüzdan yok.'}</div>`;
    return;
  }

  container.innerHTML = filtered.map(w => {
    const isSelected = selectedWallet && selectedWallet.address.toLowerCase() === w.address.toLowerCase();
    const state = w.state || {};
    const posCount = (state.positions && state.positions.length) || 0;
    const accVal = state.accountValue ? formatUsd(state.accountValue) : '$0.00';
    const unPnl = state.totalUnrealizedPnl || 0;
    const pnlColor = unPnl > 0 ? 'text-emerald-400' : (unPnl < 0 ? 'text-rose-400' : 'text-slate-400');

    return `
      <div 
        onclick="onSelectWallet('${w.address}')"
        class="cursor-pointer p-3.5 rounded-2xl border transition ultra-card-hover ${
          isSelected 
            ? 'bg-[#0f1527] border-cyan-400 shadow-lg shadow-cyan-500/15 ring-1 ring-cyan-400/40' 
            : 'bg-slate-950/50 border-white/5 hover:border-white/20 hover:bg-slate-900/60'
        }"
      >
        <div class="flex items-center justify-between mb-1.5">
          <div class="font-bold text-xs text-white truncate max-w-[160px] flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full ${w.is_active ? 'bg-cyan-400 shadow-sm shadow-cyan-400' : 'bg-slate-600'}"></span>
            <span>${w.label}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 font-mono font-semibold">
              %${w.threshold_pct || 10}
            </span>
          </div>
        </div>

        <div class="flex items-center justify-between text-[11px] text-slate-400">
          <span class="font-mono text-[10px] text-slate-500">${shortAddress(w.address)}</span>
          <span class="font-bold text-white font-mono">${accVal}</span>
        </div>

        <div class="flex items-center justify-between text-[10px] mt-2 pt-2 border-t border-white/5 font-mono">
          <span class="text-slate-500 flex items-center gap-1">
            <i data-lucide="layers" class="w-3 h-3 text-slate-500"></i> ${posCount} Pozisyon
          </span>
          <span class="${pnlColor} font-bold">${unPnl >= 0 ? '+' : ''}${formatUsd(unPnl)}</span>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

window.onSelectWallet = function(addr) {
  playClickSound();
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
  const threshPill = document.getElementById('view-whale-threshold-pill');
  const threshLabel = document.getElementById('view-threshold-label');
  const dashLink = document.getElementById('link-hyperdash');
  const hlLink = document.getElementById('link-hyperliquid-app');

  if (nameEl) nameEl.textContent = wallet.label;
  if (addrEl) addrEl.textContent = wallet.address;
  if (threshPill) threshPill.textContent = `EŞİK: %${wallet.threshold_pct || 10}`;
  if (threshLabel) threshLabel.textContent = `%${wallet.threshold_pct || 10}`;
  if (dashLink) dashLink.href = `https://hyperdash.com/address/${wallet.address}`;
  if (hlLink) hlLink.href = `https://app.hyperliquid.xyz/explorer/address/${wallet.address}`;

  // Fetch fresh state
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

  if (currentTab === 'fills' && fetchFills) {
    loadFills();
  } else if (currentTab === 'alerts') {
    loadAlerts();
  }
}

// Render Whale Metrics & Positions Table
function renderWhaleState(state) {
  const accValEl = document.getElementById('metric-account-value');
  const prevAccVal = accValEl.textContent;
  const newAccVal = formatUsd(state.accountValue || 0);
  accValEl.textContent = newAccVal;

  // Flash update animation if changed
  if (prevAccVal && prevAccVal !== newAccVal && prevAccVal !== '$0.00') {
    accValEl.classList.remove('flash-up', 'flash-down');
    void accValEl.offsetWidth; // trigger reflow
    accValEl.classList.add('flash-up');
  }

  const unPnl = state.totalUnrealizedPnl || 0;
  const unPnlEl = document.getElementById('metric-unrealized-pnl');
  unPnlEl.textContent = `PnL: ${unPnl >= 0 ? '+' : ''}${formatUsd(unPnl)}`;
  unPnlEl.className = `text-xs font-semibold mt-0.5 font-mono ${unPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

  document.getElementById('metric-margin-used').textContent = formatUsd(state.totalMarginUsed || 0);
  
  const ratio = state.accountValue > 0 ? ((state.totalMarginUsed / state.accountValue) * 100).toFixed(1) : '0';
  document.getElementById('metric-margin-ratio').textContent = `%${ratio} Kullanım`;
  const marginBar = document.getElementById('metric-margin-bar');
  if (marginBar) {
    marginBar.style.width = Math.min(100, Math.max(0, ratio)) + '%';
  }

  document.getElementById('metric-withdrawable').textContent = formatUsd(state.withdrawable || 0);
  document.getElementById('metric-notional-value').textContent = formatUsd(state.totalNtlPos || 0);

  const posCount = (state.positions && state.positions.length) || 0;
  document.getElementById('metric-pos-count').textContent = `${posCount} Pozisyon`;
  document.getElementById('tab-count-positions').textContent = posCount;

  renderPositionsTable(state.positions || []);
}

// Render Positions Table with Ultra Badges and Risk Bars
function renderPositionsTable(positions) {
  const tbody = document.getElementById('positions-table-body');
  if (!tbody) return;

  if (positions.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-16 text-slate-500 font-sans">
          <div class="flex flex-col items-center justify-center gap-2.5">
            <div class="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-slate-600 border border-white/5">
              <i data-lucide="shield-check" class="w-5 h-5"></i>
            </div>
            <span class="font-medium text-xs text-slate-400">Bu cüzdanda şu an açık pozisyon bulunmuyor.</span>
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
      ? `<span class="badge-long px-2.5 py-1 rounded-lg font-bold text-[10px] flex items-center gap-1.5 w-fit">
           <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> LONG
         </span>`
      : `<span class="badge-short px-2.5 py-1 rounded-lg font-bold text-[10px] flex items-center gap-1.5 w-fit">
           <span class="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse"></span> SHORT
         </span>`;

    const pnlColor = p.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400';
    const roeColor = p.roePct >= 0 ? 'text-emerald-400' : 'text-rose-400';

    // Liquidation Gauge display
    let liqDisplay = `<span class="text-slate-600 font-sans text-xs">-</span>`;
    if (p.liquidationPrice) {
      const dist = p.liqDistancePct !== null ? p.liqDistancePct : 100;
      let distBadge = '';
      let barColor = 'bg-emerald-400';

      if (dist < 10) {
        distBadge = `<span class="text-[10px] font-bold text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/30 animate-pulse">KRİTİK %${dist.toFixed(1)}</span>`;
        barColor = 'bg-rose-500';
      } else if (dist < 25) {
        distBadge = `<span class="text-[10px] font-semibold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30">%${dist.toFixed(1)} mesafe</span>`;
        barColor = 'bg-amber-400';
      } else {
        distBadge = `<span class="text-[10px] text-slate-400">%${dist.toFixed(1)} mesafe</span>`;
        barColor = 'bg-cyan-400';
      }

      liqDisplay = `
        <div class="text-right">
          <div class="font-bold text-white">$${p.liquidationPrice.toFixed(4)}</div>
          <div class="mt-1">${distBadge}</div>
        </div>
      `;
    }

    return `
      <tr class="ultra-tr">
        <!-- Coin -->
        <td class="py-3.5 px-4 font-bold text-white flex items-center gap-2.5 font-sans">
          <div class="w-7 h-7 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center text-[10px] text-cyan-300 font-black border border-white/10 shadow-sm">
            ${p.coin.slice(0, 3)}
          </div>
          <div>
            <a href="https://app.hyperliquid.xyz/trade/${p.coin}" target="_blank" class="hover:text-cyan-400 transition font-extrabold text-sm">
              ${p.coin}
            </a>
            <span class="text-[10px] text-slate-500 block font-mono">PERP</span>
          </div>
        </td>

        <!-- Yön -->
        <td class="py-3.5 px-3">
          ${sideBadge}
        </td>

        <!-- Boyut -->
        <td class="py-3.5 px-3 text-right">
          <div class="font-bold text-white">${formatUsd(p.positionValue)}</div>
          <div class="text-[10px] text-slate-400">${formatCrypto(p.size)} ${p.coin}</div>
        </td>

        <!-- Giriş Fiyatı -->
        <td class="py-3.5 px-3 text-right text-slate-300">
          $${p.entryPrice}
        </td>

        <!-- Mark Fiyatı -->
        <td class="py-3.5 px-3 text-right text-white font-semibold">
          $${p.currentPrice.toFixed(4)}
        </td>

        <!-- PnL -->
        <td class="py-3.5 px-3 text-right">
          <div class="font-bold ${pnlColor}">${p.unrealizedPnl >= 0 ? '+' : ''}${formatUsd(p.unrealizedPnl)}</div>
          <div class="text-[10px] font-semibold ${roeColor}">(${p.roePct >= 0 ? '+' : ''}${p.roePct.toFixed(2)}% ROE)</div>
        </td>

        <!-- Likidasyon -->
        <td class="py-3.5 px-3">
          ${liqDisplay}
        </td>

        <!-- Kaldıraç & Teminat -->
        <td class="py-3.5 px-3 text-right font-sans">
          <div class="font-bold text-slate-200 text-xs">${p.leverage}</div>
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
  tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-500 font-sans">İşlemler yükleniyor...</td></tr>`;

  try {
    const res = await fetch(`/api/wallets/${selectedWallet.address}/fills`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const fills = data.fills || [];
    if (fills.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-500 font-sans">Son işlem geçmişi bulunamadı.</td></tr>`;
      return;
    }

    tbody.innerHTML = fills.slice(0, 50).map(f => {
      const isBuy = f.side === 'BUY';
      const dirColor = isBuy ? 'text-emerald-400' : 'text-rose-400';
      const timeStr = new Date(f.time).toLocaleString('tr-TR');
      const pnl = f.closedPnl || 0;
      const pnlColor = pnl > 0 ? 'text-emerald-400' : (pnl < 0 ? 'text-rose-400' : 'text-slate-400');

      return `
        <tr class="ultra-tr">
          <td class="py-2.5 px-4 text-slate-400 text-[11px]">${timeStr}</td>
          <td class="py-2.5 px-3 font-bold text-white font-sans">${f.coin}</td>
          <td class="py-2.5 px-3 font-bold text-[11px] ${dirColor}">${f.dir || f.side}</td>
          <td class="py-2.5 px-3 text-right text-white">$${f.px}</td>
          <td class="py-2.5 px-3 text-right text-slate-300">${formatCrypto(f.sz)}</td>
          <td class="py-2.5 px-3 text-right font-bold ${pnlColor}">${pnl !== 0 ? (pnl > 0 ? '+' : '') + formatUsd(pnl) : '-'}</td>
          <td class="py-2.5 px-3 text-right text-slate-400 text-[10px]">${formatUsd(f.fee)}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-rose-400 font-sans">İşlem geçmişi alınamadı: ${err.message}</td></tr>`;
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
      container.innerHTML = `<div class="text-center py-10 text-xs text-slate-500">Henüz tetiklenen bildirim kaydı yok.</div>`;
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
        <div class="p-4 rounded-2xl bg-slate-950/70 border border-white/5 hover:border-cyan-500/30 transition space-y-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-base">${typeIcons[a.alert_type] || '🔔'}</span>
              <span class="font-extrabold text-xs text-cyan-400 tracking-wide">${typeLabels[a.alert_type] || a.alert_type}</span>
              <span class="text-xs text-slate-400 font-semibold">• ${a.wallet_label}</span>
            </div>
            <span class="text-[10px] font-mono text-slate-500">${timeStr}</span>
          </div>
          <div class="text-xs text-slate-300 font-mono bg-black/60 p-3 rounded-xl whitespace-pre-line leading-relaxed border border-white/5">
            ${a.message}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="text-center py-6 text-xs text-rose-400">Bildirimler yüklenemedi: ${err.message}</div>`;
  }
}

// Load Settings
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (!data.success) return;

    appSettings = data.settings || {};

    const statusBadge = document.getElementById('status-bot-badge');
    const displayToken = document.getElementById('display-bot-token');
    const displayChat = document.getElementById('display-default-chatid');
    const pollSelect = document.getElementById('settings-poll-interval');
    const banner = document.getElementById('telegram-warning-banner');
    const settingsIndicator = document.getElementById('badge-settings-indicator');

    if (appSettings.hasBotToken) {
      if (statusBadge) {
        statusBadge.className = 'flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30';
        statusBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span><span>Railway Aktif</span>';
      }
      if (displayToken) {
        displayToken.textContent = appSettings.botTokenPreview || 'Aktif (••••••••)';
        displayToken.className = 'text-emerald-400 font-semibold';
      }
      if (banner) banner.classList.add('hidden');
      if (settingsIndicator) settingsIndicator.className = 'w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400';
    } else {
      if (statusBadge) {
        statusBadge.className = 'flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30';
        statusBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span><span>Railway\'de Bekleniyor</span>';
      }
      if (displayToken) {
        displayToken.textContent = 'TELEGRAM_BOT_TOKEN (Eksik)';
        displayToken.className = 'text-amber-400 font-semibold';
      }
      if (banner) banner.classList.remove('hidden');
      if (settingsIndicator) settingsIndicator.className = 'w-2 h-2 rounded-full bg-amber-400';
    }

    if (displayChat) {
      displayChat.textContent = appSettings.telegram_default_chat_id || '-5173499699';
    }

    if (pollSelect && appSettings.poll_interval_seconds) {
      pollSelect.value = appSettings.poll_interval_seconds;
    }
  } catch (err) {
    console.error('loadSettings error:', err);
  }
}

// Save Settings Form
document.getElementById('form-settings')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  playClickSound();
  const poll = document.getElementById('settings-poll-interval').value;

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ poll_interval_seconds: poll })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Tercihler kaydedildi!', 'success');
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
  playClickSound();
  const feedback = document.getElementById('test-telegram-feedback');

  feedback.classList.remove('hidden');
  feedback.className = 'text-xs mt-2 text-center text-cyan-400 font-semibold';
  feedback.textContent = 'Railway değişkenleriyle Telegram bildirimi gönderiliyor...';

  try {
    const res = await fetch('/api/settings/test-telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.success) {
      feedback.className = 'text-xs mt-2 text-center text-emerald-400 font-bold';
      feedback.textContent = '✅ ' + data.message;
      showToast('Telegram testi başarılı!', 'success');
    } else {
      feedback.className = 'text-xs mt-2 text-center text-rose-400 font-medium';
      feedback.textContent = '❌ ' + (data.error || 'Gönderilemedi');
      showToast('Telegram hatası: ' + data.error, 'error');
    }
  } catch (err) {
    feedback.className = 'text-xs mt-2 text-center text-rose-400 font-medium';
    feedback.textContent = '❌ Hata: ' + err.message;
  }
});

// Add Whale Form (Matches screenshot)
document.getElementById('form-add-wallet')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  playClickSound();

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

    showToast(`Balina (${data.wallet.label}) takibe alındı!`, 'success');
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
  playClickSound();
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
  playClickSound();
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
  playClickSound();
  const spinner = document.getElementById('refresh-spinner');
  spinner?.classList.add('animate-spin');

  try {
    await fetch('/api/tracker/trigger', { method: 'POST' });
    await loadMarketTicker();
    await loadWallets();
    showToast('Veriler güncellendi!', 'info');
  } catch (err) {
    showToast('Yenileme hatası: ' + err.message, 'error');
  } finally {
    setTimeout(() => spinner?.classList.remove('animate-spin'), 600);
  }
});

// Sound Toggle
document.getElementById('btn-toggle-sound')?.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem('sound_enabled', soundEnabled ? 'true' : 'false');
  updateSoundButton();
  if (soundEnabled) playClickSound();
  showToast(soundEnabled ? 'Sesli bildirimler açıldı 🔊' : 'Ses kapatıldı 🔇', 'info');
});

function updateSoundButton() {
  const icon = document.getElementById('icon-sound');
  if (icon) {
    icon.setAttribute('data-lucide', soundEnabled ? 'volume-2' : 'volume-x');
    icon.className = `w-4 h-4 ${soundEnabled ? 'text-cyan-400' : 'text-slate-500'}`;
    lucide.createIcons();
  }
}

// Clear Alerts
document.getElementById('btn-clear-alerts')?.addEventListener('click', async () => {
  playClickSound();
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
    playClickSound();
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

// Search Input Listener
document.getElementById('search-wallet-input')?.addEventListener('input', () => {
  renderWalletsList();
});

// Modal Triggers
document.getElementById('btn-open-add-modal')?.addEventListener('click', () => {
  playClickSound();
  document.getElementById('modal-add-wallet').classList.remove('hidden');
});

document.getElementById('btn-open-settings')?.addEventListener('click', () => {
  playClickSound();
  document.getElementById('modal-settings').classList.remove('hidden');
});

// Auto-Refresh Loop
function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => {
    loadMarketTicker();
    loadWallets();
    if (currentTab === 'alerts') loadAlerts();
  }, 5000);
}

// Initialization
window.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  updateSoundButton();
  loadSettings();
  loadMarketTicker();
  loadWallets();
  loadAlerts();
  startAutoRefresh();
});
