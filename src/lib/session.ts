export const SESSION_COOKIE = "times_session";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
const encoder = new TextEncoder();

async function signingKey(secret: string) {
  if (secret.length < 32) throw new Error("SESSION_SECRET は32文字以上必要です。");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function signSession(id: string, secret: string) {
  const signature = await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(id));
  return `${id}.${Buffer.from(signature).toString("base64url")}`;
}
export async function verifySession(value: string | undefined, secret: string): Promise<string | null> {
  if (!value || secret.length < 32) return null;
  const parts = value.split(".");
  if (parts.length !== 2 || !/^[a-f0-9-]{36}$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await signingKey(secret), Buffer.from(parts[1], "base64url"), encoder.encode(parts[0]));
    return valid ? parts[0] : null;
  } catch { return null; }
}
export function sessionIsValid(session: { expires_at: string } | undefined, now = new Date()) {
  return !!session && Date.parse(session.expires_at) > now.getTime();
}
export function sessionCookieOptions() {
  return { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: SESSION_SECONDS };
}
export function safeReturnTo(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n\u0000-\u001f]/.test(value)) return "/tips/new";
  return value;
}
export function canUseDevLogin(nodeEnv: string | undefined, appEnv: string | undefined, enabled: string | undefined) {
  return nodeEnv === "development" && appEnv === "local" && enabled === "1";
}
export function roleStatus(member: { is_editor: boolean } | null, role: "member" | "editor"): 200 | 401 | 403 {
  return !member ? 401 : role === "editor" && !member.is_editor ? 403 : 200;
}
