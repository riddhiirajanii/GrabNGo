/**
 * Grab n Go — Core Shared Domain Models & Types
 * Reflects IIT Patna Smart Food Court business requirements
 */

export type CampusLocation = 'Food Court' | 'Angeethi Café' | 'Nescafe' | 'Campus Hostel Block';

export type QueueCongestionLevel = 'LOW' | 'MODERATE' | 'BUSY' | 'SEVERELY_CONGESTED';

export type OrderStatus =
  | 'PLACED'             // Order submitted by student
  | 'CONFIRMED'          // Accepted by vendor
  | 'PREPARING'          // Kitchen is cooking/assembling
  | 'READY_FOR_PICKUP'   // Waiting at express pickup counter
  | 'COMPLETED'          // Picked up by student
  | 'CANCELLED';

export interface Outlet {
  id: string;
  name: string;
  campusLocation: CampusLocation;
  contactNumbers: string[];
  isAcceptingOrders: boolean;
  freeDeliveryAvailable: boolean;
  averagePrepTimeMinutes: number;
  currentQueueLength: number;
  congestionLevel: QueueCongestionLevel;
  openingTime: string;
  closingTime: string;
}

export interface MenuItemVariant {
  id: string;
  label: string; // e.g. "Half", "Full", "Regular", "Large"
  price: number;
}

export interface MenuItem {
  id: string;
  outletId: string;
  categoryId: string;
  name: string;
  description?: string;
  price?: number; // Base price if no variants
  variants?: MenuItemVariant[];
  isVeg: boolean;
  isAvailable: boolean;
  estimatedPrepTimeMinutes: number;
}

export interface MenuCategory {
  id: string;
  outletId: string;
  name: string; // e.g. "Mushrooms", "Tandoor", "Paneer & Veg Sabzi"
  displayOrder: number;
  items: MenuItem[];
}

export interface OrderItem {
  menuItemId: string;
  name: string;
  selectedVariant?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  specialInstructions?: string;
}

export interface Order {
  id: string;
  outletId: string;
  outletName: string;
  studentId: string;
  studentName: string;
  studentEmail: string; // @iitp.ac.in
  studentPhone: string;
  pickupToken: string; // e.g. "A-104" (prevents mix-ups)
  items: OrderItem[];
  subtotal: number;
  convenienceFee: number;
  discount: number;
  totalAmount: number;
  status: OrderStatus;
  estimatedPickupTime: string; // ISO 8601 Timestamp
  actualReadyTime?: string;
  actualCollectedTime?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudentSubscription {
  studentId: string;
  planName: 'Grab n Go Pass';
  status: 'ACTIVE' | 'EXPIRED';
  validUntil: string;
  zeroConvenienceFee: boolean;
}
