# Delivery Platform API

Base URL: `http://localhost:<PORT>` (`PORT` defaults to `4000`). All endpoints are JSON and require `Content-Type: application/json` on requests with a body.

## Authentication

Send either:

- `Authorization: Bearer <token>`, or
- the `access_token` HTTP-only cookie set by `POST /api/auth/register` and `POST /api/auth/login`.

Tokens are JWTs signed with `JWT_SECRET` (`issuer: delivery-platform`). Every authenticated request re-reads the account from the database, so `SUSPENDED` / `INACTIVE` accounts lose access immediately even if their token is still valid.

`POST /api/auth/register` and `POST /api/auth/login` are rate limited to 30 requests per 15 minutes; all `/api/*` routes are rate limited to 600 requests per 15 minutes. Exceeding a limit returns `429`.

## Error envelope

Every error response has the same shape:

```json
{ "error": "Human readable message", "code": "ERROR_CODE", "details": ["optional field errors"] }
```

| Code | HTTP | Meaning |
|------|------|---------|
| `VALIDATION_FAILED` | 400 | Body failed validation (`details` lists the fields). |
| `AUTHENTICATION_REQUIRED` | 401 | Missing/invalid token. |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password. |
| `INVALID_TOKEN` | 401 | Token expired or the account no longer exists. |
| `ACCOUNT_SUSPENDED` | 403 | Account suspended by an administrator. |
| `ACCOUNT_INACTIVE` | 403 | Account deactivated. |
| `FORBIDDEN` | 403 | Role is not allowed on this endpoint, or row-level access denied. |
| `NOT_FOUND` | 404 | Resource missing — or exists but belongs to another account (no data leaks). |
| `CONFLICT` | 409 | Uniqueness conflict (duplicate email, double payment, double claim). |
| `INVALID_STATE` | 409 | Business rule or state-machine violation. |
| `RATE_LIMITED` | 429 | Too many requests. |
| `INTERNAL_ERROR` | 500 | Unexpected server error. |

## Pagination

List endpoints accept `page` (≥ 1) and `limit` (1–100, default 20) and return:

```json
{ "data": [ ... ], "meta": { "total": 42, "page": 1, "limit": 20, "totalPages": 3 } }
```

---

## Health

### GET /health

**Response 200:**

```json
{ "status": "ok", "service": "delivery-platform", "time": "2026-10-08T15:00:00.000Z" }
```

---

## Auth

### POST /api/auth/register

Creates a customer or rider account. Admin accounts are provisioned by the seed script only.

**Body:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `email` | string | Yes | Valid email, max 255 chars. Trimmed and lowercased. |
| `password` | string | Yes | 8–100 chars. |
| `firstName` | string | Yes | 1–80 chars. |
| `lastName` | string | Yes | 1–80 chars. |
| `phone` | string | No | Max 20 chars, digits/`+()-` and spaces. |
| `role` | string | No | `CUSTOMER` (default) or `RIDER`. |
| `vehicleType` | string | No | **Required when `role` is `RIDER`.** |
| `vehiclePlate` | string | No | **Required when `role` is `RIDER`.** |
| `licenseNumber` | string | No | **Required when `role` is `RIDER`.** |
| `city` | string | No | Rider city. |

**Response 201:**

```json
{
  "token": "jwt",
  "user": {
    "id": "uuid", "email": "cust@demo.test", "firstName": "Cara", "lastName": "Customer",
    "fullName": "Cara Customer", "phone": null, "role": "CUSTOMER", "status": "ACTIVE",
    "createdAt": "...", "updatedAt": "...",
    "rider": { "id": "uuid", "availability": "OFFLINE", "vehicleType": "Motorbike", "...": "..." }
  }
}
```

`rider` is present only for riders. New riders start `isVerified: false` and `OFFLINE` — an administrator must verify them before they can take jobs. The response also sets the `access_token` cookie (HTTP-only, `SameSite=Lax`, `Secure` in production, 24 h).

**Errors:** 400 validation (bad email/short password, or rider without vehicle details), 409 duplicate email, 429 rate limited.

### POST /api/auth/login

**Body:** `email` (string, required), `password` (string, required).

**Response 200:** `{ "token": "jwt", "user": { ... } }` — same shape as register.

**Errors:** 400 validation, 401 invalid credentials, 403 `ACCOUNT_SUSPENDED` / `ACCOUNT_INACTIVE`, 429 rate limited.

### POST /api/auth/logout

Clears the `access_token` cookie.

**Response 204:** empty body.

### GET /api/auth/me

**Response 200:** `{ "user": { ... } }` (with `rider` profile when applicable).

---

## Users

### GET /api/users/me

**Response 200:** `{ "user": { ... } }`.

### PATCH /api/users/me

**Body:** all optional — `firstName`, `lastName` (1–80 chars), `phone`, `password` (8–100 chars), `currentPassword` (required whenever `password` is sent).

**Response 200:** `{ "user": { ... } }`.

**Errors:** 400 validation or wrong `currentPassword`, 400 `No changes supplied`.

### GET /api/users — admin only

Query: `page`, `limit`, `role` (`CUSTOMER`|`RIDER`|`ADMIN`), `status` (`ACTIVE`|`INACTIVE`|`SUSPENDED`), `search` (matches email, first name, last name).

**Response 200:** paged list of user objects.

### GET /api/users/:id — admin only

**Response 200:** `{ "user": { ... } }`. **404** for unknown ids or ids that are not UUIDs.

### PATCH /api/users/:id/status — admin only

**Body:** `status` — one of `ACTIVE`, `INACTIVE`, `SUSPENDED` (required).

**Response 200:** `{ "user": { ... } }`.

**Errors:** 400 bad status, 403 targeting yourself or another administrator, 409 `INVALID_STATE` when suspending a rider who still has active deliveries (reassign them first).

---

## Riders

### GET /api/riders/me — rider only

**Response 200:** `{ "rider": { ... }, "user": { ... } }`.

### PATCH /api/riders/me — rider only

**Body:** all optional — `vehicleType` (≤40), `vehiclePlate` (≤20), `licenseNumber` (≤40), `city` (≤80).

**Response 200:** `{ "rider": { ... } }`.

### PATCH /api/riders/me/availability — rider only

**Body:** `availability` — `AVAILABLE` or `OFFLINE` (required). `BUSY` is system-managed: it is derived from the rider's active workload and cannot be set by hand.

**Response 200:** `{ "rider": { ... } }`.

**Errors:** 400 bad value, 409 `INVALID_STATE` when the rider still has active deliveries (`ASSIGNED`/`PICKED_UP`/`IN_TRANSIT`) and tries to go `AVAILABLE`, or when the profile is not verified yet.

### GET /api/riders — admin only

Query: `page`, `limit`, `availability` (`AVAILABLE`|`BUSY`|`OFFLINE`), `verified` (`true`|`false`), `search` (matches vehicle plate).

**Response 200:** paged list of user objects, each with a nested `rider` profile.

### GET /api/riders/:id — admin only

`:id` is the rider's **user id**.

**Response 200:** `{ "user": { ..., "rider": { ... } } }`.

### POST /api/riders/:id/verify — admin only

**Body:** `isVerified` (boolean, defaults to `true`).

**Response 200:** `{ "rider": { ..., "isVerified": true } }`.

**Errors:** 404 unknown rider (or id of a non-rider account).

### PATCH /api/riders/:id/availability — admin only

Same rules as the rider's own endpoint (an admin cannot force `AVAILABLE` on an unverified rider or one with active jobs).

**Response 200:** `{ "rider": { ... } }`.

---

## Deliveries

### POST /api/deliveries/quote — authenticated

Pricing is computed server-side; the client never sets a price.

**Body:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `distanceKm` | number | Yes | 0.1–5000. |
| `weightKg` | number | No | 0.1–500, defaults to 1. |

**Response 200:** `{ "fee": 11.23, "currency": "USD" }`.

**Fee formula:** `base + perKm × distance + perKg × max(0, weight − 1)`, floored at the minimum fee. Defaults: base `2.5`, `1.25`/km, `0.4`/kg over 1 kg, minimum `3` (override with `PRICE_BASE`, `PRICE_PER_KM`, `PRICE_PER_KG`, `PRICE_MINIMUM`).

### POST /api/deliveries — customer only

**Body:**

| Field | Type | Required |
|-------|------|----------|
| `pickup` | object | Yes — `name`, `address`, `city`, `phone` (all required), `note` (optional). |
| `dropoff` | object | Yes — `recipientName`, `address`, `city`, `phone` (all required), `note` (optional). |
| `packageDescription` | string | Yes, 1–500 chars. |
| `weightKg` | number | Yes, 0.1–500. |
| `distanceKm` | number | Yes, 0.1–5000. |
| `paymentMethod` | string | Yes — `CASH`, `CARD` or `TRANSFER`. |
| `scheduledFor` | string | No, ISO-8601 timestamp. |
| `currency` | string | No, `USD` (default). |

**Response 201:** `{ "delivery": { ... } }` — status `PENDING`, a generated `trackingCode` (`DLV-XXXXXXXX`), a `payment` record in `PENDING`, and an initial timeline event. The fee is computed from `distanceKm`/`weightKg`, never taken from the client.

**Errors:** 400 validation, 403 role.

**Delivery object:**

```json
{
  "id": "uuid", "trackingCode": "DLV-7K3M2QX9", "status": "CONFIRMED",
  "customerId": "uuid", "riderId": null,
  "pickup": { "name": "...", "address": "...", "city": "...", "phone": "...", "note": null },
  "dropoff": { "recipientName": "...", "address": "...", "city": "...", "phone": "...", "note": null },
  "package": { "description": "...", "weightKg": 2.5, "distanceKm": 6.5 },
  "fee": 11.23, "currency": "USD", "scheduledFor": null,
  "assignedAt": null, "pickedUpAt": null, "deliveredAt": null,
  "cancelledAt": null, "cancelReason": null,
  "createdAt": "...", "updatedAt": "...",
  "customer": { "id": "...", "firstName": "...", "lastName": "...", "fullName": "...", "email": "..." },
  "rider": null,
  "payment": { "id": "...", "reference": "PAY-...", "amount": 11.23, "method": "CARD", "status": "SUCCESSFUL", "...": "..." },
  "events": [ { "fromStatus": null, "toStatus": "PENDING", "note": "Delivery request created", "createdAt": "..." } ]
}
```

`customer`, `rider`, `payment` and `events` appear on single-resource reads; list responses always include `customer`, `rider` and `payment`.

### GET /api/deliveries — authenticated, scoped by role

- **Admin:** every delivery. Extra filters: `customerId`, `riderId`.
- **Customer:** only their own.
- **Rider:** only theirs — or, with `view=available`, unclaimed `CONFIRMED` jobs (the open queue).

Shared query: `page`, `limit`, `status` (any lifecycle status), `search` (matches tracking code, recipient name, pickup name). Newest first.

**Response 200:** paged list of delivery objects.

### GET /api/deliveries/:id — authenticated, scoped

Returns one delivery including `payment`, `customer`, `rider` and the full `events` timeline (oldest first).

**Response 200:** `{ "delivery": { ... } }`. **404** when the id is unknown *or* belongs to another account.

### GET /api/deliveries/:id/events — authenticated, scoped

**Response 200:** `{ "events": [ { "id", "deliveryId", "fromStatus", "toStatus", "actorId", "note", "createdAt" } ] }`.

### GET /api/deliveries/:id/payment — authenticated, scoped

**Response 200:** `{ "payment": { ... } }`.

### POST /api/deliveries/:id/assign — admin only

**Body:** `riderId` (required, UUID of a rider account).

**Response 200:** `{ "delivery": { ... }, "assignedRiderId": "uuid" }` — delivery moves `CONFIRMED → ASSIGNED`, the rider becomes `BUSY`, a timeline event is written.

**Errors:** 400 not a rider id, 404 unknown delivery/rider, 409 `INVALID_STATE` when the delivery is not `CONFIRMED`, the rider is not `ACTIVE`, not verified, or not `AVAILABLE`.

### POST /api/deliveries/:id/unassign — admin only

**Response 200:** `{ "delivery": { ... } }` — moves `ASSIGNED → CONFIRMED`, clears the rider, and recalculates the rider's availability.

**Errors:** 409 when the delivery is not `ASSIGNED`.

### POST /api/deliveries/:id/accept — rider only

Atomic claim: the conditional update only succeeds if the delivery is still `CONFIRMED` and unclaimed, so two riders racing for the same job cannot both win.

**Response 200:** `{ "delivery": { ... } }` — status `ASSIGNED`, `riderId` set to you, your availability becomes `BUSY`.

**Errors:** 409 `CONFLICT` ("Another rider has already claimed this delivery") when someone beat you to it, 409 `INVALID_STATE` when the delivery is not claimable, when you are not verified, or when your availability is not `AVAILABLE`.

### POST /api/deliveries/:id/cancel — customer (own order) or admin

**Body:** `reason` (required, 1–500 chars).

**Response 200:** `{ "delivery": { ... } }` — status `CANCELLED`, `cancelledAt` and `cancelReason` stored, rider released if there was one, and any `SUCCESSFUL` payment **automatically refunded** (`REFUNDED` + `refundedAt` + a timeline event).

**Errors:** 403 when a customer tries to cancel an order that is already assigned (only admins can cancel `ASSIGNED`), 409 when the current status is not cancellable (`DELIVERED`/`CANCELLED` are terminal).

### PATCH /api/deliveries/:id/status — rider (own assignment) or admin

**Body:** `status` (required — any lifecycle status), `note` (optional, ≤300 chars).

Riders may only advance their own delivery along legal transitions (`PICKED_UP → IN_TRANSIT → DELIVERED`). Admins may apply any legal transition.

**Response 200:** `{ "delivery": { ... } }` — reloaded fresh, so side effects (timestamps, payment, availability) are visible.

**Errors:** 403 for customers, 403 when the delivery is not assigned to you, 409 `INVALID_STATE` for illegal transitions.

---

## Lifecycle state machine

| From | Allowed next |
|------|--------------|
| `PENDING` | `CONFIRMED`, `CANCELLED` |
| `CONFIRMED` | `ASSIGNED`, `CANCELLED` |
| `ASSIGNED` | `PICKED_UP`, `CONFIRMED` (unassign), `CANCELLED` |
| `PICKED_UP` | `IN_TRANSIT` |
| `IN_TRANSIT` | `DELIVERED` |
| `DELIVERED` | — terminal |
| `CANCELLED` | — terminal |

Transitions are applied with a conditional `UPDATE ... WHERE status IN (expected)`, so concurrent actors cannot both win; all side effects run in the same database transaction.

**Side effects:**

| Transition | Effect |
|------------|--------|
| → `ASSIGNED` | Rider availability → `BUSY`; `assignedAt` stored. |
| → `CONFIRMED` (unassign) | Rider availability recalculated (→ `AVAILABLE` unless `OFFLINE`). |
| → `PICKED_UP` / → `DELIVERED` | `pickedUpAt` / `deliveredAt` stored. |
| → `DELIVERED` | Rider's `completedRuns` incremented, availability recalculated; a `CASH` payment settles (`SUCCESSFUL`, `gatewayRef = cash_…`). |
| → `CANCELLED` | Rider released; `cancelledAt`, `cancelReason`, `cancellationActorId` stored; a `SUCCESSFUL` payment is refunded. |

---

## Payments

Mock gateway — no real processor is involved. The outcome is deterministic:

| Method | Behaviour |
|--------|-----------|
| `CARD` | Declines when the card number ends in `0000` (payment `FAILED`, delivery stays `PENDING`, retry allowed). Any other number succeeds. |
| `TRANSFER` | Succeeds immediately; `transferReference` is accepted but the gateway reference is generated. |
| `CASH` | Never charges a card. Records the cash-on-delivery agreement, confirms the order, and the payment settles to `SUCCESSFUL` when the rider marks it `DELIVERED`. |

### POST /api/payments — customer only

**Body:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `deliveryId` | string | Yes | UUID of your own `PENDING` delivery. |
| `method` | string | Yes | `CASH`, `CARD`, `TRANSFER`. |
| `cardNumber` | string | No | ≤25 chars; ends with `0000` to simulate a decline. |
| `transferReference` | string | No | ≤60 chars. |

**Response 200:**

```json
{
  "payment": { "reference": "PAY-...", "status": "SUCCESSFUL", "gatewayRef": "gw_...", "...": "..." },
  "delivery": { "id": "uuid", "status": "CONFIRMED", "trackingCode": "DLV-..." },
  "message": "Payment successful. Your delivery is confirmed."
}
```

On success (or for `CASH`) the delivery moves `PENDING → CONFIRMED` and a timeline event is written.

**Errors:** 404 unknown delivery or someone else's delivery, 409 `CONFLICT` when already paid, 409 `INVALID_STATE` when the delivery is no longer `PENDING` or the payment was refunded.

### GET /api/payments — customer (own) or admin (all)

Query: `page`, `limit`, `status` (`PENDING`|`SUCCESSFUL`|`FAILED`|`REFUNDED`).

**Response 200:** paged list of payment objects.

### GET /api/payments/:id — customer (own) or admin

**Response 200:** `{ "payment": { ... } }`. **404** for other customers' payments.

### POST /api/payments/:id/refund — admin only

**Response 200:** `{ "payment": { ... } }` with `status: "REFUNDED"` and `refundedAt` set; a timeline event is added to the delivery.

**Errors:** 409 `INVALID_STATE` unless the payment is `SUCCESSFUL` **and** its delivery is `CANCELLED` or `DELIVERED` (cancel the delivery first).

---

## Stats

### GET /api/stats/platform — admin only

```json
{
  "usersByRole": { "CUSTOMER": 3, "RIDER": 2, "ADMIN": 1 },
  "deliveriesByStatus": { "PENDING": 1, "DELIVERED": 4, "CANCELLED": 2 },
  "paymentsByStatus": { "SUCCESSFUL": 5, "REFUNDED": 1, "FAILED": 1 },
  "revenue": { "total": 56.15, "successfulPayments": 5 },
  "recentDeliveries": [ { "...": "delivery objects" } ]
}
```

### GET /api/stats/rider — rider only

```json
{
  "availability": "AVAILABLE", "isVerified": true, "completedRuns": 4,
  "activeDeliveries": 0, "deliveredDeliveries": 4,
  "earnings": { "total": 44.92, "paidDeliveries": 4 }
}
```

### GET /api/stats/customer — customer only

```json
{
  "totalDeliveries": 5, "deliveriesByStatus": { "DELIVERED": 3, "CANCELLED": 1, "PENDING": 1 },
  "activeDeliveries": 1, "spend": { "total": 33.69, "paidDeliveries": 3 }
}
```

---

## Business rules

1. Only `ACTIVE` accounts can authenticate; `SUSPENDED`/`INACTIVE` lose access on the very next request.
2. Admin accounts cannot be created through the API; admins cannot change their own status or other admins'.
3. A rider must be verified by an admin before going `AVAILABLE` or taking a job.
4. `BUSY` is derived from workload: any active job (`ASSIGNED`/`PICKED_UP`/`IN_TRANSIT`) forces `BUSY`; when the last job ends the rider returns to `AVAILABLE` (or stays `OFFLINE` if they were offline).
5. A rider with active jobs cannot go `AVAILABLE`; suspending such a rider is blocked until the work is reassigned.
6. Customers can cancel only while the delivery is `PENDING` or `CONFIRMED`; admins can also cancel `ASSIGNED` orders.
7. Cancelling a paid delivery refunds its payment automatically; manual refunds require the delivery to be `CANCELLED` or `DELIVERED` first.
8. `DELIVERED` and `CANCELLED` are terminal — no transition can revive them.
9. Payment can only be taken while the delivery is `PENDING`; a successful charge (or cash agreement) confirms it.
10. Prices are always computed server-side; list/detail responses never expose `passwordHash`.
