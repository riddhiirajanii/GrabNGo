/**
 * Grab n Go integration tests.
 * Uses provisioned local test accounts and signed sessions. No demo bypass exists.
 */
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.JWT_SECRET = 'integration-test-secret-which-is-longer-than-32-chars';
process.env.GNG_DATA_DIR = path.join(os.tmpdir(), `grabngo-test-${process.pid}`);

const server = require('./server');
const auth = require('./apps/backend/src/modules/auth/auth.service');
const TEST_PORT = 3099;

function request(route, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = http.request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: route,
      method,
      headers
    }, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

server.listen(TEST_PORT, async () => {
  try {
    const health = await request('/api/v1/health');
    if (health.status !== 200) throw new Error('Health endpoint failed');
    console.log('PASS health');

    const sourceLeak = await request('/apps/backend/src/api_router.js');
    const scriptLeak = await request('/scripts/create-account.js');
    const packageLeak = await request('/package.json');
    if (sourceLeak.status !== 404 || scriptLeak.status !== 404 || packageLeak.status !== 404) {
      throw new Error('Private backend/project files must not be served as static assets');
    }
    console.log('PASS static file allowlist protects backend and project files');

    const studentPage = await request('/');
    const vendorPage = await request('/vendor');
    const adminPage = await request('/admin');
    if (studentPage.status !== 200 || vendorPage.status !== 200 || adminPage.status !== 200) {
      throw new Error('Student, vendor and admin pages must all be served');
    }
    console.log('PASS student, vendor and admin web entry points');

    const demoStudent = await request('/api/v1/auth/login', 'POST', {
      name: 'Fake User', studentRoll: '2401ME75'
    });
    if (demoStudent.status !== 404) throw new Error('Legacy demo student login must be removed');
    console.log('PASS legacy student demo login removed');

    const vendorDemo = await request('/api/v1/vendor/auth/demo', 'POST', {
      outletId: 'outlet-arya-services-01'
    });
    if (vendorDemo.status !== 404) throw new Error('Legacy vendor demo login must be removed');
    console.log('PASS legacy vendor demo login removed');

    // Ensure a developer's local .env cannot make this fail-closed test send real mail.
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;

    const otpWithoutMail = await request('/api/v1/auth/otp/request', 'POST', {
      name: 'Integration Test Student',
      studentRoll: '2401ME75',
      email: 'student@iitp.ac.in'
    });
    if (otpWithoutMail.status !== 503) throw new Error('Student OTP must fail closed when SMTP is not configured');
    console.log('PASS student authentication fails closed without SMTP');

    // Exercise the OTP API using a mocked SMTP transport. The production code
    // still requires a real configured SMTP relay to deliver the message.
    const Module = require('module');
    const originalLoad = Module._load;
    let capturedOtpMail = null;
    Module._load = function(requestName, parent, isMain) {
      if (requestName === 'nodemailer') {
        return {
          createTransport: () => ({
            sendMail: async mail => { capturedOtpMail = mail; return { messageId: 'test-message' }; }
          })
        };
      }
      return originalLoad.call(this, requestName, parent, isMain);
    };
    process.env.SMTP_HOST = 'smtp.test.invalid';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'test-smtp-user';
    process.env.SMTP_PASS = 'test-smtp-password';
    process.env.SMTP_FROM = 'Grab n Go Test <no-reply@iitp.ac.in>';

    const otpRequest = await request('/api/v1/auth/otp/request', 'POST', {
      name: 'Integration Test Student',
      studentRoll: '2401ME75',
      email: 'test.student@iitp.ac.in'
    });
    if (otpRequest.status !== 200 || !capturedOtpMail) throw new Error('Student OTP request failed');
    const otpMatch = capturedOtpMail.text.match(/code is (\d{6})/);
    if (!otpMatch) throw new Error('OTP email did not contain a six-digit code');

    const otpVerify = await request('/api/v1/auth/otp/verify', 'POST', {
      email: 'test.student@iitp.ac.in',
      otp: otpMatch[1]
    });
    Module._load = originalLoad;
    if (otpVerify.status !== 200 || !otpVerify.body.data?.token) {
      throw new Error(`Student OTP verification failed: ${JSON.stringify(otpVerify.body)}`);
    }
    const token = otpVerify.body.data.token;
    console.log('PASS institutional email OTP request and verification');

    const noStudent = await request('/api/v1/orders', 'POST', {
      outletId: 'outlet-arya-services-01',
      items: [{ name: 'Mushroom Butter Masala', qty: 1 }]
    });
    if (noStudent.status !== 401) throw new Error('Anonymous order should be rejected');
    console.log('PASS unauthenticated order rejection');

    const studentToken = token;
    const studentMe = await request('/api/v1/auth/me', 'GET', null, studentToken);
    if (studentMe.status !== 200 || studentMe.body.data.user.roll !== '2401ME75') {
      throw new Error('Student session validation failed');
    }
    console.log('PASS signed student session');

    const outletId = 'outlet-arya-services-01';
    const outlets = await request('/api/v1/outlets');
    if (outlets.status !== 200 || !outlets.body.data.length) throw new Error('Outlets failed');
    console.log('PASS outlet catalogue');

    const menu = await request(`/api/v1/outlets/${outletId}/menu`);
    if (menu.status !== 200 || !menu.body.data.categories.length) throw new Error('Menu failed');
    console.log('PASS live menu');

    await auth.createAccount({
      role: 'vendor',
      email: 'counter.test@example.org',
      name: 'Test Counter Staff',
      password: 'integration-test-vendor-password',
      outletId
    });
    const vendorLogin = await request('/api/v1/vendor/auth/login', 'POST', {
      email: 'counter.test@example.org',
      password: 'integration-test-vendor-password'
    });
    if (vendorLogin.status !== 200 || !vendorLogin.body.data.token) throw new Error('Vendor password login failed');
    const vendorToken = vendorLogin.body.data.token;
    console.log('PASS provisioned vendor password authentication');

    const wrongVendor = await request('/api/v1/vendor/auth/login', 'POST', {
      email: 'counter.test@example.org',
      password: 'wrong-password'
    });
    if (wrongVendor.status !== 401) throw new Error('Wrong vendor password should fail');
    console.log('PASS invalid vendor credentials rejected');

    const vendorFeed = await request(`/api/v1/vendor/orders?outletId=${outletId}`, 'GET', null, vendorToken);
    if (vendorFeed.status !== 200 || !Array.isArray(vendorFeed.body.data)) throw new Error('Vendor order feed failed');
    console.log('PASS outlet-scoped vendor order feed');

    const vendorIsolation = await request('/api/v1/vendor/orders?outletId=other-outlet', 'GET', null, vendorToken);
    if (vendorIsolation.status !== 403) throw new Error('Vendor outlet isolation failed');
    console.log('PASS vendor outlet isolation');

    const stockOff = await request(`/api/v1/outlets/${outletId}/stock`, 'PATCH', {
      itemName: 'Mushroom Butter Masala',
      isAvailable: false
    }, vendorToken);
    if (stockOff.status !== 200 || stockOff.body.data.isAvailable !== false) {
      throw new Error('Vendor stock update failed');
    }
    const unavailableQuote = await request('/api/v1/orders/quote', 'POST', {
      outletId,
      items: [{ name: 'Mushroom Butter Masala', qty: 1 }]
    }, studentToken);
    if (unavailableQuote.status !== 400) throw new Error('Out-of-stock items must not be orderable');

    const stockOn = await request(`/api/v1/outlets/${outletId}/stock`, 'PATCH', {
      itemName: 'Mushroom Butter Masala',
      isAvailable: true
    }, vendorToken);
    if (stockOn.status !== 200 || stockOn.body.data.isAvailable !== true) {
      throw new Error('Vendor restock failed');
    }

    const surge = await request(`/api/v1/outlets/${outletId}/surge`, 'POST', {
      surgeMinutes: 8
    }, vendorToken);
    if (surge.status !== 200 || surge.body.data.surgeMinutes !== 8) {
      throw new Error('Vendor rush mode update failed');
    }
    await request(`/api/v1/outlets/${outletId}/surge`, 'POST', { surgeMinutes: 0 }, vendorToken);
    console.log('PASS authenticated outlet stock and rush controls');

    const quote = await request('/api/v1/orders/quote', 'POST', {
      outletId,
      items: [{ name: 'Mushroom Butter Masala', qty: 1 }]
    }, studentToken);
    if (quote.status !== 200) throw new Error(`Quote failed: ${JSON.stringify(quote.body)}`);
    console.log('PASS server-side checkout quote');

    const orderResponse = await request('/api/v1/orders', 'POST', {
      outletId,
      studentPhone: '9999999999',
      academicBreakSlot: 'instant',
      paymentMethod: 'ONLINE',
      items: [{ name: 'Mushroom Butter Masala', qty: 1, price: 1 }]
    }, studentToken);
    if (orderResponse.status !== 201) throw new Error(`Order creation failed: ${JSON.stringify(orderResponse.body)}`);
    const order = orderResponse.body.data;
    if (order.paymentStatus !== 'DUE_ON_PICKUP' || order.items[0].price !== 180 || order.total !== order.subtotal + order.convenienceFee) {
      throw new Error('Order pricing/payment state incorrect');
    }
    if (Object.prototype.hasOwnProperty.call(order, 'pickupPin')) {
      throw new Error('Order create response should not expose PIN outside tracking');
    }
    console.log('PASS order creation and cash-at-pickup payment gate');

    const secondOrderResponse = await request('/api/v1/orders', 'POST', {
      outletId,
      studentPhone: '9999999999',
      academicBreakSlot: 'instant',
      items: [{ name: 'Mushroom Butter Masala', qty: 1 }]
    }, studentToken);
    if (secondOrderResponse.status !== 201) throw new Error('Second concurrent order creation failed');
    const secondOrder = secondOrderResponse.body.data;
    const concurrentHistory = await request('/api/v1/orders', 'GET', null, studentToken);
    if (concurrentHistory.status !== 200 ||
        !concurrentHistory.body.data.some(item => item.id === order.id) ||
        !concurrentHistory.body.data.some(item => item.id === secondOrder.id)) {
      throw new Error('Student API must return multiple concurrent orders');
    }
    console.log('PASS multiple concurrent student orders');

    const skipToComplete = await request(`/api/v1/vendor/orders/${order.id}/status`, 'PATCH', {
      status: 'COMPLETED',
      pickupPin: '0000'
    }, vendorToken);
    if (skipToComplete.status !== 400) throw new Error('Order must not skip kitchen states or pickup-ready status');

    const preparing = await request(`/api/v1/vendor/orders/${order.id}/status`, 'PATCH', {
      status: 'PREPARING'
    }, vendorToken);
    if (preparing.status !== 200) throw new Error('PREPARING transition failed');
    const ready = await request(`/api/v1/vendor/orders/${order.id}/status`, 'PATCH', {
      status: 'READY_FOR_PICKUP'
    }, vendorToken);
    if (ready.status !== 200) throw new Error('READY transition failed');
    console.log('PASS valid KDS status transitions');

    const track = await request(`/api/v1/orders/${order.id}/track`, 'GET', null, studentToken);
    if (track.status !== 200 || !track.body.data.pickupPin) throw new Error('Student tracking/PIN failed');
    const pin = track.body.data.pickupPin;

    const vendorFeedAfter = await request(`/api/v1/vendor/orders?outletId=${outletId}`, 'GET', null, vendorToken);
    const vendorOrder = vendorFeedAfter.body.data.find(item => item.id === order.id);
    if (!vendorOrder || Object.prototype.hasOwnProperty.call(vendorOrder, 'pickupPin')) {
      throw new Error('Vendor feed must never disclose pickup PIN');
    }

    const missingPin = await request(`/api/v1/vendor/orders/${order.id}/status`, 'PATCH', {
      status: 'COMPLETED'
    }, vendorToken);
    if (missingPin.status !== 400 && missingPin.status !== 403) throw new Error('Missing PIN should be rejected');

    const wrongPin = await request(`/api/v1/vendor/orders/${order.id}/status`, 'PATCH', {
      status: 'COMPLETED',
      pickupPin: pin === '000000' ? '000001' : '000000'
    }, vendorToken);
    if (wrongPin.status !== 400 && wrongPin.status !== 403) throw new Error('Wrong PIN should be rejected');

    const complete = await request(`/api/v1/vendor/orders/${order.id}/status`, 'PATCH', {
      status: 'COMPLETED',
      pickupPin: pin
    }, vendorToken);
    if (complete.status !== 200 || complete.body.data.status !== 'COMPLETED' ||
        Object.prototype.hasOwnProperty.call(complete.body.data, 'pickupPin')) {
      throw new Error('Correct PIN should complete order without leaking PIN');
    }
    console.log('PASS mandatory pickup PIN verification');

    const history = await request('/api/v1/orders', 'GET', null, studentToken);
    if (history.status !== 200 || !history.body.data.some(item => item.id === order.id) || !history.body.data.some(item => item.id === secondOrder.id)) {
      throw new Error('Student order history failed');
    }
    console.log('PASS student order history');

    await auth.createAccount({
      role: 'admin',
      email: 'admin.test@iitp.ac.in',
      name: 'Test Admin',
      password: 'integration-test-admin-password'
    });
    const adminLogin = await request('/api/v1/admin/auth/login', 'POST', {
      email: 'admin.test@iitp.ac.in',
      password: 'integration-test-admin-password'
    });
    if (adminLogin.status !== 200 || !adminLogin.body.data.token) throw new Error('Admin login failed');
    const adminToken = adminLogin.body.data.token;
    const analytics = await request('/api/v1/admin/analytics', 'GET', null, adminToken);
    if (analytics.status !== 200) throw new Error('Admin analytics should require and accept admin token');
    const aryaAnalytics = analytics.body.data.outletBreakdown.find(item => item.id === outletId);
    if (!aryaAnalytics || typeof aryaAnalytics.estimatedWaitMinutes !== 'number' ||
        typeof aryaAnalytics.grossSales !== 'number' || typeof aryaAnalytics.commissionFee !== 'number') {
      throw new Error('Admin analytics must return live order and queue metrics');
    }
    const studentAnalytics = await request('/api/v1/admin/analytics', 'GET', null, studentToken);
    if (studentAnalytics.status !== 401) throw new Error('Student must not access admin analytics');
    console.log('PASS administrator auth and role boundary');

    const feedback = await request('/api/v1/feedback', 'POST', {
      category: 'test',
      message: 'Integration smoke test feedback'
    }, studentToken);
    if (feedback.status !== 201) throw new Error('Feedback persistence failed');
    console.log('PASS feedback');

    const pass = await request('/api/v1/subscriptions', 'POST', { plan: 'CAMPUS_PASS_PRO' }, studentToken);
    if (pass.status !== 503) throw new Error('Pass must remain disabled without payment gateway');
    console.log('PASS payment gateway remains disabled');

    console.log('\nAll integration tests passed.');
    server.close(() => {
      try { fs.rmSync(process.env.GNG_DATA_DIR, { recursive: true, force: true }); } catch (_) {}
      process.exit(0);
    });
  } catch (error) {
    console.error('FAIL:', error.stack || error.message);
    server.close(() => {
      try { fs.rmSync(process.env.GNG_DATA_DIR, { recursive: true, force: true }); } catch (_) {}
      process.exit(1);
    });
  }
});
