# Grab n Go: PostgreSQL + Prisma runtime

The application runtime now uses PostgreSQL through Prisma for accounts, OTP challenges,
outlets, menu categories/items/variants, stock availability, orders, order items,
order status history, feedback, token counters and persistent authentication/pickup
rate limits. The student, vendor and admin frontends and their API routes are retained.

The JSON store is retained only as a one-time legacy import source. Runtime services
do not read or write `.data/grabngo.json` or `.data/auth_accounts.json`.

## 1. Configure local PostgreSQL

Create the `grabngo` database in your PostgreSQL 18 instance. For the Windows setup
described in this project, PostgreSQL 18 listens on port `5433`.

Copy `.env.example` to `.env` and set:
- `DATABASE_URL` to the local PostgreSQL connection string.
- `JWT_SECRET` to a random secret of at least 32 characters.
- `PICKUP_PIN_ENCRYPTION_KEY` using `npm run secrets:pickup-pin`.
- SMTP settings for student OTP email.

Keep `.env` private and out of Git.

## 2. Install and migrate

```bash
npm install
npm run prisma:generate
npm run prisma:validate
npm run db:migrate:dev
```

For a production database, use `npm run db:migrate:deploy`, not `migrate dev`.

## 3. Seed the catalog and import legacy records

Run this once against the target database:

```bash
npm run db:seed
```

The import utility reads the existing JSON files from `.data/` when present, and
always seeds the outlet catalogue and checked-in Arya Services menu from the project.
It upserts records, so the initial catalog import can be repeated safely, but do not
re-import an old JSON snapshot after PostgreSQL becomes the live source of truth:
it can overwrite newer order/menu/account data.

If you have a legacy `.data` directory outside the project, pass its path:

```bash
node scripts/import-json-to-postgres.js "C:\\path\\to\\legacy\\.data"
```

If legacy orders exist, set the same `PICKUP_PIN_ENCRYPTION_KEY` before importing
so existing pickup PINs can be encrypted for student tracking.

## 4. Create vendor/admin accounts

After seeding outlets:

```bash
node scripts/create-account.js vendor counter@example.org "Arya Counter Staff" outlet-arya-services-01
node scripts/create-account.js admin admin@iitp.ac.in "Campus Administrator"
```

The script prompts for the password without writing it to disk. Use your actual
authorised account emails, not the example addresses.

## 5. Run locally

```bash
npm start
```

The `/api/v1/health` endpoint checks PostgreSQL connectivity. The same Node server
serves the student app, vendor KDS and admin dashboard.

## 6. Render deployment

Create:
1. A Render PostgreSQL instance.
2. A Render Web Service connected to this repository.

Suggested Web Service settings:
- Build: `npm ci && npx prisma generate`
- Pre-deploy: `npx prisma migrate deploy`
- Start: `npm start`

Set `DATABASE_URL` to Render's **internal** database URL, plus `JWT_SECRET`,
`PICKUP_PIN_ENCRYPTION_KEY`, SMTP variables and `NODE_ENV=production`.

Run the catalog/legacy import exactly once against the production database before
opening the app to students. Do not run the legacy JSON importer on every deployment.

## 7. Important data and security notes

- Money values remain integer INR rupees to preserve the existing API and frontend contract.
- Pickup PINs are stored as a SHA-256 verification hash plus AES-256-GCM ciphertext,
  so the student tracking API can reveal the PIN while vendor feeds never include it.
- Keep `PICKUP_PIN_ENCRYPTION_KEY` backed up securely. Losing it prevents decrypting
  historical pickup PINs.
- OTP challenges, authentication lockouts and pickup PIN lockouts are stored in PostgreSQL.
- Orders and order items are written in a transaction. Outlet token counters are incremented
  atomically. Order state changes are recorded in `OrderStatusHistory`.
- Online payments and Student Pass activation remain disabled.
- Student OTP confirms control of an `@iitp.ac.in` mailbox and does not by itself
  validate a roll number against an official IIT Patna registry.
- Use a staging database and test restore/backup procedures before campus-wide launch.
