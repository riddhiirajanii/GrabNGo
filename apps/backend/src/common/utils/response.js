/**
 * Standard REST Response Utilities
 */

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
  });
  res.end(JSON.stringify(payload, null, 2));
}

function successResponse(res, data, message = 'Success', statusCode = 200) {
  sendJson(res, statusCode, {
    success: true,
    message,
    data,
    timestamp: new Date().toISOString()
  });
}

function errorResponse(res, message = 'Internal Server Error', statusCode = 500, errors = null) {
  sendJson(res, statusCode, {
    success: false,
    message,
    errors,
    timestamp: new Date().toISOString()
  });
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) { // 1MB limit
        req.connection.destroy();
        reject(new Error('Request payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (err) {
        reject(new Error('Malformed JSON in request body'));
      }
    });
    req.on('error', err => reject(err));
  });
}

module.exports = {
  sendJson,
  successResponse,
  errorResponse,
  parseJsonBody
};
