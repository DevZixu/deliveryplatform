import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError } from '../lib/errors.js';

export type FieldRule = {
  required?: boolean;
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  enum?: readonly string[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  items?: FieldRule;
  fields?: Record<string, FieldRule>;
  trim?: boolean;
  default?: unknown;
  message?: string;
  /** Extra predicate; receives the already-coerced value. */
  validate?: (value: unknown) => boolean;
};

type Rules = Record<string, FieldRule>;

const typeOf = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

function check(value: unknown, rule: FieldRule, path: string, errors: string[]): unknown {
  if (value === undefined || value === null || value === '') {
    if (rule.default !== undefined) return rule.default;
    if (rule.required) {
      errors.push(rule.message ?? `${path} is required`);
      return undefined;
    }
    return undefined;
  }

  let coerced = value;

  if (rule.type === 'string') {
    if (typeof coerced !== 'string') {
      errors.push(rule.message ?? `${path} must be a string`);
      return undefined;
    }
    if (rule.trim !== false) coerced = coerced.trim();
  }

  if (rule.type === 'number' || rule.type === 'integer') {
    const n = typeof coerced === 'string' && coerced.trim() !== '' ? Number(coerced) : coerced;
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      errors.push(rule.message ?? `${path} must be a number`);
      return undefined;
    }
    if (rule.type === 'integer' && !Number.isInteger(n)) {
      errors.push(rule.message ?? `${path} must be an integer`);
      return undefined;
    }
    coerced = n;
  }

  if (rule.type === 'boolean') {
    if (typeof coerced === 'string' && (coerced === 'true' || coerced === 'false')) {
      coerced = coerced === 'true';
    }
    if (typeof coerced !== 'boolean') {
      errors.push(rule.message ?? `${path} must be a boolean`);
      return undefined;
    }
  }

  if (rule.enum && !(rule.enum as readonly string[]).includes(String(coerced))) {
    errors.push(rule.message ?? `${path} must be one of: ${rule.enum.join(', ')}`);
    return undefined;
  }

  if (rule.type === 'array') {
    if (!Array.isArray(coerced)) {
      errors.push(rule.message ?? `${path} must be an array`);
      return undefined;
    }
    if (rule.minLength !== undefined && coerced.length < rule.minLength) {
      errors.push(rule.message ?? `${path} must contain at least ${rule.minLength} item(s)`);
      return undefined;
    }
    if (rule.items) {
      const items: unknown[] = [];
      coerced.forEach((item, index) => items.push(check(item, rule.items!, `${path}[${index}]`, errors)));
      return items;
    }
    return coerced;
  }

  if (rule.type === 'object') {
    if (typeOf(coerced) !== 'object') {
      errors.push(rule.message ?? `${path} must be an object`);
      return undefined;
    }
    if (rule.fields) return checkFields(coerced as Record<string, unknown>, rule.fields, path, errors);
    return coerced;
  }

  if (typeof coerced === 'string') {
    if (rule.minLength !== undefined && coerced.length < rule.minLength) {
      errors.push(rule.message ?? `${path} must be at least ${rule.minLength} characters`);
      return undefined;
    }
    if (rule.maxLength !== undefined && coerced.length > rule.maxLength) {
      errors.push(rule.message ?? `${path} must be at most ${rule.maxLength} characters`);
      return undefined;
    }
    if (rule.pattern && !rule.pattern.test(coerced)) {
      errors.push(rule.message ?? `${path} is invalid`);
      return undefined;
    }
  }

  if (typeof coerced === 'number') {
    if (rule.min !== undefined && coerced < rule.min) {
      errors.push(rule.message ?? `${path} must be at least ${rule.min}`);
      return undefined;
    }
    if (rule.max !== undefined && coerced > rule.max) {
      errors.push(rule.message ?? `${path} must be at most ${rule.max}`);
      return undefined;
    }
  }

  if (rule.validate && !rule.validate(coerced)) {
    errors.push(rule.message ?? `${path} is invalid`);
    return undefined;
  }

  return coerced;
}

function checkFields(
  body: Record<string, unknown>,
  rules: Rules,
  prefix: string,
  errors: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };

  for (const [field, rule] of Object.entries(rules)) {
    const path = prefix ? `${prefix}.${field}` : field;
    const value = check(body[field], rule, path, errors);
    if (value === undefined) {
      if (rule.default !== undefined) out[field] = rule.default;
      else if (!(rule.required) && body[field] === undefined) delete out[field];
      else if (body[field] === undefined) delete out[field];
    } else {
      out[field] = value;
    }
  }

  return out;
}

/**
 * Validates (and normalises) `req.body` against a rule set.
 * On failure responds `400 { error, details }`; on success replaces `req.body`
 * with the coerced value so handlers work with normalised input.
 */
export function validateBody(rules: Rules): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: string[] = [];
    const body = req.body && typeOf(req.body) === 'object' ? (req.body as Record<string, unknown>) : {};
    const normalized = checkFields(body, rules, '', errors);
    if (errors.length) return next(ApiError.validation(errors));
    req.body = normalized;
    return next();
  };
}
