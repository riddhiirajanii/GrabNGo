const test = require('node:test');
const assert = require('node:assert/strict');
const queueEstimator = require('./apps/backend/src/modules/queue_estimator/queue_estimator.service');

function order(id, token, status, outletId = 'outlet-a', placedAt = '2026-01-01T10:00:00.000Z', items = []) {
  return { id, token, status, outletId, placedAt, items };
}

test('orders are ranked by numeric outlet token sequence, not placement timestamp', () => {
  const positions = queueEstimator.calculateQueuePositions([
    order('later-token', 'A-102', 'PLACED', 'outlet-a', '2026-01-01T09:00:00.000Z'),
    order('first-token', 'A-100', 'PREPARING', 'outlet-a', '2026-01-01T10:00:00.000Z'),
    order('middle-token', 'A-101', 'CONFIRMED', 'outlet-a', '2026-01-01T08:00:00.000Z')
  ], 'outlet-a');

  assert.deepEqual(positions.get('first-token'), { position: 1, ordersAhead: 0 });
  assert.deepEqual(positions.get('middle-token'), { position: 2, ordersAhead: 1 });
  assert.deepEqual(positions.get('later-token'), { position: 3, ordersAhead: 2 });
});

test('positions recalculate when earlier orders become ready or completed', () => {
  const orders = [
    order('first', 'A-100', 'PREPARING'),
    order('second', 'A-101', 'PLACED'),
    order('third', 'A-102', 'PLACED')
  ];

  orders[0].status = 'READY_FOR_PICKUP';
  let positions = queueEstimator.calculateQueuePositions(orders, 'outlet-a');
  assert.equal(positions.has('first'), false);
  assert.deepEqual(positions.get('second'), { position: 1, ordersAhead: 0 });
  assert.deepEqual(positions.get('third'), { position: 2, ordersAhead: 1 });

  orders[1].status = 'COMPLETED';
  positions = queueEstimator.calculateQueuePositions(orders, 'outlet-a');
  assert.deepEqual(positions.get('third'), { position: 1, ordersAhead: 0 });
});

test('outlets receive independent preparation queue positions', () => {
  const orders = [
    order('a-older', 'A-100', 'PLACED', 'outlet-a'),
    order('a-newer', 'A-101', 'PREPARING', 'outlet-a'),
    order('b-first', 'B-50', 'PLACED', 'outlet-b'),
    order('b-second', 'B-51', 'CONFIRMED', 'outlet-b')
  ];

  const outletA = queueEstimator.calculateQueuePositions(orders, 'outlet-a');
  const outletB = queueEstimator.calculateQueuePositions(orders, 'outlet-b');
  assert.equal(outletA.size, 2);
  assert.equal(outletB.size, 2);
  assert.deepEqual(outletA.get('a-older'), { position: 1, ordersAhead: 0 });
  assert.deepEqual(outletB.get('b-first'), { position: 1, ordersAhead: 0 });
  assert.equal(outletA.has('b-first'), false);
});

test('one order remains one queue entry regardless of its item count', () => {
  const positions = queueEstimator.calculateQueuePositions([
    order('multi-item-order', 'A-100', 'PLACED', 'outlet-a', undefined, Array.from({ length: 8 }, (_, index) => ({ id: index }))),
    order('next-order', 'A-101', 'PLACED')
  ], 'outlet-a');

  assert.equal(positions.size, 2);
  assert.deepEqual(positions.get('multi-item-order'), { position: 1, ordersAhead: 0 });
  assert.deepEqual(positions.get('next-order'), { position: 2, ordersAhead: 1 });
});
