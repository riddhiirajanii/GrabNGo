const { successResponse, errorResponse, parseJsonBody } = require('./common/utils/response');
const outlets = require('./modules/outlets/outlets.service');
const menu = require('./modules/menu/menu.service');
const orders = require('./modules/orders/orders.service');
const analytics = require('./modules/analytics/analytics.service');
const auth = require('./modules/auth/auth.service');
const prisma = require('./database/prisma');

class ApiRouter {
  async handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;
    const method = req.method.toUpperCase();

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key'
      });
      return res.end();
    }

    try {
      if (p === '/api/v1/health' && method === 'GET') {
        await prisma.$queryRaw`SELECT 1`;
        return successResponse(res, { status: 'UP', database: 'CONNECTED', service: 'Grab n Go API', timestamp: new Date().toISOString() });
      }

      const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const actor = auth.verify(bearer);

      if (p === '/api/v1/auth/otp/request' && method === 'POST') {
        const body = await parseJsonBody(req);
        const result = await auth.requestStudentOtp(body, req.socket?.remoteAddress || 'unknown');
        return successResponse(res, result, 'Verification code sent to your IITP email.');
      }
      if (p === '/api/v1/auth/otp/verify' && method === 'POST') {
        const body = await parseJsonBody(req);
        const result = await auth.verifyStudentOtp(body);
        return successResponse(res, result, 'IITP email verified. Signed in successfully.');
      }
      if (p === '/api/v1/auth/me' && method === 'GET') {
        if (!actor || actor.role !== 'student' || !actor.emailVerified) return errorResponse(res, 'Student sign-in required', 401);
        return successResponse(res, { user: { name: actor.name, roll: actor.sub, email: actor.email, institution: 'IIT Patna', verificationStatus: 'IITP_EMAIL_VERIFIED' } });
      }

      if (p === '/api/v1/vendor/auth/login' && method === 'POST') {
        const body = await parseJsonBody(req);
        const result = await auth.loginAccount(body, 'vendor');
        const outlet = await outlets.getOutletById(result.session.outletId);
        if (!outlet) return errorResponse(res, 'Assigned outlet was not found', 403);
        result.session.outletName = outlet.name;
        return successResponse(res, result, 'Vendor signed in successfully.');
      }
      if (p === '/api/v1/vendor/auth/me' && method === 'GET') {
        if (!actor || actor.role !== 'vendor') return errorResponse(res, 'Vendor sign-in required', 401);
        const outlet = await outlets.getOutletById(actor.outletId);
        if (!outlet) return errorResponse(res, 'Assigned outlet no longer exists', 403);
        return successResponse(res, { session: { email: actor.email, name: actor.name, outletId: outlet.id, outletName: outlet.name, staffRole: 'Outlet Staff' } });
      }
      if (p === '/api/v1/admin/auth/login' && method === 'POST') {
        const body = await parseJsonBody(req);
        return successResponse(res, await auth.loginAccount(body, 'admin'), 'Administrator signed in successfully.');
      }
      if (p === '/api/v1/admin/auth/me' && method === 'GET') {
        if (!actor || actor.role !== 'admin') return errorResponse(res, 'Administrator sign-in required', 401);
        return successResponse(res, { session: { email: actor.email, name: actor.name, officerName: actor.name, role: 'admin' } });
      }

      if (p === '/api/v1/outlets' && method === 'GET') return successResponse(res, await outlets.getAllOutlets());

      let match = p.match(/^\/api\/v1\/outlets\/([^/]+)\/menu$/);
      if (match && method === 'GET') {
        const data = await menu.getMenuByOutletId(match[1]);
        return data ? successResponse(res, data) : errorResponse(res, 'Menu not found', 404);
      }

      match = p.match(/^\/api\/v1\/outlets\/([^/]+)\/stock$/);
      if (match && (method === 'PATCH' || method === 'POST')) {
        if (!actor || actor.role !== 'vendor') return errorResponse(res, 'Vendor sign-in required', 401);
        if (actor.outletId !== match[1]) return errorResponse(res, 'Cannot manage another outlet', 403);
        const body = await parseJsonBody(req);
        if (!body.itemName) return errorResponse(res, 'itemName is required', 400);
        return successResponse(res, await menu.toggleItemAvailability(match[1], body.itemName, !!body.isAvailable));
      }

      match = p.match(/^\/api\/v1\/outlets\/([^/]+)\/surge$/);
      if (match && method === 'POST') {
        if (!actor || actor.role !== 'vendor') return errorResponse(res, 'Vendor sign-in required', 401);
        if (actor.outletId !== match[1]) return errorResponse(res, 'Cannot manage another outlet', 403);
        const body = await parseJsonBody(req);
        return successResponse(res, await outlets.setRushSurge(match[1], body.surgeMinutes));
      }

      match = p.match(/^\/api\/v1\/outlets\/([^/]+)$/);
      if (match && method === 'GET') {
        const data = await outlets.getOutletById(match[1]);
        return data ? successResponse(res, data) : errorResponse(res, 'Outlet not found', 404);
      }

      if (p === '/api/v1/orders/quote' && method === 'POST') {
        if (!actor || actor.role !== 'student') return errorResponse(res, 'Student sign-in required before checkout', 401);
        const body = await parseJsonBody(req);
        return successResponse(res, await orders.quoteOrder({ ...body, studentRoll: actor.sub }));
      }
      if (p === '/api/v1/orders' && method === 'POST') {
        if (!actor || actor.role !== 'student') return errorResponse(res, 'Student sign-in required before placing an order', 401);
        const body = await parseJsonBody(req);
        const order = await orders.createOrder({ ...body, studentName: actor.name, studentRoll: actor.sub });
        const { pickupPin, ...studentOrder } = order;
        return successResponse(res, studentOrder, 'Order placed. Payment is due at pickup.', 201);
      }
      if (p === '/api/v1/orders' && method === 'GET') {
        if (!actor || actor.role !== 'student') return errorResponse(res, 'Student sign-in required to view order history', 401);
        return successResponse(res, await orders.getOrders({
          outletId: url.searchParams.get('outletId'),
          status: url.searchParams.get('status'),
          studentRoll: actor.sub
        }));
      }
      if (p === '/api/v1/vendor/orders' && method === 'GET') {
        if (!actor || actor.role !== 'vendor') return errorResponse(res, 'Vendor sign-in required to view kitchen orders', 401);
        const requestedOutlet = url.searchParams.get('outletId');
        if (requestedOutlet && requestedOutlet !== actor.outletId) return errorResponse(res, 'Vendor session cannot access another outlet', 403);
        const data = (await orders.getOrders({ outletId: actor.outletId, status: url.searchParams.get('status') }))
          .map(({ pickupPin, ...order }) => order);
        return successResponse(res, data);
      }

      match = p.match(/^\/api\/v1\/orders\/([^/]+)\/track$/);
      if (match && method === 'GET') {
        if (!actor || actor.role !== 'student') return errorResponse(res, 'Student sign-in required to track this order', 401);
        const data = await orders.trackOrder(match[1]);
        if (!data) return errorResponse(res, 'Order not found', 404);
        if (actor.sub !== String(data.studentRoll || '').toUpperCase()) return errorResponse(res, 'Forbidden', 403);
        return successResponse(res, data);
      }

      match = p.match(/^\/api\/v1\/vendor\/orders\/([^/]+)\/status$/);
      if (match && (method === 'PATCH' || method === 'POST')) {
        if (!actor || actor.role !== 'vendor') return errorResponse(res, 'Vendor sign-in required', 401);
        const order = await orders.getOrderById(match[1]);
        if (!order) return errorResponse(res, 'Order not found', 404);
        if (order.outletId !== actor.outletId) return errorResponse(res, 'Cannot update an order for another outlet', 403);
        const body = await parseJsonBody(req);
        const updated = await orders.updateStatus(match[1], body.status, body.pickupPin, actor.role.toUpperCase());
        if (!updated) return errorResponse(res, 'Order not found', 404);
        const { pickupPin, ...safeOrder } = updated;
        return successResponse(res, safeOrder);
      }

      match = p.match(/^\/api\/v1\/orders\/([^/]+)$/);
      if (match && method === 'GET') {
        if (!actor || actor.role !== 'student') return errorResponse(res, 'Student sign-in required to view this order', 401);
        const data = await orders.getOrderById(match[1]);
        if (!data) return errorResponse(res, 'Order not found', 404);
        if (actor.sub !== String(data.studentRoll || '').toUpperCase()) return errorResponse(res, 'Forbidden', 403);
        return successResponse(res, data);
      }

      if (p === '/api/v1/subscriptions' && method === 'GET') {
        if (!actor || actor.role !== 'student') return errorResponse(res, 'Student sign-in required', 401);
        return successResponse(res, { status: 'UNAVAILABLE', active: false });
      }
      if (p === '/api/v1/subscriptions' && method === 'POST') {
        return errorResponse(res, 'Student Pass activation is unavailable until payment processing is configured.', 503);
      }

      if (p === '/api/v1/feedback' && method === 'POST') {
        if (!actor || actor.role !== 'student') return errorResponse(res, 'Student sign-in required to submit feedback', 401);
        const body = await parseJsonBody(req);
        if (!body.message || !String(body.message).trim()) return errorResponse(res, 'Feedback message is required', 400);
        const item = await prisma.feedback.create({
          data: {
            id: require('crypto').randomUUID(), studentRoll: actor.sub,
            category: String(body.category || 'general'),
            message: String(body.message).trim().slice(0, 2000),
            createdAt: new Date()
          }
        });
        return successResponse(res, { id: item.id }, 'Feedback received', 201);
      }

      if (p === '/api/v1/admin/analytics' && method === 'GET') {
        if (!actor || actor.role !== 'admin') return errorResponse(res, 'Administrator sign-in required', 401);
        return successResponse(res, await analytics.getCampusAnalytics());
      }
      return errorResponse(res, `API route not found: ${method} ${p}`, 404);
    } catch (error) {
      console.error('[API]', error);
      const status = error.statusCode || (
        /required|valid|not found|unavailable|choose|active|unsupported|must contain|quantity|payment|incorrect|expired|invalid order transition|currently unavailable/i.test(error.message)
          ? 400 : 500
      );
      return errorResponse(res, error.message || 'Internal server error', status);
    }
  }
}
module.exports = new ApiRouter();
