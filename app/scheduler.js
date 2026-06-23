// scheduler.js
// Runs fetch-opportunities.js now and then every 6 hours, while this stays open.
// Run:  node scheduler.js   (keep the terminal open; Ctrl+C to stop)
// For true background/automatic runs (PC asleep-safe), use the GitHub Actions
// workflow (.github/workflows/refresh.yml) or Windows Task Scheduler — see README.

const { execFile } = require('child_process');

const SIX_HOURS = 6 * 60 * 60 * 1000;

function runOnce() {
  const stamp = new Date().toISOString();
  console.log(`\n=== refresh @ ${stamp} ===`);
  execFile('node', ['fetch-opportunities.js'], { cwd: __dirname }, (err, stdout, stderr) => {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    if (err) console.error('refresh failed:', err.message);
    console.log('next refresh in 6 hours...');
  });
}

runOnce();
setInterval(runOnce, SIX_HOURS);
