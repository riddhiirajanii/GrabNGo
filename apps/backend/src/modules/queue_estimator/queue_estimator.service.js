const config = require('../../config');
const prisma = require('../../database/prisma');

const PREPARATION_STATUSES = ['PLACED', 'CONFIRMED', 'PREPARING'];

class QueueEstimatorService {
  calculateQueuePositions(orders, outletId) {
    const queue = orders
      .filter(order => order.outletId === outletId && PREPARATION_STATUSES.includes(order.status))
      .sort((a, b) => {
        const sequenceDifference = this.getTokenSequence(a.token) - this.getTokenSequence(b.token);
        if (sequenceDifference) return sequenceDifference;
        const placedDifference = new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime();
        return placedDifference || String(a.id).localeCompare(String(b.id));
      });

    return new Map(queue.map((order, index) => [order.id, {
      position: index + 1,
      ordersAhead: index
    }]));
  }

  getTokenSequence(token) {
    const match = String(token || '').match(/-(\d+)$/);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  }

  async estimateOrderTurnaround(outletId, items = []) {
    const [outlet, preparationOrders] = await Promise.all([
      prisma.outlet.findUnique({ where: { id: outletId } }),
      prisma.order.findMany({
        where: { outletId, status: { in: PREPARATION_STATUSES } },
        include: { items: true }
      })
    ]);
    if (!outlet) throw new Error('Outlet not found');
    const basePrepTime = outlet.basePrepTime || config.QUEUE.defaultBasePrepTimeMinutes;
    let cartBasePrep = basePrepTime;
    if (items.length) {
      const maxItemPrep = Math.max(...items.map(item =>
        Math.round(basePrepTime * this.getCategoryWeight(item.categoryId))
      ));
      cartBasePrep = Math.max(8, maxItemPrep);
    }
    let queueBacklogMinutes = 0;
    for (const order of preparationOrders) {
      const orderItems = order.items?.length ? order.items : (Array.isArray(order.itemsSnapshot) ? order.itemsSnapshot : []);
      let orderWeight = 0.8;
      if (orderItems.length) {
        orderWeight = orderItems.reduce((acc, item) =>
          acc + this.getCategoryWeight(item.categoryId) * (item.qty || item.quantity || 1), 0
        ) / orderItems.length;
      }
      queueBacklogMinutes += Math.round(orderWeight * 2.2 * (order.status === 'PREPARING' ? 0.6 : 1));
    }
    const totalMinutes = Math.min(60, Math.max(5, cartBasePrep + queueBacklogMinutes + outlet.surgeMinutes));
    const targetReadyAt = new Date(Date.now() + totalMinutes * 60000).toISOString();
    const congestion = this.categorizeCongestion(preparationOrders.length, totalMinutes);
    return {
      outletId, estimatedMinutes: totalMinutes, targetReadyAt,
      congestionLevel: congestion.level, badge: congestion.badge, color: congestion.color,
      activeBacklogCount: preparationOrders.length, rushSurgeActive: outlet.surgeMinutes > 0,
      rushSurgeMinutes: outlet.surgeMinutes
    };
  }

  async getOutletQueueMetrics(outletId) {
    const [activeOrderCount, outlet] = await Promise.all([
      prisma.order.count({ where: { outletId, status: { in: PREPARATION_STATUSES } } }),
      prisma.outlet.findUnique({ where: { id: outletId } })
    ]);
    if (!outlet) return {
      outletId, activeOrderCount: 0, averageWaitMinutes: 0,
      congestionLevel: 'LOW', badge: 'Fast - Grab Quickly', color: '#10b981', rushSurgeMinutes: 0
    };
    const avgMinutes = Math.min(60, Math.max(6, outlet.basePrepTime + Math.round(activeOrderCount * 1.6) + outlet.surgeMinutes));
    const congestion = this.categorizeCongestion(activeOrderCount, avgMinutes);
    return {
      outletId, activeOrderCount, averageWaitMinutes: avgMinutes,
      congestionLevel: congestion.level, badge: congestion.badge,
      color: congestion.color, rushSurgeMinutes: outlet.surgeMinutes
    };
  }

  categorizeCongestion(activeOrderCount, waitMinutes) {
    const { LOW, MODERATE, HIGH, CONGESTED } = config.QUEUE.congestionThresholds;
    if (activeOrderCount <= LOW.maxOrders && waitMinutes <= LOW.maxMinutes) return { level: 'LOW', badge: LOW.label, color: LOW.color };
    if (activeOrderCount <= MODERATE.maxOrders && waitMinutes <= MODERATE.maxMinutes) return { level: 'MODERATE', badge: MODERATE.label, color: MODERATE.color };
    if (activeOrderCount <= HIGH.maxOrders && waitMinutes <= HIGH.maxMinutes) return { level: 'HIGH', badge: HIGH.label, color: HIGH.color };
    return { level: 'CONGESTED', badge: CONGESTED.label, color: CONGESTED.color };
  }
  getCategoryWeight(categoryId) {
    return categoryId ? (config.QUEUE.categoryWeights[categoryId] || config.QUEUE.categoryWeights.default) : config.QUEUE.categoryWeights.default;
  }
}
module.exports = Object.assign(new QueueEstimatorService(), { PREPARATION_STATUSES });
