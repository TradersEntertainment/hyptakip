const Database = require('better-sqlite3');
const config = require('./config');

let db;

function getDb() {
  if (!db) {
    db = new Database(config.DB_PATH);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

function initDb() {
  const database = getDb();

  // Create tables
  database.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      address TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      telegram_chat_id TEXT,
      threshold_pct REAL DEFAULT 10.0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_state TEXT
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_address TEXT NOT NULL,
      wallet_label TEXT,
      coin TEXT,
      alert_type TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 🐋 Ethereum wallets watched by src/evmwatch.js (e.g. Arthur Hayes)
    CREATE TABLE IF NOT EXISTS evm_wallets (
      address TEXT PRIMARY KEY,
      label TEXT,
      telegram_chat_id TEXT,
      min_usd REAL DEFAULT 100000,
      call_alert INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      last_ts TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_wallet ON alerts(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);
  `);

  // Migration: per-wallet live order alerts (orderstream.js)
  const cols = database.prepare('PRAGMA table_info(wallets)').all().map(c => c.name);
  if (!cols.includes('track_orders')) {
    database.exec('ALTER TABLE wallets ADD COLUMN track_orders INTEGER DEFAULT 0');
  }
  // spot fills / outgoing transfers (user 23.10): on by default for every wallet
  if (!cols.includes('track_spot')) {
    database.exec('ALTER TABLE wallets ADD COLUMN track_spot INTEGER DEFAULT 1');
  }
  if (!cols.includes('track_transfers')) {
    database.exec('ALTER TABLE wallets ADD COLUMN track_transfers INTEGER DEFAULT 1');
  }
  // 📞 Telegram call on this wallet's alerts (user 24.10): off by default
  if (!cols.includes('call_alert')) {
    database.exec('ALTER TABLE wallets ADD COLUMN call_alert INTEGER DEFAULT 0');
  }

  // Default settings
  const defaultSettings = [
    ['telegram_bot_token', process.env.TELEGRAM_BOT_TOKEN || ''],
    ['telegram_default_chat_id', process.env.TELEGRAM_DEFAULT_CHAT_ID || config.DEFAULT_MAIN_CHAT_ID],
    ['poll_interval_seconds', process.env.POLL_INTERVAL_SECONDS || '5'],
    ['notifications_enabled', '1'],
    ['sound_enabled', '1']
  ];

  const insertSetting = database.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
  `);

  for (const [key, val] of defaultSettings) {
    insertSetting.run(key, val);
  }

  // Seed or update default main wallet
  const mainWallet = database.prepare('SELECT * FROM wallets WHERE LOWER(address) = LOWER(?)').get(config.DEFAULT_MAIN_WALLET);
  if (!mainWallet) {
    database.prepare(`
      INSERT INTO wallets (address, label, telegram_chat_id, threshold_pct, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(
      config.DEFAULT_MAIN_WALLET.toLowerCase(),
      config.DEFAULT_MAIN_LABEL,
      config.DEFAULT_MAIN_CHAT_ID,
      10.0
    );
    console.log(`[DB] Varsayılan ana cüzdan eklendi: ${config.DEFAULT_MAIN_WALLET} (Chat ID: ${config.DEFAULT_MAIN_CHAT_ID})`);
  } else if (!mainWallet.telegram_chat_id || mainWallet.telegram_chat_id === '') {
    database.prepare('UPDATE wallets SET telegram_chat_id = ? WHERE LOWER(address) = LOWER(?)').run(
      config.DEFAULT_MAIN_CHAT_ID,
      config.DEFAULT_MAIN_WALLET.toLowerCase()
    );
    console.log(`[DB] Ana cüzdan Telegram Chat ID güncellendi: ${config.DEFAULT_MAIN_CHAT_ID}`);
  }

  console.log(`[DB] Veritabanı hazır (${config.DB_PATH})`);
}

function getWallets() {
  const database = getDb();
  return database.prepare('SELECT * FROM wallets ORDER BY created_at ASC').all();
}

function getActiveWallets() {
  const database = getDb();
  return database.prepare('SELECT * FROM wallets WHERE is_active = 1').all();
}

function getWallet(address) {
  const database = getDb();
  return database.prepare('SELECT * FROM wallets WHERE LOWER(address) = LOWER(?)').get(address);
}

/**
 * Threshold % from user input. Accepts Turkish decimal comma ("0,01"), which parseFloat read as 0 and silently
 * turned into the 10% default. 0 means "every change" and is stored as the 0.01 floor (the tracker never alerts on
 * an unchanged size). "%5", "5 %" are accepted; values above 100 are kept (a position can grow more than 100%,
 * so a high threshold is a valid way to mute size alerts). Negative / unreadable falls back to `def`.
 */
function parsePct(v, def = 10.0) {
  const n = parseFloat(String(v ?? '').replace(/[%\s]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.max(n, 0.01) : def;
}

function upsertWallet({ address, label, telegram_chat_id = null, threshold_pct = 10.0, is_active = 1, track_orders }) {
  const database = getDb();
  const cleanAddress = address.trim().toLowerCase();
  const cleanLabel = (label && label.trim()) || `Balina (${cleanAddress.slice(0, 6)}...${cleanAddress.slice(-4)})`;
  const cleanChatId = telegram_chat_id ? telegram_chat_id.trim() : null;
  const threshold = parsePct(threshold_pct);

  const existing = getWallet(cleanAddress);
  if (existing) {
    database.prepare(`
      UPDATE wallets
      SET label = ?, telegram_chat_id = ?, threshold_pct = ?, is_active = ?
      WHERE LOWER(address) = LOWER(?)
    `).run(cleanLabel, cleanChatId, threshold, is_active ? 1 : 0, cleanAddress);
    if (track_orders !== undefined) {
      database.prepare('UPDATE wallets SET track_orders = ? WHERE LOWER(address) = LOWER(?)')
        .run(track_orders ? 1 : 0, cleanAddress);
    }
    return getWallet(cleanAddress);
  } else {
    database.prepare(`
      INSERT INTO wallets (address, label, telegram_chat_id, threshold_pct, is_active, track_orders)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(cleanAddress, cleanLabel, cleanChatId, threshold, is_active ? 1 : 0, track_orders ? 1 : 0);
    return getWallet(cleanAddress);
  }
}

function updateWallet(address, fields) {
  const database = getDb();
  const cleanAddress = address.trim().toLowerCase();
  const keys = Object.keys(fields);
  if (keys.length === 0) return getWallet(cleanAddress);

  const setClauses = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => fields[k]);
  values.push(cleanAddress);

  database.prepare(`UPDATE wallets SET ${setClauses} WHERE LOWER(address) = LOWER(?)`).run(...values);
  return getWallet(cleanAddress);
}

function updateWalletLastState(address, state) {
  const database = getDb();
  const stateStr = typeof state === 'string' ? state : JSON.stringify(state);
  database.prepare('UPDATE wallets SET last_state = ? WHERE LOWER(address) = LOWER(?)').run(stateStr, address.toLowerCase());
}

function deleteWallet(address) {
  const database = getDb();
  return database.prepare('DELETE FROM wallets WHERE LOWER(address) = LOWER(?)').run(address.toLowerCase());
}

function getEvmWallets() {
  return getDb().prepare('SELECT * FROM evm_wallets ORDER BY created_at ASC').all();
}
function upsertEvmWallet({ address, label, telegram_chat_id = null, min_usd = 100000, call_alert = 0 }) {
  const a = String(address).trim().toLowerCase();
  getDb().prepare(`
    INSERT INTO evm_wallets (address, label, telegram_chat_id, min_usd, call_alert) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(address) DO UPDATE SET label = excluded.label, telegram_chat_id = excluded.telegram_chat_id,
      min_usd = excluded.min_usd, call_alert = excluded.call_alert
  `).run(a, (label || '').trim() || `${a.slice(0, 6)}…${a.slice(-4)}`, telegram_chat_id ? String(telegram_chat_id).trim() : null,
         Math.max(0, Number(min_usd) || 0), call_alert ? 1 : 0);
  return getDb().prepare('SELECT * FROM evm_wallets WHERE address = ?').get(a);
}
function setEvmLastTs(address, ts) {
  getDb().prepare('UPDATE evm_wallets SET last_ts = ? WHERE address = ?').run(ts, String(address).toLowerCase());
}
function deleteEvmWallet(address) {
  return getDb().prepare('DELETE FROM evm_wallets WHERE address = ?').run(String(address).toLowerCase());
}

function addAlert({ wallet_address, wallet_label, coin, alert_type, message, details }) {
  const database = getDb();
  const detailsStr = details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null;

  const stmt = database.prepare(`
    INSERT INTO alerts (wallet_address, wallet_label, coin, alert_type, message, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(wallet_address, wallet_label || '', coin || '', alert_type, message, detailsStr);
  return { id: result.lastInsertRowid, wallet_address, wallet_label, coin, alert_type, message, details, created_at: new Date().toISOString() };
}

function getAlerts(limit = 50, offset = 0, address = null) {
  const database = getDb();
  if (address) {
    return database.prepare(`
      SELECT * FROM alerts
      WHERE LOWER(wallet_address) = LOWER(?)
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).all(address.toLowerCase(), limit, offset);
  }
  return database.prepare(`
    SELECT * FROM alerts
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

function clearAlerts(address = null) {
  const database = getDb();
  if (address) {
    return database.prepare('DELETE FROM alerts WHERE LOWER(wallet_address) = LOWER(?)').run(address.toLowerCase());
  }
  return database.prepare('DELETE FROM alerts').run();
}

function getSettings() {
  const database = getDb();
  const rows = database.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  for (const row of rows) {
    obj[row.key] = row.value;
  }
  return obj;
}

function setSetting(key, value) {
  const database = getDb();
  database.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function updateSettings(settingsObj) {
  const database = getDb();
  const setStmt = database.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const tx = database.transaction((obj) => {
    for (const [key, val] of Object.entries(obj)) {
      setStmt.run(key, String(val ?? ''));
    }
  });

  tx(settingsObj);
  return getSettings();
}

module.exports = {
  getDb,
  initDb,
  getWallets,
  getActiveWallets,
  getWallet,
  upsertWallet,
  parsePct,
  updateWallet,
  updateWalletLastState,
  deleteWallet,
  addAlert,
  getAlerts,
  clearAlerts,
  getSettings,
  setSetting,
  updateSettings,
  getEvmWallets,
  upsertEvmWallet,
  setEvmLastTs,
  deleteEvmWallet
};
