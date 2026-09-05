// State
let wallets = [];
let selectedWallet = null;
let currentTab = 'positions';
let autoRefreshTimer = null;
let appSettings = {};
let soundEnabled = localStorage.getItem('sound_enabled') !== 'false';

// Chart.js instances
let allocationChart = null;
let pnlChart = null;

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

// Real Crisp SVG Coin Badges (Top Hyperliquid Assets)
function getCoinBadge(coin) {
  const c = (coin || '').toUpperCase();
  
  if (c === 'BTC') {
    return `<div class="w-7 h-7 rounded-xl bg-[#f7931a]/15 border border-[#f7931a]/40 flex items-center justify-center shrink-0 shadow-sm shadow-[#f7931a]/10">
      <svg class="w-4 h-4 text-[#f7931a]" viewBox="0 0 24 24" fill="currentColor">
        <path d="M14.7 10.3c.3-.8.2-1.8-.4-2.4-.7-.7-1.8-.9-2.8-.8V5.5h-1.8v1.6H8.2V5.5H6.4v1.7H3.5v1.8h1.6c.3 0 .5.2.5.5v5.8c0 .3-.2.5-.5.5H3.5v1.8h2.9v1.7h1.8v-1.6h1.5v1.6h1.8v-1.7c2.5.2 4.4-.9 4.8-3.4.3-1.6-.4-2.8-1.6-3.4zm-4.8-1.5h1.9c1 0 1.8.4 1.8 1.4s-.8 1.4-1.8 1.4H9.9V8.8zm2.4 6.7H9.9v-3h2.4c1.2 0 2 .5 2 1.5s-.8 1.5-2 1.5z"/>
      </svg>
    </div>`;
  }
  
  if (c === 'ETH') {
    return `<div class="w-7 h-7 rounded-xl bg-[#627eea]/15 border border-[#627eea]/40 flex items-center justify-center shrink-0 shadow-sm shadow-[#627eea]/10">
      <svg class="w-4 h-4 text-[#8a9cf5]" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 1.5L4.5 13.8 12 18.2l7.5-4.4L12 1.5zm0 18.2L4.5 15.2 12 22.5l7.5-7.3L12 19.7z"/>
      </svg>
    </div>`;
  }

  if (c === 'SOL') {
    return `<div class="w-7 h-7 rounded-xl bg-gradient-to-br from-[#9945ff]/20 to-[#14f195]/20 border border-[#14f195]/40 flex items-center justify-center shrink-0">
      <svg class="w-4 h-4 text-[#14f195]" viewBox="0 0 24 24" fill="currentColor">
        <path d="M4 17.5h13.2l2.8-2.8H6.8L4 17.5zm0-8.2h13.2l2.8-2.8H6.8L4 9.3zm2.8 1.4L4 13.5h13.2l2.8-2.8H6.8z"/>
      </svg>
    </div>`;
  }

  if (c === 'ASTER') {
    return `<div class="w-7 h-7 rounded-xl bg-cyan-500/20 border border-cyan-400/50 flex items-center justify-center shrink-0 shadow-sm shadow-cyan-500/20">
      <svg class="w-4 h-4 text-cyan-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    </div>`;
  }

  if (c === 'HYPE') {
    return `<div class="w-7 h-7 rounded-xl bg-emerald-500/20 border border-emerald-400/50 flex items-center justify-center shrink-0 shadow-sm shadow-emerald-500/20">
      <svg class="w-4 h-4 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    </div>`;
  }

  if (c === 'PURR') {
    return `<div class="w-7 h-7 rounded-xl bg-purple-500/20 border border-purple-400/50 flex items-center justify-center shrink-0 shadow-sm shadow-purple-500/20">
      <svg class="w-4 h-4 text-purple-300" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12c0 3.31 1.61 6.24 4.09 8.04l.91-2.04c-.65-.63-1.12-1.42-1.37-2.31 1.05.62 2.27.97 3.57.97h5.6c1.3 0 2.52-.35 3.57-.97-.25.89-.72 1.68-1.37 2.31l.91 2.04C20.39 18.24 22 15.31 22 12c0-5.52-4.48-10-10-10zm-3 8c.83 0 1.5.67 1.5 1.5S9.83 13 9 13s-1.5-.67-1.5-1.5S8.17 10 9 10zm6 0c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5.67-1.5 1.5-1.5z"/>
      </svg>
    </div>`;
  }

  if (c === 'DOGE') {
    return `<div class="w-7 h-7 rounded-xl bg-amber-500/15 border border-amber-400/40 flex items-center justify-center shrink-0 shadow-sm shadow-amber-500/10">
      <span class="text-amber-400 font-black font-mono text-xs">Ð</span>
    </div>`;
  }

  if (c === 'XRP') {
    return `<div class="w-7 h-7 rounded-xl bg-slate-800 border border-cyan-400/40 flex items-center justify-center shrink-0">
      <span class="text-cyan-300 font-black font-mono text-[11px]">✕RP</span>
    </div>`;
  }

  if (c === 'SUI') {
    return `<div class="w-7 h-7 rounded-xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center shrink-0">
      <svg class="w-4 h-4 text-sky-300" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2L4 12l8 10 8-10L12 2zm0 4.5l5 6.5-5 6.2-5-6.2 5-6.5z"/>
      </svg>
    </div>`;
  }

  if (c === 'AVAX') {
    return `<div class="w-7 h-7 rounded-xl bg-rose-500/20 border border-rose-400/40 flex items-center justify-center shrink-0">
      <span class="text-rose-400 font-black font-mono text-[10px]">▲</span>
    </div>`;
  }

  if (c === 'LINK') {
    return `<div class="w-7 h-7 rounded-xl bg-blue-500/20 border border-blue-400/40 flex items-center justify-center shrink-0">
      <span class="text-blue-400 font-black font-mono text-[10px]">⬡</span>
    </div>`;
  }

  if (c === 'PEPE') {
    return `<div class="w-7 h-7 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shrink-0">
      <span class="text-emerald-400 font-bold text-xs">🐸</span>
    </div>`;
  }

  // Fallback high tech badge
  return `<div class="w-7 h-7 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 flex items-center justify-center text-[10px] text-cyan-300 font-black shrink-0">
    ${c.slice(0, 3)}
  </div>`;
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

// Render Interactive Position Charts (Chart.js)
function renderCharts(positions) {
  if (typeof Chart === 'undefined') return;
  const allocCanvas = document.getElementById('chart-allocation');
  const pnlCanvas = document.getElementById('chart-pnl');
  if (!allocCanvas || !pnlCanvas) return;

  let totalNotional = 0;
  let totalLong = 0;
  let totalShort = 0;

  for (const p of positions) {
    const val = parseFloat(p.positionValue || 0);
    totalNotional += val;
    if (p.side === 'LONG') totalLong += val;
    else totalShort += val;
  }

  // Update Doughnut Center & Ratio Bar
  const totalEl = document.getElementById('chart-allocation-total');
  if (totalEl) totalEl.textContent = formatUsd(totalNotional);

  const ratioPill = document.getElementById('chart-long-short-ratio');
  const labelLong = document.getElementById('label-ratio-long');
  const labelShort = document.getElementById('label-ratio-short');
  const barLong = document.getElementById('bar-ratio-long');
  const barShort = document.getElementById('bar-ratio-short');

  const longPct = totalNotional > 0 ? (totalLong / totalNotional) * 100 : 50;
  const shortPct = totalNotional > 0 ? (totalShort / totalNotional) * 100 : 50;

  if (ratioPill) {
    if (longPct >= shortPct) {
      ratioPill.className = 'text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold';
      ratioPill.textContent = `%${longPct.toFixed(0)} LONG AĞIRLIKLI`;
    } else {
      ratioPill.className = 'text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/30 font-bold';
      ratioPill.textContent = `%${shortPct.toFixed(0)} SHORT AĞIRLIKLI`;
    }
  }

  if (labelLong) labelLong.textContent = `🟢 Long: %${longPct.toFixed(1)} (${formatUsd(totalLong)})`;
  if (labelShort) labelShort.textContent = `Short: %${shortPct.toFixed(1)} (${formatUsd(totalShort)}) 🔴`;
  if (barLong) barLong.style.width = `${longPct}%`;
  if (barShort) barShort.style.width = `${shortPct}%`;

  if (positions.length === 0) {
    if (allocationChart) { allocationChart.destroy(); allocationChart = null; }
    if (pnlChart) { pnlChart.destroy(); pnlChart = null; }
    return;
  }

  const neonColors = [
    '#00f2fe', '#4facfe', '#a855f7', '#ec4899', '#10b981', '#f59e0b', '#6366f1', '#14b8a6'
  ];

  // Allocation Doughnut Chart
  if (allocationChart) allocationChart.destroy();
  allocationChart = new Chart(allocCanvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: positions.map(p => p.coin),
      datasets: [{
        data: positions.map(p => p.positionValue),
        backgroundColor: positions.map((_, i) => neonColors[i % neonColors.length]),
        borderWidth: 2,
        borderColor: '#0a0e1a',
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10, 14, 26, 0.95)',
          titleFont: { family: 'JetBrains Mono', size: 12, weight: 'bold' },
          bodyFont: { family: 'JetBrains Mono', size: 11 },
          borderColor: 'rgba(0, 242, 254, 0.3)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: function(context) {
              const val = context.parsed;
              const pct = totalNotional > 0 ? ((val / totalNotional) * 100).toFixed(1) : 0;
              return ` ${context.label}: $${val.toLocaleString('en-US', { minimumFractionDigits: 2 })} (%${pct})`;
            }
          }
        }
      }
    }
  });

  // PnL Performance Bar Chart
  if (pnlChart) pnlChart.destroy();
  pnlChart = new Chart(pnlCanvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: positions.map(p => p.coin),
      datasets: [{
        label: 'Kâr / Zarar ($)',
        data: positions.map(p => p.unrealizedPnl),
        backgroundColor: positions.map(p => p.unrealizedPnl >= 0 ? 'rgba(16, 185, 129, 0.85)' : 'rgba(244, 63, 94, 0.85)'),
        borderColor: positions.map(p => p.unrealizedPnl >= 0 ? '#10b981' : '#f43f5e'),
        borderWidth: 1.5,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10, weight: 'bold' } }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#94a3b8',
            font: { family: 'JetBrains Mono', size: 10 },
            callback: function(v) {
              return '$' + (v >= 1000 || v <= -1000 ? (v / 1000).toFixed(1) + 'k' : v);
            }
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10, 14, 26, 0.95)',
          titleFont: { family: 'JetBrains Mono', size: 12, weight: 'bold' },
          bodyFont: { family: 'JetBrains Mono', size: 11 },
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: function(ctx) {
              const p = positions[ctx.dataIndex];
              const pnl = ctx.parsed.y;
              return ` PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${p.roePct >= 0 ? '+' : ''}${p.roePct.toFixed(2)}% ROE)`;
            }
          }
        }
      }
    }
  });
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
  const hypurrLink = document.getElementById('link-hypurrscan');
  const dashLink = document.getElementById('link-hyperdash');
  const hlLink = document.getElementById('link-hyperliquid-app');

  if (nameEl) nameEl.textContent = wallet.label;
  if (addrEl) addrEl.textContent = wallet.address;
  if (threshPill) threshPill.textContent = `EŞİK: %${wallet.threshold_pct || 10}`;
  if (threshLabel) threshLabel.textContent = `%${wallet.threshold_pct || 10}`;
  
  // Main Hypurrscan & Secondary Explorer Links
  if (hypurrLink) hypurrLink.href = `https://hypurrscan.io/address/${wallet.address}`;
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

// Render Whale Metrics & Intelligence Profile
function renderWhaleState(state) {
  const accVal = parseFloat(state.accountValue || 0);
  const totalNtl = parseFloat(state.totalNtlPos || 0);
  const accValEl = document.getElementById('metric-account-value');
  const prevAccVal = accValEl.textContent;
  const newAccVal = formatUsd(accVal);
  accValEl.textContent = newAccVal;

  if (prevAccVal && prevAccVal !== newAccVal && prevAccVal !== '$0.00') {
    accValEl.classList.remove('flash-up', 'flash-down');
    void accValEl.offsetWidth;
    accValEl.classList.add('flash-up');
  }

  // Arkham-Style Dynamic Whale Intelligence Tier
  const tierEl = document.getElementById('view-whale-tier');
  if (tierEl) {
    if (accVal >= 1000000) {
      tierEl.innerHTML = '<span>👑 APEX WHALE ($1M+)</span>';
      tierEl.className = 'tag-whale px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold flex items-center gap-1 shadow-md shadow-purple-500/20 border-purple-400 text-purple-200';
    } else if (accVal >= 250000) {
      tierEl.innerHTML = '<span>🐋 GIGA CHAD ($250K+)</span>';
      tierEl.className = 'tag-whale px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold flex items-center gap-1 shadow-md shadow-cyan-500/20 border-cyan-400 text-cyan-200';
    } else if (accVal >= 50000) {
      tierEl.innerHTML = '<span>🦈 SMART WHALE</span>';
      tierEl.className = 'tag-whale px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold flex items-center gap-1 border-blue-400 text-blue-200';
    } else {
      tierEl.innerHTML = '<span>🐬 SWIFT TRADER</span>';
      tierEl.className = 'tag-whale px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold flex items-center gap-1 border-slate-600 text-slate-300';
    }
  }

  // Effective Leverage Risk Gauge
  const levRiskEl = document.getElementById('view-leverage-risk');
  if (levRiskEl) {
    const effLev = accVal > 0 ? (totalNtl / accVal) : 0;
    if (effLev === 0) {
      levRiskEl.textContent = 'RİSK: BOŞTA';
      levRiskEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-800 text-slate-400 border border-white/10';
    } else if (effLev < 2.5) {
      levRiskEl.textContent = `RİSK: DÜŞÜK (${effLev.toFixed(1)}x)`;
      levRiskEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30';
    } else if (effLev < 6.0) {
      levRiskEl.textContent = `RİSK: NORMAL (${effLev.toFixed(1)}x)`;
      levRiskEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30';
    } else if (effLev < 15.0) {
      levRiskEl.textContent = `RİSK: YÜKSEK (${effLev.toFixed(1)}x)`;
      levRiskEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/10 text-amber-300 border border-amber-500/30';
    } else {
      levRiskEl.textContent = `🔥 DEGEN RİSK (${effLev.toFixed(1)}x)`;
      levRiskEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse';
    }
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
  document.getElementById('metric-notional-value').textContent = formatUsd(totalNtl);

  const posCount = (state.positions && state.positions.length) || 0;
  document.getElementById('metric-pos-count').textContent = `${posCount} Pozisyon`;
  document.getElementById('tab-count-positions').textContent = posCount;

  // Render Charts, Liquidation Radar & Positions Table
  renderCharts(state.positions || []);
  renderLiquidationRadar(state.positions || []);
  renderPositionsTable(state.positions || []);
}

// Render Liquidation Danger Radar (HyperData Terminal / Hypurrscan style)
function renderLiquidationRadar(positions) {
  const container = document.getElementById('radar-cards-container');
  const pill = document.getElementById('radar-highest-risk-pill');
  if (!container) return;

  const validPositions = positions.filter(p => p.liquidationPrice && p.liqDistancePct !== null);

  if (validPositions.length === 0) {
    if (pill) {
      pill.className = 'text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold';
      pill.textContent = 'TÜM POZİSYONLAR GÜVENLİ';
    }
    container.innerHTML = `
      <div class="col-span-full py-3 px-4 rounded-xl bg-slate-950/60 border border-white/5 flex items-center justify-between text-xs text-slate-400">
        <div class="flex items-center gap-2">
          <i data-lucide="shield-check" class="w-4 h-4 text-emerald-400"></i>
          <span>Aktif pozisyonlarda yakın likidasyon riski bulunmuyor.</span>
        </div>
        <span class="text-[10px] font-mono text-slate-500">Güvenli Bölge (>%50 mesafe)</span>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  // Sort ascending by distance (most critical first)
  validPositions.sort((a, b) => (a.liqDistancePct || 100) - (b.liqDistancePct || 100));

  const closest = validPositions[0];
  const closestDist = closest.liqDistancePct || 100;

  if (pill) {
    if (closestDist < 15) {
      pill.className = 'text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold animate-pulse';
      pill.textContent = `🚨 KRİTİK TEHLİKE: %${closestDist.toFixed(1)} (${closest.coin})`;
    } else if (closestDist < 30) {
      pill.className = 'text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold';
      pill.textContent = `⚠️ DİKKAT: %${closestDist.toFixed(1)} (${closest.coin})`;
    } else {
      pill.className = 'text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold';
      pill.textContent = `TÜM POZİSYONLAR GÜVENLİ (%${closestDist.toFixed(1)})`;
    }
  }

  container.innerHTML = validPositions.slice(0, 3).map(p => {
    const dist = p.liqDistancePct || 100;
    let cardClass = 'radar-card-safe';
    let textClass = 'text-emerald-400';
    let badgeLabel = 'GÜVENLİ';

    if (dist < 15) {
      cardClass = 'radar-card-danger';
      textClass = 'text-rose-400 font-bold';
      badgeLabel = 'KRİTİK RİSK';
    } else if (dist < 30) {
      cardClass = 'radar-card-warn';
      textClass = 'text-amber-400 font-bold';
      badgeLabel = 'DİKKAT';
    }

    return `
      <div class="p-3 rounded-xl border border-white/5 ${cardClass} flex flex-col justify-between space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            ${getCoinBadge(p.coin)}
            <div>
              <span class="font-extrabold text-xs text-white">${p.coin}</span>
              <span class="text-[9px] font-mono text-slate-400 block">${p.side} (${p.leverage})</span>
            </div>
          </div>
          <div class="text-right">
            <span class="text-[10px] font-mono ${textClass}">%${dist.toFixed(1)} Mesafe</span>
            <span class="text-[9px] block text-slate-500">${badgeLabel}</span>
          </div>
        </div>

        <div class="space-y-1">
          <div class="flex justify-between text-[10px] font-mono text-slate-400">
            <span>Mark: $${p.currentPrice.toFixed(4)}</span>
            <span class="text-rose-400 font-semibold">Liq: $${p.liquidationPrice.toFixed(4)}</span>
          </div>
          <div class="w-full h-1.5 rounded-full bg-slate-900 overflow-hidden">
            <div class="h-full ${dist < 15 ? 'bg-rose-500' : (dist < 30 ? 'bg-amber-400' : 'bg-emerald-400')}" style="width: ${Math.min(100, Math.max(5, dist))}%"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

// Render Price Level Channel Progress Bar for each position
function renderPriceChannel(p) {
  const isLong = p.side === 'LONG';
  const entry = parseFloat(p.entryPrice) || 0;
  const mark = p.currentPrice || 0;
  const liq = p.liquidationPrice || 0;
  const dist = p.liqDistancePct !== null ? p.liqDistancePct : 100;

  // Calculate where Mark sits relative to entry (profit/loss)
  const isProfit = p.unrealizedPnl >= 0;
  let progressPct = 50; // default center

  if (entry > 0 && liq > 0) {
    if (isLong) {
      // Long: liq is below entry. If mark is below entry, it moves towards liq (loss).
      // If mark > entry, it moves right (profit).
      const totalSpan = Math.max(entry * 1.15, mark) - liq;
      progressPct = totalSpan > 0 ? ((mark - liq) / totalSpan) * 100 : 50;
    } else {
      // Short: liq is above entry. If mark is above entry, it moves towards liq (loss).
      // If mark < entry, it moves left towards profit.
      const totalSpan = liq - Math.min(entry * 0.85, mark);
      progressPct = totalSpan > 0 ? ((liq - mark) / totalSpan) * 100 : 50;
    }
  } else {
    progressPct = isProfit ? 75 : 25;
  }

  progressPct = Math.min(95, Math.max(5, progressPct));

  let distBadge = '';
  if (liq > 0) {
    if (dist < 15) distBadge = `<span class="text-[9px] font-bold text-rose-400 bg-rose-500/10 px-1 rounded animate-pulse">Liq: %${dist.toFixed(1)}</span>`;
    else if (dist < 30) distBadge = `<span class="text-[9px] font-semibold text-amber-400 bg-amber-500/10 px-1 rounded">Liq: %${dist.toFixed(1)}</span>`;
    else distBadge = `<span class="text-[9px] text-slate-500">Liq: %${dist.toFixed(1)}</span>`;
  } else {
    distBadge = `<span class="text-[9px] text-slate-600">Liq: Yok</span>`;
  }

  return `
    <div class="py-1 min-w-[210px]">
      <div class="flex items-center justify-between text-[10px] font-mono">
        <span class="text-slate-400">G: <b class="text-white">$${p.entryPrice}</b></span>
        <span class="${isProfit ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}">M: $${mark.toFixed(4)}</span>
        <span class="text-slate-500">L: ${liq > 0 ? '$' + liq.toFixed(4) : '-'}</span>
      </div>

      <div class="price-channel-container my-1.5">
        <div class="${isProfit ? 'price-channel-fill-profit' : 'price-channel-fill-loss'}" style="width: ${progressPct}%"></div>
        <div class="price-dot-pointer ${isProfit ? 'bg-emerald-400 text-emerald-400' : 'bg-rose-400 text-rose-400'}" style="left: ${progressPct}%"></div>
      </div>

      <div class="flex items-center justify-between text-[9px] font-mono">
        <span class="${isProfit ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}">${isProfit ? '▲ KÂRDA' : '▼ ZARARDA'}</span>
        ${distBadge}
      </div>
    </div>
  `;
}

// Render Positions Table with Real SVG Logos, Channel Bars, and Action Buttons
function renderPositionsTable(positions) {
  const tbody = document.getElementById('positions-table-body');
  if (!tbody) return;

  if (positions.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-16 text-slate-500 font-sans">
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

    return `
      <tr class="ultra-tr">
        <!-- Coin with Real SVG Logo -->
        <td class="py-3 px-4 font-bold text-white flex items-center gap-2.5 font-sans">
          ${getCoinBadge(p.coin)}
          <div>
            <a href="https://app.hyperliquid.xyz/trade/${p.coin}" target="_blank" class="hover:text-cyan-400 transition font-extrabold text-sm">
              ${p.coin}
            </a>
            <span class="text-[10px] text-slate-500 block font-mono">PERP</span>
          </div>
        </td>

        <!-- Yön -->
        <td class="py-3 px-3">
          ${sideBadge}
        </td>

        <!-- Boyut -->
        <td class="py-3 px-3 text-right">
          <div class="font-bold text-white">${formatUsd(p.positionValue)}</div>
          <div class="text-[10px] text-slate-400">${formatCrypto(p.size)} ${p.coin}</div>
        </td>

        <!-- Fiyat Seviyesi (Giriş ➔ Mark ➔ Liq) Visual Channel Bar -->
        <td class="py-3 px-4">
          ${renderPriceChannel(p)}
        </td>

        <!-- PnL -->
        <td class="py-3 px-3 text-right">
          <div class="font-bold ${pnlColor}">${p.unrealizedPnl >= 0 ? '+' : ''}${formatUsd(p.unrealizedPnl)}</div>
          <div class="text-[10px] font-semibold ${roeColor}">(${p.roePct >= 0 ? '+' : ''}${p.roePct.toFixed(2)}% ROE)</div>
          <!-- Visual PnL Trail -->
          <div class="w-full h-1 rounded-full bg-slate-900 mt-1 overflow-hidden flex">
            <div class="h-full ${p.unrealizedPnl >= 0 ? 'bg-emerald-400' : 'bg-rose-500'}" style="width: ${Math.min(100, Math.max(10, Math.abs(p.roePct)))}%"></div>
          </div>
        </td>

        <!-- Kaldıraç & Teminat -->
        <td class="py-3 px-3 text-right font-sans">
          <div class="font-bold text-slate-200 text-xs">${p.leverage}</div>
          <div class="text-[10px] text-slate-400 font-mono">${formatUsd(p.marginUsed)}</div>
        </td>

        <!-- Hızlı İşlemler (Hypurrscan, HL Trade, PnL Card) -->
        <td class="py-3 px-3 text-center">
          <div class="flex items-center justify-center gap-1.5">
            <!-- Hypurrscan Button -->
            <a 
              href="https://hypurrscan.io/address/${selectedWallet ? selectedWallet.address : ''}" 
              target="_blank" 
              title="Hypurrscan'de İncele" 
              class="p-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 transition hover:scale-105"
            >
              <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
            </a>

            <!-- Hyperliquid Direct Trade Button -->
            <a 
              href="https://app.hyperliquid.xyz/trade/${p.coin}" 
              target="_blank" 
              title="Hyperliquid'de İşlem Aç" 
              class="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 transition hover:scale-105"
            >
              <i data-lucide="trending-up" class="w-3.5 h-3.5"></i>
            </a>

            <!-- PnL Share Card Button -->
            <button 
              onclick="openShareCard('${p.coin}')" 
              title="PnL Kartı Oluştur ve Paylaş" 
              class="p-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 transition hover:scale-105 cursor-pointer"
            >
              <i data-lucide="share-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  lucide.createIcons();
}

// Cyberpunk PnL Share Card Generator
window.openShareCard = function(coinName) {
  playClickSound();
  if (!selectedWallet) return;
  const positions = (selectedWallet.state && selectedWallet.state.positions) || [];
  let targetPos = positions.find(p => p.coin === coinName);
  if (!targetPos && positions.length > 0) targetPos = positions[0];

  const modal = document.getElementById('modal-share-card');
  if (!modal) return;

  document.getElementById('card-whale-name').textContent = selectedWallet.label || 'Whale Trader';
  document.getElementById('card-whale-address').textContent = shortAddress(selectedWallet.address);

  const accVal = parseFloat((selectedWallet.state && selectedWallet.state.accountValue) || 0);
  const tierEl = document.getElementById('card-whale-tier');
  if (tierEl) {
    tierEl.textContent = accVal >= 1000000 ? '👑 APEX WHALE' : (accVal >= 250000 ? '🐋 GIGA CHAD' : '🦈 SMART WHALE');
  }

  if (targetPos) {
    document.getElementById('card-coin-badge').innerHTML = getCoinBadge(targetPos.coin);
    document.getElementById('card-coin-name').textContent = targetPos.coin;

    const isLong = targetPos.side === 'LONG';
    const sideBadge = document.getElementById('card-side-badge');
    sideBadge.className = isLong ? 'badge-long px-3 py-1 rounded-xl text-xs font-black' : 'badge-short px-3 py-1 rounded-xl text-xs font-black';
    sideBadge.textContent = `${isLong ? '🟢' : '🔴'} ${targetPos.leverage} ${targetPos.side}`;

    const isProfit = targetPos.unrealizedPnl >= 0;
    const roeEl = document.getElementById('card-roe-val');
    const pnlEl = document.getElementById('card-pnl-val');

    roeEl.textContent = `${isProfit ? '+' : ''}${targetPos.roePct.toFixed(2)}%`;
    roeEl.className = `text-3xl font-black font-mono drop-shadow-[0_0_15px_rgba(16,185,129,0.5)] ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`;

    pnlEl.textContent = `${isProfit ? '+' : ''}${formatUsd(targetPos.unrealizedPnl)}`;
    pnlEl.className = `text-sm font-bold font-mono mt-1 ${isProfit ? 'text-emerald-300' : 'text-rose-300'}`;

    document.getElementById('card-entry-price').textContent = '$' + targetPos.entryPrice;
    document.getElementById('card-mark-price').textContent = '$' + targetPos.currentPrice.toFixed(4);
  } else {
    document.getElementById('card-coin-badge').innerHTML = getCoinBadge('HYPE');
    document.getElementById('card-coin-name').textContent = 'GENEL KASA';
    document.getElementById('card-side-badge').textContent = 'PORTFÖY';
    document.getElementById('card-roe-val').textContent = formatUsd(accVal);
    document.getElementById('card-pnl-val').textContent = 'Net Bakiye';
  }

  document.getElementById('card-timestamp').textContent = new Date().toLocaleTimeString('tr-TR');
  modal.classList.remove('hidden');
  lucide.createIcons();

  // Setup Copy Text Listener
  const copyBtn = document.getElementById('btn-copy-card-text');
  if (copyBtn) {
    copyBtn.onclick = () => {
      playClickSound();
      let text = '';
      if (targetPos) {
        text = `🚨 HYPERLIQUID BALİNA POZİSYONU 🚨\n` +
          `👤 Balina: ${selectedWallet.label} (${shortAddress(selectedWallet.address)})\n` +
          `⚡ İşlem: ${targetPos.side} ${targetPos.coin} (${targetPos.leverage})\n` +
          `💰 Anlık PnL: ${targetPos.unrealizedPnl >= 0 ? '+' : ''}${formatUsd(targetPos.unrealizedPnl)} (${targetPos.roePct >= 0 ? '+' : ''}${targetPos.roePct.toFixed(2)}% ROE)\n` +
          `🎯 Giriş: $${targetPos.entryPrice} | Mark: $${targetPos.currentPrice.toFixed(4)}\n` +
          `🔗 Hypurrscan: https://hypurrscan.io/address/${selectedWallet.address}`;
      } else {
        text = `🐋 HYPERLIQUID BALİNA KASASI: ${selectedWallet.label} -> ${formatUsd(accVal)}\n` +
          `🔗 Hypurrscan: https://hypurrscan.io/address/${selectedWallet.address}`;
      }
      navigator.clipboard.writeText(text);
      showToast('Telegram / Twitter metni panoya kopyalandı! 📋', 'success');
    };
  }
};

// Wire Top PnL Card Button in Whale Header
document.getElementById('btn-open-share-card')?.addEventListener('click', () => {
  openShareCard();
});

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
          <td class="py-2.5 px-3 font-bold text-white font-sans flex items-center gap-1.5">
            ${getCoinBadge(f.coin)}
            <span>${f.coin}</span>
          </td>
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
