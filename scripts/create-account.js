// Provision vendor/admin accounts directly in PostgreSQL.
const fs = require('fs');
const path = require('path');

const envFile = path.resolve(__dirname, '../.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}
const [roleArg, emailArg, nameArg, outletId] = process.argv.slice(2);
const role = String(roleArg || '').toLowerCase();
const email = String(emailArg || '').trim().toLowerCase();
const name = String(nameArg || '').trim();
if (!['vendor', 'admin'].includes(role) || !email || !name) {
  console.error('Usage: node scripts/create-account.js <vendor|admin> <email> "<full name>" [outlet-id]');
  process.exit(1);
}
if (role === 'vendor' && !outletId) {
  console.error('Vendor account requires an outlet-id.');
  process.exit(1);
}
if (role === 'admin' && !email.endsWith('@iitp.ac.in')) {
  console.error('Administrator accounts must use an IIT Patna email address.');
  process.exit(1);
}
function askPassword() {
  return new Promise(resolve => {
    const stdin = process.stdin;
    let password = '';
    process.stdout.write('New password (min 12 characters): ');
    if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    const onData = chunk => {
      for (const char of chunk.toString()) {
        if (char === '\u0003') process.exit(1);
        if (char === '\r' || char === '\n') {
          stdin.removeListener('data', onData);
          if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(false);
          process.stdout.write('\n');
          resolve(password);
          return;
        }
        if (char === '\u007f' || char === '\b') password = password.slice(0, -1);
        else if (char >= ' ') password += char;
      }
    };
    stdin.on('data', onData);
  });
}
(async () => {
  const prisma = require('../apps/backend/src/database/prisma');
  try {
    const password = await askPassword();
    if (password.length < 12) throw new Error('Password must contain at least 12 characters.');
    if (role === 'vendor' && !await prisma.outlet.findUnique({ where: { id: outletId }, select: { id: true } })) {
      throw new Error('Outlet ID does not exist. Run npm run db:seed first.');
    }
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) throw new Error('An account with this email already exists.');
    const crypto = require('crypto');
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');
    const account = await prisma.user.create({
      data: {
        role: role.toUpperCase(), email, name, outletId: role === 'vendor' ? outletId : null,
        passwordSalt: salt, passwordHash
      }
    });
    console.log(`Created ${role} account for ${account.email}${account.outletId ? ` (${account.outletId})` : ''}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    process.stdin.pause();
    await prisma.$disconnect();
  }
})();
