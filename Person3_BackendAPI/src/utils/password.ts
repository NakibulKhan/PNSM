/**
 * Password and PIN hashing. Uses bcryptjs (pure JS, no native build step) —
 * deliberately, so this backend never depends on a compiler toolchain being
 * available at install time.
 *
 * Rule (locked constraint #6): password_hash, pin_hash, and biometric
 * embeddings are never sent to any client. Mongoose enforces this at the
 * schema level (`select: false`); these functions are the only place a
 * plaintext value and its hash ever exist in the same scope.
 */
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { BCRYPT_SALT_ROUNDS, BCRYPT_PIN_SALT_ROUNDS } from '../config/env';

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_SALT_ROUNDS);
}

export async function comparePassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/**
 * The 4-digit 2FA PIN. Set by Admin/HR at onboarding, never chosen by the
 * employee (Person 1's OnboardingScreen deliberately doesn't offer this) —
 * see architecture report §4. A lower cost factor is fine here: a 4-digit
 * space is small regardless, the real protection is rate-limiting attempts
 * at the route layer plus PIN check happening before anything else in the
 * check-in pipeline (report §7 validation order).
 */
export async function hashPin(pin: string): Promise<string> {
  if (!/^\d{4}$/.test(pin)) {
    throw new Error('PIN must be exactly 4 digits');
  }
  return bcrypt.hash(pin, BCRYPT_PIN_SALT_ROUNDS);
}

export async function comparePin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

/** Generates a random 4-digit PIN as a string, e.g. "0842". Used at employee creation. */
export function generatePin(): string {
  // crypto.randomInt (CSPRNG), not Math.random() — cheap defense-in-depth
  // even though the real protection against guessing is rate-limiting plus
  // the PIN being only one of several gates a check-in must pass (report §7).
  return String(randomInt(0, 10000)).padStart(4, '0');
}
