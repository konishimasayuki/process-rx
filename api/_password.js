import crypto from "crypto";

// パスワードは scrypt でハッシュ化して保存する(平文では保存しない)
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const [, salt, hash] = stored.split("$");
  const expected = Buffer.from(hash, "hex");
  const actual = crypto.scryptSync(String(password), salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}
