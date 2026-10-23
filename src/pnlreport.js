// 🔬 Detailed PnL report: several 1600×1000 PNG pages drawn on the server (@napi-rs/canvas, fonts bundled in
// assets/fonts) and sent to Telegram as one album with /pnl.
// User (23.10): "aşırı detaylı bir card hazırla … milim milim incelensin, telegramdan bota /pnl yazınca yollasın
// tüm detayları" · "birden çok görsel şeklinde de atabilir".
// Pages: 1 summary · 2 track record + daily PnL · 3 open positions · 4 PnL per coin · 5 newest closes.
const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const pnldata = require('./pnldata');
const hyperliquid = require('./hyperliquid');
const tracker = require('./tracker');
const telegram = require('./telegram');

const FONT_DIR = path.join(__dirname, '../assets/fonts');
let fontsReady = false;
function fonts() {
  if (fontsReady) return;
  for (const f of ['PlusJakartaSans_600SemiBold', 'PlusJakartaSans_700Bold', 'PlusJakartaSans_800ExtraBold']) {
    GlobalFonts.registerFromPath(path.join(FONT_DIR, f + '.ttf'), 'Jakarta');
  }
  for (const f of ['JetBrainsMono_500Medium', 'JetBrainsMono_700Bold', 'JetBrainsMono_800ExtraBold']) {
    GlobalFonts.registerFromPath(path.join(FONT_DIR, f + '.ttf'), 'JBMono');
  }
  fontsReady = true;
}

const W = 1600, H = 1000, PAGES = 5;
const F = 'Jakarta', M = 'JBMono';
const GREEN = '#34d399', RED = '#fb7185', CYAN = '#22d3ee', AMBER = '#fcd34d', SLATE = '#94a3b8', DIM = '#64748b', TEXT = '#e2e8f0';
const TZ = 'Europe/Istanbul';

const TXT = {
  tr: {
    report: 'Detaylı K/Z raporu', page: ['ÖZET', 'KARNE', 'AÇIK POZİSYONLAR', 'COIN DÖKÜMÜ', 'SON KAPANIŞLAR'],
    data: 'Veri: Hyperliquid · saatler TSİ', loc: 'tr-TR',
    kpi: ['Toplam değer (perp+spot)', 'Perp hesabı', 'Çekilebilir', 'Açık pozisyon', 'Efektif kaldıraç', 'Açık K/Z'],
    periods: { day: '24 saat', week: '7 gün', month: '30 gün', allTime: 'Tüm zaman' },
    ptHead: ['Dönem', 'K/Z', 'Getiri*', 'Hacim', 'Bakiye (başı → sonu)'],
    ptNote: '* Dönem başı bakiyeye göre; dönem içindeki para yatırma / çekme bunu etkiler.',
    curve30: 'Son 30 gün K/Z', curveAll: 'Tüm zaman K/Z (yeşil) ve hesap değeri (kesikli)',
    noData: 'veri yok', none: 'Açık pozisyon yok',
    win: 'Kârlı kapanış', wl: (w, l) => `${w} kârlı · ${l} zararlı kapanış`,
    rec: ['Ortalama kârlı kapanış', 'Ortalama zararlı kapanış', 'Kapanış başına ortalama', 'En büyük kazanç', 'En büyük kayıp',
          'Toplam gerçekleşen', 'Toplam ücret', 'Toplam funding', 'İşlem kaydı', 'Veri kapsamı'],
    full: 'tüm geçmiş', from: d => `${d}'den beri (HL son ~10.000 işlemi veriyor)`,
    daily: 'Günlük K/Z · son 30 gün', dayStats: (p, n, b, w) => `Kârlı gün ${p}/${n} · en iyi ${b} · en kötü ${w}`,
    posHead: ['Coin', 'Yön', 'Kald.', 'Büyüklük', 'Değer', 'Giriş', 'Mark', 'Liq', 'Liq uzak.', 'K/Z', 'ROE', 'Teminat', 'Funding*'],
    posNote: '* Pozisyon açıldığından beri ödenen (−) / alınan (+) funding.',
    posSum: (l, s, u) => `Long ${l} · Short ${s} · açık K/Z ${u}`,
    coinHead: ['Coin', '7 gün net', '30 gün net', 'Tüm net', 'Gerçekleşen', 'Ücret', 'Funding', 'Hacim', 'İşlem', 'Açık K/Z'],
    coinNote: 'Net = gerçekleşen − ücret + funding. Açık K/Z pozisyon açıldığından beri, nete eklenmez.',
    others: n => `Diğer ${n} coin`, total: 'TOPLAM',
    closeHead: ['Zaman', 'Coin', 'İşlem', 'Fiyat', 'Miktar', 'Değer', 'K/Z', 'Ücret'],
    dir: { 'Close Long': 'Long kapat', 'Close Short': 'Short kapat', 'Long > Short': 'Long → Short', 'Short > Long': 'Short → Long', 'Sell': 'Sat', 'Buy': 'Al' },
    closeNote: n => `En yeni ${n} kapanış. Aynı coin ve işlemde 2 dakika içindeki dolumlar tek satır; fiyat ortalamadır.`, noClose: 'Kapanış kaydı yok',
    since: 'Açılış',
    ratios: 'ORANLAR', rt: ['Sharpe (yıllık)', 'Sortino (yıllık)', 'En büyük düşüş', 'En büyük düşüş %', 'Toparlanma oranı',
                            'Kâr / zarar oranı', 'Kazanç / kayıp boyu', 'Günlük oynaklık'],
    rtNote: 'Sharpe / Sortino: son 30 günün günlük getirileri (gün başı bakiyeye göre), √365 ile yıllık, risksiz faiz 0. Düşüş: tüm zaman K/Z eğrisinde zirveden dibe. Toparlanma = toplam K/Z ÷ en büyük düşüş. Kâr/zarar oranı = kârlı kapanışlar toplamı ÷ zararlılar toplamı.',
    share: 'POZİSYON PAYLARI', margin: 'TEMİNAT', mk: ['Perp hesabı', 'Kullanılan teminat', 'Serbest teminat', 'Çekilebilir', 'Efektif kaldıraç', 'Teminat kullanımı'],
    fills: 'Dolum',
  },
  en: {
    report: 'Detailed PnL report', page: ['SUMMARY', 'TRACK RECORD', 'OPEN POSITIONS', 'PnL PER COIN', 'NEWEST CLOSES'],
    data: 'Data: Hyperliquid · times UTC+3', loc: 'en-GB',
    kpi: ['Total value (perp+spot)', 'Perp account', 'Withdrawable', 'Open positions', 'Effective leverage', 'Unrealized PnL'],
    periods: { day: '24 hours', week: '7 days', month: '30 days', allTime: 'All time' },
    ptHead: ['Period', 'PnL', 'Return*', 'Volume', 'Balance (start → end)'],
    ptNote: '* On the balance at the start of the period; deposits / withdrawals during it affect this.',
    curve30: 'Last 30 days PnL', curveAll: 'All-time PnL (green) and account value (dashed)',
    noData: 'no data', none: 'No open positions',
    win: 'Winning closes', wl: (w, l) => `${w} winning · ${l} losing closes`,
    rec: ['Average winning close', 'Average losing close', 'Average per close', 'Biggest win', 'Biggest loss',
          'Total realized', 'Total fees', 'Total funding', 'Trade records', 'Data coverage'],
    full: 'full history', from: d => `since ${d} (HL serves the last ~10,000 trades)`,
    daily: 'Daily PnL · last 30 days', dayStats: (p, n, b, w) => `Green days ${p}/${n} · best ${b} · worst ${w}`,
    posHead: ['Coin', 'Side', 'Lev.', 'Size', 'Value', 'Entry', 'Mark', 'Liq', 'Liq dist.', 'PnL', 'ROE', 'Margin', 'Funding*'],
    posNote: '* Funding paid (−) / received (+) since the position was opened.',
    posSum: (l, s, u) => `Long ${l} · Short ${s} · unrealized ${u}`,
    coinHead: ['Coin', '7d net', '30d net', 'All-time net', 'Realized', 'Fees', 'Funding', 'Volume', 'Trades', 'Unrealized'],
    coinNote: 'Net = realized − fees + funding. Unrealized is since the position was opened and not added to net.',
    others: n => `${n} other coins`, total: 'TOTAL',
    closeHead: ['Time', 'Coin', 'Action', 'Price', 'Size', 'Value', 'PnL', 'Fee'],
    dir: {},
    closeNote: n => `Newest ${n} closes. Fills of the same coin and action within 2 minutes are one row; price is the average.`, noClose: 'No closes recorded',
    since: 'Opened',
    ratios: 'RATIOS', rt: ['Sharpe (annual)', 'Sortino (annual)', 'Max drawdown', 'Max drawdown %', 'Recovery factor',
                           'Profit factor', 'Win / loss size', 'Daily volatility'],
    rtNote: 'Sharpe / Sortino: daily returns of the last 30 days (on the start-of-day balance), annualized with √365, risk-free rate 0. Drawdown: peak to trough of the all-time PnL curve. Recovery = total PnL ÷ max drawdown. Profit factor = sum of winning closes ÷ sum of losing closes.',
    share: 'POSITION SHARES', margin: 'MARGIN', mk: ['Perp account', 'Margin used', 'Free margin', 'Withdrawable', 'Effective leverage', 'Margin usage'],
    fills: 'Fills',
  },
};

// ---------- formatting ----------
const short = v => {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(a < 10 ? 2 : 0)}`;
};
const signed = v => (v > 0 ? '+' : '') + short(v);
const px = v => {
  if (!Number.isFinite(v) || v === 0) return '—';
  const a = Math.abs(v);
  const d = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 5 : 7;
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: d });
};
const qty = v => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : Number(v.toPrecision(5)).toLocaleString('en-US', { maximumFractionDigits: 6 }));
const coinName = c => (String(c || '').includes(':') ? String(c).split(':')[1] : String(c || ''));
const colorOf = v => (v > 0 ? GREEN : v < 0 ? RED : DIM);

// ---------- drawing helpers ----------
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function fit(ctx, text, maxW) {
  text = String(text);
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
function txt(ctx, s, x, y, { font = `600 16px ${F}`, color = TEXT, align = 'left', max } = {}) {
  ctx.font = font; ctx.fillStyle = color;
  s = max ? fit(ctx, s, max) : String(s);
  // Jakarta turns "0x" into "0×": draw the pieces separately so the pair is never shaped together
  const parts = font.includes(F) && /0x/.test(s) ? s.split(/(?<=0)(?=x)/) : [s];
  const wTot = parts.reduce((a, p) => a + ctx.measureText(p).width, 0);
  let cx = align === 'right' ? x - wTot : align === 'center' ? x - wTot / 2 : x;
  ctx.textAlign = 'left';
  for (const p of parts) { ctx.fillText(p, cx, y); cx += ctx.measureText(p).width; }
}
function caps(ctx, s, x, y, color = SLATE, size = 13) {
  ctx.font = `800 ${size}px ${F}`; ctx.fillStyle = color;
  let cx = x;
  for (const ch of String(s)) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + 1.6; }
}
function wrap(ctx, s, x, y, maxW, lh, opts) {
  ctx.font = opts.font;
  let line = '';
  for (const w of String(s).split(' ')) {
    const tryL = line ? line + ' ' + w : w;
    if (ctx.measureText(tryL).width > maxW && line) { txt(ctx, line, x, y, opts); y += lh; line = w; } else line = tryL;
  }
  if (line) txt(ctx, line, x, y, opts);
  return y + lh;
}
function panel(ctx, x, y, w, h, stroke = 'rgba(255,255,255,0.08)') {
  rr(ctx, x, y, w, h, 18);
  ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
}
function pill(ctx, x, y, text, fg, bg, border, size = 13) {
  ctx.font = `800 ${size}px ${F}`;
  const w = ctx.measureText(text).width + 18, h = size + 11;
  rr(ctx, x, y - h / 2, w, h, h / 2);
  ctx.fillStyle = bg; ctx.fill(); ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.fillText(text, x + 9, y + 1); ctx.textBaseline = 'alphabetic';
  return w;
}

function frame(ctx, t, d, pageNo) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#050914'); g.addColorStop(0.55, '#0a1029'); g.addColorStop(1, '#120a2a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for (const [x, y, r, c] of [[160, 40, 620, 'rgba(34,211,238,0.12)'], [1500, 980, 680, 'rgba(168,85,247,0.16)']]) {
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, c); rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.025)'; ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }
  const bd = ctx.createLinearGradient(0, 0, W, H);
  bd.addColorStop(0, 'rgba(34,211,238,0.5)'); bd.addColorStop(0.5, 'rgba(59,130,246,0.12)'); bd.addColorStop(1, 'rgba(168,85,247,0.5)');
  rr(ctx, 12, 12, W - 24, H - 24, 28); ctx.strokeStyle = bd; ctx.lineWidth = 2; ctx.stroke();

  // header: name + address (left), page title + n/N (right)
  txt(ctx, d.name, 48, 74, { font: `800 38px ${F}`, color: '#fff', max: 760 });
  txt(ctx, d.address, 48, 104, { font: `500 15px ${M}`, color: SLATE });
  caps(ctx, `${t.report.toLocaleUpperCase(t.loc)} · ${t.page[pageNo - 1]}`, W - 48 - 520, 60, AMBER, 13);
  txt(ctx, `${pageNo}/${PAGES}`, W - 48, 62, { font: `800 15px ${M}`, color: SLATE, align: 'right' });
  txt(ctx, d.when, W - 48, 100, { font: `500 14px ${M}`, color: DIM, align: 'right' });
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.moveTo(48, 126); ctx.lineTo(W - 48, 126); ctx.stroke();
  // footer
  txt(ctx, t.data, 48, H - 34, { font: `600 13px ${F}`, color: DIM });
  if (d.showLogo) txt(ctx, 'HYPTAKIP', W - 48, H - 34, { font: `900 14px ${F}`, color: CYAN, align: 'right' });
}

// line chart; extra = optional second series drawn dashed on its own scale
function chart(ctx, pts, x, y, w, h, { extra, labels = true, loc = 'tr-TR', fmtT } = {}) {
  if (!pts || pts.length < 2) return false;
  const vs = pts.map(p => p[1]);
  let lo = Math.min(0, ...vs), hi = Math.max(0, ...vs);
  if (hi === lo) hi = lo + 1;
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
  const X = tt => x + (t1 === t0 ? 0 : (tt - t0) / (t1 - t0)) * w;
  const Y = v => y + h - ((v - lo) / (hi - lo)) * h;
  const up = vs[vs.length - 1] >= 0, color = up ? GREEN : RED;
  // grid + axis labels
  ctx.font = `500 12px ${M}`;
  for (let i = 0; i <= 4; i++) {
    const v = lo + (hi - lo) * (i / 4), yy = Y(v);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke();
    if (labels) { ctx.fillStyle = DIM; ctx.textAlign = 'right'; ctx.fillText(short(v), x - 8, yy + 4); ctx.textAlign = 'left'; }
  }
  ctx.save(); ctx.setLineDash([5, 6]); ctx.strokeStyle = 'rgba(148,163,184,0.35)';
  ctx.beginPath(); ctx.moveTo(x, Y(0)); ctx.lineTo(x + w, Y(0)); ctx.stroke(); ctx.restore();
  if (extra && extra.length >= 2) {
    const ev = extra.map(p => p[1]);
    let el = Math.min(...ev), eh = Math.max(...ev);
    if (eh === el) eh = el + 1;
    const EY = v => y + h - ((v - el) / (eh - el)) * h * 0.9 - h * 0.05;
    ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(148,163,184,0.55)'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    extra.filter(p => p[0] >= t0 && p[0] <= t1).forEach(([tt, v], i) => (i ? ctx.lineTo(X(tt), EY(v)) : ctx.moveTo(X(tt), EY(v))));
    ctx.stroke(); ctx.restore();
    if (labels) {
      ctx.fillStyle = 'rgba(148,163,184,0.8)'; ctx.font = `500 12px ${M}`;
      ctx.fillText(short(eh), x + w + 8, EY(eh) + 4); ctx.fillText(short(el), x + w + 8, EY(el) + 4);
    }
  }
  const fill = ctx.createLinearGradient(0, y, 0, y + h);
  fill.addColorStop(0, up ? 'rgba(52,211,153,0.28)' : 'rgba(251,113,133,0.28)'); fill.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath(); ctx.moveTo(X(t0), Y(0));
  for (const [tt, v] of pts) ctx.lineTo(X(tt), Y(v));
  ctx.lineTo(X(t1), Y(0)); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 10; ctx.strokeStyle = color; ctx.lineWidth = 2.6; ctx.lineJoin = 'round';
  ctx.beginPath(); pts.forEach(([tt, v], i) => (i ? ctx.lineTo(X(tt), Y(v)) : ctx.moveTo(X(tt), Y(v)))); ctx.stroke(); ctx.restore();
  // max / min markers
  let iMax = 0, iMin = 0;
  vs.forEach((v, i) => { if (v > vs[iMax]) iMax = i; if (v < vs[iMin]) iMin = i; });
  for (const i of new Set([iMax, iMin, vs.length - 1])) {
    const [tt, v] = pts[i];
    ctx.beginPath(); ctx.arc(X(tt), Y(v), 4.5, 0, Math.PI * 2); ctx.fillStyle = colorOf(v) === DIM ? SLATE : colorOf(v); ctx.fill();
    ctx.font = `700 12px ${M}`; ctx.fillStyle = TEXT;
    const lx = Math.min(Math.max(X(tt), x + 30), x + w - 30);
    ctx.textAlign = 'center'; ctx.fillText(signed(v), lx, i === iMin && i !== vs.length - 1 ? Y(v) + 18 : Y(v) - 10); ctx.textAlign = 'left';
  }
  if (labels && fmtT) {
    ctx.font = `500 12px ${M}`; ctx.fillStyle = DIM;
    for (let i = 0; i <= 4; i++) {
      const tt = t0 + (t1 - t0) * (i / 4);
      ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
      ctx.fillText(fmtT(tt), X(tt), y + h + 20);
    }
    ctx.textAlign = 'left';
  }
  return true;
}

// generic table: cols = [{h, w, align, get(row) -> {s, color, font}}]
function table(ctx, x, y, cols, rows, { rowH = 40, headSize = 12, zebra = true, maxRows = 99, bold } = {}) {
  let cx = x;
  for (const c of cols) {
    ctx.font = `800 ${headSize}px ${F}`; ctx.fillStyle = SLATE;
    ctx.textAlign = c.align || 'left';
    ctx.fillText(c.h, c.align === 'right' ? cx + c.w - 8 : cx + 8, y);
    cx += c.w;
  }
  ctx.textAlign = 'left';
  const totalW = cols.reduce((s, c) => s + c.w, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.beginPath(); ctx.moveTo(x, y + 12); ctx.lineTo(x + totalW, y + 12); ctx.stroke();
  let yy = y + 14;
  rows.slice(0, maxRows).forEach((r, i) => {
    if (zebra && i % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.025)'; ctx.fillRect(x, yy, totalW, rowH); }
    if (bold && bold(r)) { ctx.fillStyle = 'rgba(34,211,238,0.07)'; ctx.fillRect(x, yy, totalW, rowH); }
    let cx2 = x;
    for (const c of cols) {
      const v = c.get(r) || {};
      ctx.font = v.font || `600 15px ${M}`; ctx.fillStyle = v.color || TEXT;
      ctx.textAlign = c.align || 'left';
      const s = fit(ctx, v.s ?? '', c.w - 16);
      ctx.fillText(s, c.align === 'right' ? cx2 + c.w - 8 : cx2 + 8, yy + rowH / 2 + 5);
      cx2 += c.w;
    }
    ctx.textAlign = 'left';
    yy += rowH;
  });
  return yy;
}

// ---------- pages ----------
function last(p) { return p && p.pnl && p.pnl.length >= 2 ? p.pnl[p.pnl.length - 1][1] : null; }

function page1(ctx, t, d) {
  const st = d.state || {};
  const av = +st.accountValue || 0, ntl = +st.totalNtlPos || 0;
  const upnl = (st.positions || []).reduce((s, p) => s + (+p.unrealizedPnl || 0), 0);
  const dayAv = d.periods.day && d.periods.day.av && d.periods.day.av.length ? d.periods.day.av[d.periods.day.av.length - 1][1] : null;
  const kpis = [
    [t.kpi[0], dayAv === null ? '—' : short(dayAv), '#fff'], [t.kpi[1], short(av), TEXT], [t.kpi[2], short(+st.withdrawable || 0), TEXT],
    [t.kpi[3], short(ntl), CYAN], [t.kpi[4], av > 0 ? `${(ntl / av).toFixed(2)}x` : '—', ntl / av >= 5 ? AMBER : TEXT], [t.kpi[5], signed(upnl), colorOf(upnl)],
  ];
  const kw = (W - 96 - 5 * 14) / 6;
  kpis.forEach(([k, v, c], i) => {
    const x = 48 + i * (kw + 14);
    panel(ctx, x, 146, kw, 92);
    txt(ctx, k, x + 16, 176, { font: `700 13px ${F}`, color: SLATE });
    txt(ctx, v, x + 16, 220, { font: `800 28px ${M}`, color: c, max: kw - 28 });
  });

  // periods table
  panel(ctx, 48, 256, 760, 300);
  caps(ctx, t.ptHead[0] === 'Dönem' ? 'DÖNEMLER' : 'PERIODS', 68, 288);
  const rows = ['day', 'week', 'month', 'allTime'].map(k => {
    const p = d.periods[k] || {};
    const pnl = last(p), a0 = p.av && p.av.length ? p.av[0][1] : null, a1 = p.av && p.av.length ? p.av[p.av.length - 1][1] : null;
    return { k, pnl, ret: pnl !== null && a0 > 0 ? (pnl / a0) * 100 : null, vlm: p.vlm || 0, a0, a1 };
  });
  table(ctx, 64, 326, [
    { h: t.ptHead[0], w: 150, get: r => ({ s: t.periods[r.k], font: `700 16px ${F}` }) },
    { h: t.ptHead[1], w: 150, align: 'right', get: r => ({ s: r.pnl === null ? '—' : signed(r.pnl), color: colorOf(r.pnl || 0), font: `800 17px ${M}` }) },
    { h: t.ptHead[2], w: 110, align: 'right', get: r => ({ s: r.ret === null ? '—' : `${r.ret >= 0 ? '+' : ''}${r.ret.toFixed(1)}%`, color: colorOf(r.ret || 0) }) },
    { h: t.ptHead[3], w: 120, align: 'right', get: r => ({ s: short(r.vlm), color: SLATE }) },
    { h: t.ptHead[4], w: 198, align: 'right', get: r => ({ s: r.a0 === null ? '—' : `${short(r.a0)} → ${short(r.a1)}`, color: SLATE }) },
  ], rows, { rowH: 48 });
  txt(ctx, t.ptNote, 68, 540, { font: `600 12px ${F}`, color: DIM, max: 720 });

  // 30-day curve
  panel(ctx, 828, 256, W - 48 - 828, 300);
  caps(ctx, t.curve30.toLocaleUpperCase(t.loc), 848, 288);
  const fm = tt => new Date(tt).toLocaleDateString(t.loc, { timeZone: TZ, day: '2-digit', month: 'short' });
  if (!chart(ctx, d.periods.month && d.periods.month.pnl, 920, 312, W - 48 - 920 - 28, 200, { fmtT: fm })) txt(ctx, t.noData, 848, 420, { color: DIM });

  // all-time curve with account value
  panel(ctx, 48, 576, W - 96, 370);
  caps(ctx, t.curveAll.toLocaleUpperCase(t.loc), 68, 608);
  const at = d.periods.allTime || {};
  const fa = tt => new Date(tt).toLocaleDateString(t.loc, { timeZone: TZ, day: '2-digit', month: 'short', year: '2-digit' });
  if (!chart(ctx, at.pnl, 140, 634, W - 96 - 92 - 90, 270, { extra: at.av, fmtT: fa })) txt(ctx, t.noData, 68, 760, { color: DIM });
}

function dailyBuckets(month) {
  if (!month || !month.pnl || month.pnl.length < 2) return [];
  const key = tt => new Date(tt).toLocaleDateString('en-CA', { timeZone: TZ });
  const lastOf = new Map();
  for (const [tt, v] of month.pnl) lastOf.set(key(tt), { tt, v });
  const out = [];
  let prev = month.pnl[0][1];
  for (const [k, { tt, v }] of lastOf) { out.push({ k, tt, d: v - prev }); prev = v; }
  return out;
}

function page2(ctx, t, d) {
  const all = d.coin[0] || {};
  const r = all.record || { wins: 0, losses: 0, sumWin: 0, sumLoss: 0 };
  const n = r.wins + r.losses;
  panel(ctx, 48, 146, 640, 800, 'rgba(245,158,11,0.25)');
  // ring
  const cx = 160, cy = 270, R = 84;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 18; ctx.stroke();
  if (n) {
    const wr = r.wins / n;
    const g = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R); g.addColorStop(0, '#22d3ee'); g.addColorStop(1, '#34d399');
    ctx.save(); ctx.shadowColor = 'rgba(52,211,153,0.6)'; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + wr * Math.PI * 2); ctx.strokeStyle = g; ctx.stroke(); ctx.restore();
    txt(ctx, `${(wr * 100).toFixed(1)}%`, cx, cy + 12, { font: `900 34px ${M}`, color: '#fff', align: 'center' });
  } else txt(ctx, '—', cx, cy + 12, { font: `900 34px ${M}`, color: DIM, align: 'center' });
  ctx.lineCap = 'butt'; ctx.lineWidth = 1;
  txt(ctx, t.win, 280, 250, { font: `800 26px ${F}`, color: '#fff' });
  txt(ctx, t.wl(r.wins, r.losses), 280, 284, { font: `600 16px ${M}`, color: SLATE });

  const realized = (all.rows || []).reduce((s, x) => s + x.realized, 0);
  const fees = (all.rows || []).reduce((s, x) => s + x.fees, 0);
  const funding = (all.rows || []).reduce((s, x) => s + (x.funding || 0), 0);
  const day = tt => new Date(tt).toLocaleDateString(t.loc, { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });
  const cov = all.truncated && all.coveredFrom ? t.from(day(all.coveredFrom)) : t.full;
  const pf = r.sumLoss ? r.sumWin / Math.abs(r.sumLoss) : null;
  const items = [
    [t.rec[0], r.wins ? signed(r.sumWin / r.wins) : '—', GREEN],
    [t.rec[1], r.losses ? signed(r.sumLoss / r.losses) : '—', RED],
    [t.rec[2], n ? signed((r.sumWin + r.sumLoss) / n) : '—', colorOf(r.sumWin + r.sumLoss)],
    [t.rec[3], r.best ? `${coinName(r.best.name || r.best.coin)}  ${signed(r.best.pnl)}` : '—', GREEN, r.best && day(r.best.time)],
    [t.rec[4], r.worst ? `${coinName(r.worst.name || r.worst.coin)}  ${signed(r.worst.pnl)}` : '—', RED, r.worst && day(r.worst.time)],
    [t.rec[5], signed(realized), colorOf(realized)],
    [t.rec[6], signed(-fees), RED],
    [t.rec[7], signed(funding), colorOf(funding)],
    [t.rec[8], String(all.fills || 0), TEXT],
    [t.rec[9], cov, SLATE],
  ];
  let y = 384;
  for (const [k, v, c, sub] of items) {
    rr(ctx, 64, y, 608, 50, 12); ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fill();
    txt(ctx, k, 82, y + 31, { font: `600 16px ${F}`, color: SLATE });
    const isCov = k === t.rec[9];
    txt(ctx, v, 654, y + (sub ? 24 : 31), { font: isCov ? `600 13px ${F}` : `800 18px ${M}`, color: c, align: 'right', max: isCov ? 380 : 330 });
    if (sub) txt(ctx, sub, 654, y + 42, { font: `500 12px ${M}`, color: DIM, align: 'right' });
    y += 55;
  }

  // daily bars
  const bx = 708, bw = W - 48 - bx;
  panel(ctx, bx, 146, bw, 800);
  // ratios: 2 rows × 4 tiles
  caps(ctx, t.ratios, bx + 22, 180, AMBER);
  const q = d.ratios || {};
  const num = (v, k = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(k));
  const payoff = r.wins && r.losses ? (r.sumWin / r.wins) / Math.abs(r.sumLoss / r.losses) : null;
  const tiles = [
    [t.rt[0], num(q.sharpe), q.sharpe > 0 ? GREEN : q.sharpe < 0 ? RED : DIM],
    [t.rt[1], num(q.sortino), q.sortino > 0 ? GREEN : q.sortino < 0 ? RED : DIM],
    [t.rt[2], q.maxDdUsd === undefined ? '—' : signed(q.maxDdUsd), RED],
    [t.rt[3], q.maxDdPct === null || q.maxDdPct === undefined ? '—' : `${q.maxDdPct.toFixed(1)}%`, RED],
    [t.rt[4], num(q.recovery), q.recovery >= 1 ? GREEN : AMBER],
    [t.rt[5], pf === null ? '—' : pf.toFixed(2), pf === null ? DIM : pf >= 1 ? GREEN : RED],
    [t.rt[6], payoff === null ? '—' : payoff.toFixed(2), payoff >= 1 ? GREEN : AMBER],
    [t.rt[7], q.dailyVolPct === undefined ? '—' : `${q.dailyVolPct.toFixed(1)}%`, TEXT],
  ];
  const tw2 = (bw - 44 - 3 * 12) / 4;
  tiles.forEach(([k, v, c], i) => {
    const x = bx + 22 + (i % 4) * (tw2 + 12), y = 196 + Math.floor(i / 4) * 80;
    rr(ctx, x, y, tw2, 68, 12); ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.stroke();
    txt(ctx, k, x + 12, y + 23, { font: `700 12px ${F}`, color: SLATE, max: tw2 - 20 });
    txt(ctx, v, x + 12, y + 54, { font: `800 22px ${M}`, color: c, max: tw2 - 20 });
  });
  if (q.maxDdFrom) {
    const dd = tt => new Date(tt).toLocaleDateString(t.loc, { timeZone: TZ, day: '2-digit', month: 'short' });
    txt(ctx, `${t.rt[2]}: ${dd(q.maxDdFrom)} → ${dd(q.maxDdTo)}`, bx + 22, 372, { font: `600 12px ${F}`, color: DIM });
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.moveTo(bx + 22, 388); ctx.lineTo(bx + bw - 22, 388); ctx.stroke();
  caps(ctx, t.daily.toLocaleUpperCase(t.loc), bx + 22, 418);
  const days = dailyBuckets(d.periods.month).slice(-30);
  if (!days.length) { txt(ctx, t.noData, bx + 22, 470, { color: DIM }); return; }
  const pos = days.filter(x => x.d > 0).length;
  const best = days.reduce((a, b) => (b.d > a.d ? b : a)), worst = days.reduce((a, b) => (b.d < a.d ? b : a));
  txt(ctx, t.dayStats(pos, days.length, signed(best.d), signed(worst.d)), bx + 22, 446, { font: `600 14px ${F}`, color: SLATE });
  const top = 510, bottom = 790, gx = bx + 90, gw = bw - 120;
  const maxAbs = Math.max(1, ...days.map(x => Math.abs(x.d)));
  const lo = Math.min(0, ...days.map(x => x.d)), hi = Math.max(0, ...days.map(x => x.d));
  const span = (hi - lo) || 1;
  const Y = v => top + (hi - v) / span * (bottom - top);
  ctx.font = `500 12px ${M}`;
  for (let i = 0; i <= 4; i++) {
    const v = lo + span * (i / 4), yy = Y(v);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.beginPath(); ctx.moveTo(gx, yy); ctx.lineTo(gx + gw, yy); ctx.stroke();
    ctx.fillStyle = DIM; ctx.textAlign = 'right'; ctx.fillText(short(v), gx - 8, yy + 4); ctx.textAlign = 'left';
  }
  ctx.strokeStyle = 'rgba(148,163,184,0.4)'; ctx.beginPath(); ctx.moveTo(gx, Y(0)); ctx.lineTo(gx + gw, Y(0)); ctx.stroke();
  const slot = gw / days.length, barW = Math.max(4, slot * 0.68);
  days.forEach((x, i) => {
    const xx = gx + i * slot + (slot - barW) / 2;
    const y0 = Y(0), y1 = Y(x.d);
    const g = ctx.createLinearGradient(0, Math.min(y0, y1), 0, Math.max(y0, y1));
    g.addColorStop(0, x.d >= 0 ? '#6ee7b7' : '#e11d48'); g.addColorStop(1, x.d >= 0 ? '#059669' : '#fda4af');
    ctx.fillStyle = g;
    rr(ctx, xx, Math.min(y0, y1), barW, Math.max(2, Math.abs(y1 - y0)), Math.min(4, barW / 2)); ctx.fill();
    if (Math.abs(x.d) >= maxAbs * 0.5 || x === best || x === worst) {
      // negative labels hang below the bar; when that would hit the dates, write it inside the bar instead
      const inside = x.d < 0 && y1 + 80 > bottom + 10;
      ctx.save(); ctx.translate(xx + barW / 2, x.d >= 0 ? y1 - 8 : inside ? y1 - 8 : y1 + 8); ctx.rotate(-Math.PI / 2);
      ctx.font = `700 11px ${M}`; ctx.fillStyle = inside ? '#fff' : TEXT; ctx.textAlign = x.d >= 0 || inside ? 'left' : 'right';
      ctx.fillText(signed(x.d), 0, 4); ctx.restore();
    }
    if (i % 3 === 0 || i === days.length - 1) {
      txt(ctx, new Date(x.tt).toLocaleDateString(t.loc, { timeZone: TZ, day: '2-digit', month: '2-digit' }), xx + barW / 2, 812,
          { font: `500 11px ${M}`, color: DIM, align: 'center' });
    }
  });
  wrap(ctx, t.rtNote, bx + 22, 860, bw - 44, 17, { font: `600 12px ${F}`, color: DIM });
}

function page3(ctx, t, d) {
  const pos = (d.state && d.state.positions || []).slice().sort((a, b) => b.positionValue - a.positionValue);
  if (!pos.length) { txt(ctx, t.none, W / 2, H / 2, { font: `800 30px ${F}`, color: DIM, align: 'center' }); return; }
  const lv = pos.filter(p => p.side === 'LONG').reduce((s, p) => s + p.positionValue, 0);
  const sv = pos.filter(p => p.side !== 'LONG').reduce((s, p) => s + p.positionValue, 0);
  const u = pos.reduce((s, p) => s + p.unrealizedPnl, 0);
  txt(ctx, t.posSum(short(lv), short(sv), signed(u)), 48, 172, { font: `700 18px ${F}`, color: TEXT });
  const tot = lv + sv || 1;
  rr(ctx, 48, 190, W - 96, 12, 6); ctx.fillStyle = 'rgba(244,63,94,0.75)'; ctx.fill();
  if (lv > 0) { ctx.save(); rr(ctx, 48, 190, W - 96, 12, 6); ctx.clip(); ctx.fillStyle = GREEN; ctx.fillRect(48, 190, (W - 96) * lv / tot, 12); ctx.restore(); }
  const maxRows = 13;
  const end = table(ctx, 48, 240, [
    { h: t.posHead[0], w: 120, get: p => ({ s: coinName(p.coin), font: `800 17px ${F}`, color: '#fff' }) },
    { h: t.posHead[1], w: 80, get: p => ({ s: p.side, font: `800 14px ${F}`, color: p.side === 'LONG' ? GREEN : RED }) },
    { h: t.posHead[2], w: 70, align: 'right', get: p => ({ s: `${p.leverageValue}x` }) },
    { h: t.posHead[3], w: 140, align: 'right', get: p => ({ s: qty(p.size), color: SLATE }) },
    { h: t.posHead[4], w: 120, align: 'right', get: p => ({ s: short(p.positionValue), font: `700 16px ${M}` }) },
    { h: t.posHead[5], w: 120, align: 'right', get: p => ({ s: px(p.entryPrice), color: SLATE }) },
    { h: t.posHead[6], w: 120, align: 'right', get: p => ({ s: px(p.currentPrice) }) },
    { h: t.posHead[7], w: 120, align: 'right', get: p => ({ s: p.liquidationPrice ? px(p.liquidationPrice) : '—', color: AMBER }) },
    { h: t.posHead[8], w: 96, align: 'right', get: p => ({ s: p.liqDistancePct === null || p.liqDistancePct === undefined ? '—' : `${p.liqDistancePct.toFixed(1)}%`,
                                                         color: p.liqDistancePct === null ? DIM : p.liqDistancePct < 15 ? RED : p.liqDistancePct < 30 ? AMBER : GREEN }) },
    { h: t.posHead[9], w: 120, align: 'right', get: p => ({ s: signed(p.unrealizedPnl), color: colorOf(p.unrealizedPnl), font: `800 16px ${M}` }) },
    { h: t.posHead[10], w: 92, align: 'right', get: p => ({ s: `${p.roePct >= 0 ? '+' : ''}${p.roePct.toFixed(1)}%`, color: colorOf(p.roePct) }) },
    { h: t.posHead[11], w: 110, align: 'right', get: p => ({ s: short(p.marginUsed || 0), color: SLATE }) },
    { h: t.posHead[12], w: 196, align: 'right', get: p => {
      const f = p.cumFunding && p.cumFunding.sinceOpen !== undefined ? -parseFloat(p.cumFunding.sinceOpen) : null;
      return { s: f === null || !Number.isFinite(f) ? '—' : signed(f), color: colorOf(f || 0) };
    } },
  ], pos, { rowH: 50, maxRows });
  if (pos.length > maxRows) txt(ctx, `+${pos.length - maxRows}`, 56, end + 26, { font: `700 14px ${F}`, color: DIM });
  txt(ctx, t.posNote, 48, H - 64, { font: `600 12px ${F}`, color: DIM });
  const py = end + 36;
  const nShow = Math.min(pos.length, 10);
  const ph = Math.min(H - 90 - py, Math.max(nShow * 38 + 76, 6 * 40 + 70));
  if (ph < 200) return;
  // position shares (left) + margin (right)
  const lw = 900;
  panel(ctx, 48, py, lw, ph);
  caps(ctx, t.share, 68, py + 32);
  const n = Math.min(pos.length, Math.floor((ph - 60) / 38));
  pos.slice(0, n).forEach((p, i) => {
    const y = py + 56 + i * 38, share = p.positionValue / tot;
    txt(ctx, coinName(p.coin), 68, y + 18, { font: `800 15px ${F}`, color: '#fff', max: 110 });
    rr(ctx, 190, y + 4, 520, 18, 9); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
    const g = ctx.createLinearGradient(190, 0, 190 + 520 * share, 0);
    g.addColorStop(0, p.side === 'LONG' ? '#059669' : '#e11d48'); g.addColorStop(1, p.side === 'LONG' ? '#6ee7b7' : '#fda4af');
    rr(ctx, 190, y + 4, Math.max(18, 520 * share), 18, 9); ctx.fillStyle = g; ctx.fill();
    txt(ctx, `${(share * 100).toFixed(1)}%`, 724, y + 18, { font: `700 14px ${M}` });
    txt(ctx, short(p.positionValue), lw + 48 - 20, y + 18, { font: `700 14px ${M}`, color: SLATE, align: 'right' });
  });
  const st = d.state || {};
  const av = +st.accountValue || 0, used = +st.totalMarginUsed || 0, ntl = +st.totalNtlPos || 0;
  const mx = 48 + lw + 20, mw = W - 48 - mx;
  panel(ctx, mx, py, mw, ph);
  caps(ctx, t.margin, mx + 20, py + 32);
  const mrows = [[t.mk[0], short(av)], [t.mk[1], short(used)], [t.mk[2], short(av - used)], [t.mk[3], short(+st.withdrawable || 0)],
                 [t.mk[4], av > 0 ? `${(ntl / av).toFixed(2)}x` : '—'], [t.mk[5], av > 0 ? `${((used / av) * 100).toFixed(1)}%` : '—']];
  mrows.slice(0, Math.floor((ph - 50) / 40)).forEach(([k, v], i) => {
    const y = py + 52 + i * 40;
    txt(ctx, k, mx + 20, y + 22, { font: `600 15px ${F}`, color: SLATE });
    txt(ctx, v, mx + mw - 20, y + 22, { font: `800 17px ${M}`, align: 'right' });
  });
}

function page4(ctx, t, d) {
  const [all, m30, w7] = d.coin;
  const by = new Map();
  for (const r of (all && all.rows) || []) by.set(r.coin, { ...r, n30: 0, n7: 0 });
  for (const [src, key] of [[m30, 'n30'], [w7, 'n7']]) {
    for (const r of (src && src.rows) || []) {
      const x = by.get(r.coin) || { coin: r.coin, name: r.name, realized: 0, fees: 0, funding: 0, net: 0, volume: 0, trades: 0, unrealized: r.unrealized || 0, n30: 0, n7: 0 };
      x[key] = r.net; by.set(r.coin, x);
    }
  }
  const rows = [...by.values()].filter(r => r.trades || r.unrealized || r.n30 || r.n7).sort((a, b) => b.net - a.net);
  const maxRows = 17;
  let shown = rows;
  if (rows.length > maxRows) {
    const keep = rows.slice(0, maxRows - 1), rest = rows.slice(maxRows - 1);
    const o = rest.reduce((a, r) => ({ n7: a.n7 + r.n7, n30: a.n30 + r.n30, net: a.net + r.net, realized: a.realized + r.realized, fees: a.fees + r.fees,
                                       funding: a.funding + (r.funding || 0), volume: a.volume + r.volume, trades: a.trades + r.trades, unrealized: a.unrealized + (r.unrealized || 0) }),
                           { n7: 0, n30: 0, net: 0, realized: 0, fees: 0, funding: 0, volume: 0, trades: 0, unrealized: 0 });
    shown = [...keep, { ...o, name: t.others(rest.length), other: true }];
  }
  const tot = rows.reduce((a, r) => ({ n7: a.n7 + r.n7, n30: a.n30 + r.n30, net: a.net + r.net, realized: a.realized + r.realized, fees: a.fees + r.fees,
                                       funding: a.funding + (r.funding || 0), volume: a.volume + r.volume, trades: a.trades + r.trades, unrealized: a.unrealized + (r.unrealized || 0) }),
                         { n7: 0, n30: 0, net: 0, realized: 0, fees: 0, funding: 0, volume: 0, trades: 0, unrealized: 0 });
  shown.push({ ...tot, name: t.total, total: true });
  const money = v => ({ s: v ? signed(v) : '—', color: colorOf(v) });
  table(ctx, 48, 166, [
    { h: t.coinHead[0], w: 290, get: r => ({ s: r.coin ? coinName(r.name || r.coin) : r.name, font: `800 16px ${F}`, color: r.other ? SLATE : '#fff' }) },
    { h: t.coinHead[1], w: 140, align: 'right', get: r => money(r.n7) },
    { h: t.coinHead[2], w: 140, align: 'right', get: r => money(r.n30) },
    { h: t.coinHead[3], w: 160, align: 'right', get: r => ({ ...money(r.net), font: `800 16px ${M}` }) },
    { h: t.coinHead[4], w: 150, align: 'right', get: r => money(r.realized) },
    { h: t.coinHead[5], w: 120, align: 'right', get: r => ({ s: signed(-r.fees), color: SLATE }) },
    { h: t.coinHead[6], w: 130, align: 'right', get: r => money(r.funding || 0) },
    { h: t.coinHead[7], w: 140, align: 'right', get: r => ({ s: short(r.volume), color: SLATE }) },
    { h: t.coinHead[8], w: 100, align: 'right', get: r => ({ s: String(r.trades), color: SLATE }) },
    { h: t.coinHead[9], w: 134, align: 'right', get: r => money(r.unrealized || 0) },
  ], shown, { rowH: 40, bold: r => r.total });
  txt(ctx, t.coinNote, 48, H - 64, { font: `600 12px ${F}`, color: DIM });
}

function page5(ctx, t, d) {
  const all = d.coin[0] || {};
  // one row per order: consecutive fills of the same coin and action within 2 min are merged
  const groups = [];
  for (const c of all.closes || []) {
    const g = groups[groups.length - 1];
    if (g && g.coin === c.coin && g.dir === c.dir && g.tFirst - c.time <= 120_000) {
      g.ntl += c.px * c.sz; g.sz += c.sz; g.pnl += c.pnl; g.fee += c.fee; g.n++; g.tFirst = c.time;
    } else {
      if (groups.length >= 18) break;
      groups.push({ coin: c.coin, name: c.name, dir: c.dir, time: c.time, tFirst: c.time, ntl: c.px * c.sz, sz: c.sz, pnl: c.pnl, fee: c.fee, n: 1 });
    }
  }
  for (const g of groups) g.px = g.sz ? g.ntl / g.sz : 0;
  const closes = groups;
  if (!closes.length) { txt(ctx, t.noClose, W / 2, H / 2, { font: `800 30px ${F}`, color: DIM, align: 'center' }); return; }
  table(ctx, 48, 166, [
    { h: t.closeHead[0], w: 210, get: c => ({ s: new Date(c.time).toLocaleString(t.loc, { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }), color: SLATE }) },
    { h: t.closeHead[1], w: 170, get: c => ({ s: coinName(c.name || c.coin), font: `800 16px ${F}`, color: '#fff' }) },
    { h: t.closeHead[2], w: 200, get: c => ({ s: t.dir[c.dir] || c.dir || '—', font: `700 15px ${F}`, color: /Long/.test(c.dir) ? GREEN : /Short/.test(c.dir) ? RED : TEXT }) },
    { h: t.closeHead[3], w: 170, align: 'right', get: c => ({ s: px(c.px) }) },
    { h: t.closeHead[4], w: 170, align: 'right', get: c => ({ s: qty(c.sz), color: SLATE }) },
    { h: t.closeHead[5], w: 160, align: 'right', get: c => ({ s: short(c.ntl), color: SLATE }) },
    { h: t.fills, w: 100, align: 'right', get: c => ({ s: String(c.n), color: DIM }) },
    { h: t.closeHead[6], w: 150, align: 'right', get: c => ({ s: signed(c.pnl), color: colorOf(c.pnl), font: `800 17px ${M}` }) },
    { h: t.closeHead[7], w: 144, align: 'right', get: c => ({ s: signed(-c.fee), color: SLATE }) },
  ], closes, { rowH: 41 });
  txt(ctx, t.closeNote(closes.length), 48, H - 64, { font: `600 12px ${F}`, color: DIM });
}

// ---------- data + render ----------
async function collect(address) {
  const [pf, all, m30, w7, state] = await Promise.all([
    pnldata.getPortfolio(address),
    pnldata.getCoinPnl(address, 0),
    pnldata.getCoinPnl(address, 30),
    pnldata.getCoinPnl(address, 7),
    tracker.getCachedState(address) ? Promise.resolve(tracker.getCachedState(address)) : hyperliquid.getClearinghouseState(address),
  ]);
  for (const c of all.closes || []) if (!c.name) c.name = String(c.coin).startsWith('@') ? await telegram.spotName(c.coin) : c.coin;
  return { periods: pf.periods || {}, ratios: pf.ratios || {}, coin: [all, m30, w7], state };
}

// returns [Buffer png, …]
async function render(wallet, { lang = 'tr', name, showLogo = true } = {}) {
  fonts();
  const t = TXT[lang === 'en' ? 'en' : 'tr'];
  const address = wallet.address.toLowerCase();
  const data = await collect(address);
  const d = {
    ...data, address, showLogo,
    name: name || wallet.label || address,
    when: new Date().toLocaleString(t.loc, { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  };
  const out = [];
  [page1, page2, page3, page4, page5].forEach((fn, i) => {
    const c = createCanvas(W, H);
    const ctx = c.getContext('2d');
    frame(ctx, t, d, i + 1);
    fn(ctx, t, d);
    out.push(c.toBuffer('image/png'));
  });
  return { pages: out, data: d };
}

module.exports = { render, TXT };
