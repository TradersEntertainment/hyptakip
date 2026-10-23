// 🌐 TR / EN switch for the whole page. The page is written in Turkish; when English is picked, every text node and
// placeholder/title attribute is translated in place (exact phrases first, then patterns for text with numbers in it),
// and a MutationObserver translates whatever the app renders later. Switching back restores the original text.
(function () {
  const KEY = 'hyp_lang';
  const DICT = {
    // header / ticker
    'CANLI TAKİP': 'LIVE TRACKING', 'CANLI': 'LIVE', 'Hyperliquid Balina & Pozisyon Radar': 'Hyperliquid Whale & Position Radar',
    'HYPERLIQUID PIYASA:': 'HYPERLIQUID MARKET:', 'İzlenen:': 'Tracking:', 'Balina': 'Whales', 'Toplam Hacim:': 'Total Volume:',
    'Yenile': 'Refresh', 'Ayarlar': 'Settings', 'Yeni Balina Ekle': 'Add Whale', 'Sesli Bildirimleri Aç/Kapat': 'Sound alerts on/off',
    'Dil: English / Türkçe': 'Language: English / Türkçe',
    // sidebar / whale header
    'Takip Edilen Balinalar': 'Tracked Whales', 'Balina adı veya adres ara...': 'Search whale name or address...',
    'Cüzdanlar yükleniyor...': 'Loading wallets...', 'AKTİF': 'ACTIVE', 'Adres:': 'Address:',
    'Adresi Kopyala': 'Copy Address', 'PnL Kartı': 'PnL Card', 'Balina Kartı': 'Whale Card', 'Düzenle': 'Edit', 'Sil': 'Delete',
    'Uyarı Eşiği:': 'Alert Threshold:', 'Detayları Gör →': 'View Details →',
    // metrics
    'Toplam Portföy (Kasa)': 'Total Portfolio (Equity)', 'Toplam Açık Pozisyon': 'Total Open Positions', 'Kullanılan Teminat': 'Margin Used',
    'Serbest Nakit': 'Free Cash', 'Çekilebilir Bakiye': 'Withdrawable', 'Toplam Poz': 'Total Pos.', 'Kâr / Zarar (PnL)': 'Profit / Loss (PnL)',
    'Likidasyon Tehlike Radarı': 'Liquidation Danger Radar', 'Likidasyon analizi yapılıyor...': 'Analysing liquidation risk...',
    'En Yakın Mesafe': 'Closest Distance', 'TÜM POZİSYONLAR GÜVENLİ': 'ALL POSITIONS SAFE', 'RİSK: NORMAL': 'RISK: NORMAL',
    'RİSK: BOŞTA': 'RISK: IDLE', 'GÜVENLİ': 'SAFE', 'DİKKAT': 'CAUTION', 'KRİTİK RİSK': 'CRITICAL RISK', 'LİKİDASYON RİSKİ': 'LIQUIDATION RISK',
    'Pozisyon Büyüklüğü Dağılımı': 'Position Size Breakdown', 'Kâr/Zarar (PnL) Dağılımı': 'Profit/Loss (PnL) Breakdown',
    // tabs / tables
    'Aktif Pozisyonlar': 'Active Positions', 'Son İşlemler (Fills)': 'Recent Trades (Fills)', 'Bildirim Geçmişi': 'Alert History',
    'Parite': 'Pair', 'Yön': 'Side', 'Pozisyon Büyüklüğü': 'Position Size', 'Fiyat Seviyesi (Giriş ➔ Mark ➔ Liq)': 'Price Levels (Entry ➔ Mark ➔ Liq)',
    'Kaldıraç & Teminat': 'Leverage & Margin', 'Getiri Oranı (ROE)': 'Return on Equity (ROE)', 'Hızlı İşlem': 'Quick Trade',
    'Pozisyon verisi yükleniyor...': 'Loading positions...', 'Zaman': 'Time', 'Fiyat': 'Price', 'Miktar': 'Size', 'İşlem Ücreti': 'Fee',
    'İşlem geçmişi yükleniyor...': 'Loading trade history...', 'İşlemler yükleniyor...': 'Loading trades...',
    'Tetiklenen Canlı Bildirimler': 'Triggered Live Alerts', 'Geçmişi Temizle': 'Clear History', 'Henüz bildirim kaydı yok.': 'No alerts yet.', 'Henüz tetiklenen bildirim kaydı yok.': 'No alerts triggered yet.',
    'Hyperliquid\'de İşlem Aç': 'Trade on Hyperliquid', 'Hypurrscan\'de İncele': 'View on Hypurrscan',
    'Giriş Fiyatı': 'Entry Price', 'Mark Fiyatı': 'Mark Price', 'Henüz işlem yok.': 'No trades yet.', 'Açık pozisyon yok.': 'No open positions.',
    'Bu cüzdanın açık pozisyonu yok.': 'This wallet has no open positions.',
    // PnL history panel
    'Kâr/Zarar Geçmişi': 'PnL History', '24 Saat': '24 Hours', '7 Gün': '7 Days', '30 Gün': '30 Days', 'Tümü': 'All',
    'Bu dönem için veri yok.': 'No data for this period.', 'Kaynak: Hyperliquid portföy geçmişi (perp + spot, dönem başından birikimli kâr/zarar). Kesikli çizgi: hesap değeri.':
      'Source: Hyperliquid portfolio history (perp + spot, cumulative PnL since the start of the period). Dashed line: account value.',
    'Coin bazında kâr/zarar': 'PnL per coin', 'Coin': 'Coin', 'Gerçekleşen': 'Realized', 'Ücret': 'Fees', 'Funding': 'Funding',
    'Net (dönem)': 'Net (period)', 'Açık poz. (şu an)': 'Open pos. (now)', 'Hacim': 'Volume', 'İşlem': 'Trades', 'TOPLAM': 'TOTAL',
    'Kapanan işlemlerin kâr/zararı (HL closedPnl)': 'PnL of closed trades (HL closedPnl)',
    'Dönemde ödenen (−) / alınan (+) funding': 'Funding paid (−) / received (+) in the period',
    'Gerçekleşen − ücret + funding (yalnız bu dönem)': 'Realized − fees + funding (this period only)',
    'Şu an açık pozisyonun, açıldığından beri anlık kâr/zararı — döneme ait değil, toplama eklenmez':
      'Unrealized PnL of the open position since it was opened — not part of the period, not added to the total',
    'Bu dönemde işlem yok.': 'No trades in this period.', 'Yükleniyor…': 'Loading…', 'Yükleniyor...': 'Loading...',
    'Kâr/Zarar': 'PnL', 'Hesap değeri': 'Account value', 'Kâr / Zarar ($)': 'Profit / Loss ($)',
    '(veri eksik: fark bunu da içerir)': '(data incomplete: the difference includes this too)',
    // add / edit modals
    'Yeni Balina / Cüzdan Ekle': 'Add Whale / Wallet', 'Balinayı Düzenle': 'Edit Whale', 'Hyperliquid Cüzdan Adresi': 'Hyperliquid Wallet Address',
    'Balina Adı / Lakabı': 'Whale Name / Nickname', 'Pozisyon Değişim Eşiği (%)': 'Position Change Threshold (%)',
    'Telegram Chat ID (İsteğe Bağlı)': 'Telegram Chat ID (optional)', 'Boş = genel Chat ID': 'Empty = default Chat ID',
    'Boş bırakılırsa Railway\'deki genel Chat ID kullanılır.': 'If empty, the default Chat ID from Railway is used.',
    'Pozisyon boyutu en az bu oranda değiştiğinde bildirim gönderilir.': 'An alert is sent when the position size changes by at least this much.',
    'Pozisyon boyutu en az bu oranda değişince bildirim gelir. 0.01 = her değişim; boyut değişmezse bildirim gelmez.':
      'An alert comes when the position size changes by at least this much. 0.01 = every change; no alert if the size does not change.',
    'Örn: 10 · her işlem için 0.01': 'e.g. 10 · 0.01 for every trade', 'Her işlem (%0.01)': 'Every trade (0.01%)',
    'Örn: 0x4fbc41fac6d1cacf1': 'e.g. 0x4fbc41fac6d1cacf1', 'Örn: 150dollarsto10k': 'e.g. 150dollarsto10k', 'Örn: -5173499699': 'e.g. -5173499699',
    '📝 Emirleri de bildir': '📝 Alert on orders too', '🪙 Spot işlemleri bildir': '🪙 Alert on spot trades', '💸 Dışarı transferleri bildir': '💸 Alert on outgoing transfers',
    'Bu cüzdan yeni limit emir koyunca, dolmadan önce bildirim gelir (chase limitlerde aynı coin ve yönde ilki; sonrakiler 10 dk susturulur). En çok 10 cüzdan.':
      'When this wallet places a new limit order you get an alert before it fills (for chase limits only the first one per coin and side; the rest are muted for 10 min). At most 10 wallets.',
    'Spot alım/satım (ör. HYPE/USDC): dolumlar 15 sn toplanıp tek bildirim; aynı çift ve yönde 10 dk tekrar yok. $1.000 altı yok.':
      'Spot buys/sells (e.g. HYPE/USDC): fills are grouped for 15 s into one alert; no repeat for the same pair and side for 10 min. Nothing under $1,000.',
    'Çekim (Arbitrum\'a), başka adrese / alt hesaba gönderim, vault\'a yatırma. Kendi içinde perp↔spot aktarım bildirilmez.':
      'Withdrawals (to Arbitrum), sends to another address / sub-account, vault deposits. Internal perp↔spot moves are not alerted.',
    '⚠️ Bu cüzdan canlı akışa giremiyor: Hyperliquid aynı anda en çok 10 cüzdanı canlı izletiyor. Emir / spot / transfer bildirimi gelmez; başka bir cüzdanda bu kutucukları kapatınca açılır.':
      '⚠️ This wallet cannot join the live stream: Hyperliquid allows at most 10 wallets live at once. No order / spot / transfer alerts; untick these boxes on another wallet to free a slot.',
    'Eylediğiniz cüzdanın Hyperliquid üzerindeki yeni pozisyonları ve %10+ boyut değişimleri tespit edildiğinde bağlı Telegram grubuna anında bildirim gönderilecektir.':
      'When new positions or 10%+ size changes of this wallet are detected on Hyperliquid, an alert is sent to the linked Telegram group right away.',
    'Takibe Başla': 'Start Tracking', 'Vazgeç': 'Cancel', 'Kaydet': 'Save', 'Kapat': 'Close', 'Bilgi:': 'Info:',
    // settings modal
    'Telegram & Sistem Ayarları': 'Telegram & System Settings', 'Railway ortam değişkenleri ve bot durumu': 'Railway environment variables and bot status',
    'Telegram Bot Token': 'Telegram Bot Token', 'Bot token web sitesinden değil, Railway dashboard\'undaki': 'The bot token is not set on this website but in the Railway dashboard\'s',
    'sekmesine': 'tab as', 'olarak eklenir.': '.', 'Varsayılan Telegram Chat ID': 'Default Telegram Chat ID',
    'Ana balina ve diğer cüzdanlar için varsayılan bildirim grubu.': 'Default alert group for the main whale and other wallets.',
    'Tarama Aralığı (Saniye)': 'Scan Interval (Seconds)', '3 Saniyede bir (Ultra Hızlı)': 'Every 3 seconds (Ultra Fast)',
    '5 Saniyede bir (Önerilen)': 'Every 5 seconds (Recommended)', '10 Saniyede bir': 'Every 10 seconds', '30 Saniyede bir': 'Every 30 seconds',
    'Railway Telegram Bağlantısını Test Et': 'Test Railway Telegram Connection', 'Tercihleri Kaydet': 'Save Preferences',
    'Telegram Botu Bekleniyor:': 'Waiting for Telegram bot:', 'Bildirimlerin iletilmesi için Railway\'de': 'To deliver alerts, add the',
    've': 'and', 'değişkenlerini ekleyin.': 'variables in Railway.', 'Değişken:': 'Variable:', 'Railway\'de Bekleniyor': 'Waiting on Railway',
    '⚡ Railway Variables:': '⚡ Railway Variables:', '7/24 Gerçek Zamanlı Takip': '24/7 Real-Time Tracking',
    'Eklediğiniz cüzdanların Hyperliquid L1 üzerindeki yeni pozisyonları ve': 'New positions and', 'anında tespit edilip Telegram\'a iletilir.':
      'of the wallets you add on Hyperliquid L1 are detected instantly and sent to Telegram.', '%10+ boyut değişimleri': '10%+ size changes',
    'Hypurrscan Doğrulamalı': 'Verified on Hypurrscan',
    // PnL card (old text card)
    'Metni Kopyala': 'Copy Text', 'PnL Kartı Oluştur ve Paylaş': 'Create and share a PnL card', 'Net Bakiye': 'Net Balance', 'PORTFÖY': 'PORTFOLIO',
    'GENEL KASA': 'TOTAL EQUITY',
    // whale card modal
    'Görseli İndir': 'Download Image', 'Görseli Kopyala': 'Copy Image', 'Paylaş': 'Share', 'Adresi göster': 'Show address', 'Kart ve site dili': 'Card and site language', 'Karttaki isim': 'Name on card',
    'Paylaşmak için hazır görsel (1200×675). Dönemi seç, indir ya da kopyala.': 'Ready-to-share image (1200×675). Pick a period, then download or copy.',
    '24S': '24H', 'Karne Kartı': 'Track Record', '📸 Anlık Kart': '📸 Snapshot Card', '🏆 Karne Kartı': '🏆 Track Record Card', '7G': '7D', '30G': '30D',
    // alert type labels / toasts / confirms
    'YENİ POZİSYON': 'NEW POSITION', 'BOYUT DEĞİŞİMİ': 'SIZE CHANGE', 'POZİSYON KAPANDI': 'POSITION CLOSED', 'YÖN DEĞİŞTİ': 'SIDE FLIPPED',
    'YENİ EMİR': 'NEW ORDER', 'SPOT İŞLEM': 'SPOT TRADE', 'DIŞARI TRANSFER': 'OUTGOING TRANSFER', 'LİKİDASYON YAKIN': 'NEAR LIQUIDATION',
    'Cüzdan adresi panoya kopyalandı!': 'Wallet address copied!', 'Cüzdan takipten çıkarıldı': 'Wallet removed', 'Cüzdan bulunamadı': 'Wallet not found',
    'Veriler güncellendi!': 'Data refreshed!', 'Ses kapatıldı 🔇': 'Sound off 🔇', 'Sesli bildirimler açıldı 🔊': 'Sound alerts on 🔊',
    'Telegram / Twitter metni panoya kopyalandı! 📋': 'Telegram / Twitter text copied! 📋', 'Telegram testi başarılı!': 'Telegram test succeeded!',
    'Railway değişkenleriyle Telegram bildirimi gönderiliyor...': 'Sending a Telegram alert with the Railway variables...',
    'Gönderilemedi': 'Could not send', 'Tüm bildirim geçmişini temizlemek istiyor musunuz?': 'Clear the whole alert history?',
    'Aramaya uygun balina bulunamadı.': 'No whale matches the search.', 'Takip edilen cüzdan yok.': 'No wallets tracked.',
    'Emir bildirimi açık': 'Order alerts on', 'KAPATILDI': 'CLOSED',
    'Aktif pozisyonlarda yakın likidasyon riski bulunmuyor.': 'No open position is close to liquidation.',
    'Güvenli Bölge (>%50 mesafe)': 'Safe Zone (>50% away)', '▲ KÂRDA': '▲ IN PROFIT', '▼ ZARARDA': '▼ IN LOSS',
    'Bu cüzdanda şu an açık pozisyon bulunmuyor.': 'This wallet has no open positions right now.',
    'Son işlem geçmişi bulunamadı.': 'No recent trades found.', 'Liq: Yok': 'Liq: none',
    'Aktif (••••••••)': 'Active (••••••••)', 'TELEGRAM_BOT_TOKEN (Eksik)': 'TELEGRAM_BOT_TOKEN (Missing)',
    'Ayarlar kaydedildi!': 'Settings saved!', 'Bildirim geçmişi temizlendi': 'Alert history cleared', 'az önce': 'just now', 'Az önce': 'Just now',
  };

  // Text with numbers / names inside: [regex on the trimmed text, replacement]
  const PATTERNS = [
    [/^(\d+) Pozisyon$/, '$1 Positions'],
    [/^%([\d.,]+)$/, '$1%'],
    [/^%([\d.,]+) Kullanım$/, '$1% Used'],
    [/^%([\d.,]+) (LONG|SHORT) AĞIRLIKLI$/, '$1% $2-HEAVY'],
    [/^(🟢 )?Long: %([\d.,]+)(.*)$/, '$1Long: $2%$3'], [/^Short: %([\d.,]+)(.*)$/, 'Short: $1%$2'],
    [/^%([\d.,]+) Mesafe$/, '$1% away'],
    [/^EŞİK: %([\d.,]+)$/, 'THRESHOLD: $1%'],
    [/^RİSK: DÜŞÜK \((.+)\)$/, 'RISK: LOW ($1)'], [/^RİSK: NORMAL \((.+)\)$/, 'RISK: NORMAL ($1)'],
    [/^RİSK: YÜKSEK \((.+)\)$/, 'RISK: HIGH ($1)'], [/^🔥 DEGEN RİSK \((.+)\)$/, '🔥 DEGEN RISK ($1)'],
    [/^TÜM POZİSYONLAR GÜVENLİ \(%([\d.,]+)\)$/, 'ALL POSITIONS SAFE ($1%)'],
    [/^⚠️ DİKKAT: %([\d.,]+) \((.+)\)$/, '⚠️ CAUTION: $1% ($2)'], [/^🚨 KRİTİK TEHLİKE: %([\d.,]+) \((.+)\)$/, '🚨 CRITICAL: $1% ($2)'],
    [/^Balina \((.+)\) takibe alındı!$/, 'Whale ($1) is now tracked!'],
    [/^Cüzdan ayarları güncellendi! Eşik: %(.+)$/, 'Wallet settings updated! Threshold: $1%'],
    [/^"(.+)" cüzdanını takipten çıkarmak istediğinize emin misiniz\?$/, 'Stop tracking "$1"?'],
    [/^(Hata|❌ Hata|Kayıt hatası|Telegram hatası|Yenileme hatası|Okunamadı|İşlem geçmişi alınamadı|Bildirimler yüklenemedi): ([\s\S]*)$/, (m, a, b) =>
      ({ 'Hata': 'Error', '❌ Hata': '❌ Error', 'Kayıt hatası': 'Save error', 'Telegram hatası': 'Telegram error',
         'Yenileme hatası': 'Refresh error', 'Okunamadı': 'Could not read', 'İşlem geçmişi alınamadı': 'Could not load trade history',
         'Bildirimler yüklenemedi': 'Could not load alerts' })[a] + ': ' + (tr(b) ?? b)],
    [/^dönem K\/Z$/, 'period PnL'],
    [/^· hacim (\S+)(?: · bakiye (\S+) → (\S+))?$/, (m, v, a, b) => `· volume ${v}` + (a ? ` · balance ${a} → ${b}` : '')],
    [/^HL portföy K\/Z \((.+)\)$/, (m, a) => `HL portfolio PnL (${tr(a) ?? a})`],
    [/^= işlemlerden net$/, '= net from trades'],
    [/^\+ açık pozisyonların bu dönemdeki değer değişimi$/, '+ change in value of open positions this period'],
    [/^· son (\d+) gün$/, '· last $1 days'], [/^· son 24 saat$/, '· last 24 hours'], [/^· tüm zaman$/, '· all time'],
    [/^(\d+) gün$/, '$1 days'], [/^24 saat$/, '24 hours'], [/^tüm zaman$/, 'all time'],
    [/^(?:⚠️ HL yalnız son ~10\.000 işlemi veriyor: veri (.+?)'den itibaren · )?(\d+) işlem kaydı( · ⚠️ funding kısmi \(çok uzun geçmiş\))?$/,
      (m, from, n, fp) => (from ? `⚠️ HL only returns the last ~10,000 trades: data from ${from} · ` : '') + `${n} trade records`
        + (fp ? ' · ⚠️ funding partial (very long history)' : '')],
    [/^EŞİK: %(.+)$/, 'THRESHOLD: $1%'],
    [/^(\d+) (saniye|dakika|saat|gün) önce$/, (m, n, u) => `${n} ${({ saniye: 'sec', dakika: 'min', saat: 'h', gün: 'd' })[u]} ago`],
  ];

  let lang = 'tr';
  try { lang = localStorage.getItem(KEY) === 'en' ? 'en' : 'tr'; } catch (e) { /* storage blocked */ }

  const origText = new WeakMap();   // text node -> original Turkish text
  const outText = new WeakMap();    // text node -> what we last wrote (so our own writes are not re-read as source)
  const origAttr = new WeakMap();   // element -> {attr: original}

  function tr(s) {
    if (!s) return null;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    const core = m[2].replace(/\s+/g, ' ');
    if (!core) return null;
    let out = DICT[core];
    if (out === undefined) {
      for (const [re, rep] of PATTERNS) {
        if (re.test(core)) { out = core.replace(re, rep); break; }
      }
    }
    if (out === undefined) return null;
    return m[1] + out + m[3];
  }

  // Public helper for text drawn on canvas / confirm() etc.
  function T(s) { return lang === 'en' ? (tr(s) ?? s) : s; }

  // user data (wallet names, alert texts) is marked data-no-i18n and never translated
  const skip = el => !!(el && el.closest && el.closest('[data-no-i18n]'));

  function doText(node) {
    if (skip(node.parentElement)) return;
    const cur = node.data;
    if (outText.get(node) === cur) return;
    const t = tr(cur);
    if (t === null || t === cur) return;
    origText.set(node, cur);
    outText.set(node, t);
    node.data = t;
  }
  function doAttrs(el) {
    if (skip(el)) return;
    for (const a of ['placeholder', 'title', 'aria-label']) {
      const v = el.getAttribute && el.getAttribute(a);
      if (!v) continue;
      const saved = origAttr.get(el) || {};
      if (saved['_out_' + a] === v) continue;
      const t = tr(v);
      if (t === null || t === v) continue;
      saved[a] = v; saved['_out_' + a] = t; origAttr.set(el, saved);
      el.setAttribute(a, t);
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 || root.tagName === 'SCRIPT' || root.tagName === 'STYLE') return;
    doAttrs(root);
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: n => (n.nodeType === 1 && (n.tagName === 'SCRIPT' || n.tagName === 'STYLE') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let n;
    while ((n = it.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }
  function restore(root) {
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n = root;
    do {
      if (n.nodeType === 3) {
        if (origText.has(n) && outText.get(n) === n.data) n.data = origText.get(n);
        origText.delete(n); outText.delete(n);
      } else if (origAttr.has(n)) {
        const s = origAttr.get(n);
        for (const a of ['placeholder', 'title', 'aria-label']) if (s[a] !== undefined && n.getAttribute(a) === s['_out_' + a]) n.setAttribute(a, s[a]);
        origAttr.delete(n);
      }
    } while ((n = it.nextNode()));
  }

  const obs = new MutationObserver(muts => {
    if (lang !== 'en') return;
    for (const m of muts) {
      if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doAttrs(m.target);
      else m.addedNodes.forEach(walk);
    }
  });

  // TR | EN switches (header + card window): the active language is the lit one
  function paintButton() {
    document.querySelectorAll('[data-set-lang]').forEach(b => {
      const on = b.dataset.setLang === lang;
      b.classList.toggle('bg-cyan-500', on); b.classList.toggle('text-black', on);
      b.classList.toggle('text-slate-400', !on); b.classList.toggle('hover:text-white', !on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function set(l) {
    lang = l === 'en' ? 'en' : 'tr';
    try { localStorage.setItem(KEY, lang); } catch (e) { /* ignore */ }
    document.documentElement.lang = lang;
    if (lang === 'en') walk(document.body); else restore(document.body);
    paintButton();
    document.dispatchEvent(new CustomEvent('hyp:lang', { detail: lang }));
  }

  function init() {
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label'] });
    document.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-set-lang]');
      if (b && b.dataset.setLang !== lang) set(b.dataset.setLang);
    });
    if (lang === 'en') set('en'); else paintButton();
  }

  window.HypI18n = { lang: () => lang, set, T, tr };
  window.T = T;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
