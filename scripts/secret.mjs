import crypto from 'node:crypto';
// Prints a random 64-character secret. Use it for APP_SECRET, CRON_SECRET and SETUP_TOKEN (a different one for each).
console.log(crypto.randomBytes(32).toString('hex'));
