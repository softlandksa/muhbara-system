export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

const PHONE_RE = /^\d{3,15}$/;

/**
 * Returns an array of normalized phone numbers if the input looks like a
 * paste of multiple phone values (≥2, separated by newline / comma / semicolon).
 * Returns null for single-value input.
 */
export function parseMultiPhone(input: string): string[] | null {
  const parts = input
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const phones = parts.map(normalizePhone);
  if (!phones.every((p) => PHONE_RE.test(p))) return null;
  return phones;
}
