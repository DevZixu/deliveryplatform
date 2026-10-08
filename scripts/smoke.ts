/**
 * End-to-end smoke test. Boots the API on SMOKE_PORT (default 4100) and
 * walks the whole delivery lifecycle with real HTTP calls:
 * register → verify rider → quote → pay (decline, retry) → claim →
 * pickup → in transit → delivered → stats, plus refunds, cancellation,
 * authorization, validation and suspension checks.
 *
 * Requires a migrated database and the seed accounts (npm run db:seed).
 */
import { spawn, type ChildProcess } from 'node:child_process';

const PORT = Number(process.env.SMOKE_PORT ?? 4100);
const BASE = `http://127.0.0.1:${PORT}`;
const stamp = Date.now().toString(36);

type Res = { status: number; body: any };

let checks = 0;
let failures = 0;

function check(label: string, condition: boolean, extra?: unknown): void {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`);
    if (extra !== undefined) console.error('      ', JSON.stringify(extra));
  }
}

function expect(res: Res, status: number, label: string): Res {
  check(`${label} → ${status}`, res.status === status, res.body);
  return res;
}

async function req(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<Res> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
}

const pickup = {
  name: 'Main Street Store',
  address: '12 Main Street',
  city: 'Lagos',
  phone: '+15550001001',
};
const dropoff = {
  recipientName: 'Bola Adeyemi',
  address: '45 Ring Road',
  city: 'Lagos',
  phone: '+15550001002',
};

function deliveryPayload(paymentMethod: 'CASH' | 'CARD' | 'TRANSFER') {
  return {
    pickup,
    dropoff,
    packageDescription: 'Box of documents',
    weightKg: 2.5,
    distanceKm: 6.5,
    paymentMethod,
  };
}

async function waitForHealth(timeoutMs = 40_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become healthy on ${BASE}`);
}

async function main(): Promise<void> {
  let server: ChildProcess | undefined;
  try {
    server = spawn('npx', ['tsx', 'src/server.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stderr?.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

    await waitForHealth();
    console.log(`\nAPI ready at ${BASE}\n`);

    // ---- accounts -------------------------------------------------------
    console.log('Accounts');
    const customerEmail = `cust-${stamp}@demo.test`;
    const riderEmail = `rider-${stamp}@demo.test`;
    const adminEmail = `admin-${stamp}@demo.test`;

    const registerCustomer = expect(
      await req('POST', '/api/auth/register', {
        body: { email: customerEmail, password: 'Customer1234!', firstName: 'Cara', lastName: 'Customer' },
      }),
      201,
      'register customer',
    );
    const customerToken: string = registerCustomer.body?.token;

    expect(
      await req('POST', '/api/auth/register', {
        body: { email: customerEmail, password: 'Customer1234!', firstName: 'Dup', lastName: 'Account' },
      }),
      409,
      'duplicate email rejected',
    );

    const registerRider = expect(
      await req('POST', '/api/auth/register', {
        body: {
          email: riderEmail,
          password: 'Rider1234!',
          firstName: 'Ravi',
          lastName: 'Rider',
          role: 'RIDER',
          vehicleType: 'Motorbike',
          vehiclePlate: `SM-${stamp}`,
          licenseNumber: 'LIC-4411',
        },
      }),
      201,
      'register rider with vehicle details',
    );
    const riderToken: string = registerRider.body?.token;
    const riderUserId: string = registerRider.body?.user?.id;

    expect(
      await req('POST', '/api/auth/register', {
        body: { email: `bad-${stamp}@demo.test`, password: 'short', firstName: 'X', lastName: 'Y', role: 'RIDER' },
      }),
      400,
      'weak password rejected',
    );

    expect(
      await req('POST', '/api/auth/register', {
        body: {
          email: `norider-${stamp}@demo.test`,
          password: 'Customer1234!',
          firstName: 'No',
          lastName: 'Vehicle',
          role: 'RIDER',
        },
      }),
      400,
      'rider without vehicle details rejected',
    );

    const adminLogin = expect(
      await req('POST', '/api/auth/login', { body: { email: 'admin@platform.test', password: 'Admin1234!' } }),
      200,
      'admin login (seeded account)',
    );
    if (adminLogin.status !== 200) {
      console.error('      → run `npm run db:seed` first so the seeded admin exists');
    }
    const adminToken: string = adminLogin.body?.token;

    const badLogin = expect(
      await req('POST', '/api/auth/login', { body: { email: customerEmail, password: 'wrong-password' } }),
      401,
      'wrong password rejected',
    );
    check('bad login has INVALID_CREDENTIALS code', badLogin.body?.code === 'INVALID_CREDENTIALS');

    expect(await req('GET', '/api/auth/me', {}), 401, 'unauthenticated request rejected');

    // ---- rider verification & availability ------------------------------
    console.log('\nRider onboarding');
    expect(
      await req('PATCH', '/api/riders/me/availability', { token: riderToken, body: { availability: 'AVAILABLE' } }),
      409,
      'unverified rider cannot go available',
    );

    expect(
      await req('POST', `/api/riders/${riderUserId}/verify`, { token: adminToken, body: { isVerified: true } }),
      200,
      'admin verifies rider',
    );

    const availability = expect(
      await req('PATCH', '/api/riders/me/availability', {
        token: riderToken,
        body: { availability: 'AVAILABLE' },
      }),
      200,
      'verified rider goes available',
    );
    check('availability is AVAILABLE', availability.body?.rider?.availability === 'AVAILABLE');

    expect(
      await req('PATCH', '/api/riders/me/availability', { token: customerToken, body: { availability: 'AVAILABLE' } }),
      403,
      'customer cannot use rider endpoints',
    );

    // ---- quote & order creation -----------------------------------------
    console.log('\nOrder lifecycle');
    const quote = expect(
      await req('POST', '/api/deliveries/quote', { token: customerToken, body: { distanceKm: 6.5, weightKg: 2.5 } }),
      200,
      'quote price is calculated server-side',
    );
    check('quote returns a positive fee', Number(quote.body?.fee) > 0, quote.body);

    expect(
      await req('POST', '/api/deliveries', { token: riderToken, body: deliveryPayload('CARD') }),
      403,
      'riders cannot create orders',
    );

    expect(
      await req('POST', '/api/deliveries', { token: customerToken, body: { packageDescription: 'no locations' } }),
      400,
      'malformed order rejected',
    );

    const created = expect(
      await req('POST', '/api/deliveries', { token: customerToken, body: deliveryPayload('CARD') }),
      201,
      'customer creates order',
    );
    const deliveryId: string = created.body?.delivery?.id;
    const trackingCode: string = created.body?.delivery?.trackingCode;
    check('order starts PENDING with a tracking code',
      created.body?.delivery?.status === 'PENDING' && /^DLV-/.test(trackingCode ?? ''),
      created.body?.delivery);
    check('fee matches the quote', created.body?.delivery?.fee === quote.body?.fee, {
      created: created.body?.delivery?.fee,
      quote: quote.body?.fee,
    });
    check('payment starts PENDING', created.body?.delivery?.payment?.status === 'PENDING');

    // ---- payment ---------------------------------------------------------
    console.log('\nPayment');
    const declined = expect(
      await req('POST', '/api/payments', {
        token: customerToken,
        body: { deliveryId, method: 'CARD', cardNumber: '4000000000000000' },
      }),
      200,
      'declined card processed by gateway',
    );
    check('declined charge reported FAILED', declined.body?.payment?.status === 'FAILED', declined.body);
    check('order still PENDING after decline', declined.body?.delivery?.status === 'PENDING');

    const paid = expect(
      await req('POST', '/api/payments', {
        token: customerToken,
        body: { deliveryId, method: 'CARD', cardNumber: '4111111111111111' },
      }),
      200,
      'approved card processed',
    );
    check('charge is SUCCESSFUL', paid.body?.payment?.status === 'SUCCESSFUL', paid.body);
    check('order confirmed after payment', paid.body?.delivery?.status === 'CONFIRMED');

    expect(
      await req('POST', '/api/payments', {
        token: customerToken,
        body: { deliveryId, method: 'CARD', cardNumber: '4111111111111111' },
      }),
      409,
      'double payment rejected',
    );

    // ---- claiming & progress --------------------------------------------
    console.log('\nRider progress');
    const offers = expect(
      await req('GET', '/api/deliveries?view=available', { token: riderToken }),
      200,
      'rider sees available jobs',
    );
    check(
      'new order appears in the available queue',
      Array.isArray(offers.body?.data) && offers.body.data.some((d: any) => d.id === deliveryId),
      offers.body?.meta,
    );

    const assigned = expect(
      await req('POST', `/api/deliveries/${deliveryId}/accept`, { token: riderToken }),
      200,
      'rider claims the order',
    );
    check('order is ASSIGNED', assigned.body?.delivery?.status === 'ASSIGNED');

    expect(
      await req('POST', `/api/deliveries/${deliveryId}/accept`, { token: riderToken }),
      409,
      'second claim rejected',
    );

    const busyCheck = expect(
      await req('PATCH', '/api/riders/me/availability', { token: riderToken, body: { availability: 'AVAILABLE' } }),
      409,
      'rider with active jobs cannot reset availability',
    );
    check('blocked by active deliveries', /active deliveries/i.test(busyCheck.body?.error ?? ''), busyCheck.body);

    expect(
      await req('PATCH', `/api/deliveries/${deliveryId}/status`, {
        token: customerToken,
        body: { status: 'PICKED_UP' },
      }),
      403,
      'customer cannot drive rider progress',
    );

    for (const [status, label] of [
      ['PICKED_UP', 'picked up'],
      ['IN_TRANSIT', 'in transit'],
      ['DELIVERED', 'delivered'],
    ] as const) {
      const step = expect(
        await req('PATCH', `/api/deliveries/${deliveryId}/status`, { token: riderToken, body: { status } }),
        200,
        `rider marks ${label}`,
      );
      check(`status is ${status}`, step.body?.delivery?.status === status, step.body?.delivery?.status);
    }

    const riderStats = expect(
      await req('GET', '/api/stats/rider', { token: riderToken }),
      200,
      'rider stats',
    );
    check('completed run recorded', riderStats.body?.deliveredDeliveries >= 1, riderStats.body);
    check('rider free again after delivery', riderStats.body?.availability === 'AVAILABLE', riderStats.body);

    expect(
      await req('GET', `/api/deliveries/${deliveryId}`, { token: riderToken }),
      200,
      'rider can read the delivered order',
    );

    const timeline = expect(
      await req('GET', `/api/deliveries/${deliveryId}/events`, { token: customerToken }),
      200,
      'customer reads the tracking timeline',
    );
    check(
      'timeline records every step',
      Array.isArray(timeline.body?.events) && timeline.body.events.length >= 5,
      timeline.body?.events?.length,
    );

    // ---- cancellation & refunds -----------------------------------------
    console.log('\nCancellation & refunds');
    const cashOrder = expect(
      await req('POST', '/api/deliveries', { token: customerToken, body: deliveryPayload('CASH') }),
      201,
      'cash order created',
    );
    const cashDeliveryId: string = cashOrder.body?.delivery?.id;
    const cashPaid = expect(
      await req('POST', '/api/payments', {
        token: customerToken,
        body: { deliveryId: cashDeliveryId, method: 'CASH' },
      }),
      200,
      'cash agreement recorded',
    );
    check('cash order confirmed without a gateway charge', cashPaid.body?.delivery?.status === 'CONFIRMED');

    const refundOrder = expect(
      await req('POST', '/api/deliveries', { token: customerToken, body: deliveryPayload('CARD') }),
      201,
      'second card order created',
    );
    const refundDeliveryId: string = refundOrder.body?.delivery?.id;
    expect(
      await req('POST', '/api/payments', {
        token: customerToken,
        body: { deliveryId: refundDeliveryId, method: 'CARD', cardNumber: '4111111111111111' },
      }),
      200,
      'paid before cancellation',
    );

    const cancelled = expect(
      await req('POST', `/api/deliveries/${cashDeliveryId}/cancel`, {
        token: customerToken,
        body: { reason: 'Ordered by mistake' },
      }),
      200,
      'customer cancels own order',
    );
    check('order is CANCELLED', cancelled.body?.delivery?.status === 'CANCELLED');
    check('cancel reason stored', cancelled.body?.delivery?.cancelReason === 'Ordered by mistake');

    const refunded = expect(
      await req('POST', `/api/deliveries/${refundDeliveryId}/cancel`, {
        token: adminToken,
        body: { reason: 'Customer requested refund' },
      }),
      200,
      'admin cancels paid order',
    );
    check('payment auto-refunded', refunded.body?.delivery?.payment?.status === 'REFUNDED', refunded.body?.delivery?.payment);
    check('refund timestamped', Boolean(refunded.body?.delivery?.payment?.refundedAt));

    expect(
      await req('PATCH', `/api/deliveries/${refundDeliveryId}/status`, {
        token: adminToken,
        body: { status: 'CONFIRMED' },
      }),
      409,
      'cancelled orders are terminal',
    );

    // ---- assignment flow -------------------------------------------------
    console.log('\nAdmin assignment');
    const assignedOrder = expect(
      await req('POST', '/api/deliveries', { token: customerToken, body: deliveryPayload('TRANSFER') }),
      201,
      'transfer order created',
    );
    const assignedDeliveryId: string = assignedOrder.body?.delivery?.id;
    expect(
      await req('POST', '/api/payments', {
        token: customerToken,
        body: { deliveryId: assignedDeliveryId, method: 'TRANSFER', transferReference: 'TRF-001' },
      }),
      200,
      'transfer settles the payment',
    );

    const ridersList = expect(
      await req('GET', '/api/riders?verified=true', { token: adminToken }),
      200,
      'admin lists verified riders',
    );
    check('rider directory returns results', (ridersList.body?.data ?? []).length > 0, ridersList.body?.meta);

    const ourRiderId: string = riderUserId;
    expect(
      await req('PATCH', `/api/riders/${ourRiderId}/availability`, {
        token: adminToken,
        body: { availability: 'AVAILABLE' },
      }),
      200,
      'admin ensures the rider is available',
    );
    expect(
      await req('POST', `/api/deliveries/${assignedDeliveryId}/assign`, {
        token: adminToken,
        body: { riderId: ourRiderId },
      }),
      200,
      'admin assigns a rider',
    );
    const assignedAgain = expect(
      await req('POST', `/api/deliveries/${assignedDeliveryId}/assign`, {
        token: adminToken,
        body: { riderId: ourRiderId },
      }),
      409,
      'assigning an already-assigned order is rejected',
    );
    check('reassignment reports invalid state', assignedAgain.body?.code === 'INVALID_STATE', assignedAgain.body);

    expect(
      await req('POST', `/api/deliveries/${assignedDeliveryId}/unassign`, { token: adminToken }),
      200,
      'admin unassigns the rider',
    );
    expect(
      await req('POST', `/api/deliveries/${assignedDeliveryId}/assign`, {
        token: riderToken,
        body: { riderId: ourRiderId },
      }),
      403,
      'riders cannot assign themselves',
    );

    // ---- authorization ---------------------------------------------------
    console.log('\nAuthorization');
    const otherEmail = `other-${stamp}@demo.test`;
    const otherCustomer = await req('POST', '/api/auth/register', {
      body: { email: otherEmail, password: 'Customer1234!', firstName: 'Ola', lastName: 'Other' },
    });
    const otherToken: string = otherCustomer.body?.token;

    expect(
      await req('GET', `/api/deliveries/${deliveryId}`, { token: otherToken }),
      404,
      'another customer cannot read this order',
    );
    expect(
      await req('GET', '/api/users', { token: customerToken }),
      403,
      'customer cannot list accounts',
    );
    expect(
      await req('GET', '/api/stats/platform', { token: riderToken }),
      403,
      'rider cannot read platform stats',
    );
    expect(await req('GET', '/api/deliveries'), 401, 'anonymous listing rejected');
    expect(
      await req('GET', '/api/deliveries/00000000-0000-0000-0000-000000000000', { token: adminToken }),
      404,
      'unknown delivery id → 404',
    );

    const suspended = expect(
      await req('PATCH', `/api/users/${otherCustomer.body?.user?.id}/status`, {
        token: adminToken,
        body: { status: 'SUSPENDED' },
      }),
      200,
      'admin suspends an account',
    );
    check('status stored as SUSPENDED', suspended.body?.user?.status === 'SUSPENDED');
    expect(
      await req('GET', '/api/auth/me', { token: otherToken }),
      403,
      'suspended account loses access immediately',
    );

    // ---- stats -----------------------------------------------------------
    console.log('\nStats');
    const platformStats = expect(await req('GET', '/api/stats/platform', { token: adminToken }), 200, 'platform stats');
    check('stats include deliveries by status', Boolean(platformStats.body?.deliveriesByStatus), platformStats.body);
    const customerStats = expect(await req('GET', '/api/stats/customer', { token: customerToken }), 200, 'customer stats');
    check('customer stats count own orders', customerStats.body?.totalDeliveries >= 3, customerStats.body);
    expect(await req('GET', '/api/payments', { token: customerToken }), 200, 'customer lists own payments');
    expect(await req('GET', '/api/users', { token: adminToken }), 200, 'admin lists accounts');

    console.log(`\n${checks - failures}/${checks} checks passed`);
    if (failures > 0) {
      console.error(`${failures} check(s) FAILED`);
      process.exitCode = 1;
    }
  } finally {
    server?.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error('\nSmoke test crashed:', error);
  process.exitCode = 1;
});
