#!/usr/bin/env node
/**
 * One-time, repeatable import of the legacy JSON store into PostgreSQL.
 * JSON is a read-only migration source. The running application uses PostgreSQL.
 * Usage: node scripts/import-json-to-postgres.js [path-to-data-dir]
 */
const fs = require('fs');
const path = require('path');
const { encryptPickupPin } = require('../apps/backend/src/database/pickup_pin_crypto');

const envFile = path.resolve(__dirname, '../.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

const dataDir = path.resolve(process.argv[2] || process.env.GNG_DATA_DIR || path.join(__dirname, '../.data'));
process.env.GNG_DATA_DIR = dataDir;
const legacyStorePath = path.join(dataDir, 'grabngo.json');
const accountsPath = path.join(dataDir, 'auth_accounts.json');
const pinKeyHex = process.env.PICKUP_PIN_ENCRYPTION_KEY || '';

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function asDate(value, fallback = new Date()) {
  const d = value ? new Date(value) : fallback;
  return Number.isNaN(d.getTime()) ? fallback : d;
}
function encryptPin(pin) {
  return encryptPickupPin(pin);
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const prisma = require('../apps/backend/src/database/prisma');
  const legacy = readJson(legacyStorePath, {});
  const accounts = readJson(accountsPath, []);
  const outletsStore = require('../apps/backend/src/database/legacy_json_store');
  const outlets = outletsStore.getOutlets();
  const menus = outlets.map(outlet => ({ outletId: outlet.id, menu: outletsStore.getMenuByOutletId(outlet.id) })).filter(x => x.menu);
  const outOfStock = new Set(legacy.outOfStockItems || []);
  const orders = legacy.orders || [];
  const subscriptions = legacy.subscriptions || [];
  const feedback = legacy.feedback || [];

  if (orders.length && Buffer.from(pinKeyHex, 'hex').length !== 32) {
    throw new Error('Orders exist in the JSON store. Set PICKUP_PIN_ENCRYPTION_KEY to a random 32-byte (64 hex character) key before import.');
  }

  console.log(`[Import] Source: ${dataDir}`);
  console.log(`[Import] Outlets: ${outlets.length}; menus: ${menus.length}; orders: ${orders.length}; accounts: ${accounts.length}; feedback: ${feedback.length}`);
  console.log('[Import] JSON source is read-only; PostgreSQL is the application runtime store.');

  try {
    await prisma.$transaction(async tx => {
      for (const outlet of outlets) {
        await tx.outlet.upsert({
          where: { id: outlet.id },
          create: {
            id: outlet.id, name: outlet.name, subtitle: outlet.subtitle || '', campus: outlet.campus || 'IIT Patna',
            location: outlet.location, tokenPrefix: outlet.tokenPrefix, contacts: outlet.contacts || [],
            rating: Number(outlet.rating || 0), reviewCount: Number(outlet.reviewCount || 0),
            basePrepTime: Number(outlet.basePrepTime || 12), isAcceptingOrders: !!outlet.isAcceptingOrders,
            freeDelivery: !!outlet.freeDelivery, icon: outlet.icon || '🍽️', accentColor: outlet.accentColor || '#10b981',
            tags: outlet.tags || [], tokenCounter: Number((legacy.tokenCounters || {})[outlet.id] || 100),
            surgeMinutes: Number((legacy.outletSurgeMinutes || {})[outlet.id] || 0)
          },
          update: {
            name: outlet.name, subtitle: outlet.subtitle || '', campus: outlet.campus || 'IIT Patna', location: outlet.location,
            tokenPrefix: outlet.tokenPrefix, contacts: outlet.contacts || [], rating: Number(outlet.rating || 0),
            reviewCount: Number(outlet.reviewCount || 0), basePrepTime: Number(outlet.basePrepTime || 12),
            isAcceptingOrders: !!outlet.isAcceptingOrders, freeDelivery: !!outlet.freeDelivery,
            icon: outlet.icon || '🍽️', accentColor: outlet.accentColor || '#10b981', tags: outlet.tags || [],
            tokenCounter: Number((legacy.tokenCounters || {})[outlet.id] || 100),
            surgeMinutes: Number((legacy.outletSurgeMinutes || {})[outlet.id] || 0)
          }
        });
      }

      for (const { outletId, menu } of menus) {
        for (const [sortOrder, category] of menu.categories.entries()) {
          await tx.menuCategory.upsert({
            where: { id: category.id },
            create: { id: category.id, outletId, name: category.name, sortOrder },
            update: { outletId, name: category.name, sortOrder }
          });
          for (const item of category.items) {
            const unavailable = outOfStock.has(`${outletId}::${item.name}`);
            const price = Number.isFinite(Number(item.price)) ? Math.round(Number(item.price)) : null;
            const metadata = { ...item };
            delete metadata.id; delete metadata.outletId; delete metadata.categoryId;
            delete metadata.name; delete metadata.price; delete metadata.variants; delete metadata.is_veg;
            await tx.menuItem.upsert({
              where: { id: item.id },
              create: {
                id: item.id, outletId, categoryId: category.id, name: item.name,
                description: item.description || null, price, isVeg: item.is_veg !== false,
                isAvailable: !unavailable && item.isAvailable !== false, metadata: jsonSafe(metadata) || {}
              },
              update: {
                outletId, categoryId: category.id, name: item.name, description: item.description || null,
                price, isVeg: item.is_veg !== false, isAvailable: !unavailable && item.isAvailable !== false,
                metadata: jsonSafe(metadata) || {}
              }
            });
            await tx.menuItemVariant.deleteMany({ where: { menuItemId: item.id } });
            for (const variant of item.variants || []) {
              await tx.menuItemVariant.create({ data: { menuItemId: item.id, label: variant.label, price: Math.round(Number(variant.price)) } });
            }
          }
        }
      }

      for (const account of accounts) {
        const role = String(account.role || '').toUpperCase();
        if (!['VENDOR', 'ADMIN'].includes(role)) continue;
        await tx.user.upsert({
          where: { email: String(account.email).toLowerCase() },
          create: {
            id: account.id, role, email: String(account.email).toLowerCase(), name: account.name,
            outletId: account.outletId || null, passwordSalt: account.passwordSalt,
            passwordHash: account.passwordHash, disabled: !!account.disabled,
            createdAt: asDate(account.createdAt)
          },
          update: {
            name: account.name, outletId: account.outletId || null, passwordSalt: account.passwordSalt,
            passwordHash: account.passwordHash, disabled: !!account.disabled
          }
        });
      }

      for (const order of orders) {
        const pin = encryptPin(order.pickupPin);
        const placedAt = asDate(order.placedAt);
        const updatedAt = asDate(order.updatedAt, placedAt);
        const readyAt = order.readyAt ? asDate(order.readyAt) : null;
        const completedAt = order.completedAt ? asDate(order.completedAt) : null;
        const estimatedReadyAt = asDate(order.estimatedReadyAt, placedAt);
        const scheduledPickupTime = order.scheduledPickupTime ? asDate(order.scheduledPickupTime) : null;
        await tx.order.upsert({
          where: { id: order.id },
          create: {
            id: order.id, token: order.token, ...pin, outletId: order.outletId,
            studentName: order.studentName, studentRoll: String(order.studentRoll || '').toUpperCase(),
            studentPhone: order.studentPhone || '', status: order.status, subtotal: Math.round(Number(order.subtotal || 0)),
            convenienceFee: Math.round(Number(order.convenienceFee || 0)), discount: Math.round(Number(order.discount || 0)),
            total: Math.round(Number(order.total || 0)), hasPassApplied: !!order.hasPassApplied,
            paymentMethod: order.paymentMethod || 'CASH_ON_PICKUP', paymentStatus: order.paymentStatus || 'DUE_ON_PICKUP',
            academicBreakSlot: order.academicBreakSlot || 'instant', scheduledPickupTime, estimatedReadyAt,
            estimatedMinutes: Number(order.estimatedMinutes || 0), placedAt, updatedAt, readyAt, completedAt,
            notes: order.notes || '', queueSnapshot: jsonSafe(order.queueSnapshot) || {}, itemsSnapshot: jsonSafe(order.items || [])
          },
          update: {
            token: order.token, ...pin, outletId: order.outletId, studentName: order.studentName,
            studentRoll: String(order.studentRoll || '').toUpperCase(), studentPhone: order.studentPhone || '',
            status: order.status, subtotal: Math.round(Number(order.subtotal || 0)),
            convenienceFee: Math.round(Number(order.convenienceFee || 0)), discount: Math.round(Number(order.discount || 0)),
            total: Math.round(Number(order.total || 0)), paymentStatus: order.paymentStatus || 'DUE_ON_PICKUP',
            estimatedReadyAt, estimatedMinutes: Number(order.estimatedMinutes || 0), updatedAt, readyAt, completedAt,
            notes: order.notes || '', queueSnapshot: jsonSafe(order.queueSnapshot) || {}, itemsSnapshot: jsonSafe(order.items || [])
          }
        });
        await tx.orderItem.deleteMany({ where: { orderId: order.id } });
        for (const item of order.items || []) {
          await tx.orderItem.create({ data: {
            orderId: order.id, name: item.name, variant: item.variant || null,
            quantity: Number(item.qty || item.quantity || 1), unitPrice: Math.round(Number(item.price || 0)),
            categoryId: item.categoryId || null
          }});
        }
        const historyCount = await tx.orderStatusHistory.count({ where: { orderId: order.id } });
        if (!historyCount) await tx.orderStatusHistory.create({ data: { orderId: order.id, toStatus: order.status || 'PLACED', actorRole: 'LEGACY_IMPORT', createdAt: placedAt } });
      }

      for (const [studentRoll, subscription] of subscriptions) {
        await tx.subscription.upsert({
          where: { studentRoll },
          create: { studentRoll, plan: subscription.plan, activeUntil: asDate(subscription.activeUntil), status: subscription.status, createdAt: asDate(subscription.createdAt) },
          update: { plan: subscription.plan, activeUntil: asDate(subscription.activeUntil), status: subscription.status }
        });
      }
      for (const entry of feedback) {
        await tx.feedback.upsert({
          where: { id: entry.id },
          create: { id: entry.id, studentRoll: entry.studentRoll, category: entry.category || 'general', message: entry.message, createdAt: asDate(entry.createdAt) },
          update: { category: entry.category || 'general', message: entry.message }
        });
      }
    }, { timeout: 120000, maxWait: 20000 });

    const [outletCount, itemCount, orderCount, userCount, feedbackCount] = await Promise.all([
      prisma.outlet.count(), prisma.menuItem.count(), prisma.order.count(), prisma.user.count(), prisma.feedback.count()
    ]);
    console.log('[Import] Complete. Current database totals:');
    console.log({ outletCount, itemCount, orderCount, userCount, feedbackCount });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('[Import] Failed:', error.message);
  process.exitCode = 1;
});
