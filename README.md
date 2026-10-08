# Delivery Platform API

Backend-only REST API for a delivery platform with three roles: **customers** place and pay for deliveries, **riders** claim and complete them, **admins** manage accounts, assignment and refunds.

Built with Node.js + Express 5 + PostgreSQL + Prisma 8 ORM (`@prisma/orm-postgres`) + JWT + bcrypt.

- [`API.md`](./API.md) — every endpoint, payload, error code and business rule.
- Delivery lifecycle: `PENDING → CONFIRMED → ASSIGNED → PICKED_UP → IN_TRANSIT → DELIVERED` (plus `CANCELLED`), enforced by an atomic state machine.
- Mock payment gateway (card decline/approve, bank transfer, cash-on-delivery) with automatic refunds on cancellation.

## Requirements

- Node.js ≥ 20 (developed on v24)
- PostgreSQL ≥ 14 (developed on 18)

## Setup

```bash
npm install
cp .env.example .env          # then set DATABASE_URL (and JWT_SECRET in production)
npm run db:migrate            # create the schema
npm run db:seed               # demo accounts (see below)
npm run dev                   # http://localhost:4000
```

On a machine where you cannot run the system PostgreSQL service, a user-level cluster works just as well:

```bash
initdb -D ~/pgdata
pg_ctl -D ~/pgdata -l ~/pgdata/server.log -o "-p 5432 -k /tmp -c listen_addresses=127.0.0.1" start
```

`.env`:

```dotenv
DATABASE_URL="postgresql://zixu:2020@127.0.0.1:5432/delivery"
JWT_SECRET="change-me-in-production"
PORT=4000
```

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | API with file watching (`tsx watch`). |
| `npm start` | API without watching. |
| `npm run typecheck` | Strict TypeScript check, no emit. |
| `npm run contract:emit` | Regenerate `contract.json` / `contract.d.ts` after editing `src/prisma/contract.prisma`. |
| `npm run db:plan` | Preview the migration for the current contract changes. |
| `npm run db:migrate` | Apply migrations to the database. |
| `npm run db:status` | Show pending/applied migrations. |
| `npm run db:verify` | Verify the migration history. |
| `npm run db:seed` | Create/update the demo accounts (idempotent). |
| `npm run test:smoke` | Boot the API on port 4100 and run the end-to-end scenario (85 checks). |

## Demo accounts

Created by `npm run db:seed`:

| Role | Email | Password |
|------|-------|----------|
| ADMIN | `admin@platform.test` | `Admin1234!` |
| CUSTOMER | `customer@demo.test` | `Customer1234!` |
| RIDER (verified, available) | `rider@demo.test` | `Rider1234!` |
| RIDER (verified, offline) | `rider2@demo.test` | `Rider1234!` |

## Quick tour

```bash
TOKEN=$(curl -s localhost:4000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"customer@demo.test","password":"Customer1234!"}' | jq -r .token)

# get a price (server-side pricing)
curl -s localhost:4000/api/deliveries/quote -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"distanceKm":6.5,"weightKg":2.5}'

# create an order
curl -s localhost:4000/api/deliveries -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{
    "pickup":{"name":"Store","address":"12 Main St","city":"Lagos","phone":"+15550001001"},
    "dropoff":{"recipientName":"Bola","address":"45 Ring Rd","city":"Lagos","phone":"+15550001002"},
    "packageDescription":"Documents","weightKg":2.5,"distanceKm":6.5,"paymentMethod":"CARD"
  }'
```

Then pay it (`POST /api/payments` — a card number ending in `0000` simulates a decline), let a rider claim it (`POST /api/deliveries/:id/accept`), drive it `PICKED_UP → IN_TRANSIT → DELIVERED`, and check the timeline (`GET /api/deliveries/:id/events`). See [`API.md`](./API.md) for the full flow.

## Project layout

```
src/
  app.ts, server.ts        Express app wiring, server bootstrap
  config/env.ts            Env config (JWT, pricing, rate limits)
  controllers/             Request handlers (auth, users, riders, deliveries, payments, stats)
  services/                Business rules: state machine, payments, availability, account status
  middleware/              auth (JWT + DB re-check), validate (rule engine), errors
  serializers/             Stable JSON shapes (Decimal → number, compact relations)
  lib/                     errors, tokens, pricing, pagination, tracking codes
  routes/                  Router composition per resource
  prisma/                  contract.prisma (data contract), db.ts (client), generated types
scripts/                   seed.ts, smoke.ts
migrations/                Prisma 8 migrations + snapshots
```

## Design notes

- **Contract-first schema.** `src/prisma/contract.prisma` is the source of truth; `npm run contract:emit` regenerates the typed client contract, then `npm run db:plan` / `db:migrate` produce the migration.
- **Atomic state machine.** Every transition is a conditional `UPDATE ... WHERE status IN (expected)` inside a transaction — racing actors cannot both win, and side effects (rider availability, `completedRuns`, cash settlement, auto-refund, timeline events) commit or roll back with it.
- **Row-level access.** Admins see everything, customers their own orders, riders their assignments (plus the open queue); anything else answers `404` so existence is never leaked.
- **Passwords never leave the server** — responses serialize a compact user shape, and authentication re-reads the account on every request so suspensions take effect immediately.
