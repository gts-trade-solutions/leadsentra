// Shared password-complexity rules so /api/auth/register and the signup UI
// can't drift out of sync.

const COMMON = new Set([
  "password",
  "12345678",
  "qwerty123",
  "letmein123",
  "admin1234",
  "password123",
  "passw0rd1234",
  "iloveyou123",
  "welcome1234",
]);

export function validatePassword(pw: string): string | null {
  if (pw.length < 12) return "Password must be at least 12 characters";
  if (!/[a-z]/.test(pw)) return "Password must contain a lowercase letter";
  if (!/[A-Z]/.test(pw)) return "Password must contain an uppercase letter";
  if (!/[0-9]/.test(pw)) return "Password must contain a number";
  if (COMMON.has(pw.toLowerCase())) return "Password is too common";
  return null;
}
