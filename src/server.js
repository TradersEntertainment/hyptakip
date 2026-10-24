const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const db = require('./db');
const orderstream = require('./orderstream');
const hyperliquid = require('./hyperliquid');
const telegram = require('./telegram');
const tracker = require('./tracker');
const pnldata = require('./pnldata');
const botcmd = require('./botcmd');
const caller = require('./caller');
const evmwatch = require('./evmwatch');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    dataDir: config.DATA_DIR
  });
});

// --- Wallets Endpoints ---

// Get all tracked wallets
app.get('/api/wallets', async (req, res) => {
  try {
    const wallets = db.getWallets();
    const live = orderstream.wanted();
    const enriched = wallets.map(w => {
      let state = null;
      if (w.last_state) {
        try {
          state = JSON.parse(w.last_state);
        } catch (e) {
          state = null;
        }
      }
      return {
        ...w,
        live: live.has(w.address.toLowerCase()),   // has a live stream slot (HL allows 10 wallets)
        state: state || tracker.getCachedState(w.address)
      };
    });
    res.json({ success: true, wallets: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add new wallet
app.post('/api/wallets', async (req, res) => {
  try {
    const { address, label, telegram_chat_id, threshold_pct, is_active, track_orders } = req.body;

    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Geçersiz Ethereum/Hyperliquid cüzdan adresi. 0x ile başlayan 42 karakterlik bir adres giriniz.'
      });
    }

    if (track_orders && ordersFull(address)) {
      return res.status(400).json({ success: false, error: `Emir bildirimi en çok ${orderstream.MAX_USERS} cüzdanda açılabilir (Hyperliquid sınırı).` });
    }
    const saved = db.upsertWallet({
      address: address.trim(),
      label: label?.trim(),
      telegram_chat_id: telegram_chat_id?.trim(),
      threshold_pct: db.parsePct(threshold_pct),
      is_active: is_active !== undefined ? is_active : 1,
      track_orders: track_orders === undefined ? undefined : !!track_orders   // left out → keep the stored value
    });
    orderstream.refresh();

    // Run immediate check in background to initialize state
    tracker.checkWallet(saved).catch(err => {
      console.error('[API] Yeni cüzdan ilk kontrol hatası:', err.message);
    });

    res.json({ success: true, wallet: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update existing wallet
app.put('/api/wallets/:address', (req, res) => {
  try {
    const { address } = req.params;
    const { label, telegram_chat_id, threshold_pct, is_active, track_orders, track_spot, track_transfers, call_alert } = req.body;

    const fields = {};
    if (label !== undefined) fields.label = label.trim();
    if (telegram_chat_id !== undefined) fields.telegram_chat_id = telegram_chat_id ? telegram_chat_id.trim() : null;
    if (threshold_pct !== undefined) fields.threshold_pct = db.parsePct(threshold_pct);
    if (is_active !== undefined) fields.is_active = is_active ? 1 : 0;
    if (track_orders !== undefined) fields.track_orders = track_orders ? 1 : 0;
    if (track_spot !== undefined) fields.track_spot = track_spot ? 1 : 0;
    if (track_transfers !== undefined) fields.track_transfers = track_transfers ? 1 : 0;
    if (call_alert !== undefined) fields.call_alert = call_alert ? 1 : 0;
    if (fields.track_orders && ordersFull(address)) {
      return res.status(400).json({ success: false, error: `Emir bildirimi en çok ${orderstream.MAX_USERS} cüzdanda açılabilir (Hyperliquid sınırı).` });
    }

    const updated = db.updateWallet(address, fields);
    if (!updated) return res.status(404).json({ success: false, error: 'Cüzdan bulunamadı' });
    orderstream.refresh();
    res.json({ success: true, wallet: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// HL allows live order streams for at most 10 wallets per IP
function ordersFull(address) {
  const others = db.getWallets().filter(w => Number(w.track_orders) === 1 && w.address.toLowerCase() !== String(address).toLowerCase());
  return others.length >= orderstream.MAX_USERS;
}

// 📈 PnL / account value history (HL portfolio: day / week / month / allTime, spot included). Cached 60 s.
app.get('/api/wallets/:address/portfolio', async (req, res) => {
  try {
    const address = String(req.params.address || '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) return res.status(400).json({ success: false, error: 'Geçersiz adres' });
    res.json({ success: true, ...(await pnldata.getPortfolio(address)) });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// 🪙 PnL per coin over the last N days: realized (fills' closedPnl) − fees + funding = net for the period.
// The open position's unrealized PnL is shown separately and NOT added: it is accumulated since the position was
// opened, not over the period (user 23.10: "hesap tutmuyor"). `portfolioPnl` (HL's mark-to-market curve for the
// same period) lets the page reconcile: chart = trades' net + change in value of open positions during the period.
// HL serves at most the ~10,000 most recent fills, so very active wallets may be covered for less than N days:
// `coveredFrom` says from when. Cached 5 min (up to 10 requests of weight 20 per miss).
app.get('/api/wallets/:address/coin-pnl', async (req, res) => {
  try {
    const address = String(req.params.address || '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) return res.status(400).json({ success: false, error: 'Geçersiz adres' });
    // days=0 → all time (user 23.10: "tümüne basınca tümü olmuyor 30da kalıyor")
    const days = [0, 1, 7, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
    const { closes, ...data } = await pnldata.getCoinPnl(address, days);   // closes: only for the /pnl report
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// 📞 Telegram call (CallMeBot) status + test call
app.get('/api/caller/status', (req, res) => res.json({ success: true, ...caller.status() }));
app.post('/api/caller/test', async (req, res) => {
  const r = await caller.callNow('HYPTAKIP deneme araması. Balina hareket edince böyle arayacağım.');
  res.status(r.ok ? 200 : 400).json({ success: r.ok, note: r.note, error: r.ok ? undefined : r.note });
});

// 🐋 Ethereum wallets (evmwatch.js)
app.get('/api/evm-wallets', (req, res) => res.json({ success: true, wallets: db.getEvmWallets(), status: evmwatch.status() }));
app.post('/api/evm-wallets', (req, res) => {
  try {
    const { address, label, telegram_chat_id, min_usd, call_alert } = req.body || {};
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(address || '').trim())) return res.status(400).json({ success: false, error: 'Geçersiz Ethereum adresi' });
    const w = db.upsertEvmWallet({ address, label, telegram_chat_id, min_usd: min_usd === undefined || min_usd === '' ? 100000 : min_usd, call_alert });
    res.json({ success: true, wallet: w });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.delete('/api/evm-wallets/:address', (req, res) => {
  try { db.deleteEvmWallet(req.params.address); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 🤖 /pnl Telegram command status
app.get('/api/botcmd/status', (req, res) => res.json({ success: true, ...botcmd.status() }));

// Live order stream status
app.get('/api/orders/status', (req, res) => {
  res.json({ success: true, ...orderstream.status() });
});

// Delete wallet
app.delete('/api/wallets/:address', (req, res) => {
  try {
    const { address } = req.params;
    db.deleteWallet(address);
    orderstream.refresh();
    res.json({ success: true, message: 'Cüzdan takipten çıkarıldı' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fetch live state for a wallet
app.get('/api/wallets/:address/state', async (req, res) => {
  try {
    const { address } = req.params;
    const state = await hyperliquid.getClearinghouseState(address);
    res.json({ success: true, state });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fetch trade fills history for a wallet
app.get('/api/wallets/:address/fills', async (req, res) => {
  try {
    const { address } = req.params;
    const fills = await hyperliquid.getUserFills(address);
    res.json({ success: true, fills });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fetch all market mid prices for ticker
app.get('/api/mids', async (req, res) => {
  try {
    const mids = await hyperliquid.getAllMids();
    res.json({ success: true, mids });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Alerts Endpoints ---

// Get alerts
app.get('/api/alerts', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const offset = parseInt(req.query.offset || '0', 10);
    const address = req.query.address || null;

    const alerts = db.getAlerts(limit, offset, address);
    res.json({ success: true, alerts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Clear alerts
app.delete('/api/alerts', (req, res) => {
  try {
    const address = req.query.address || null;
    db.clearAlerts(address);
    res.json({ success: true, message: 'Bildirim geçmişi temizlendi' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Settings Endpoints ---

// Get settings (Bot Token is strictly loaded from Railway environment variables)
app.get('/api/settings', (req, res) => {
  try {
    const settings = db.getSettings();
    const rawToken = process.env.TELEGRAM_BOT_TOKEN ? process.env.TELEGRAM_BOT_TOKEN.trim() : '';
    const defaultChatId = process.env.TELEGRAM_DEFAULT_CHAT_ID ? process.env.TELEGRAM_DEFAULT_CHAT_ID.trim() : config.DEFAULT_MAIN_CHAT_ID;
    const maskedToken = rawToken ? `${rawToken.slice(0, 6)}••••••••${rawToken.slice(-4)}` : '';

    res.json({
      success: true,
      settings: {
        hasBotToken: Boolean(rawToken),
        botTokenPreview: maskedToken,
        telegram_default_chat_id: defaultChatId,
        poll_interval_seconds: settings.poll_interval_seconds || '5',
        call_telegram_user: settings.call_telegram_user || '',
        call_env_user: (process.env.CALL_TELEGRAM_USER || process.env.WAKE_TELEGRAM_USER || '').trim(),
        source: 'railway_env'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update settings (Only non-sensitive preferences like poll interval)
app.post('/api/settings', (req, res) => {
  try {
    const { poll_interval_seconds, call_telegram_user } = req.body;
    const toUpdate = {};
    if (poll_interval_seconds) toUpdate.poll_interval_seconds = String(poll_interval_seconds);
    // 📞 who gets the call: a Telegram @username or +phone (not a secret; stored in the database, not in the repo)
    if (call_telegram_user !== undefined) {
      const u = String(call_telegram_user || '').trim();
      if (u && !/^(@?[A-Za-z0-9_]{4,32}|\+\d{8,15})$/.test(u)) return res.status(400).json({ success: false, error: 'Aranacak Telegram: @kullanıcıadı ya da +90… telefon' });
      toUpdate.call_telegram_user = u;
    }

    const updated = db.updateSettings(toUpdate);
    const rawToken = process.env.TELEGRAM_BOT_TOKEN ? process.env.TELEGRAM_BOT_TOKEN.trim() : '';
    const defaultChatId = process.env.TELEGRAM_DEFAULT_CHAT_ID ? process.env.TELEGRAM_DEFAULT_CHAT_ID.trim() : config.DEFAULT_MAIN_CHAT_ID;

    res.json({
      success: true,
      settings: {
        hasBotToken: Boolean(rawToken),
        botTokenPreview: rawToken ? `${rawToken.slice(0, 6)}••••••••${rawToken.slice(-4)}` : '',
        telegram_default_chat_id: defaultChatId,
        poll_interval_seconds: updated.poll_interval_seconds || '5'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Test Telegram Alert (Uses Railway environment variables)
app.post('/api/settings/test-telegram', async (req, res) => {
  try {
    const { chatId } = req.body;
    const result = await telegram.sendTestMessage(chatId);
    if (result.success) {
      res.json({ success: true, message: 'Test bildirimi Telegram grubunuza başarıyla gönderildi!' });
    } else {
      res.status(400).json({ success: false, error: result.reason || 'Mesaj gönderilemedi' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Manual trigger all wallets check
app.post('/api/tracker/trigger', async (req, res) => {
  try {
    const wallets = db.getActiveWallets();
    const results = [];
    for (const w of wallets) {
      const state = await tracker.checkWallet(w);
      results.push({ address: w.address, label: w.label, positions: state?.positions?.length || 0 });
    }
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Initialize DB and start server
db.initDb();
tracker.startTracker();
orderstream.start();
evmwatch.start();

const server = app.listen(config.PORT, () => {
  console.log(`=========================================`);
  console.log(`🚀 HYPERLIQUID POZİSYON TAKİP SİSTEMİ 🚀`);
  console.log(`📡 Port: http://localhost:${config.PORT}`);
  console.log(`💾 Veritabanı Yolu: ${config.DB_PATH}`);
  console.log(`=========================================`);
  botcmd.start();
});

// Graceful shutdown
function shutdown() {
  console.log('[Server] Kapatılıyor...');
  tracker.stopTracker();
  orderstream.stop();
  botcmd.stop();
  evmwatch.stop();
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { app, server, shutdown };
