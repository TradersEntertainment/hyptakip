// 🐋 Whale card: a shareable 1200×675 PNG drawn on <canvas> (no extra library).
// Data: /portfolio (period PnL curve, account value, volume), /coin-pnl (best/worst coins), live state (open positions).
(function () {
  const W = 1200, H = 675;
  const FONT = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  const MONO = "'JetBrains Mono', ui-monospace, monospace";
  const GREEN = '#34d399', RED = '#fb7185', CYAN = '#22d3ee', SLATE = '#94a3b8', DIM = '#64748b';
  const DAYS = { day: 1, week: 7, month: 30, allTime: 0 };

  const TXT = {
    tr: {
      tagline: 'Hyperliquid Balina Radarı', pnl: 'DÖNEM KÂR / ZARAR',
      period: { day: '24 SAAT', week: '7 GÜN', month: '30 GÜN', allTime: 'TÜM ZAMAN' },
      account: 'Hesap', volume: 'Hacim', open: 'AÇIK POZİSYONLAR', none: 'Açık pozisyon yok',
      more: n => `+${n} pozisyon daha`, coins: 'DÖNEMİN COINLERİ', loading: 'yükleniyor…', noData: 'Bu dönem için veri yok',
      data: 'Veri: Hyperliquid', hidden: 'adres gizli',
      rec: 'TÜM ZAMANLAR KARNESİ', total: 'TOPLAM KÂR / ZARAR · TÜM ZAMANLAR', since: 'İlk kayıt', totalVol: 'Toplam hacim',
      card: 'KARNE', winRate: 'Kârlı kapanış', wl: (w, l) => `${w} kârlı · ${l} zararlı`, lastN: n => `son ${n} işlem`,
      best: 'En büyük kazanç', worst: 'En büyük kayıp', peak: 'Zirve hesap değeri', topCoins: 'EN ÇOK KAZANDIRAN COINLER',
      tiles: { day: '24 SAAT', week: '7 GÜN', month: '30 GÜN' },
    },
    en: {
      tagline: 'Hyperliquid Whale Radar', pnl: 'PERIOD PnL',
      period: { day: '24 HOURS', week: '7 DAYS', month: '30 DAYS', allTime: 'ALL TIME' },
      account: 'Account', volume: 'Volume', open: 'OPEN POSITIONS', none: 'No open positions',
      more: n => `+${n} more`, coins: 'COINS THIS PERIOD', loading: 'loading…', noData: 'No data for this period',
      data: 'Data: Hyperliquid', hidden: 'address hidden',
      rec: 'ALL-TIME TRACK RECORD', total: 'TOTAL PnL · ALL TIME', since: 'Since', totalVol: 'Total volume',
      card: 'TRACK RECORD', winRate: 'Winning closes', wl: (w, l) => `${w} wins · ${l} losses`, lastN: n => `last ${n} trades`,
      best: 'Biggest win', worst: 'Biggest loss', peak: 'Peak account value', topCoins: 'TOP EARNING COINS',
      tiles: { day: '24 HOURS', week: '7 DAYS', month: '30 DAYS' },
    },
  };

  const lang = () => (window.HypI18n && window.HypI18n.lang() === 'en' ? 'en' : 'tr');
  const short = v => {
    const a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
    return `${s}$${a.toFixed(0)}`;
  };
  const signed = v => (v > 0 ? '+' : '') + short(v);
  const coinName = c => String(c || '').includes(':') ? String(c).split(':')[1] : String(c || '');

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function fit(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }
  function pill(ctx, x, y, text, fg, bg, border, size = 13) {
    ctx.font = `800 ${size}px ${FONT}`;
    const w = ctx.measureText(text).width + 20, h = size + 12;
    rr(ctx, x, y - h / 2, w, h, h / 2);
    ctx.fillStyle = bg; ctx.fill();
    ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = fg; ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 10, y + 1);
    ctx.textBaseline = 'alphabetic';
    return w;
  }
  function tier(av) {
    if (av >= 1e6) return ['APEX WHALE', '#e9d5ff', 'rgba(168,85,247,0.18)', 'rgba(168,85,247,0.55)'];
    if (av >= 25e4) return ['GIGA WHALE', '#a5f3fc', 'rgba(34,211,238,0.14)', 'rgba(34,211,238,0.5)'];
    if (av >= 5e4) return ['SMART WHALE', '#bfdbfe', 'rgba(59,130,246,0.14)', 'rgba(59,130,246,0.5)'];
    return ['TRADER', '#cbd5e1', 'rgba(148,163,184,0.12)', 'rgba(148,163,184,0.4)'];
  }

  function background(ctx) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#050914'); g.addColorStop(0.55, '#0a1029'); g.addColorStop(1, '#120a2a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (const [x, y, r, c] of [[140, 60, 520, 'rgba(34,211,238,0.16)'], [1120, 660, 560, 'rgba(168,85,247,0.20)'], [640, 360, 420, 'rgba(59,130,246,0.06)']]) {
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, c); rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.028)'; ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, 'rgba(34,211,238,0.55)'); bg.addColorStop(0.5, 'rgba(59,130,246,0.15)'); bg.addColorStop(1, 'rgba(168,85,247,0.55)');
    rr(ctx, 14, 14, W - 28, H - 28, 30);
    ctx.strokeStyle = bg; ctx.lineWidth = 2; ctx.stroke();
  }

  function logo(ctx, t) {
    const x = 56, y = 48;
    const g = ctx.createLinearGradient(x, y + 44, x + 44, y);
    g.addColorStop(0, '#22d3ee'); g.addColorStop(0.5, '#3b82f6'); g.addColorStop(1, '#9333ea');
    ctx.save(); ctx.shadowColor = 'rgba(34,211,238,0.45)'; ctx.shadowBlur = 18;
    rr(ctx, x, y, 44, 44, 12); ctx.fillStyle = g; ctx.fill(); ctx.restore();
    ctx.beginPath();                                         // lightning bolt
    ctx.moveTo(x + 25, y + 9); ctx.lineTo(x + 13, y + 25); ctx.lineTo(x + 22, y + 25);
    ctx.lineTo(x + 19, y + 36); ctx.lineTo(x + 31, y + 19); ctx.lineTo(x + 22, y + 19); ctx.closePath();
    ctx.fillStyle = '#05070d'; ctx.fill();
    ctx.font = `900 26px ${FONT}`; ctx.fillStyle = '#fff';
    ctx.fillText('HYP', x + 58, y + 24);
    const w = ctx.measureText('HYP').width;
    const tg = ctx.createLinearGradient(x + 58 + w, 0, x + 58 + w + 90, 0);
    tg.addColorStop(0, '#22d3ee'); tg.addColorStop(1, '#60a5fa');
    ctx.fillStyle = tg; ctx.fillText('TAKIP', x + 58 + w, y + 24);
    ctx.font = `600 14px ${FONT}`; ctx.fillStyle = SLATE;
    ctx.fillText(t.tagline, x + 58, y + 44);
  }

  function sparkline(ctx, pts, x, y, w, h, up) {
    if (!pts || pts.length < 2) return false;
    const vs = pts.map(p => p[1]);
    let lo = Math.min(0, ...vs), hi = Math.max(0, ...vs);
    if (hi === lo) hi = lo + 1;
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
    const X = t => x + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * w;
    const Y = v => y + h - ((v - lo) / (hi - lo)) * h;
    const color = up ? GREEN : RED;
    // zero line
    ctx.save(); ctx.setLineDash([5, 6]); ctx.strokeStyle = 'rgba(148,163,184,0.28)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, Y(0)); ctx.lineTo(x + w, Y(0)); ctx.stroke(); ctx.restore();
    // area
    const fill = ctx.createLinearGradient(0, y, 0, y + h);
    fill.addColorStop(0, up ? 'rgba(52,211,153,0.32)' : 'rgba(251,113,133,0.32)'); fill.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.moveTo(X(pts[0][0]), Y(0));
    for (const [t, v] of pts) ctx.lineTo(X(t), Y(v));
    ctx.lineTo(X(pts[pts.length - 1][0]), Y(0)); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    // line with glow
    ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 14; ctx.strokeStyle = color; ctx.lineWidth = 3.5; ctx.lineJoin = 'round';
    ctx.beginPath(); pts.forEach(([t, v], i) => (i ? ctx.lineTo(X(t), Y(v)) : ctx.moveTo(X(t), Y(v)))); ctx.stroke(); ctx.restore();
    const [lt, lv] = pts[pts.length - 1];
    ctx.beginPath(); ctx.arc(X(lt), Y(lv), 6, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.beginPath(); ctx.arc(X(lt), Y(lv), 11, 0, Math.PI * 2); ctx.strokeStyle = color + '66'; ctx.lineWidth = 2; ctx.stroke();
    return true;
  }

  function head(ctx, t, d, ptxt, gold) {
    // top right: period + timestamp
    const now = new Date().toLocaleString(lang() === 'en' ? 'en-GB' : 'tr-TR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    ctx.font = `800 14px ${FONT}`;
    const pw = ctx.measureText(ptxt).width + 20;
    if (gold) pill(ctx, W - 56 - pw, 62, ptxt, '#fde68a', 'rgba(245,158,11,0.14)', 'rgba(245,158,11,0.55)', 14);
    else pill(ctx, W - 56 - pw, 62, ptxt, '#a5f3fc', 'rgba(34,211,238,0.12)', 'rgba(34,211,238,0.5)', 14);
    ctx.font = `500 13px ${MONO}`; ctx.fillStyle = DIM; ctx.textAlign = 'right';
    ctx.fillText(now, W - 56, 100); ctx.textAlign = 'left';

    // identity
    const LX = 64;
    ctx.font = `800 42px ${FONT}`; ctx.fillStyle = '#fff';
    let name = d.label || 'Whale';
    if (!d.showAddress && !d.customName) name = name.replace(/\(?\s*0x[0-9a-f]{3,}\S*\s*\)?/gi, '').trim() || 'Whale';
    ctx.fillText(fit(ctx, name, 560), LX, 172);
    ctx.font = `500 16px ${MONO}`; ctx.fillStyle = SLATE;
    const addr = d.showAddress ? `${d.address.slice(0, 6)}…${d.address.slice(-4)}` : t.hidden;
    ctx.fillText(addr, LX, 204);
    const aw = ctx.measureText(addr).width;
    const [tn, tf, tb, tbd] = tier(d.accountValue);
    pill(ctx, LX + aw + 14, 198, tn, tf, tb, tbd, 12);

  }

  // the rest of the coins in small print under the big chips: "SOL +$12K · HYPE −$3K · …", wrapped, "+N more" when out of room
  function smallCoins(ctx, list, x, y, maxX, maxY) {
    const LH = 18;
    let cx = x, cy = y, i = 0;
    for (; i < list.length; i++) {
      const r = list[i];
      const nm = coinName(r.name || r.coin), v = signed(r.net);
      ctx.font = `700 12px ${FONT}`; const nw = ctx.measureText(nm + ' ').width;
      ctx.font = `700 12px ${MONO}`; const vw = ctx.measureText(v).width;
      const w = nw + vw + (cx > x ? 16 : 0);
      if (cx + w > maxX) {
        if (cy + LH > maxY) break;
        cx = x; cy += LH;
      }
      if (cx > x) { ctx.font = `700 12px ${FONT}`; ctx.fillStyle = 'rgba(148,163,184,0.45)'; ctx.fillText('·', cx + 6, cy); cx += 16; }
      ctx.font = `700 12px ${FONT}`; ctx.fillStyle = SLATE; ctx.fillText(nm + ' ', cx, cy); cx += nw;
      ctx.font = `700 12px ${MONO}`; ctx.fillStyle = r.net >= 0 ? 'rgba(52,211,153,0.85)' : 'rgba(251,113,133,0.85)'; ctx.fillText(v, cx, cy); cx += vw;
    }
    if (i < list.length) {
      const more = `+${list.length - i}`;
      ctx.font = `700 12px ${FONT}`; ctx.fillStyle = DIM;
      ctx.textAlign = 'right'; ctx.fillText(more, maxX, cy); ctx.textAlign = 'left';
    }
  }

  // d = { label, address, showAddress, period, accountValue, positions, portfolio: {pnl, av, vlm} | null, coins: rows | null | 'loading' }
  function draw(canvas, d) {
    const t = TXT[lang()];
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    background(ctx);
    logo(ctx, t);

    const LX = 64;
    head(ctx, t, d, t.period[d.period] || '');

    // big PnL
    const p = d.portfolio;
    const pts = p && p.pnl && p.pnl.length >= 2 ? p.pnl : null;
    const pnl = pts ? pts[pts.length - 1][1] : null;
    const up = pnl === null || pnl >= 0;
    ctx.font = `700 13px ${FONT}`; ctx.fillStyle = SLATE;
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '2px';
    ctx.fillText(t.pnl, LX, 262);
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';
    ctx.save();
    ctx.font = `900 84px ${FONT}`;
    if (pnl === null) { ctx.fillStyle = DIM; ctx.fillText('—', LX, 342); }
    else {
      const g = ctx.createLinearGradient(LX, 270, LX, 345);
      g.addColorStop(0, up ? '#6ee7b7' : '#fda4af'); g.addColorStop(1, up ? '#10b981' : '#f43f5e');
      ctx.shadowColor = up ? 'rgba(16,185,129,0.55)' : 'rgba(244,63,94,0.55)'; ctx.shadowBlur = 34;
      ctx.fillStyle = g; ctx.fillText(fit(ctx, signed(pnl), 560), LX, 342);
    }
    ctx.restore();
    ctx.font = `600 17px ${FONT}`;
    let sx = LX;
    const stat = (k, v) => {
      ctx.fillStyle = DIM; ctx.fillText(k + ' ', sx, 380); sx += ctx.measureText(k + ' ').width;
      ctx.fillStyle = '#e2e8f0'; ctx.font = `700 17px ${MONO}`; ctx.fillText(v, sx, 380); sx += ctx.measureText(v).width + 22;
      ctx.font = `600 17px ${FONT}`;
    };
    stat(t.account, short(d.accountValue || 0));
    if (p && p.vlm) stat(t.volume, short(p.vlm));

    // chart
    if (!sparkline(ctx, pts, LX, 410, 556, 180, up)) {
      ctx.font = `600 16px ${FONT}`; ctx.fillStyle = DIM; ctx.fillText(t.noData, LX, 500);
    }

    // right panel
    const PX = 668, PY = 128, PW = 476, PH = 470;
    rr(ctx, PX, PY, PW, PH, 22);
    ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();
    const IX = PX + 26, IR = PX + PW - 26;
    const pos = (d.positions || []).slice().sort((a, b) => b.positionValue - a.positionValue);
    const total = pos.reduce((s, q) => s + q.positionValue, 0);
    ctx.font = `800 13px ${FONT}`; ctx.fillStyle = SLATE;
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '1.5px';
    ctx.fillText(t.open, IX, PY + 38);
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';
    ctx.textAlign = 'right'; ctx.font = `700 14px ${MONO}`; ctx.fillStyle = '#e2e8f0';
    if (pos.length) ctx.fillText(`${pos.length} · ${short(total)}`, IR, PY + 38);
    ctx.textAlign = 'left';

    let y = PY + 64;
    if (!pos.length) {
      ctx.font = `600 16px ${FONT}`; ctx.fillStyle = DIM; ctx.fillText(t.none, IX, y + 24); y += 50;
    }
    const shown = pos.slice(0, 4);
    for (const q of shown) {
      const long = q.side === 'LONG';
      rr(ctx, IX - 10, y, IR - IX + 20, 50, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fill();
      ctx.font = `800 20px ${FONT}`; ctx.fillStyle = '#fff';
      const cn = fit(ctx, coinName(q.coin), 120);
      ctx.fillText(cn, IX, y + 32);
      const cw = Math.max(ctx.measureText(cn).width, 60);
      pill(ctx, IX + cw + 12, y + 25, `${long ? 'LONG' : 'SHORT'} ${q.leverageValue || ''}x`.replace(' x', ''),
           long ? '#6ee7b7' : '#fda4af', long ? 'rgba(16,185,129,0.14)' : 'rgba(244,63,94,0.14)',
           long ? 'rgba(16,185,129,0.5)' : 'rgba(244,63,94,0.5)', 11);
      ctx.textAlign = 'right';
      ctx.font = `700 17px ${MONO}`; ctx.fillStyle = '#e2e8f0'; ctx.fillText(short(q.positionValue), IR, y + 23);
      ctx.font = `700 13px ${MONO}`; ctx.fillStyle = q.unrealizedPnl >= 0 ? GREEN : RED;
      ctx.fillText(`${signed(q.unrealizedPnl)} (${q.roePct >= 0 ? '+' : ''}${(q.roePct || 0).toFixed(1)}%)`, IR, y + 41);
      ctx.textAlign = 'left';
      y += 58;
    }
    if (pos.length > shown.length) {
      ctx.font = `600 13px ${FONT}`; ctx.fillStyle = DIM; ctx.fillText(t.more(pos.length - shown.length), IX, y + 6); y += 18;
    }

    // long / short bar
    if (pos.length) {
      const lv = pos.filter(q => q.side === 'LONG').reduce((s, q) => s + q.positionValue, 0);
      const lp = total > 0 ? lv / total : 0;
      y += 14;
      ctx.font = `700 13px ${FONT}`;
      ctx.fillStyle = GREEN; ctx.fillText(`LONG ${(lp * 100).toFixed(0)}%`, IX, y);
      ctx.textAlign = 'right'; ctx.fillStyle = RED; ctx.fillText(`SHORT ${((1 - lp) * 100).toFixed(0)}%`, IR, y); ctx.textAlign = 'left';
      y += 10;
      rr(ctx, IX, y, IR - IX, 10, 5); ctx.fillStyle = 'rgba(244,63,94,0.75)'; ctx.fill();
      if (lp > 0) {
        ctx.save(); rr(ctx, IX, y, IR - IX, 10, 5); ctx.clip();
        const lg = ctx.createLinearGradient(IX, 0, IX + (IR - IX) * lp, 0);
        lg.addColorStop(0, '#10b981'); lg.addColorStop(1, '#34d399');
        ctx.fillStyle = lg; ctx.fillRect(IX, y, (IR - IX) * lp, 10); ctx.restore();
      }
      y += 30;
    }

    // best / worst coins of the period
    const room = PY + PH - 20 - y;
    if (room >= 60) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.moveTo(IX, y); ctx.lineTo(IR, y); ctx.stroke();
      y += 28;
      ctx.font = `800 13px ${FONT}`; ctx.fillStyle = SLATE;
      if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '1.5px';
      ctx.fillText(t.coins, IX, y);
      if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';
      y += 10;
      if (d.coins === 'loading') {
        ctx.font = `600 14px ${FONT}`; ctx.fillStyle = DIM; ctx.fillText(t.loading, IX, y + 24);
      } else if (Array.isArray(d.coins)) {
        const rows = d.coins.filter(r => r.trades && Math.abs(r.net) >= 1).sort((a, b) => b.net - a.net);
        const pick = rows.length <= 3 ? rows : [rows[0], rows[1], rows[rows.length - 1]];
        const n = Math.max(0, Math.min(pick.length, Math.floor((PY + PH - 16 - y) / 30)));
        const chipW = n ? (IR - IX - (n - 1) * 10) / n : 0;
        pick.slice(0, n).forEach((r, i) => {
          const cx = IX + i * (chipW + 10);
          rr(ctx, cx, y + 6, chipW, 46, 12);
          ctx.fillStyle = r.net >= 0 ? 'rgba(16,185,129,0.09)' : 'rgba(244,63,94,0.09)'; ctx.fill();
          ctx.strokeStyle = r.net >= 0 ? 'rgba(16,185,129,0.3)' : 'rgba(244,63,94,0.3)'; ctx.stroke();
          ctx.font = `800 14px ${FONT}`; ctx.fillStyle = '#fff';
          ctx.fillText(fit(ctx, coinName(r.name || r.coin), chipW - 20), cx + 10, y + 25);
          ctx.font = `700 14px ${MONO}`; ctx.fillStyle = r.net >= 0 ? GREEN : RED;
          ctx.fillText(signed(r.net), cx + 10, y + 44);
        });
        const shownSet = new Set(pick.slice(0, n));
        smallCoins(ctx, rows.filter(r => !shownSet.has(r)), IX, y + 76, IR, PY + PH - 14);
      }
    }

    // footer
    ctx.font = `600 13px ${FONT}`; ctx.fillStyle = DIM;
    ctx.fillText(t.data, LX, H - 40);
    ctx.textAlign = 'right'; ctx.font = `700 14px ${MONO}`; ctx.fillStyle = CYAN;
    ctx.fillText(location.host || 'hyptakip', W - 56, H - 40);
    ctx.textAlign = 'left';
  }

  function label(ctx, text, x, y, color = SLATE) {
    ctx.font = `800 13px ${FONT}`; ctx.fillStyle = color;
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '1.5px';
    ctx.fillText(text, x, y);
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';
  }

  // 🏆 Track record card. d = { label, address, showAddress, accountValue, periods: {day,week,month,allTime} | null,
  //                             all: coin-pnl response for all time | null | 'loading' }
  function drawRecord(canvas, d) {
    const t = TXT[lang()];
    const loc = lang() === 'en' ? 'en-GB' : 'tr-TR';
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    background(ctx);
    logo(ctx, t);
    head(ctx, t, d, t.rec, true);
    const LX = 64;
    const per = d.periods || {};
    const last = p => (p && p.pnl && p.pnl.length >= 2 ? p.pnl[p.pnl.length - 1][1] : null);
    const at = per.allTime;
    const total = last(at);
    const up = total === null || total >= 0;

    label(ctx, t.total, LX, 262);
    ctx.save();
    ctx.font = `900 84px ${FONT}`;
    if (total === null) { ctx.fillStyle = DIM; ctx.fillText('—', LX, 342); }
    else {
      const g = ctx.createLinearGradient(LX, 270, LX, 345);
      g.addColorStop(0, up ? '#fde68a' : '#fda4af'); g.addColorStop(0.45, up ? '#6ee7b7' : '#fb7185'); g.addColorStop(1, up ? '#10b981' : '#e11d48');
      ctx.shadowColor = up ? 'rgba(16,185,129,0.55)' : 'rgba(244,63,94,0.55)'; ctx.shadowBlur = 34;
      ctx.fillStyle = g; ctx.fillText(fit(ctx, signed(total), 580), LX, 342);
    }
    ctx.restore();
    ctx.font = `600 17px ${FONT}`;
    let sx = LX;
    const stat = (k, v) => {
      ctx.font = `600 17px ${FONT}`; ctx.fillStyle = DIM; ctx.fillText(k + ' ', sx, 380); sx += ctx.measureText(k + ' ').width;
      ctx.fillStyle = '#e2e8f0'; ctx.font = `700 17px ${MONO}`; ctx.fillText(v, sx, 380); sx += ctx.measureText(v).width + 22;
    };
    if (at && at.pnl && at.pnl.length) stat(t.since, new Date(at.pnl[0][0]).toLocaleDateString(loc, { day: '2-digit', month: 'short', year: 'numeric' }));
    if (at && at.vlm) stat(t.totalVol, short(at.vlm));

    // 24h / 7d / 30d tiles
    const keys = ['day', 'week', 'month'];
    const tw = (556 - 2 * 14) / 3;
    keys.forEach((k, i) => {
      const x = LX + i * (tw + 14), y = 404, v = last(per[k]);
      rr(ctx, x, y, tw, 70, 14);
      ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
      ctx.strokeStyle = v === null ? 'rgba(255,255,255,0.08)' : v >= 0 ? 'rgba(16,185,129,0.35)' : 'rgba(244,63,94,0.35)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.font = `800 12px ${FONT}`; ctx.fillStyle = DIM; ctx.fillText(t.tiles[k], x + 14, y + 25);
      ctx.font = `800 22px ${MONO}`; ctx.fillStyle = v === null ? DIM : v >= 0 ? GREEN : RED;
      ctx.fillText(v === null ? '—' : fit(ctx, signed(v), tw - 28), x + 14, y + 55);
    });

    // all-time curve
    if (!sparkline(ctx, at && at.pnl && at.pnl.length >= 2 ? at.pnl : null, LX, 494, 556, 100, up)) {
      ctx.font = `600 16px ${FONT}`; ctx.fillStyle = DIM; ctx.fillText(t.noData, LX, 550);
    }

    // right panel: track record
    const PX = 668, PY = 128, PW = 476, PH = 470;
    rr(ctx, PX, PY, PW, PH, 22);
    ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fill();
    ctx.strokeStyle = 'rgba(245,158,11,0.25)'; ctx.lineWidth = 1; ctx.stroke();
    const IX = PX + 26, IR = PX + PW - 26;
    label(ctx, t.card, IX, PY + 38, '#fcd34d');
    const all = d.all;
    if (all === 'loading' || !all) {
      ctx.font = `600 15px ${FONT}`; ctx.fillStyle = DIM; ctx.fillText(all === 'loading' ? t.loading : t.noData, IX, PY + 80);
    } else {
      const r = all.record || { wins: 0, losses: 0 };
      const n = r.wins + r.losses;
      let y = PY + 60;
      // win ring
      const cx = IX + 56, cy = y + 58, R = 48;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 11; ctx.stroke();
      if (n) {
        const wr = r.wins / n;
        if (wr > 0) {
          const rg = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
          rg.addColorStop(0, '#22d3ee'); rg.addColorStop(1, '#34d399');
          ctx.save(); ctx.shadowColor = 'rgba(52,211,153,0.6)'; ctx.shadowBlur = 12;
          ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + wr * Math.PI * 2); ctx.strokeStyle = rg; ctx.stroke(); ctx.restore();
        }
        ctx.textAlign = 'center'; ctx.font = `900 24px ${MONO}`; ctx.fillStyle = '#fff';
        ctx.fillText(`${Math.round(wr * 100)}%`, cx, cy + 8); ctx.textAlign = 'left';
      } else {
        ctx.textAlign = 'center'; ctx.font = `900 24px ${MONO}`; ctx.fillStyle = DIM; ctx.fillText('—', cx, cy + 8); ctx.textAlign = 'left';
      }
      ctx.lineCap = 'butt'; ctx.lineWidth = 1;
      ctx.font = `800 20px ${FONT}`; ctx.fillStyle = '#fff'; ctx.fillText(t.winRate, IX + 130, cy - 10);
      ctx.font = `600 15px ${MONO}`; ctx.fillStyle = SLATE; ctx.fillText(t.wl(r.wins, r.losses), IX + 130, cy + 16);
      if (all.truncated) { ctx.font = `600 12px ${FONT}`; ctx.fillStyle = DIM; ctx.fillText(t.lastN(all.fills), IX + 130, cy + 38); }
      y = cy + R + 26;

      const row = (k, v, color, sub) => {
        rr(ctx, IX - 10, y, IR - IX + 20, 44, 12); ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fill();
        ctx.font = `600 15px ${FONT}`; ctx.fillStyle = SLATE; ctx.fillText(k, IX, y + 28);
        ctx.textAlign = 'right'; ctx.font = `800 17px ${MONO}`; ctx.fillStyle = color; ctx.fillText(v, IR, y + 28);
        if (sub) { const vw = ctx.measureText(v).width; ctx.font = `700 14px ${FONT}`; ctx.fillStyle = '#e2e8f0'; ctx.fillText(sub, IR - vw - 10, y + 28); }
        ctx.textAlign = 'left';
        y += 48;
      };
      if (r.best) row(t.best, signed(r.best.pnl), GREEN, coinName(r.best.name || r.best.coin));
      if (r.worst) row(t.worst, signed(r.worst.pnl), RED, coinName(r.worst.name || r.worst.coin));
      const av = at && at.av && at.av.length ? Math.max(...at.av.map(x => x[1])) : null;
      if (av !== null && isFinite(av)) row(t.peak, short(av), '#e2e8f0');

      const top = (all.rows || []).filter(x => x.net >= 1).sort((a, b) => b.net - a.net).slice(0, 3);
      if (top.length && PY + PH - y >= 80) {
        y += 14;
        label(ctx, t.topCoins, IX, y);
        y += 14;
        const cw = (IR - IX - (top.length - 1) * 10) / top.length;
        top.forEach((x, i) => {
          const cx2 = IX + i * (cw + 10);
          rr(ctx, cx2, y, cw, 46, 12);
          ctx.fillStyle = 'rgba(16,185,129,0.09)'; ctx.fill(); ctx.strokeStyle = 'rgba(16,185,129,0.3)'; ctx.stroke();
          ctx.font = `800 14px ${FONT}`; ctx.fillStyle = '#fff'; ctx.fillText(fit(ctx, coinName(x.name || x.coin), cw - 20), cx2 + 10, y + 19);
          ctx.font = `700 14px ${MONO}`; ctx.fillStyle = GREEN; ctx.fillText(signed(x.net), cx2 + 10, y + 38);
        });
        const rest = (all.rows || []).filter(x => Math.abs(x.net) >= 1 && !top.includes(x)).sort((a, b) => b.net - a.net);
        smallCoins(ctx, rest, IX, y + 68, IR, PY + PH - 12);
      }
    }

    ctx.font = `600 13px ${FONT}`; ctx.fillStyle = DIM;
    ctx.fillText(t.data, LX, H - 40);
    ctx.textAlign = 'right'; ctx.font = `700 14px ${MONO}`; ctx.fillStyle = CYAN;
    ctx.fillText(location.host || 'hyptakip', W - 56, H - 40);
    ctx.textAlign = 'left';
  }

  // ---- modal wiring ----
  let state = null;   // { address, label, period, showAddress, portfolio: {period: data}, coins: {period: rows} }

  function el(id) { return document.getElementById(id); }

  function render() {
    if (!state || !window.selectedWalletForCard) return;
    const w = window.selectedWalletForCard();
    if (!w || w.address.toLowerCase() !== state.address) return;
    const st = w.state || {};
    const pf = state.portfolio ? state.portfolio[state.period] : null;
    const kindOn = k => document.querySelectorAll('#whale-card-kinds [data-kind]').forEach(b => {
      const on = b.dataset.kind === k;
      b.classList.toggle('bg-cyan-500/15', on); b.classList.toggle('text-cyan-300', on); b.classList.toggle('border-cyan-500/40', on);
      b.classList.toggle('text-slate-300', !on);
    });
    kindOn(state.kind);
    el('whale-card-periods').classList.toggle('invisible', state.kind === 'record');
    if (state.kind === 'record') {
      const all = state.coins.allTime;
      drawRecord(el('whale-card-canvas'), {
        label: state.customName || w.label, customName: !!state.customName, address: w.address, showAddress: state.showAddress, accountValue: parseFloat(st.accountValue || 0),
        periods: state.portfolio, all: all === undefined ? 'loading' : all,
      });
      return;
    }
    const resp = state.coins[state.period];
    const coins = resp === undefined ? undefined : resp && resp.rows;
    draw(el('whale-card-canvas'), {
      label: state.customName || w.label, customName: !!state.customName, address: w.address, showAddress: state.showAddress, period: state.period,
      accountValue: parseFloat(st.accountValue || 0), positions: st.positions || [],
      portfolio: pf || null, coins: coins === undefined ? 'loading' : coins,
    });
    document.querySelectorAll('#whale-card-periods [data-period]').forEach(b => {
      const on = b.dataset.period === state.period;
      b.classList.toggle('bg-cyan-500/15', on); b.classList.toggle('text-cyan-300', on); b.classList.toggle('border-cyan-500/40', on);
      b.classList.toggle('text-slate-300', !on);
    });
  }

  async function load() {
    const addr = state.address, period = state.kind === 'record' ? 'allTime' : state.period;
    if (!state.portfolio) {
      try {
        const r = await (await fetch(`/api/wallets/${addr}/portfolio`)).json();
        if (state.address !== addr) return;
        state.portfolio = r.success ? (r.periods || {}) : {};
      } catch (e) { if (state.address !== addr) return; state.portfolio = {}; }
      if (state.address !== addr) return;
      render();
    }
    if (state.coins[period] === undefined) {
      try {
        const r = await (await fetch(`/api/wallets/${addr}/coin-pnl?days=${DAYS[period]}`)).json();
        if (state.address !== addr) return;
        state.coins[period] = r.success ? r : null;
      } catch (e) { if (state.address === addr) state.coins[period] = null; }
      if ((state.kind === 'record' ? 'allTime' : state.period) === period) render();
    }
  }

  function blob() {
    return new Promise(res => el('whale-card-canvas').toBlob(res, 'image/png'));
  }
  function fileName() {
    const w = window.selectedWalletForCard();
    const base = String((w && w.label) || 'whale').replace(/[^\w-]+/g, '_').slice(0, 40) || 'whale';
    return `hyptakip_${base}_${state.kind === 'record' ? 'karne' : state.period}.png`;
  }

  function open(period, kind) {
    const w = window.selectedWalletForCard && window.selectedWalletForCard();
    if (!w) return;
    const addr = w.address.toLowerCase();
    // keep the picked period / address toggle, but always refetch so the numbers match the timestamp on the card
    state = { address: addr, period: state && state.address === addr ? state.period : 'month',
              showAddress: state ? state.showAddress : true, kind: kind === 'record' ? 'record' : 'snap', portfolio: null, coins: {} };
    if (period && DAYS[period] !== undefined) state.period = period;
    el('whale-card-show-address').checked = state.showAddress;
    // name on the card only (the wallet's own label is not changed); remembered per wallet in this browser
    try { state.customName = localStorage.getItem('hyp_card_name_' + addr) || ''; } catch (e) { state.customName = ''; }
    el('whale-card-name').value = state.customName;
    el('whale-card-name').placeholder = w.label || '';
    el('btn-whale-card-share').classList.toggle('hidden', !(navigator.canShare && navigator.share));
    el('modal-whale-card').classList.remove('hidden');
    render();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(render);
    load();
  }

  function init() {
    if (!el('modal-whale-card')) return;
    el('btn-open-whale-card')?.addEventListener('click', () => open(window.currentPnlPeriodForCard && window.currentPnlPeriodForCard()));
    el('btn-open-record-card')?.addEventListener('click', () => open(null, 'record'));
    document.querySelectorAll('#whale-card-kinds [data-kind]').forEach(b => b.addEventListener('click', () => {
      state.kind = b.dataset.kind; render(); load();
    }));
    el('btn-whale-card-close').addEventListener('click', () => el('modal-whale-card').classList.add('hidden'));
    el('modal-whale-card').addEventListener('click', e => { if (e.target.id === 'modal-whale-card') e.target.classList.add('hidden'); });
    document.querySelectorAll('#whale-card-periods [data-period]').forEach(b => b.addEventListener('click', () => {
      state.period = b.dataset.period; state.kind = 'snap'; render(); load();
    }));
    el('whale-card-show-address').addEventListener('change', e => { state.showAddress = e.target.checked; render(); });
    el('whale-card-name').addEventListener('input', e => {
      state.customName = e.target.value.trim().slice(0, 60);
      try {
        if (state.customName) localStorage.setItem('hyp_card_name_' + state.address, state.customName);
        else localStorage.removeItem('hyp_card_name_' + state.address);
      } catch (err) { /* storage blocked: still used for this card */ }
      render();
    });
    el('btn-whale-card-download').addEventListener('click', async () => {
      const b = await blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = fileName();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
    el('btn-whale-card-copy').addEventListener('click', async () => {
      try {
        // Safari wants the ClipboardItem promise created synchronously inside the click
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob() })]);
        window.showToast && window.showToast(lang() === 'en' ? 'Card image copied 📋' : 'Kart görseli panoya kopyalandı 📋', 'success');
      } catch (e) {
        window.showToast && window.showToast(lang() === 'en' ? 'Copy not supported here, use Download' : 'Bu tarayıcı görsel kopyalamıyor, İndir\'i kullan', 'error');
      }
    });
    el('btn-whale-card-share').addEventListener('click', async () => {
      try {
        const f = new File([await blob()], fileName(), { type: 'image/png' });
        if (navigator.canShare({ files: [f] })) await navigator.share({ files: [f] });
      } catch (e) { /* user cancelled */ }
    });
    document.addEventListener('hyp:lang', () => { if (!el('modal-whale-card').classList.contains('hidden')) render(); });
  }

  window.HypWhaleCard = { draw, drawRecord, open, refresh: () => state && render() };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
