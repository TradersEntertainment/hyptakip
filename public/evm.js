// 🐋 Ethereum wallets panel (server: /api/evm-wallets, src/evmwatch.js)
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const usd = v => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v}`);

  async function load() {
    const list = $('evm-list');
    if (!list) return;
    try {
      const d = await (await fetch('/api/evm-wallets')).json();
      if (!d.success) throw new Error(d.error);
      const st = d.status || {};
      $('evm-status').textContent = st.lastError ? '⚠️ ' + st.lastError.slice(0, 40) : (st.lastPoll ? `✓ ${new Date(st.lastPoll).toLocaleTimeString('tr-TR')}` : '');
      list.innerHTML = (d.wallets || []).map(w => `
        <div class="p-2.5 rounded-xl bg-slate-950/60 border border-white/5 hover:border-indigo-400/40 flex items-center justify-between gap-2 cursor-pointer" data-evm-open="${esc(w.address)}" data-evm-label="${esc(w.label)}">
          <div class="min-w-0">
            <div class="font-bold text-white truncate" data-no-i18n>${esc(w.label)}${Number(w.call_alert) === 1 ? ' 📞' : ''}</div>
            <a href="https://etherscan.io/address/${esc(w.address)}" target="_blank" rel="noopener" class="text-[0.625rem] font-mono text-slate-500 hover:text-indigo-300">${esc(w.address.slice(0, 8))}…${esc(w.address.slice(-6))}</a>
            <span class="text-[0.625rem] text-slate-500"> · ≥ ${usd(Number(w.min_usd) || 0)}</span>
          </div>
          <button data-evm-del="${esc(w.address)}" title="Sil" class="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 text-xs">✕</button>
        </div>`).join('') || '<div class="text-slate-500 text-center py-2">Henüz Ethereum cüzdanı yok.</div>';
      list.querySelectorAll('[data-evm-open]').forEach(r => r.addEventListener('click', e => {
        if (e.target.closest('[data-evm-del]') || e.target.closest('a')) return;
        openDetail(r.dataset.evmOpen, r.dataset.evmLabel);
      }));
      list.querySelectorAll('[data-evm-del]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm(window.T ? T('Bu Ethereum cüzdanı takipten çıkarılsın mı?') : 'Bu Ethereum cüzdanı takipten çıkarılsın mı?')) return;
        await fetch(`/api/evm-wallets/${b.dataset.evmDel}`, { method: 'DELETE' });
        load();
      }));
    } catch (err) {
      list.innerHTML = `<div class="text-rose-400">${esc(err.message)}</div>`;
    }
  }

  // 🔎 wallet detail: holdings + newest transfers (server: /api/evm-wallets/:address/overview)
  const qty = v => { const a = Math.abs(v); return a >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1e4 ? (v / 1e3).toFixed(1) + 'K' : v.toLocaleString('en-US', { maximumFractionDigits: a >= 100 ? 0 : 4 }); };
  const usd2 = v => { const a = Math.abs(v); return a >= 1e9 ? `$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}K` : `$${a.toFixed(0)}`; };
  const px = v => !v ? '—' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 2 : v >= 1 ? 4 : 8 });
  function modal() {
    let m = $('modal-evm');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'modal-evm';
    m.className = 'fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md hidden overflow-y-auto';
    m.innerHTML = `<div class="w-full max-w-5xl bg-[#0b1020]/95 border border-white/10 rounded-2xl p-4 sm:p-6 space-y-4 shadow-2xl my-auto">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0"><h3 id="evm-d-name" data-no-i18n class="text-lg font-black text-white"></h3>
          <div id="evm-d-sub" class="text-[0.6875rem] text-slate-400 font-mono break-all"></div></div>
        <button id="evm-d-close" class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 text-lg leading-none">✕</button>
      </div>
      <div id="evm-d-body" class="space-y-5 text-xs"></div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m || e.target.id === 'evm-d-close') m.classList.add('hidden'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') m.classList.add('hidden'); });
    return m;
  }
  async function openDetail(address, label) {
    const m = modal();
    $('evm-d-name').textContent = label || address;
    $('evm-d-sub').innerHTML = `${esc(address)} · <a class="text-indigo-300 hover:underline" target="_blank" rel="noopener" href="https://etherscan.io/address/${esc(address)}">Etherscan</a> · <a class="text-indigo-300 hover:underline" target="_blank" rel="noopener" href="https://intel.arkm.com/explorer/address/${esc(address)}">Arkham</a> · <a class="text-indigo-300 hover:underline" target="_blank" rel="noopener" href="https://debank.com/profile/${esc(address)}">DeBank</a>`;
    const body = $('evm-d-body');
    body.innerHTML = '<div class="text-slate-500 py-6 text-center">Yükleniyor…</div>';
    m.classList.remove('hidden');
    let d;
    try { d = await (await fetch(`/api/evm-wallets/${address}/overview`)).json(); if (!d.success) throw new Error(d.error); }
    catch (err) { body.innerHTML = `<div class="text-rose-400">${esc(err.message)}</div>`; return; }
    const tot = d.total || 0;
    const rows = d.tokens.map(t => `<tr class="border-b border-white/5">
        <td class="py-2 pr-2 font-bold text-white">${esc(t.symbol)} <span class="text-slate-500 font-normal">${esc(t.name || '')}</span></td>
        <td class="text-right px-2 font-mono text-slate-300">${qty(t.amount)}</td>
        <td class="text-right px-2 font-mono text-slate-400">${px(t.price)}</td>
        <td class="text-right px-2 font-mono font-bold text-white">${usd2(t.usd)}</td>
        <td class="pl-2 w-40"><div class="h-2 rounded-full bg-white/5 overflow-hidden"><div class="h-2 bg-gradient-to-r from-indigo-500 to-cyan-400" style="width:${tot ? Math.max(1, t.usd / tot * 100).toFixed(1) : 0}%"></div></div>
          <div class="text-[0.625rem] text-slate-500 font-mono mt-0.5">${tot ? (t.usd / tot * 100).toFixed(1) : 0}%</div></td></tr>`).join('');
    const rec = d.recent.map(x => `<tr class="border-b border-white/5">
        <td class="py-1.5 pr-2 text-slate-400 font-mono">${new Date(x.ts).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
        <td class="px-2 font-bold ${x.dir === 'out' ? 'text-rose-400' : 'text-emerald-400'}">${x.dir === 'out' ? '📤 Giden' : '📥 Gelen'}</td>
        <td class="px-2 text-right font-mono text-white">${qty(x.amount)} ${esc(x.sym)}</td>
        <td class="px-2 text-right font-mono font-bold text-white">${usd2(x.usd)}</td>
        <td class="px-2 truncate max-w-[14rem]">${x.cp ? `<a class="text-indigo-300 hover:underline" target="_blank" rel="noopener" href="https://etherscan.io/address/${esc(x.cp)}">${esc(x.cpName || (x.cp.slice(0, 8) + '…' + x.cp.slice(-4)))}</a>` : '—'}</td>
        <td class="pl-2"><a class="text-slate-400 hover:text-white" target="_blank" rel="noopener" href="https://etherscan.io/tx/${esc(x.tx)}">tx ↗</a></td></tr>`).join('');
    body.innerHTML = `
      <div class="flex flex-wrap gap-3">
        <div class="px-4 py-3 rounded-xl bg-slate-950/70 border border-white/5"><div class="text-[0.625rem] text-slate-400">Cüzdan değeri (token + ETH)</div><div class="text-2xl font-black font-mono text-white">${usd2(tot)}</div></div>
        <div class="px-4 py-3 rounded-xl bg-slate-950/70 border border-white/5"><div class="text-[0.625rem] text-slate-400">Token sayısı</div><div class="text-2xl font-black font-mono text-white">${d.tokens.length}</div></div>
        ${d.tags && d.tags.length ? `<div class="px-4 py-3 rounded-xl bg-slate-950/70 border border-white/5"><div class="text-[0.625rem] text-slate-400">Etiket</div><div class="text-sm font-bold text-indigo-200 mt-1">${esc(d.tags.join(' · '))}</div></div>` : ''}
      </div>
      <div><div class="font-bold text-white mb-2">Varlıklar</div><div class="overflow-x-auto"><table class="w-full text-left">
        <thead class="text-[0.625rem] uppercase text-slate-500"><tr><th class="py-1">Token</th><th class="text-right px-2">Miktar</th><th class="text-right px-2">Fiyat</th><th class="text-right px-2">Değer</th><th class="pl-2">Pay</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="py-3 text-slate-500">Varlık yok</td></tr>'}</tbody></table></div>
        <p class="text-[0.625rem] text-slate-500 mt-2">Yalnız adresteki ETH ve fiyatı bilinen ERC-20 bakiyeleri. DeFi pozisyonları (Aave, stake sözleşmeleri, Pendle…) burada görünmez; tam resim için DeBank.${d.unpriced ? ` ${d.unpriced} fiyatsız / taklit token gizlendi.` : ''}</p></div>
      <div><div class="font-bold text-white mb-2">Son transferler</div><div class="overflow-x-auto"><table class="w-full text-left">
        <thead class="text-[0.625rem] uppercase text-slate-500"><tr><th class="py-1">Zaman</th><th class="px-2">Yön</th><th class="text-right px-2">Miktar</th><th class="text-right px-2">Değer</th><th class="px-2">Karşı taraf</th><th></th></tr></thead>
        <tbody>${rec || '<tr><td colspan="6" class="py-3 text-slate-500">Transfer yok</td></tr>'}</tbody></table></div></div>`;
  }

  $('form-evm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const body = { address: $('evm-address').value.trim(), label: $('evm-label').value.trim(), telegram_chat_id: $('evm-chat').value.trim() || null,
                   min_usd: $('evm-min').value.trim(), call_alert: $('evm-call').checked };
    const d = await (await fetch('/api/evm-wallets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (!d.success) { window.showToast && showToast('Hata: ' + d.error, 'error'); return; }
    window.showToast && showToast('Ethereum cüzdanı kaydedildi', 'success');
    e.target.reset();
    e.target.closest('details').open = false;
    load();
  });

  load();
  setInterval(load, 30_000);
})();
