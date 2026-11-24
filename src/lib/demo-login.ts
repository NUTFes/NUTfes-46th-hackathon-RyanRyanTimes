import { createHash, timingSafeEqual } from "node:crypto";

const windowMs = 10 * 60 * 1000;
const limit = 10;
const digest = (value: string) => createHash("sha256").update(value).digest();

export function demoPasscode(env: Pick<CloudflareEnv, "DEMO_PASSCODE">) {
  const passcode = env.DEMO_PASSCODE ?? process.env.DEMO_PASSCODE;
  return passcode && Array.from(passcode).length >= 16 ? passcode : undefined;
}

export async function checkDemoPasscode(db: D1Database, request: Request, expected: string, input: unknown) {
  const now = Date.now();
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  if (typeof input === "string" && timingSafeEqual(digest(expected), digest(input))) {
    const blocked = await db.prepare(
      "SELECT 1 FROM demo_login_attempts WHERE ip = ? AND expires_at > ? AND failures >= ?",
    ).bind(ip, now, limit).first();
    return blocked ? 429 : 200;
  }

  const [result] = await db.batch([
    db.prepare(`
      INSERT INTO demo_login_attempts (ip, expires_at, failures) VALUES (?, ?, 1)
      ON CONFLICT(ip) DO UPDATE SET
        expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END,
        failures = CASE WHEN expires_at <= ? THEN 1 ELSE failures + 1 END
      WHERE expires_at <= ? OR failures < ?
      RETURNING failures
    `).bind(ip, now + windowMs, now, now, now, limit),
    db.prepare("DELETE FROM demo_login_attempts WHERE expires_at <= ?").bind(now),
  ]);
  return result.results.length ? 403 : 429;
}

export const demoLoginError = (status: number) => status === 429
  ? "試行回数の上限に達しました。時間をおいてお試しください。"
  : "デモ用パスコードを確認してください。";
