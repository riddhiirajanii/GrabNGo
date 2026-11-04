const prisma = require('../../database/prisma');
const config = require('../../config');
const queueEstimator = require('../queue_estimator/queue_estimator.service');

class AnalyticsService {
  async getCampusAnalytics() {
    const [orders, outlets] = await Promise.all([
      prisma.order.findMany({ orderBy: { placedAt: 'desc' } }),
      prisma.outlet.findMany({ orderBy: { name: 'asc' } })
    ]);
    const gross = orders.reduce((sum, order) => sum + Number(order.subtotal || 0), 0);
    const fees = orders.reduce((sum, order) => sum + Number(order.convenienceFee || 0), 0);
    const completed = orders.filter(order => order.status === 'COMPLETED');
    const minutesSaved = completed.length * config.CAMPUS.averageBreakMinutesSavedPerOrder;
    const commission = Math.round(gross * config.CAMPUS.vendorCommissionPct / 100);
    const avg = orders.length ? Math.round(orders.reduce((sum, order) => sum + (order.estimatedMinutes || 0), 0) / orders.length) : 0;
    const hourBuckets = {};
    orders.forEach(order => {
      const date = new Date(order.placedAt);
      if (Number.isNaN(date.getTime())) return;
      const hour = date.getHours();
      const label = `${String(hour).padStart(2, '0')}:00`;
      hourBuckets[label] = (hourBuckets[label] || 0) + 1;
    });
    const hourlyDistribution = Object.entries(hourBuckets)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([time, count]) => ({ time, orders: count }));

    const outletBreakdown = await Promise.all(outlets.map(async outlet => {
      const list = orders.filter(order => order.outletId === outlet.id);
      const sales = list.reduce((sum, order) => sum + Number(order.subtotal || 0), 0);
      const [queue, menuCount, activeBacklog] = await Promise.all([
        queueEstimator.getOutletQueueMetrics(outlet.id),
        prisma.menuItem.count({ where: { outletId: outlet.id } }),
        prisma.order.count({ where: { outletId: outlet.id, status: { in: ['PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP'] } } })
      ]);
      const fee = Math.round(sales * config.CAMPUS.vendorCommissionPct / 100);
      return {
        id: outlet.id, name: outlet.name, location: outlet.location,
        totalOrders: list.length, activeBacklog,
        estimatedWaitMinutes: queue.averageWaitMinutes,
        congestionLevel: queue.congestionLevel, grossSales: sales,
        commissionFee: fee, netPayout: sales - fee, rating: outlet.rating,
        status: outlet.isAcceptingOrders && menuCount > 0 ? 'ACTIVE' : 'MENU_PENDING'
      };
    }));

    const today = new Date().toDateString();
    return {
      institution: config.CAMPUS.name,
      kpis: {
        totalOrdersToday: orders.filter(order => new Date(order.placedAt).toDateString() === today).length,
        grossOrderValue: gross, convenienceFeesCollected: fees,
        platformCommissionCollected: commission, estimatedVendorNet: gross - commission,
        commissionRatePct: config.CAMPUS.vendorCommissionPct,
        studentBreakMinutesSaved: minutesSaved,
        studentBreakHoursSaved: (minutesSaved / 60).toFixed(1),
        avgTurnaroundMinutes: avg, completedOrders: completed.length, totalOrders: orders.length
      },
      hourlyDistribution, outletBreakdown, generatedAt: new Date().toISOString()
    };
  }
}
module.exports = new AnalyticsService();
