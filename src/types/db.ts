import type { ResultType } from '@prisma/orm-postgres/components/runtime';
import type { db } from '../prisma/db.js';

export type UserRow = ResultType<typeof db.orm.public.User>;
export type DeliveryRow = ResultType<typeof db.orm.public.Delivery>;
export type PaymentRow = ResultType<typeof db.orm.public.Payment>;
export type RiderProfileRow = ResultType<typeof db.orm.public.RiderProfile>;
export type DeliveryEventRow = ResultType<typeof db.orm.public.DeliveryEvent>;

export type UserRole = UserRow['role'];
export type AccountStatus = UserRow['status'];
export type DeliveryStatus = DeliveryRow['status'];
export type PaymentStatus = PaymentRow['status'];
export type PaymentMethod = PaymentRow['method'];
export type RiderAvailability = RiderProfileRow['availability'];

/** Compact actor reference returned by `.include('customer'/'rider', select...)`. */
export type ActorRef = {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string | null;
};

/** Delivery rows with eagerly-loaded relations (from `.include(...)` queries). */
export type DeliveryWithRelations = DeliveryRow & {
  payment?: PaymentRow | null;
  customer?: ActorRef | null;
  rider?: ActorRef | null;
  events?: DeliveryEventRow[];
};
