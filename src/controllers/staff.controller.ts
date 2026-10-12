import { or } from '@prisma/orm-postgres/orm-client';
import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { config } from '../config/env.js';
import { ApiError, asyncHandler } from '../lib/errors.js';
import { getPagination, getStringQuery, paged } from '../lib/pagination.js';
import { db } from '../prisma/db.js';
import { serializeUser } from '../serializers/user.serializer.js';
import { serializeDelivery } from '../serializers/delivery.serializer.js';
import { createDelivery } from '../services/delivery.service.js';
import type { AccountStatus } from '../types/db.js';
import { setAccountStatus } from '../services/user.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_STATUSES: AccountStatus[] = ['ACTIVE', 'INACTIVE', 'SUSPENDED'];

// ---------------------------------------------------------------------------
// Admin: manage staff accounts
// ---------------------------------------------------------------------------

/** POST /api/admin/staffs — admin creates a staff account */
export const createStaff = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, firstName, lastName, phone } = req.body as {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
  };

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.orm.public.User.first({ email: normalizedEmail });
  if (existing) throw ApiError.conflict('An account with that email already exists');

  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);

  const user = await db.orm.public.User.create({
    id: crypto.randomUUID(),
    email: normalizedEmail,
    passwordHash,
    firstName,
    lastName,
    phone: phone ?? null,
    role: 'STAFF',
    status: 'ACTIVE',
  });

  res.status(201).json({ user: serializeUser(user) });
});

/** GET /api/admin/staffs — admin lists all staff accounts */
export const listStaffs = asyncHandler(async (req: Request, res: Response) => {
  const pagination = getPagination(req);
  let q = db.orm.public.User.where((u) => u.role.eq('STAFF'));

  const status = getStringQuery(req, 'status');
  if (status) {
    if (!ACCOUNT_STATUSES.includes(status as AccountStatus)) {
      throw ApiError.badRequest(`status must be one of: ${ACCOUNT_STATUSES.join(', ')}`);
    }
    q = q.where((u) => u.status.eq(status as AccountStatus));
  }

  const search = getStringQuery(req, 'search');
  if (search) {
    const term = `%${search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    q = q.where((u) => or(u.email.ilike(term), u.firstName.ilike(term), u.lastName.ilike(term)));
  }

  const [rows, countResult] = await Promise.all([
    q.orderBy([(u) => u.createdAt.desc(), (u) => u.id.desc()])
      .offset(pagination.offset)
      .limit(pagination.limit)
      .all(),
    q.aggregate((a) => ({ total: a.count() })),
  ]);

  res.json(paged(rows.map(serializeUser), countResult.total, pagination));
});

/** GET /api/admin/staffs/:id */
export const getStaff = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) throw ApiError.notFound('Staff not found');
  const user = await db.orm.public.User.first({ id, role: 'STAFF' });
  if (!user) throw ApiError.notFound('Staff not found');
  res.json({ user: serializeUser(user) });
});

/** PATCH /api/admin/staffs/:id/status */
export const changeStaffStatus = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) throw ApiError.notFound('Staff not found');
  const target = await db.orm.public.User.first({ id, role: 'STAFF' });
  if (!target) throw ApiError.notFound('Staff not found');

  const status = String(req.body.status ?? '') as AccountStatus;
  if (!ACCOUNT_STATUSES.includes(status)) {
    throw ApiError.badRequest(`status must be one of: ${ACCOUNT_STATUSES.join(', ')}`);
  }

  const updated = await setAccountStatus(target, status, req.user!);
  res.json({ user: serializeUser(updated) });
});

// ---------------------------------------------------------------------------
// Staff: create deliveries (can auto-create customer)
// ---------------------------------------------------------------------------

/**
 * POST /api/staff/deliveries
 *
 * Staff members can create a delivery for any customer. If the customer
 * doesn't exist yet (identified by email), they are created silently with a
 * random password — no email is sent.
 */
export const staffCreateDelivery = asyncHandler(async (req: Request, res: Response) => {
  const {
    customerEmail,
    customerFirstName,
    customerLastName,
    customerPhone,
    pickup,
    dropoff,
    packageDescription,
    weightKg,
    distanceKm,
    paymentMethod,
    scheduledFor,
    currency,
  } = req.body as {
    customerEmail: string;
    customerFirstName?: string;
    customerLastName?: string;
    customerPhone?: string;
    pickup: { name: string; address: string; city: string; phone: string; note?: string };
    dropoff: { recipientName: string; address: string; city: string; phone: string; note?: string };
    packageDescription: string;
    weightKg: number;
    distanceKm: number;
    paymentMethod: 'CASH' | 'CARD' | 'TRANSFER';
    scheduledFor?: string;
    currency?: string;
  };

  const email = customerEmail.trim().toLowerCase();
  let customer = await db.orm.public.User.first({ email });
  let customerCreated = false;

  // Auto-create customer if not found
  if (!customer) {
    const firstName = customerFirstName?.trim() || 'Customer';
    const lastName = customerLastName?.trim() || 'Unknown';
    const randomPassword = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(randomPassword, config.bcryptRounds);

    customer = await db.orm.public.User.create({
      id: crypto.randomUUID(),
      email,
      passwordHash,
      firstName,
      lastName,
      phone: customerPhone ?? null,
      role: 'CUSTOMER',
      status: 'ACTIVE',
    });
    customerCreated = true;
  }

  const delivery = await createDelivery(customer, {
    pickup,
    dropoff,
    packageDescription,
    weightKg: Number(weightKg),
    distanceKm: Number(distanceKm),
    paymentMethod,
    scheduledFor: scheduledFor ?? undefined,
    currency: currency ?? 'USD',
  });

  res.status(201).json({
    delivery: serializeDelivery(delivery),
    customerCreated,
    customer: {
      id: customer.id,
      email: customer.email,
      fullName: `${customer.firstName} ${customer.lastName}`,
    },
  });
});
