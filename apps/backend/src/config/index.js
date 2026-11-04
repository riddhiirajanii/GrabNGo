/**
 * Grab n Go Backend Configuration
 * Campus Food Court Architecture — IIT Patna
 */

const fs = require('fs');
const path = require('path');

module.exports = {
  PORT: process.env.PORT || 3000,
  API_PREFIX: '/api/v1',
  CAMPUS: {
    name: 'Indian Institute of Technology Patna',
    code: 'IITP',
    location: 'Bihta, Patna, Bihar 801106',
    convenienceFee: 5,
    subscriptionMonthlyFee: 49,
    vendorCommissionPct: 3.5,
    averageBreakMinutesSavedPerOrder: 18
  },
  QUEUE: {
    defaultBasePrepTimeMinutes: 12,
    categoryWeights: {
      cat_mushrooms: 1.1,
      cat_tandoor: 1.3,
      cat_paneer: 1.0,
      cat_chicken: 1.2,
      cat_rolls: 0.7,
      cat_rice_biryani: 0.8,
      cat_chinese: 0.7,
      cat_egg: 0.6,
      cat_chowmein: 0.6,
      cat_thali: 0.9,
      cat_beverages: 0.4,
      cat_sweets: 0.3,
      default: 0.8
    },
    congestionThresholds: {
      LOW: { maxOrders: 4, maxMinutes: 10, label: 'Fast - Grab Quickly', color: '#10b981' },
      MODERATE: { maxOrders: 12, maxMinutes: 18, label: 'Moderate Rush', color: '#eab308' },
      HIGH: { maxOrders: 25, maxMinutes: 30, label: 'Peak Rush - Pre-order Ahead', color: '#f97316' },
      CONGESTED: { maxOrders: 999, maxMinutes: 999, label: 'Heavy Queue - Consider Other Outlets', color: '#ef4444' }
    }
  },
  SEEDS_PATH: (function() {
    const c1 = path.resolve(__dirname, '../../../../data/outlets/arya_services_menu.json');
    if (fs.existsSync(c1)) return c1;
    const c2 = path.resolve(__dirname, '../database/seeds/arya_services_menu.json');
    if (fs.existsSync(c2)) return c2;
    return c1;
  })()
};
