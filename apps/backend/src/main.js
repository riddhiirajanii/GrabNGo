/**
 * Grab n Go — Backend Entry Point
 * Can be run standalone (node apps/backend/src/main.js) or mounted in server.js
 */

const http = require('http');
const config = require('./config');
const apiRouter = require('./api_router');

const PORT = process.env.API_PORT || 3001;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    apiRouter.handleRequest(req, res);
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Use /api/v1/ prefix for API requests' }));
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`🚀 Grab n Go Backend API running at http://localhost:${PORT}/api/v1`);
    console.log(`🩺 Health check: http://localhost:${PORT}/api/v1/health`);
  });
}

module.exports = server;
