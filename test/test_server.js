const { app, server } = require('../src/server');

async function testServer() {
  try {
    const port = server.address().port;
    const base = `http://localhost:${port}`;
    console.log(`Testing server on ${base}...`);

    // Health
    const healthRes = await fetch(`${base}/health`);
    const health = await healthRes.json();
    console.log('Health response:', health.status);
    if (health.status !== 'ok') throw new Error('Health check failed');

    // Wallets
    const walletsRes = await fetch(`${base}/api/wallets`);
    const walletsData = await walletsRes.json();
    console.log(`Fetched ${walletsData.wallets.length} wallets via REST API`);
    if (!walletsData.success || walletsData.wallets.length === 0) throw new Error('API wallets failed');

    // Settings
    const settingsRes = await fetch(`${base}/api/settings`);
    const settingsData = await settingsRes.json();
    console.log('Poll interval setting:', settingsData.settings.poll_interval_seconds);

    // Alerts
    const alertsRes = await fetch(`${base}/api/alerts`);
    const alertsData = await alertsRes.json();
    console.log(`Alerts count: ${alertsData.alerts.length}`);

    console.log('✅ ALL SERVER REST API TESTS PASSED!');
  } finally {
    const tracker = require('../src/tracker');
    tracker.stopTracker();
    server.close();
    setTimeout(() => process.exit(0), 100);
  }
}

testServer().catch(err => {
  console.error('Server test error:', err);
  process.exit(1);
});
