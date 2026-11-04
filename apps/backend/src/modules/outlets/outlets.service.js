const prisma = require('../../database/prisma');
const queueEstimator = require('../queue_estimator/queue_estimator.service');

class OutletsService {
  async getAllOutlets() {
    const rawOutlets = await prisma.outlet.findMany({ orderBy: { name: 'asc' } });
    return Promise.all(rawOutlets.map(async outlet => {
      const [queueMetrics, menuCount] = await Promise.all([
        queueEstimator.getOutletQueueMetrics(outlet.id),
        prisma.menuItem.count({ where: { outletId: outlet.id } })
      ]);
      return {
        ...outlet,
        isAcceptingOrders: Boolean(outlet.isAcceptingOrders && menuCount > 0),
        queueStatus: queueMetrics.congestionLevel,
        activeOrderCount: queueMetrics.activeOrderCount,
        averageWaitMinutes: queueMetrics.averageWaitMinutes,
        badge: queueMetrics.badge,
        badgeColor: queueMetrics.color,
        rushSurgeMinutes: queueMetrics.rushSurgeMinutes
      };
    }));
  }

  async getOutletById(outletId) {
    const outlet = await prisma.outlet.findUnique({ where: { id: outletId } });
    if (!outlet) return null;
    const [queueMetrics, menuCount] = await Promise.all([
      queueEstimator.getOutletQueueMetrics(outlet.id),
      prisma.menuItem.count({ where: { outletId: outlet.id } })
    ]);
    return {
      ...outlet,
      isAcceptingOrders: Boolean(outlet.isAcceptingOrders && menuCount > 0),
      queueStatus: queueMetrics.congestionLevel,
      activeOrderCount: queueMetrics.activeOrderCount,
      averageWaitMinutes: queueMetrics.averageWaitMinutes,
      badge: queueMetrics.badge,
      badgeColor: queueMetrics.color,
      rushSurgeMinutes: queueMetrics.rushSurgeMinutes
    };
  }

  async setRushSurge(outletId, minutes) {
    const value = Math.max(0, Math.min(120, parseInt(minutes, 10) || 0));
    const outlet = await prisma.outlet.update({ where: { id: outletId }, data: { surgeMinutes: value } });
    return { outletId, surgeMinutes: outlet.surgeMinutes, active: outlet.surgeMinutes > 0 };
  }
}
module.exports = new OutletsService();
