const crypto = require('crypto');
const prisma = require('../../database/prisma');
const { verifyPickupPin } = require('../../database/pickup_pin_crypto');

class TokensService {
  async issueToken(outletId) {
    const outlet = await prisma.outlet.update({
      where: { id: outletId }, data: { tokenCounter: { increment: 1 } }
    });
    return {
      token: `${outlet.tokenPrefix}-${outlet.tokenCounter}`,
      pickupPin: crypto.randomInt(1000, 10000).toString(),
      status: 'ISSUED',
      issuedAt: new Date().toISOString()
    };
  }
  async verifyPickup(orderId, submittedPin) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return { success: false, message: 'Order not found' };
    if (!/^\d{4}$/.test(String(submittedPin || '').trim()) || !verifyPickupPin(order, submittedPin)) {
      return { success: false, message: 'Incorrect pickup PIN. Verify with the student.' };
    }
    return { success: true, order };
  }
}
module.exports = new TokensService();
