const { buildLatestConsumptionUrl, buildTodayConsumptionUrl } = require('../dist/octopusUrls');

const mpan = process.argv[2];
const serial = process.argv[3];

if (!mpan || !serial) {
  console.error('Usage: node scripts/print-urls.js <MPAN> <SERIAL>');
  process.exit(1);
}

console.log('Latest:', buildLatestConsumptionUrl(mpan, serial));
console.log('Today:', buildTodayConsumptionUrl(mpan, serial));
