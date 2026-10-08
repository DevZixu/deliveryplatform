import { randomBytes } from 'node:crypto';
import type { Request } from 'express';

export type Pagination = {
  page: number;
  limit: number;
  offset: number;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export function getPagination(req: Request, defaultLimit = 20): Pagination {
  const page = clamp(Number.parseInt(String(req.query.page ?? '1'), 10) || 1, 1, 100_000);
  const limit = clamp(
    Number.parseInt(String(req.query.limit ?? defaultLimit), 10) || defaultLimit,
    1,
    100,
  );
  return { page, limit, offset: (page - 1) * limit };
}

export function paged<T>(data: T[], total: number, { page, limit }: Pagination) {
  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export function getStringQuery(req: Request, key: string): string | undefined {
  const raw = req.query[key];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
