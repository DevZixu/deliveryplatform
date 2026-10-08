import { randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function code(prefix: string, length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${prefix}-${out}`;
}

/** Human-friendly, URL-safe tracking code, e.g. `DLV-7K3M2QX9`. */
export const trackingCode = (): string => code('DLV', 8);

/** Payment reference, e.g. `PAY-4H2K9M2QX7AB`. */
export const paymentReference = (): string => code('PAY', 12);

/** Simulated gateway reference for successful card / transfer charges. */
export const gatewayReference = (): string => `gw_${randomBytes(8).toString('hex')}`;
