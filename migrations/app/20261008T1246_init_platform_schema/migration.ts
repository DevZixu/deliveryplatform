#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0055f2532f279509e5d098be55e55131fbf6798e3c9d6439fc4486bdb65b65f9/contract';
import endContract from '../../snapshots/0055f2532f279509e5d098be55e55131fbf6798e3c9d6439fc4486bdb65b65f9/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createTable({
        schema: 'public',
        table: 'deliveries',
        columns: [
          col('assignedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('cancelReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('cancellationActorId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('cancelledAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('currency', 'text', {
            notNull: true,
            default: lit('USD'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('customerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('deliveredAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('deliveryAddress', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('deliveryCity', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('deliveryNote', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('deliveryPhone', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('distanceKm', 'numeric', {
            notNull: true,
            default: lit('1'),
            codecRef: { codecId: 'pg/numeric@1' },
          }),
          col('fee', 'numeric', { notNull: true, codecRef: { codecId: 'pg/numeric@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('packageDescription', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('pickedUpAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('pickupAddress', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('pickupCity', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('pickupName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('pickupNote', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('pickupPhone', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('recipientName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('riderId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('scheduledFor', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('trackingCode', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('weightKg', 'numeric', {
            notNull: true,
            default: lit('1'),
            codecRef: { codecId: 'pg/numeric@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'deliveries_status_check_6d1168c9',
            `"status" IN ('PENDING', 'CONFIRMED', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED')`,
          ),
          checkExpression('delivery_fee_non_negative_1b43b512', 'fee >= 0'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'delivery_events',
        columns: [
          col('actorId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('deliveryId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('fromStatus', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('toStatus', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'delivery_events_fromStatus_check_ab6b448e',
            `"fromStatus" IN ('PENDING', 'CONFIRMED', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED')`,
          ),
          checkExpression(
            'delivery_events_toStatus_check_58a77e7e',
            `"toStatus" IN ('PENDING', 'CONFIRMED', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'payments',
        columns: [
          col('amount', 'numeric', { notNull: true, codecRef: { codecId: 'pg/numeric@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('currency', 'text', {
            notNull: true,
            default: lit('USD'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('deliveryId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('failureReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('gatewayRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('method', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('paidAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('reference', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('refundedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('payment_amount_non_negative_2ce36fec', 'amount >= 0'),
          checkExpression(
            'payments_method_check_5dc49e27',
            `"method" IN ('CASH', 'CARD', 'TRANSFER')`,
          ),
          checkExpression(
            'payments_status_check_d65fcf38',
            `"status" IN ('PENDING', 'SUCCESSFUL', 'FAILED', 'REFUNDED')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'rider_profiles',
        columns: [
          col('availability', 'text', {
            notNull: true,
            default: lit('OFFLINE'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('city', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('completedRuns', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('isVerified', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('licenseNumber', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('vehiclePlate', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('vehicleType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'rider_profiles_availability_check_91d6c61d',
            `"availability" IN ('AVAILABLE', 'BUSY', 'OFFLINE')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'users',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('email', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('firstName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('passwordHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('phone', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('role', 'text', {
            notNull: true,
            default: lit('CUSTOMER'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('status', 'text', {
            notNull: true,
            default: lit('ACTIVE'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('users_role_check_b7d9e498', `"role" IN ('CUSTOMER', 'RIDER', 'ADMIN')`),
          checkExpression(
            'users_status_check_a34ffd8e',
            `"status" IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')`,
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'deliveries',
        constraint: 'deliveries_trackingCode_key',
        columns: ['trackingCode'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'payments',
        constraint: 'payments_reference_key',
        columns: ['reference'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'payments',
        constraint: 'payments_deliveryId_key',
        columns: ['deliveryId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'rider_profiles',
        constraint: 'rider_profiles_userId_key',
        columns: ['userId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'users',
        constraint: 'users_email_key',
        columns: ['email'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'deliveries',
        index: 'deliveries_createdAt_idx_9575dbd7',
        columns: ['createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'deliveries',
        index: 'deliveries_customerId_idx_b2a8a46c',
        columns: ['customerId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'deliveries',
        index: 'deliveries_customerId_status_idx_2986b558',
        columns: ['customerId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'deliveries',
        index: 'deliveries_riderId_idx_966752c5',
        columns: ['riderId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'deliveries',
        index: 'deliveries_riderId_status_idx_087b46d8',
        columns: ['riderId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'deliveries',
        index: 'deliveries_status_createdAt_idx_58610442',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'delivery_events',
        index: 'delivery_events_actorId_idx_a58f6b4b',
        columns: ['actorId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'delivery_events',
        index: 'delivery_events_deliveryId_createdAt_idx_432caeb8',
        columns: ['deliveryId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'delivery_events',
        index: 'delivery_events_deliveryId_idx_ebc950f6',
        columns: ['deliveryId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'payments',
        index: 'payments_status_createdAt_idx_58610442',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'rider_profiles',
        index: 'rider_profiles_availability_isVerified_idx_b65beb9f',
        columns: ['availability', 'isVerified'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'users',
        index: 'users_role_status_idx_e87879e1',
        columns: ['role', 'status'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'deliveries',
        foreignKey: {
          name: 'deliveries_customerId_fkey',
          columns: ['customerId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'deliveries',
        foreignKey: {
          name: 'deliveries_riderId_fkey',
          columns: ['riderId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'delivery_events',
        foreignKey: {
          name: 'delivery_events_deliveryId_fkey',
          columns: ['deliveryId'],
          references: { schema: 'public', table: 'deliveries', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'delivery_events',
        foreignKey: {
          name: 'delivery_events_actorId_fkey',
          columns: ['actorId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'payments',
        foreignKey: {
          name: 'payments_deliveryId_fkey',
          columns: ['deliveryId'],
          references: { schema: 'public', table: 'deliveries', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'rider_profiles',
        foreignKey: {
          name: 'rider_profiles_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
