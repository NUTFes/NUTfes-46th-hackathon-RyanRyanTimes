import { describe, expect, it } from "vitest";
import { canUseDevLogin, roleStatus, safeReturnTo, SESSION_SECONDS, sessionCookieOptions, sessionIsValid, signSession, verifySession } from "../src/lib/session";
const secret = "a-local-test-secret-with-more-than-32-characters";
const id = "12345678-1234-4234-8234-123456789abc";
describe("署名付きセッション", () => {
  it("正しい署名のみ認証する", async () => {
    const cookie = await signSession(id, secret);
    expect(await verifySession(cookie, secret)).toBe(id);
    expect(await verifySession(cookie.replace("12345678", "87654321"), secret)).toBeNull();
    expect(await verifySession(cookie, `${secret}x`)).toBeNull();
    expect(await verifySession(`${cookie}x`, secret)).toBeNull();
  });
  it("不正な形式と未設定の秘密を拒否する", async () => {
    for (const value of [undefined, "", "malformed", "a.b.c", `${id}.!!!!`]) expect(await verifySession(value, secret)).toBeNull();
    expect(await verifySession(await signSession(id, secret), "short")).toBeNull();
    await expect(signSession(id, "short")).rejects.toThrow();
  });
  it("DB にない・期限切れ・不正な期限は認証しない", () => {
    const now = new Date("2026-11-16T00:00:00Z");
    expect(sessionIsValid(undefined, now)).toBe(false);
    expect(sessionIsValid({ expires_at: now.toISOString() }, now)).toBe(false);
    expect(sessionIsValid({ expires_at: "invalid" }, now)).toBe(false);
    expect(sessionIsValid({ expires_at: "2026-11-17T00:00:00Z" }, now)).toBe(true);
  });
  it("30日・HttpOnly・Secure・SameSite=Lax", () => {
    expect(sessionCookieOptions()).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_SECONDS });
    expect(SESSION_SECONDS).toBe(2592000);
  });
  it("外部へのログイン後リダイレクトを防ぐ", () => {
    for (const value of ["https://example.com", "//example.com", "/\\example.com", "/\r\nhello", undefined]) expect(safeReturnTo(value)).toBe("/tips/new");
    expect(safeReturnTo("/tips/new?from=article")).toBe("/tips/new?from=article");
  });
  it("開発用ログインは本番で有効にならない", () => {
    expect(canUseDevLogin("development", "local", "1")).toBe(true);
    expect(canUseDevLogin("production", "local", "1")).toBe(false);
    expect(canUseDevLogin("development", "production", "1")).toBe(false);
    expect(canUseDevLogin("development", "local", "0")).toBe(false);
  });
  it("未ログインは401、局員による編集部アクセスは403", () => {
    expect(roleStatus(null, "member")).toBe(401);
    expect(roleStatus(null, "editor")).toBe(401);
    expect(roleStatus({ is_editor: false }, "member")).toBe(200);
    expect(roleStatus({ is_editor: false }, "editor")).toBe(403);
    expect(roleStatus({ is_editor: true }, "editor")).toBe(200);
  });
});
