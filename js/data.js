/**
 * Grab n Go — Campus Food Court Shared Dataset
 * Conceived for Indian Institute of Technology Patna (IIT Patna)
 * Conceived by Team H
 */

const CAMPUS_CONFIG = {
  institution: 'Indian Institute of Technology Patna (IIT Patna)',
  code: 'IITP',
  foodCourtLocations: [
    'Food Court Ground Floor (Central Stall)',
    'Discovery Foods'
  ],
  defaultConvenienceFee: 5,
  subscriptionMonthlyFee: 49,
  vendorCommissionPct: 3.5,
  academicBreaks: [
    { id: 'instant', label: '⚡ Next Available (~12-15 mins)', sub: 'Fastest pickup' },
    { id: 'lunch_a', label: '🕒 1:15 PM (Lunch Break Batch A)', sub: 'Post CSE/Mech classes' },
    { id: 'lunch_b', label: '🕒 1:30 PM (Lunch Break Batch B)', sub: 'Post ECE/Civil classes' },
    { id: 'evening_snack', label: '🕒 5:15 PM (Post-Lab Evening Snack)', sub: 'Tea & quick bites' },
    { id: 'dinner_rush', label: '🕒 8:30 PM (Hostel Dinner Pickup)', sub: 'Hot fresh dinner' }
  ]
};

const CAMPUS_OUTLETS = [
  {
    id: 'outlet-arya-services-01',
    name: 'Arya Services',
    subtitle: 'North Indian, Tandoor, Chinese & Traditional Sweets',
    location: 'Food Court',
    tokenPrefix: 'A',
    contacts: ['9835493001', '9572544000'],
    rating: 4.4,
    reviewCount: 1240,
    basePrepTime: 14,
    queueStatus: 'MODERATE',
    activeOrderCount: 8,
    isAcceptingOrders: true,
    freeDelivery: true,
    icon: '🍛',
    accentColor: '#10b981',
    tags: ['Bestseller', 'Tandoor Special', 'Late Night', 'Express Counter Available']
  },
  {
    id: 'outlet-discoveryfoods',
    name: 'Discovery Foods',
    subtitle: 'Biryanis, Kati Rolls, Shakes & Chai',
    location: 'Food Court',
    tokenPrefix: 'ANG',
    contacts: ['9835123456'],
    rating: 4.5,
    reviewCount: 890,
    basePrepTime: 18,
    queueStatus: 'BUSY',
    activeOrderCount: 15,
    isAcceptingOrders: true,
    freeDelivery: false,
    icon: '🍢',
    accentColor: '#f59e0b',
    tags: ['Student Favorite', 'Evening Hangout', 'Kati Rolls']
  }
];

const ARYA_SERVICES_MENU = []; // Live menu is loaded from /api/v1/outlets/:id/menu.


const INITIAL_KDS_ORDERS = []; // KDS orders must come from the backend API.


const TEAM_MEMBERS = [
  { name: 'Priyansh Kataria', roll: '2401AI13', dept: 'AIDS', role: 'AI & Queue Modeling' },
  { name: 'Ruthvik Reddy', roll: '2401CS02', dept: 'CS', role: 'Full Stack & System Architecture' },
  { name: 'Tushar Bharti', roll: '2401PH03', dept: 'PH', role: 'Operations & User Research' },
  { name: 'Kavya Mahajan', roll: '2402VL05', dept: 'ECE', role: 'Product Design & Frontend' },
  { name: 'Riddhi Umesh Rajani', roll: '2401ME75', dept: 'ME', role: 'Strategy & Project Coordination' },
  { name: 'Rudranshu Mishra', roll: '2403EC02', dept: 'ECE', role: 'Embedded Systems & Token Display' },
  { name: 'Vaibhav', roll: '2401CB29', dept: 'CBE', role: 'Vendor Relations & Logistics' }
];

const LEAN_CANVAS_ITEMS = [
  {
    title: '1. Problem',
    tag: 'Pain Points',
    color: '#ef4444',
    icon: '⚠️',
    points: [
      'Unpredictable 20-30 min counter queues during peak lunch & evening break times at IIT Patna.',
      'High rate of verbal order mix-ups and missing items in noisy food court counters.',
      'Students have zero advance visibility of crowd density before physically walking to outlets.',
      'Existing alternatives: Waiting in slow physical lines or calling busy vendor phones.'
    ]
  },
  {
    title: '2. Customer Segments',
    tag: 'Users & Buyers',
    color: '#3b82f6',
    icon: '👥',
    points: [
      'Primary: 3,500+ IIT Patna undergraduate, postgraduate & PhD students on tight break schedules.',
      'Secondary: Campus faculty, project staff, and residential community.',
      'Partners: Campus dining outlets (Arya Services, Angeethi Café, Nescafe, Central Food Court).'
    ]
  },
  {
    title: '3. Unique Value Proposition',
    tag: 'Core Value',
    color: '#10b981',
    icon: '💎',
    points: [
      '"Order Smart. Track Live. Save Time."',
      'Unified campus pre-ordering with live queue congestion meters, exact prep countdowns, and unique pickup tokens (#A-104) for zero-wait express pickup.'
    ]
  },
  {
    title: '4. Solution',
    tag: 'Features',
    color: '#8b5cf6',
    icon: '🚀',
    points: [
      'Advance pre-ordering aligned with academic break slots.',
      'Dynamic queue estimation model factoring backlog complexity.',
      'Anti-collision alphanumeric token verification at express pickup counter.',
      'Vendor KDS tablet app for single-tap cooking and ready alerts.'
    ]
  },
  {
    title: '5. Channels',
    tag: 'Distribution',
    color: '#06b6d4',
    icon: '📢',
    points: [
      'IIT Patna student WhatsApp, Telegram, and Discord batch groups.',
      'Table-top QR codes and standees placed at Arya Services & food court tables.',
      'Campus Gymkhana and Student Council endorsement.',
      'Direct vendor integration & co-branding.'
    ]
  },
  {
    title: '6. Revenue Streams',
    tag: 'Monetization',
    color: '#14b8a6',
    icon: '💰',
    points: [
      'Nominal convenience fee: ₹5 per pre-order (waived with Pass).',
      'Grab n Go Pass: ₹49/month student subscription for unlimited free express orders.',
      'Vendor partnership micro-commission: 3.5% on incremental orders.'
    ]
  },
  {
    title: '7. Cost Structure',
    tag: 'Expenditure',
    color: '#f59e0b',
    icon: '📊',
    points: [
      'Cloud hosting, PostgreSQL database, and WebSocket infrastructure.',
      'UPI / Payment gateway processing fees (Razorpay / campus merchant rate).',
      'Vendor tablet mounting hardware & pickup counter standees.',
      'Maintenance and customer support.'
    ]
  },
  {
    title: '8. Key Metrics',
    tag: 'KPIs',
    color: '#ec4899',
    icon: '📈',
    points: [
      'Average Break Time Saved (Target: 18 mins saved per order).',
      'Daily Active Students (DAS) and pre-order volume.',
      'Zero-Error Handover Rate (Target: >99.5% correct orders).',
      'Vendor kitchen throughput during 12:45 PM – 2:00 PM rush.'
    ]
  },
  {
    title: '9. Unfair Advantage',
    tag: 'Moat',
    color: '#6366f1',
    icon: '🛡️',
    points: [
      'Direct on-ground access to IIT Patna student body and academic timetables.',
      'First-party relationships with campus vendors (Arya Services, Angeethi Café).',
      'Tailored express counter workflow designed specifically for campus food courts.'
    ]
  }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CAMPUS_CONFIG,
    CAMPUS_OUTLETS,
    ARYA_SERVICES_MENU,
    INITIAL_KDS_ORDERS,
    TEAM_MEMBERS,
    LEAN_CANVAS_ITEMS
  };
}
