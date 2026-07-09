/**
 * The one shared email normalizer. SQLite (via Prisma) has no
 * case-insensitive filter, so every email is lowercased on write and every
 * comparison happens on the normalized form. Any code path that skips this
 * silently breaks ownership matching - use it everywhere an email is stored
 * or compared.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
