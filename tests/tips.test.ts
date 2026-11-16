import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeTipLinks, validateTip } from "../src/lib/tip-validation";

const state = vi.hoisted(() => ({
  target: { id: "target", is_active: 1, opted_out_at: null } as Record<string, unknown> | undefined,
  saved: [] as unknown[],
}));
vi.mock("@/lib/auth", () => ({ guardRole: async () => ({ member: { id: "sender" } }) }));
vi.mock("@/lib/reader", () => ({ invalidatePublicCache: vi.fn(), validIssuePath: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: async () => ({ env: { DB: {
  prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({
    all: async () => ({ results: sql.includes("FROM members") ? (state.target ? [state.target] : []) : [{ id: "saved" }] }),
    run: async () => { state.saved = args; },
  }) }),
} } }) }));
import { POST } from "../src/app/api/[...path]/route";

const base = { target_member_id: "target", body: "助かりました！", links: [], is_anonymous: false };
async function post(overrides: Record<string, unknown> = {}) {
  const response = await POST(new Request("http://localhost/api/tips", {
    method: "POST", headers: { origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ ...base, ...overrides }),
  }), { params: Promise.resolve({ path: ["tips"] }) });
  const value = await response.json() as { error?: { code: string; message: string; field?: string }; id?: string };
  return { status: response.status, value };
}

describe("タレコミ共通バリデーター", () => {
  it("空行・前後の空白を除去しホスト形式に https を補完する", () => {
    expect(normalizeTipLinks([" ", " slack.com/archives/abc ", "http://example.com", "https://example.org"])).toEqual([
      "https://slack.com/archives/abc", "http://example.com", "https://example.org",
    ]);
  });
  it("クライアントの対象一覧でも選択を検証する", () => {
    expect(validateTip(base, ["other"]).error?.field).toBe("target_member_id");
  });
  it("1000字はUnicodeコードポイントで数える", () => {
    expect(validateTip({ ...base, body: "🐼".repeat(1000) }).error).toBeUndefined();
    expect(validateTip({ ...base, body: "🐼".repeat(1001) }).error?.message).toBe("何が良かったかは1000字までです。");
  });
});

describe("POST /api/tips", () => {
  beforeEach(() => { state.target = { id: "target", is_active: 1, opted_out_at: null }; state.saved = []; });
  it("正規化したリンクと本文を保存する", async () => {
    expect((await post({ body: "  ありがとう  ", links: [" ", " slack.com/archives/abc ", "http://example.com"] })).status).toBe(200);
    expect(state.saved[4]).toBe("ありがとう");
    expect(JSON.parse(state.saved[5] as string)).toEqual(["https://slack.com/archives/abc", "http://example.com"]);
  });
  it.each([
    [{ target_member_id: "" }, "target_member_id", "誰のいい話かを選んでください。"],
    [{ target_member_id: null }, "target_member_id", "誰のいい話かを選んでください。"],
    [{ body: "  " }, "body", "何が良かったかを書いてください。"],
    [{ body: "あ".repeat(1001) }, "body", "何が良かったかは1000字までです。"],
    [{ links: Array(4).fill("example.com") }, "links", "関連リンクは3件までです。"],
    [{ links: ["https://example.com", "bad link"] }, "links", "関連リンクは https:// から始まる URL を1行に1つずつ書いてください（2行目）。"],
    [{ links: ["javascript:alert(1)"] }, "links", "関連リンクは https:// から始まる URL を1行に1つずつ書いてください（1行目）。"],
    [{ links: [123] }, "links", "関連リンクは https:// から始まる URL を1行に1つずつ書いてください（1行目）。"],
    [{ links: null }, "links", "関連リンクは https:// から始まる URL を1行に1つずつ書いてください（1行目）。"],
  ])("項目に対応するメッセージを返す: %j", async (body, field, message) => {
    expect(await post(body)).toEqual({ status: 400, value: { error: { code: "validation_error", field, message } } });
    expect(state.saved).toEqual([]);
  });
  it("匿名の型が違う場合は汎用メッセージを返す", async () => {
    expect((await post({ is_anonymous: "false" })).value.error).toEqual({ code: "validation_error", message: "入力内容を確認してください。" });
  });
  it("存在しない局員の選択を案内する", async () => {
    state.target = undefined;
    expect((await post()).value.error).toEqual({ code: "validation_error", field: "target_member_id", message: "誰のいい話かを選んでください。" });
  });
  it.each([{ id: "sender" }, { is_active: 0 }, { opted_out_at: "2026-11-16" }])("自分・無効・対象外の局員へ送れない: %j", async patch => {
    Object.assign(state.target!, patch);
    expect((await post()).value.error).toEqual({ code: "validation_error", field: "target_member_id", message: "その局員にはタレコミを送れません。" });
    expect(state.saved).toEqual([]);
  });
});
