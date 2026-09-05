const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Determine persistent data directory (Railway volume support)
let dataDir = process.env.DATA_DIR;

if (!dataDir) {
  // If running inside container with mounted /data volume
  if (fs.existsSync('/data')) {
    dataDir = '/data';
  } else {
    dataDir = path.join(__dirname, '../data');
  }
}

// Ensure directory exists
if (!fs.existsSync(dataDir)) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (err) {
    console.error(`Failed to create data directory ${dataDir}:`, err.message);
  }
}

const dbPath = path.join(dataDir, 'hyptakip.sqlite');

module.exports = {
  PORT: process.env.PORT || 3000,
  DATA_DIR: dataDir,
  DB_PATH: dbPath,
  HYPERLIQUID_API_URL: process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info',
  DEFAULT_POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_SECONDS || '5', 10) * 1000,
  DEFAULT_MAIN_WALLET: '0x3b9e9c9f82eb1C321535FD2Bc48d8DB9E8E8c503',
  DEFAULT_MAIN_LABEL: 'Ana Balina (0x3b9e)',
};
