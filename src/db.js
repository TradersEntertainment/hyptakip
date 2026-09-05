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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_wallet ON alerts(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);
  `);

  // Default settings
  const defaultSettings = [
    ['telegram_bot_token', process.env.TELEGRAM_BOT_TOKEN || ''],
    ['telegram_default_chat_id', process.env.TELEGRAM_DEFAULT_CHAT_ID || ''],
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

  // Seed default main wallet if none exists
  const walletCount = database.prepare('SELECT COUNT(*) AS count FROM wallets').get().count;
  if (walletCount === 0) {
    database.prepare(`
      INSERT INTO wallets (address, label, threshold_pct, is_active)
      VALUES (?, ?, ?, 1)
    `).run(
      config.DEFAULT_MAIN_WALLET.toLowerCase(),
      config.DEFAULT_MAIN_LABEL,
      10.0
    );
    console.log(`[DB] Varsayılan ana cüzdan eklendi: ${config.DEFAULT_MAIN_WALLET}`);
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

function upsertWallet({ address, label, telegram_chat_id = null, threshold_pct = 10.0, is_active = 1 }) {
  const database = getDb();
  const cleanAddress = address.trim().toLowerCase();
  const cleanLabel = (label && label.trim()) || `Balina (${cleanAddress.slice(0, 6)}...${cleanAddress.slice(-4)})`;
  const cleanChatId = telegram_chat_id ? telegram_chat_id.trim() : null;
  const threshold = parseFloat(threshold_pct) || 10.0;

  const existing = getWallet(cleanAddress);
  if (existing) {
    database.prepare(`
      UPDATE wallets
      SET label = ?, telegram_chat_id = ?, threshold_pct = ?, is_active = ?
      WHERE LOWER(address) = LOWER(?)
    `).run(cleanLabel, cleanChatId, threshold, is_active ? 1 : 0, cleanAddress);
    return getWallet(cleanAddress);
  } else {
    database.prepare(`
      INSERT INTO wallets (address, label, telegram_chat_id, threshold_pct, is_active)
      VALUES (?, ?, ?, ?, ?)
    `).run(cleanAddress, cleanLabel, cleanChatId, threshold, is_active ? 1 : 0);
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
  updateWallet,
  updateWalletLastState,
  deleteWallet,
  addAlert,
  getAlerts,
  clearAlerts,
  getSettings,
  setSetting,
  updateSettings
};
