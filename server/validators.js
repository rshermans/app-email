export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

export function positiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function publicSmtpSettings(row) {
  if (!row) return null;

  return {
    id: row.id,
    host: row.host,
    port: row.port,
    from_email: row.from_email,
    secure: Boolean(row.secure),
    max_per_minute: row.max_per_minute,
    hasPassword: Boolean(row.password_encrypted),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
