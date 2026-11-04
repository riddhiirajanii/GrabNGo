const crypto = require('crypto');
console.log('PICKUP_PIN_ENCRYPTION_KEY=' + crypto.randomBytes(32).toString('hex'));
console.log('Store this key securely. Losing it makes previously encrypted pickup PINs unrecoverable.');
