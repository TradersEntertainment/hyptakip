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
        <div class="p-2.5 rounded-xl bg-slate-950/60 border border-white/5 flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="font-bold text-white truncate" data-no-i18n>${esc(w.label)}${Number(w.call_alert) === 1 ? ' 📞' : ''}</div>
            <a href="https://etherscan.io/address/${esc(w.address)}" target="_blank" rel="noopener" class="text-[0.625rem] font-mono text-slate-500 hover:text-indigo-300">${esc(w.address.slice(0, 8))}…${esc(w.address.slice(-6))}</a>
            <span class="text-[0.625rem] text-slate-500"> · ≥ ${usd(Number(w.min_usd) || 0)}</span>
          </div>
          <button data-evm-del="${esc(w.address)}" title="Sil" class="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 text-xs">✕</button>
        </div>`).join('') || '<div class="text-slate-500 text-center py-2">Henüz Ethereum cüzdanı yok.</div>';
      list.querySelectorAll('[data-evm-del]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm(window.T ? T('Bu Ethereum cüzdanı takipten çıkarılsın mı?') : 'Bu Ethereum cüzdanı takipten çıkarılsın mı?')) return;
        await fetch(`/api/evm-wallets/${b.dataset.evmDel}`, { method: 'DELETE' });
        load();
      }));
    } catch (err) {
      list.innerHTML = `<div class="text-rose-400">${esc(err.message)}</div>`;
    }
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
