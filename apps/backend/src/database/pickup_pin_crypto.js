const crypto = require('crypto');

function encryptionKey() {
  const value = process.env.PICKUP_PIN_ENCRYPTION_KEY || '';
  const key = Buffer.from(value, 'hex');
  if (key.length !== 32 || value.length !== 64) {
    throw new Error('PICKUP_PIN_ENCRYPTION_KEY must be exactly 64 hexadecimal characters.');
  }
  return key;
}

function encryptPickupPin(pin) {
  if (pin === null || pin === undefined || pin === '') {
    return { pickupPinHash: null, pickupPinCiphertext: null, pickupPinIv: null, pickupPinAuthTag: null };
  }
  const value = String(pin);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    pickupPinHash: crypto.createHash('sha256').update(value).digest('hex'),
    pickupPinCiphertext: ciphertext.toString('base64'),
    pickupPinIv: iv.toString('base64'),
    pickupPinAuthTag: cipher.getAuthTag().toString('base64')
  };
}

function decryptPickupPin(order) {
  if (!order?.pickupPinCiphertext || !order?.pickupPinIv || !order?.pickupPinAuthTag) return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(order.pickupPinIv, 'base64'));
  decipher.setAuthTag(Buffer.from(order.pickupPinAuthTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(order.pickupPinCiphertext, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

function verifyPickupPin(order, submittedPin) {
  const expected = Buffer.from(String(order?.pickupPinHash || ''), 'hex');
  const supplied = Buffer.from(crypto.createHash('sha256').update(String(submittedPin || '').trim()).digest('hex'), 'hex');
  return expected.length === supplied.length && expected.length > 0 && crypto.timingSafeEqual(expected, supplied);
}

module.exports = { encryptPickupPin, decryptPickupPin, verifyPickupPin };
