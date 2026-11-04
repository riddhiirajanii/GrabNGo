/**
 * Grab n Go — Node HTTP server serving the student, vendor and admin portals.
 * All runtime application persistence is PostgreSQL through Prisma.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

(function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
})();

const apiRouter = require('./apps/backend/src/api_router');
const prisma = require('./apps/backend/src/database/prisma');
const PORT = process.env.PORT || 3000;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function resolveFilePath(reqUrl) {
  let cleanUrl = decodeURI(reqUrl.split('?')[0]);
  if (cleanUrl === '/' || cleanUrl === '') cleanUrl = '/index.html';
  if (cleanUrl === '/admin' || cleanUrl === '/admin/') return path.join(__dirname, 'admin', 'index.html');
  if (cleanUrl === '/admin.js') return path.join(__dirname, 'admin', 'admin.js');
  if (cleanUrl === '/vendor' || cleanUrl === '/vendor/') return path.join(__dirname, 'vendor', 'index.html');
  if (cleanUrl === '/vendor.js') return path.join(__dirname, 'vendor', 'vendor.js');
  const target = path.resolve(__dirname, `.${cleanUrl}`);
  if (!target.startsWith(__dirname + path.sep) && target !== path.join(__dirname, 'index.html')) return path.join(__dirname, 'index.html');
  if (fs.existsSync(target)) {
    try {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        const candidate = path.join(target, 'index.html');
        if (fs.existsSync(candidate)) return candidate;
      }
      return target;
    } catch (_) { return target; }
  }
  if (cleanUrl.startsWith('/admin/')) {
    const targetAdmin = path.join(__dirname, 'admin', cleanUrl.replace('/admin/', ''));
    if (fs.existsSync(targetAdmin)) return targetAdmin;
  }
  if (cleanUrl.startsWith('/vendor/')) {
    const targetVendor = path.join(__dirname, 'vendor', cleanUrl.replace('/vendor/', ''));
    if (fs.existsSync(targetVendor)) return targetVendor;
  }
  return target;
}

function serveDirectFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server read error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const requestedPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (requestedPath.split('/').some(segment => ['.data', '.git', '.env', 'node_modules'].includes(segment))) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  if ((req.url || '').startsWith('/api/')) {
    apiRouter.handleRequest(req, res);
    return;
  }
  const filePath = resolveFilePath(req.url || '/');
  const resolvedFile = path.resolve(filePath);
  const publicRoots = ['js', 'css', 'assets', 'vendor', 'admin'].map(folder => path.resolve(__dirname, folder));
  const isIndex = resolvedFile === path.resolve(__dirname, 'index.html');
  const isPublic = publicRoots.some(publicRoot => resolvedFile === publicRoot || resolvedFile.startsWith(publicRoot + path.sep));
  if (!isIndex && !isPublic) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  let stat;
  try { stat = fs.statSync(filePath); }
  catch (_) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('File stat error');
    return;
  }
  if (stat.isDirectory()) {
    const index = path.join(filePath, 'index.html');
    if (fs.existsSync(index)) return serveDirectFile(index, res);
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Directory listing forbidden');
    return;
  }
  serveDirectFile(filePath, res);
});

async function start() {
  await prisma.$connect();
  server.listen(PORT, '0.0.0.0', () => {
    console.log('==============================================================');
    console.log(' Grab n Go — PostgreSQL / Prisma backend');
    console.log(` Student App:  http://localhost:${PORT}/`);
    console.log(` Vendor KDS:   http://localhost:${PORT}/vendor`);
    console.log(` Admin:        http://localhost:${PORT}/admin`);
    console.log(` API health:   http://localhost:${PORT}/api/v1/health`);
    console.log(' Database:     connected');
    console.log('==============================================================');
  });
}
async function shutdown(signal) {
  console.log(`[Server] ${signal} received; closing server and database connection.`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
if (require.main === module) {
  start().catch(error => {
    console.error('[Startup] Database connection failed:', error.message);
    process.exit(1);
  });
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
module.exports = server;
