# Grab n Go integration notes

## Current architecture

- Student ordering UI: `index.html` + `js/consumer_app.js`
- Vendor KDS: `vendor/index.html` + `vendor/vendor.js`
- Administrator portal: `admin/index.html` + `admin/admin.js`
- HTTP server and API: `server.js` + `apps/backend/src/api_router.js`
- Runtime persistence: PostgreSQL through Prisma
- Legacy JSON persistence: `apps/backend/src/database/legacy_json_store.js`, used only by the one-time importer

## Database-backed features

- Student identities created after successful OTP verification are persisted in `User`.
- Vendor/admin accounts and password hashes are persisted in `User`.
- OTP challenges and authentication rate limits are persisted in PostgreSQL.
- Outlets, menu categories, menu items, variants, availability, token counters and rush surge values are persisted in PostgreSQL.
- Orders, order items, pickup PIN verification/encrypted PIN data and order status history are persisted in PostgreSQL.
- Feedback and subscriptions have database models. Student Pass activation remains disabled until payments are integrated.
- Analytics are computed from PostgreSQL records.

## Authentication

- Students sign in by receiving a one-time code at an `@iitp.ac.in` email address.
- Vendor and administrator users sign in with server-provisioned email/password accounts.
- Passwords are stored as salted `scrypt` hashes.
- Sessions are signed JWT bearer tokens with role-specific expiry.
- Student, vendor and administrator API routes enforce role checks.
- Vendor accounts are scoped to one outlet.
- The vendor order feed never returns student pickup PINs.
- Pickup PIN is required to move an order from `READY_FOR_PICKUP` to `COMPLETED`.
- OTP challenges, login lockouts and pickup PIN lockouts are persisted in PostgreSQL.

See `AUTH_SETUP.md` for SMTP configuration, account provisioning and the exact identity-verification limitation.

## Ordering

- The backend validates menu items, quantities, variants, availability and prices using database records.
- The backend computes totals and estimated preparation time.
- Order and order-item creation is transactional.
- Outlet token counters are incremented atomically inside the order transaction.
- Order status changes and their audit history are committed together.
- Student order history returns orders for the authenticated student.
- The student dashboard renders multiple active orders and lets each one be tracked separately.
- The KDS refreshes its outlet-scoped order feed and exposes actions for preparation, ready-for-pickup and PIN-verified handover.

## Payments

- Online payment is not configured. All orders are marked `DUE_ON_PICKUP`.
- Student Pass activation is disabled until payment processing is integrated.

## Local setup

Follow `PRISMA_MIGRATION.md` for PostgreSQL creation, `.env` setup, Prisma migrations, initial catalog/legacy import, account provisioning and running the server.

```bash
npm install
npm run prisma:generate
npm run prisma:validate
npm run db:migrate:dev
npm run secrets:pickup-pin
# Copy the generated key into .env before seeding/importing legacy orders.
npm run db:seed
npm run check
npm start
```

Student OTP delivery requires a working SMTP relay. Vendor and admin login require accounts created with `scripts/create-account.js`.

## Production notes

- Use `prisma migrate deploy` against production, never `migrate dev`.
- Use Render's internal PostgreSQL connection URL from the Render web service.
- Run the legacy JSON importer once only. Do not run it on every deployment after PostgreSQL becomes authoritative.
- Back up `PICKUP_PIN_ENCRYPTION_KEY` securely.
- Test PostgreSQL backup restoration before campus-wide launch.
