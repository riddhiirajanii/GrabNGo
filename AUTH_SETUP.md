# Grab n Go authentication setup

## Student accounts

Student sign-in uses a six-digit one-time code delivered to an `@iitp.ac.in` mailbox. This is a real mailbox-ownership check, not a mock login.

1. Configure SMTP values in `.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`).
2. Ensure the SMTP account is authorised to send mail from the configured sender. OTP challenges and resend/attempt controls are stored in PostgreSQL.
3. Start the server.
4. The student enters their name, IITP roll number and institutional email, requests a code, and verifies it.
5. The code expires after five minutes, is limited to five attempts, and resend requests are throttled.

**Identity limitation:** This verifies control of an IITP email mailbox. It is not IIT Patna's official SSO, and the roll number is format-validated but not checked against the institute's student registry. To claim registrar-backed identity verification, IITP's official OIDC/SAML/SSO integration or an authorised student directory API must be supplied.

## Vendor and administrator accounts

Vendor and administrator accounts are created by an authorised server operator. Passwords are hashed with Node's `scrypt` and never stored in plaintext. Account records are stored in PostgreSQL through Prisma.

Create an administrator:

```bash
node scripts/create-account.js admin dining-admin@iitp.ac.in "Dining Administrator"
```

Create a vendor account assigned to an outlet:

```bash
node scripts/create-account.js vendor counter@example.org "Arya Counter Staff" outlet-arya-services-01
```

The command prompts for a password. Use at least 12 characters. Vendor accounts are restricted to their assigned outlet.

Supported outlet IDs:

- `outlet-arya-services-01`
- `outlet-angeethi-02`
- `outlet-nescafe-03`
- `outlet-central-fc-04`

Only outlets with a configured digital menu are enabled for ordering. The repository currently contains a menu seed for Arya Services; other outlets remain non-orderable until their actual menus are added.

## Required environment

Copy `.env.example` to `.env`, set `DATABASE_URL`, a unique `JWT_SECRET` of at least 32 characters, `PICKUP_PIN_ENCRYPTION_KEY`, and configure SMTP. `.env` is excluded from version control and static file serving. Generate the pickup key with `npm run secrets:pickup-pin`.

```bash
npm install
cp .env.example .env
# Edit .env with real values
npm run prisma:generate
npm run prisma:validate
npm run db:migrate:dev
npm run secrets:pickup-pin
# Copy the generated key into .env, then:
npm run db:seed
npm run check
npm start
```

Student email OTP sign-in will return a configuration error until SMTP is configured. This is intentional: the application does not silently fall back to demo authentication.

## Sessions

Signed bearer tokens expire after 12 hours for students, 8 hours for vendors and 4 hours for administrators. The frontend validates saved sessions against the relevant `/auth/me` endpoint on load.

## Payments and persistence

Online payment and Student Pass activation remain disabled. All orders are marked `DUE_ON_PICKUP`. Runtime account and order persistence uses PostgreSQL through Prisma. The legacy JSON files are retained only as an import source during migration.
