const crypto = require('crypto');
const prisma = require('../../database/prisma');

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32 || SECRET.includes('replace-with-a-random-secret')) {
  throw new Error('Set a unique JWT_SECRET of at least 32 characters in .env. Do not use the example placeholder.');
}

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function b64(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(payload) {
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  const signature = crypto.createHmac('sha256', SECRET)
    .update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function publicError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return {
    salt,
    hash: crypto.scryptSync(String(password), salt, 64).toString('hex')
  };
}

function safeEqualHex(a, b) {
  try {
    const aa = Buffer.from(String(a), 'hex');
    const bb = Buffer.from(String(b), 'hex');
    return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
  } catch (_) {
    return false;
  }
}

class AuthService {
  async createStudentSession({ name, studentRoll, email }) {
    const cleanName = String(name || '').trim();
    const roll = String(studentRoll || '').trim().toUpperCase();
    const cleanEmail = normalizeEmail(email);

    if (cleanName.length < 2) throw publicError('Enter your full name');
    if (!/^[0-9]{4}[A-Z]{2,4}[0-9]{1,4}$/.test(roll)) {
      throw publicError('Enter a valid IIT Patna roll number');
    }
    if (!/^[^@\s]+@iitp\.ac\.in$/.test(cleanEmail)) {
      throw publicError('Use your IIT Patna institutional email address');
    }

    const existing = await prisma.user.findUnique({
      where: { email: cleanEmail }
    });

    if (existing && existing.role !== 'STUDENT') {
      throw publicError('This email is assigned to a staff account. Contact an administrator.', 403);
    }

    await prisma.user.upsert({
      where: { email: cleanEmail },
      create: {
        role: 'STUDENT',
        email: cleanEmail,
        name: cleanName,
        studentRoll: roll
      },
      update: {
        name: cleanName,
        studentRoll: roll,
        disabled: false
      }
    });

    const now = Math.floor(Date.now() / 1000);

    const payload = {
      sub: roll,
      name: cleanName,
      email: cleanEmail,
      role: 'student',
      emailVerified: true,
      authMethod: 'iitp-email-otp',
      iat: now,
      exp: now + 12 * 60 * 60
    };

    return {
      token: sign(payload),
      user: {
        name: cleanName,
        roll,
        email: cleanEmail,
        institution: 'IIT Patna',
        verificationStatus: 'IITP_EMAIL_VERIFIED'
      }
    };
  }

  async requestStudentOtp({ name, studentRoll, email }, ipAddress = 'unknown') {
    const cleanEmail = normalizeEmail(email);
    const cleanName = String(name || '').trim();
    const roll = String(studentRoll || '').trim().toUpperCase();

    if (!/^[^@\s]+@iitp\.ac\.in$/.test(cleanEmail)) {
      throw publicError('Use your IIT Patna institutional email address');
    }
    if (cleanName.length < 2) {
      throw publicError('Enter your full name');
    }
    if (!/^[0-9]{4}[A-Z]{2,4}[0-9]{1,4}$/.test(roll)) {
      throw publicError('Enter a valid IIT Patna roll number');
    }

    const rateKey = `otp:${cleanEmail}:${String(ipAddress || 'unknown').slice(0, 120)}`;

    const rate = await prisma.authRateLimit.findUnique({
      where: { key: rateKey }
    });

    if (rate && Date.now() - rate.lastEventAt.getTime() < OTP_RESEND_MS) {
      throw publicError('Please wait one minute before requesting another code', 429);
    }

    // Resend configuration
    // Google Apps Script email configuration
const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
const scriptSecret = process.env.GOOGLE_APPS_SCRIPT_SECRET;

if (!scriptUrl || !scriptSecret) {
  throw publicError(
    'Email service is not configured.',
    503
  );
}

// Generate OTP
const otp = crypto.randomInt(100000, 1000000).toString();
const now = new Date();

const otpHash = crypto.createHmac('sha256', SECRET)
  .update(`${cleanEmail}:${otp}`)
  .digest('hex');

// Send OTP through Google Apps Script
let emailResponse;

try {
  emailResponse = await fetch(scriptUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      secret: scriptSecret,
      email: cleanEmail,
      otp: otp
    }),
    redirect: 'follow',
    signal: AbortSignal.timeout(20000)
  });

  const result = await emailResponse.json();

  if (!emailResponse.ok || !result.success) {
    console.error('[Email] Google Apps Script error:', result);
    throw new Error('Email delivery failed');
  }

} catch (error) {
  console.error('[Email] Request failed:', error.message);

  throw publicError(
    'Could not send verification email. Please try again later.',
    502
  );
}

    // Store OTP only after successful email delivery request
    await prisma.$transaction([
      prisma.otpChallenge.upsert({
        where: { email: cleanEmail },
        create: {
          email: cleanEmail,
          name: cleanName,
          studentRoll: roll,
          otpHash,
          expiresAt: new Date(now.getTime() + OTP_TTL_MS),
          attempts: 0,
          lastSentAt: now
        },
        update: {
          name: cleanName,
          studentRoll: roll,
          otpHash,
          expiresAt: new Date(now.getTime() + OTP_TTL_MS),
          attempts: 0,
          lastSentAt: now
        }
      }),

      prisma.authRateLimit.upsert({
        where: { key: rateKey },
        create: {
          key: rateKey,
          count: 1,
          lastEventAt: now
        },
        update: {
          count: { increment: 1 },
          lastEventAt: now,
          lockedUntil: null
        }
      })
    ]);

    return {
      email: cleanEmail,
      expiresInSeconds: OTP_TTL_MS / 1000
    };
  }

  async verifyStudentOtp({ email, otp }) {
    const cleanEmail = normalizeEmail(email);

    const challenge = await prisma.otpChallenge.findUnique({
      where: { email: cleanEmail }
    });

    if (!challenge) {
      throw publicError('Request a new verification code first', 400);
    }

    if (Date.now() > challenge.expiresAt.getTime()) {
      await prisma.otpChallenge.deleteMany({
        where: { email: cleanEmail }
      });
      throw publicError('Verification code expired. Request a new one.', 401);
    }

    const suppliedHash = crypto.createHmac('sha256', SECRET)
      .update(`${cleanEmail}:${String(otp || '').trim()}`)
      .digest('hex');

    const nextAttempts = challenge.attempts + 1;

    if (nextAttempts > OTP_MAX_ATTEMPTS) {
      await prisma.otpChallenge.deleteMany({
        where: { email: cleanEmail }
      });
      throw publicError('Too many incorrect attempts. Request a new code.', 429);
    }

    if (!safeEqualHex(challenge.otpHash, suppliedHash)) {
      await prisma.otpChallenge.update({
        where: { email: cleanEmail },
        data: { attempts: { increment: 1 } }
      });
      throw publicError('Incorrect verification code', 401);
    }

    await prisma.otpChallenge.deleteMany({
      where: { email: cleanEmail }
    });

    return this.createStudentSession({
      name: challenge.name,
      studentRoll: challenge.studentRoll,
      email: cleanEmail
    });
  }

  async createAccount({ role, email, name, password, outletId = null }) {
    const cleanRole = String(role || '').toLowerCase();
    const cleanEmail = normalizeEmail(email);
    const cleanName = String(name || '').trim();

    if (!['vendor', 'admin'].includes(cleanRole)) {
      throw new Error('Account role must be vendor or admin');
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      throw new Error('Enter a valid account email');
    }
    if (cleanRole === 'admin' && !cleanEmail.endsWith('@iitp.ac.in')) {
      throw new Error('Administrator accounts must use an IIT Patna email address');
    }
    if (cleanName.length < 2) {
      throw new Error('Enter the account holder name');
    }
    if (String(password || '').length < 12) {
      throw new Error('Password must contain at least 12 characters');
    }
    if (cleanRole === 'vendor' && !outletId) {
      throw new Error('Vendor accounts must be assigned to an outlet');
    }

    if (cleanRole === 'vendor' && !await prisma.outlet.findUnique({
      where: { id: String(outletId) },
      select: { id: true }
    })) {
      throw new Error('Vendor outlet ID does not exist. Seed the database first.');
    }

    const existing = await prisma.user.findUnique({
      where: { email: cleanEmail }
    });

    if (existing) {
      throw new Error('An account with this email already exists');
    }

    const credentials = hashPassword(password);

    const account = await prisma.user.create({
      data: {
        role: cleanRole.toUpperCase(),
        email: cleanEmail,
        name: cleanName,
        outletId: cleanRole === 'vendor' ? String(outletId) : null,
        passwordSalt: credentials.salt,
        passwordHash: credentials.hash
      }
    });

    return {
      id: account.id,
      role: account.role.toLowerCase(),
      email: account.email,
      name: account.name,
      outletId: account.outletId
    };
  }

  async loginAccount({ email, password }, requiredRole) {
    const cleanEmail = normalizeEmail(email);
    const role = String(requiredRole || '').toUpperCase();
    const rateKey = `login:${role}:${cleanEmail}`;

    const failures = await prisma.authRateLimit.findUnique({
      where: { key: rateKey }
    });

    if (failures?.lockedUntil && failures.lockedUntil.getTime() > Date.now()) {
      throw publicError('Too many sign-in attempts. Try again in 15 minutes.', 429);
    }

    if (!String(password || '') || String(password).length > 128) {
      throw publicError('Invalid email or password', 401);
    }

    const account = await prisma.user.findFirst({
      where: {
        email: cleanEmail,
        role,
        disabled: false
      }
    });

    const candidate = account?.passwordSalt
      ? crypto.scryptSync(String(password), account.passwordSalt, 64).toString('hex')
      : crypto.scryptSync(String(password), 'grabngo-invalid-account-salt', 64).toString('hex');

    if (!account || !account.passwordHash || !safeEqualHex(account.passwordHash, candidate)) {
      const count = (failures?.count || 0) + 1;
      const lockedUntil = count >= 8
        ? new Date(Date.now() + 15 * 60 * 1000)
        : null;

      await prisma.authRateLimit.upsert({
        where: { key: rateKey },
        create: {
          key: rateKey,
          count: count >= 8 ? 0 : count,
          lockedUntil,
          lastEventAt: new Date()
        },
        update: {
          count: count >= 8 ? 0 : count,
          lockedUntil,
          lastEventAt: new Date()
        }
      });

      throw publicError('Invalid email or password', 401);
    }

    await prisma.authRateLimit.deleteMany({
      where: { key: rateKey }
    });

    if (requiredRole === 'vendor' && !account.outletId) {
      throw publicError('Vendor account has no assigned outlet. Contact an administrator.', 403);
    }

    const now = Math.floor(Date.now() / 1000);

    const payload = {
      sub: account.email,
      name: account.name,
      email: account.email,
      role: account.role.toLowerCase(),
      outletId: account.outletId || undefined,
      iat: now,
      exp: now + (requiredRole === 'admin' ? 4 : 8) * 60 * 60
    };

    const token = sign(payload);

    if (requiredRole === 'vendor') {
      return {
        token,
        session: {
          email: account.email,
          outletId: account.outletId,
          outletName: null,
          staffRole: 'Outlet Staff',
          name: account.name
        }
      };
    }

    return {
      token,
      session: {
        email: account.email,
        name: account.name,
        officerName: account.name,
        role: 'admin'
      }
    };
  }

  verify(token) {
    if (!token || typeof token !== 'string') return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    try {
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
    } catch (_) {
      return null;
    }

    const expected = crypto.createHmac('sha256', SECRET)
      .update(`${parts[0]}.${parts[1]}`)
      .digest();

    let actual;
    try {
      actual = Buffer.from(parts[2], 'base64url');
    } catch (_) {
      return null;
    }

    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      return null;
    }

    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      const now = Math.floor(Date.now() / 1000);

      if (!payload.exp || payload.exp <= now || !payload.role || !payload.sub) {
        return null;
      }

      return payload;
    } catch (_) {
      return null;
    }
  }
}

module.exports = new AuthService();