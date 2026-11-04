const config = require('../../config');
const prisma = require('../../database/prisma');

const ACTIVE_STATUSES = ['PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP'];

class QueueEstimatorService {
  async estimateOrderTurnaround(outletId, items = []) {
    const [outlet, activeOrders] = await Promise.all([
      prisma.outlet.findUnique({ where: { id: outletId } }),
      prisma.order.findMany({
        where: { outletId, status: { in: ACTIVE_STATUSES } },
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
    for (const order of activeOrders) {
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
    const congestion = this.categorizeCongestion(activeOrders.length, totalMinutes);
    return {
      outletId, estimatedMinutes: totalMinutes, targetReadyAt,
      congestionLevel: congestion.level, badge: congestion.badge, color: congestion.color,
      activeBacklogCount: activeOrders.length, rushSurgeActive: outlet.surgeMinutes > 0,
      rushSurgeMinutes: outlet.surgeMinutes
    };
  }

  async getOutletQueueMetrics(outletId) {
    const [activeOrderCount, outlet] = await Promise.all([
      prisma.order.count({ where: { outletId, status: { in: ACTIVE_STATUSES } } }),
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
module.exports = new QueueEstimatorService();
