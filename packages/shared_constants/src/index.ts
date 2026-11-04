/**
 * Grab n Go — Shared System Constants
 */

export const CAMPUS_DETAILS = {
  INSTITUTION: 'Indian Institute of Technology Patna (IIT Patna)',
  MAIN_CAMPUS_CODE: 'IITP',
  DEFAULT_OUTLETS: [
    { id: 'outlet-arya-services-01', name: 'Arya Services', tokenPrefix: 'A' },
    { id: 'outlet-angeethi-02', name: 'Angeethi Café', tokenPrefix: 'ANG' },
    { id: 'outlet-central-fc-03', name: 'Central Food Court Stall', tokenPrefix: 'FC' }
  ]
};

export const FEE_STRUCTURE = {
  DEFAULT_CONVENIENCE_FEE_INR: 5,
  SUBSCRIPTION_MONTHLY_FEE_INR: 49,
  VENDOR_COMMISSION_PERCENTAGE: 3.5
};

export const ORDER_STATUSES = {
  PLACED: 'PLACED',
  CONFIRMED: 'CONFIRMED',
  PREPARING: 'PREPARING',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED'
} as const;

export const QUEUE_LEVEL_THRESHOLDS = {
  LOW: { maxActiveOrders: 5, label: 'Fast (5-10 mins)' },
  MODERATE: { maxActiveOrders: 15, label: 'Normal (10-18 mins)' },
  BUSY: { maxActiveOrders: 30, label: 'High Rush (18-30 mins)' },
  SEVERELY_CONGESTED: { maxActiveOrders: 999, label: 'Congested (30+ mins)' }
};
