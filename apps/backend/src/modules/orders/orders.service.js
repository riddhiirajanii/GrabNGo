const crypto = require('crypto');
const prisma = require('../../database/prisma');
const config = require('../../config');
const queueEstimator = require('../queue_estimator/queue_estimator.service');
const { encryptPickupPin, decryptPickupPin, verifyPickupPin } = require('../../database/pickup_pin_crypto');

const ACTIVE_STATUSES = ['PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP'];
const VALID_NEXT = {
  PLACED: ['PREPARING'],
  CONFIRMED: ['PREPARING'],
  PREPARING: ['READY_FOR_PICKUP'],
  READY_FOR_PICKUP: ['COMPLETED']
};

function mapOrder(row, includePin = false) {
  if (!row) return null;
  const items = (row.items || []).map(item => ({
    name: item.name, variant: item.variant || null, qty: item.quantity,
    price: item.unitPrice, categoryId: item.categoryId || null
  }));
  const result = {
    id: row.id, token: row.token, outletId: row.outletId,
    studentName: row.studentName, studentRoll: row.studentRoll,
    studentPhone: row.studentPhone, status: row.status, items,
    subtotal: row.subtotal, convenienceFee: row.convenienceFee,
    discount: row.discount, total: row.total, hasPassApplied: row.hasPassApplied,
    paymentMethod: row.paymentMethod, paymentStatus: row.paymentStatus,
    academicBreakSlot: row.academicBreakSlot,
    scheduledPickupTime: row.scheduledPickupTime?.toISOString() || null,
    estimatedReadyAt: row.estimatedReadyAt.toISOString(),
    estimatedMinutes: row.estimatedMinutes, placedAt: row.placedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(), readyAt: row.readyAt?.toISOString() || null,
    completedAt: row.completedAt?.toISOString() || null, notes: row.notes,
    queueSnapshot: row.queueSnapshot
  };
  if (includePin) result.pickupPin = decryptPickupPin(row);
  return result;
}

class OrdersService {
  async getValidatedItems(tx, outletId, inputs) {
    if (!Array.isArray(inputs) || !inputs.length) throw new Error('Order must contain at least one item');
    const menuItems = await tx.menuItem.findMany({
      where: { outletId },
      include: { variants: true }
    });
    return inputs.map(input => {
      const item = menuItems.find(row => row.name === input.name);
      if (!item) throw new Error(`Item not found in current menu: ${input.name}`);
      if (!item.isAvailable) throw new Error(`${item.name} is currently unavailable`);
      const qty = Number(input.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error('Item quantity must be between 1 and 20');
      let price = Number(item.price);
      let variant = null;
      if (item.variants.length) {
        const chosen = item.variants.find(row => row.label === input.variant);
        if (!chosen) throw new Error(`Choose a valid size for ${item.name}`);
        price = Number(chosen.price);
        variant = chosen.label;
      } else if (input.variant) {
        throw new Error(`No size option exists for ${item.name}`);
      }
      if (!Number.isFinite(price) || price < 0) throw new Error(`Invalid menu price for ${item.name}`);
      return { name: item.name, variant, qty, price, categoryId: item.categoryId, menuItemId: item.id };
    });
  }

  async quoteOrder(payload = {}) {
    const { outletId, items = [] } = payload;
    const outlet = await prisma.outlet.findUnique({ where: { id: outletId } });
    if (!outlet || !outlet.isAcceptingOrders) throw new Error('This outlet is unavailable for orders');
    const validatedItems = await this.getValidatedItems(prisma, outletId, items);
    const subtotal = validatedItems.reduce((sum, item) => sum + item.price * item.qty, 0);
    const convenienceFee = config.CAMPUS.convenienceFee;
    return {
      items: validatedItems.map(({ menuItemId, ...item }) => item),
      subtotal, convenienceFee, discount: 0, total: subtotal + convenienceFee,
      hasPassApplied: false, currency: 'INR'
    };
  }

  async createOrder(payload = {}) {
    const { outletId, items = [], studentName, studentRoll, studentPhone = '', academicBreakSlot = 'instant', notes = '' } = payload;
    if (!studentName || !studentRoll) throw new Error('Student name and roll number are required');
    const outlet = await prisma.outlet.findUnique({ where: { id: outletId } });
    if (!outlet || !outlet.isAcceptingOrders) throw new Error('This outlet is unavailable for orders');

    const validatedItems = await this.getValidatedItems(prisma, outletId, items);
    const subtotal = validatedItems.reduce((sum, item) => sum + item.price * item.qty, 0);
    const convenienceFee = config.CAMPUS.convenienceFee;
    const queue = await queueEstimator.estimateOrderTurnaround(outletId, validatedItems);
    const pickupPin = crypto.randomInt(1000, 10000).toString();
    const pinFields = encryptPickupPin(pickupPin);
    const now = new Date();
    const orderId = `ord-${crypto.randomUUID()}`;
    const cleanRoll = String(studentRoll).toUpperCase();
    const snapshot = validatedItems.map(({ menuItemId, ...item }) => item);

    const createInTransaction = async () => prisma.$transaction(async tx => {
      const currentOutlet = await tx.outlet.findUnique({ where: { id: outletId } });
      if (!currentOutlet || !currentOutlet.isAcceptingOrders) throw new Error('This outlet is unavailable for orders');
      const itemsNow = await this.getValidatedItems(tx, outletId, items);
      const currentSubtotal = itemsNow.reduce((sum, item) => sum + item.price * item.qty, 0);
      const tokenOutlet = await tx.outlet.update({
        where: { id: outletId }, data: { tokenCounter: { increment: 1 } }
      });
      const token = `${tokenOutlet.tokenPrefix}-${tokenOutlet.tokenCounter}`;
      const order = await tx.order.create({
        data: {
          id: orderId, token, ...pinFields, outletId,
          studentName: String(studentName).trim(), studentRoll: cleanRoll,
          studentPhone: String(studentPhone || '').slice(0, 30),
          status: 'PLACED', subtotal: currentSubtotal,
          convenienceFee, discount: 0, total: currentSubtotal + convenienceFee,
          hasPassApplied: false, paymentMethod: 'CASH_ON_PICKUP',
          paymentStatus: 'DUE_ON_PICKUP', academicBreakSlot: String(academicBreakSlot || 'instant'),
          scheduledPickupTime: payload.scheduledPickupTime ? new Date(payload.scheduledPickupTime) : new Date(queue.targetReadyAt),
          estimatedReadyAt: new Date(queue.targetReadyAt), estimatedMinutes: queue.estimatedMinutes,
          placedAt: now, notes: String(notes || '').slice(0, 500),
          queueSnapshot: {
            congestionLevel: queue.congestionLevel,
            activeBacklog: queue.activeBacklogCount
          },
          itemsSnapshot: itemsNow.map(({ menuItemId, ...item }) => item),
          items: { create: itemsNow.map(item => ({
            menuItemId: item.menuItemId, name: item.name, variant: item.variant,
            quantity: item.qty, unitPrice: item.price, categoryId: item.categoryId
          })) },
          statusHistory: { create: { fromStatus: null, toStatus: 'PLACED', actorRole: 'STUDENT', createdAt: now } }
        },
        include: { items: true }
      });
      return order;
    }, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 20000 });

    let created;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { created = await createInTransaction(); break; }
      catch (error) {
        if (attempt === 2 || !['P2034', 'P2002'].includes(error.code)) throw error;
      }
    }
    return { ...mapOrder(created, true), pickupPin };
  }

  async getOrderRecord(idOrToken) {
    let row = await prisma.order.findUnique({ where: { id: idOrToken }, include: { items: true } });
    if (!row) row = await prisma.order.findUnique({ where: { token: idOrToken }, include: { items: true } });
    return row;
  }

  async trackOrder(id) {
    const row = await this.getOrderRecord(id);
    if (!row) return null;
    const order = mapOrder(row, true);
    const outlet = await prisma.outlet.findUnique({ where: { id: order.outletId } });
    const ready = new Date(order.estimatedReadyAt);
    const now = new Date();
    const remaining = Math.max(0, Math.ceil((ready - now) / 1000));
    const duration = Math.max(60000, ready - new Date(order.placedAt));
    const elapsed = Math.max(0, now - new Date(order.placedAt));
    const done = ['READY_FOR_PICKUP', 'COMPLETED'].includes(order.status);
    return {
      orderId: order.id, token: order.token, pickupPin: order.pickupPin,
      status: order.status, outletName: outlet?.name || 'Campus Outlet',
      outletLocation: outlet?.location || '', studentName: order.studentName,
      studentRoll: order.studentRoll, items: order.items, total: order.total,
      paymentStatus: order.paymentStatus, remainingMinutes: done ? 0 : Math.ceil(remaining / 60),
      remainingSeconds: done ? 0 : remaining,
      progressPct: done ? 100 : Math.min(99, Math.round(elapsed / duration * 100)),
      placedAt: order.placedAt, estimatedReadyAt: order.estimatedReadyAt,
      estimatedMinutes: order.estimatedMinutes, completedAt: order.completedAt,
      readyAt: order.readyAt, isReadyForPickup: order.status === 'READY_FOR_PICKUP'
    };
  }

  async getOrders(filters = {}) {
    const where = {};
    if (filters.outletId) where.outletId = filters.outletId;
    if (filters.status) where.status = filters.status;
    if (filters.studentRoll) where.studentRoll = String(filters.studentRoll).toUpperCase();
    const rows = await prisma.order.findMany({
      where, include: { items: true }, orderBy: { placedAt: 'desc' }, take: 500
    });
    return rows.map(row => mapOrder(row, Boolean(filters.studentRoll)));
  }

  async getOrderById(id) {
    const row = await this.getOrderRecord(id);
    return row ? mapOrder(row, true) : null;
  }

  async updateStatus(id, status, pickupPin, actorRole = 'VENDOR') {
    const result = await prisma.$transaction(async tx => {
      const current = await tx.order.findUnique({ where: { id }, include: { items: true } });
      if (!current) return { missing: true };
      if (!(VALID_NEXT[current.status] || []).includes(status)) {
        throw new Error(`Invalid order transition: ${current.status} -> ${status}`);
      }

      if (status === 'COMPLETED') {
        const rateKey = `pickup:${id}`;
        const attempt = await tx.authRateLimit.findUnique({ where: { key: rateKey } });
        if (attempt?.lockedUntil && attempt.lockedUntil.getTime() > Date.now()) {
          return { failure: 'Too many incorrect PIN attempts. Try again in 15 minutes.', statusCode: 403 };
        }
        if (!verifyPickupPin(current, pickupPin)) {
          const count = (attempt?.count || 0) + 1;
          const lockedUntil = count >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
          await tx.authRateLimit.upsert({
            where: { key: rateKey },
            create: { key: rateKey, count: count >= 5 ? 0 : count, lockedUntil, lastEventAt: new Date() },
            update: { count: count >= 5 ? 0 : count, lockedUntil, lastEventAt: new Date() }
          });
          return {
            failure: lockedUntil
              ? 'Too many incorrect PIN attempts. Try again in 15 minutes.'
              : 'Incorrect pickup PIN. Verify with the student.',
            statusCode: 403
          };
        }
        await tx.authRateLimit.deleteMany({ where: { key: rateKey } });
      }

      const now = new Date();
      const updated = await tx.order.update({
        where: { id },
        data: {
          status,
          ...(status === 'READY_FOR_PICKUP' ? { readyAt: now } : {}),
          ...(status === 'COMPLETED' ? { completedAt: now } : {})
        },
        include: { items: true }
      });
      await tx.orderStatusHistory.create({
        data: { orderId: id, fromStatus: current.status, toStatus: status, actorRole, createdAt: now }
      });
      return { order: mapOrder(updated, true) };
    }, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 20000 });

    if (result.missing) return null;
    if (result.failure) {
      const error = new Error(result.failure);
      error.statusCode = result.statusCode || 403;
      throw error;
    }
    return result.order;
  }
}
module.exports = new OrdersService();
