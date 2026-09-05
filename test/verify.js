const db = require('../src/db');
const hyperliquid = require('../src/hyperliquid');
const telegram = require('../src/telegram');
const config = require('../src/config');

async function testAll() {
  console.log('--- 1. Testing Database Initialization ---');
  db.initDb();
  const wallets = db.getWallets();
  console.log(`Found ${wallets.length} wallets in DB.`);
  const mainWallet = wallets.find(w => w.address.toLowerCase() === config.DEFAULT_MAIN_WALLET.toLowerCase());
  if (!mainWallet) {
    throw new Error('Default main wallet not found in DB!');
  }
  console.log('✅ Default wallet verified:', mainWallet.label, mainWallet.address);

  console.log('\n--- 2. Testing Hyperliquid API Live Fetch ---');
  const state = await hyperliquid.getClearinghouseState(config.DEFAULT_MAIN_WALLET);
  console.log(`Account Value: $${state.accountValue}`);
  console.log(`Total Margin Used: $${state.totalMarginUsed}`);
  console.log(`Active Positions: ${state.positions.length}`);
  if (state.positions.length > 0) {
    const p0 = state.positions[0];
    console.log(`Position 1: ${p0.side} ${p0.coin}, Size: ${p0.size}, Value: $${p0.positionValue}, PnL: $${p0.unrealizedPnl} (${p0.roePct.toFixed(2)}% ROE)`);
  }
  console.log('✅ Hyperliquid API live fetch succeeded!');

  console.log('\n--- 3. Testing Fills API ---');
  const fills = await hyperliquid.getUserFills(config.DEFAULT_MAIN_WALLET);
  console.log(`Fetched ${fills.length} recent fills.`);
  if (fills.length > 0) {
    console.log(`Latest Fill: ${fills[0].side} ${fills[0].coin} at $${fills[0].px}, dir: ${fills[0].dir}`);
  }
  console.log('✅ User fills API succeeded!');

  console.log('\n--- 4. Testing Position Alert Dispatcher & DB Alert Logging ---');
  const testAlert = {
    type: 'NEW_POSITION',
    wallet: mainWallet,
    current: {
      coin: 'BTC',
      side: 'LONG',
      size: 0.5,
      positionValue: 40000,
      entryPrice: 80000,
      leverage: '10x cross',
      marginUsed: 4000,
      liquidationPrice: 72000,
      liqDistancePct: 10.0
    }
  };

  await telegram.notifyPositionAlert(testAlert);
  const alerts = db.getAlerts(5);
  console.log(`Total alerts in DB: ${alerts.length}`);
  if (alerts.length === 0) {
    throw new Error('Alert was not recorded in DB!');
  }
  console.log('Latest alert in DB:', alerts[0].alert_type, alerts[0].coin, alerts[0].wallet_label);
  console.log('✅ Alert generation & SQLite logging verified!');

  console.log('\n=========================================');
  console.log('🎉 ALL BACKEND CHECKS PASSED SUCCESSFULLY!');
  console.log('=========================================');
}

testAll().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
