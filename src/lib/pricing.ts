import { config } from '../config/env.js';

export type FeeInput = {
  distanceKm: number;
  weightKg?: number;
};

/**
 * Server-side pricing. The client never sets the price — it only asks for a
 * quote and the same function is used when the delivery is created.
 */
export function calculateFee({ distanceKm, weightKg = 1 }: FeeInput): number {
  const { baseFee, perKm, minimumFee, perKgSurcharge } = config.pricing;
  const weight = Number.isFinite(weightKg) && weightKg > 0 ? weightKg : 1;
  const raw = baseFee + perKm * distanceKm + perKgSurcharge * Math.max(0, weight - 1);
  return Math.max(minimumFee, Math.round(raw * 100) / 100);
}

export function quoteFee(input: FeeInput): { fee: number; currency: string } {
  return { fee: calculateFee(input), currency: 'USD' };
}
