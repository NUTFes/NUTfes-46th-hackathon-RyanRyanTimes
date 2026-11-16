import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { normalizeTipLinks, validateTip } from "../src/lib/tip-validation";

const state = vi.hoisted(() => ({
  db: undefined as DatabaseSync | undefined,
  beforeInsert: undefined as (() => void) | undefined,
  saved: [] as unknown[],
}));
vi.mock("@/lib/auth", () => ({ guardRole: async () => ({ member: { id: "sender" } }) }));
vi.mock("@/lib/reader", () => ({ invalidatePublicCache: vi.fn(), validIssuePath: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: async () => ({ env: { DB: {
  prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({
    all: async () => ({ results: state.db!.prepare(sql).all(...args as SQLInputValue[]) }),
    run: async () => {
      state.beforeInsert?.();
      const result = state.db!.prepare(sql).run(...args as SQLInputValue[]);
      if (result.changes) state.saved = args;
      return result;
    },
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
  it.each(["//example.com/path", "user@example.com", "example.com?x=1", "日本語.jp", "foo.123", "example.com:abc", "foo..com", "https://user@example.com", "https://user:pass@example.com", "https://:pass@example.com"]) ("曖昧な入力や認証情報を補完せず拒否する: %s", link => {
    expect(normalizeTipLinks([link])).toEqual([link]);
    expect(validateTip({ ...base, links: ["https://example.com", link] }).error).toMatchObject({field:"links",message:expect.stringContaining("2行目")});
  });
  it("ASCII ドメインだけ補完し、ポートとパスを扱う", () => {
    expect(normalizeTipLinks(["EXAMPLE.COM:8443/path?q=1#part", "sub.example.org/a"])).toEqual(["https://EXAMPLE.COM:8443/path?q=1#part", "https://sub.example.org/a"]);
  });
  it("明示された国際化ドメインを punycode の href に統一する", () => {
    const result = validateTip({...base, links:["https://例え.jp/記事", "HTTPS://EXAMPLE.COM:443"]});
    expect(result.error).toBeUndefined();
    expect(result.links).toEqual([new URL("https://例え.jp/記事").href, "https://example.com/"]);
  });
  it("空行を含めた入力の行番号を返す", () => {
    expect(validateTip({...base,links:["", "example.com", " ", "//example.com"]}).error?.message).toContain("4行目");
  });
  it("1000字はUnicodeコードポイントで数える", () => {
    expect(validateTip({ ...base, body: "🐼".repeat(1000) }).error).toBeUndefined();
    expect(validateTip({ ...base, body: "🐼".repeat(1001) }).error?.message).toBe("何が良かったかは1000字までです。");
  });
});

describe("POST /api/tips", () => {
  beforeEach(() => {
    state.db = new DatabaseSync(":memory:");
    state.db.exec(`CREATE TABLE members (id TEXT PRIMARY KEY, is_active INTEGER, opted_out_at TEXT);
      CREATE TABLE tips (id TEXT PRIMARY KEY, target_member_id TEXT, sender_member_id TEXT, is_anonymous INTEGER, body TEXT, links TEXT, status TEXT, created_at TEXT);
      INSERT INTO members VALUES ('target',1,NULL),('sender',1,NULL);`);
    state.saved = []; state.beforeInsert = undefined;
  });
  afterEach(() => state.db?.close());
  it("正規化したリンクと本文を保存する", async () => {
    expect((await post({ body: "  ありがとう  ", links: [" ", " slack.com/archives/abc ", "http://example.com"] })).status).toBe(200);
    expect(state.saved[4]).toBe("ありがとう");
    expect(JSON.parse(state.saved[5] as string)).toEqual(["https://slack.com/archives/abc", "http://example.com/"]);
  });
  it("国際化 URL を正規化して保存する", async () => {
    expect((await post({links:["https://例え.jp/記事"]})).status).toBe(200);
    expect(JSON.parse(state.saved[5] as string)).toEqual([new URL("https://例え.jp/記事").href]);
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
    [{ links: ["//example.com"] }, "links", "関連リンクは https:// から始まる URL を1行に1つずつ書いてください（1行目）。"],
    [{ links: ["https://user:pass@example.com"] }, "links", "関連リンクは https:// から始まる URL を1行に1つずつ書いてください（1行目）。"],
    [{ links: null }, "links", "関連リンクは https:// から始まる URL を1行に1つずつ書いてください（1行目）。"],
  ])("項目に対応するメッセージを返す: %j", async (body, field, message) => {
    expect(await post(body)).toEqual({ status: 400, value: { error: { code: "validation_error", field, message } } });
    expect(state.saved).toEqual([]);
  });
  it("匿名の型が違う場合は汎用メッセージを返す", async () => {
    expect((await post({ is_anonymous: "false" })).value.error).toEqual({ code: "validation_error", message: "入力内容を確認してください。" });
  });
  it("存在しない局員の選択を案内する", async () => {
    state.db!.exec("DELETE FROM members WHERE id='target'");
    expect((await post()).value.error).toEqual({ code: "validation_error", field: "target_member_id", message: "誰のいい話かを選んでください。" });
  });
  it.each(["self", "inactive", "opted-out"])("自分・無効・対象外の局員へ送れない: %s", async kind => {
    if (kind === "inactive") state.db!.exec("UPDATE members SET is_active=0 WHERE id='target'");
    if (kind === "opted-out") state.db!.exec("UPDATE members SET opted_out_at='2026-11-16' WHERE id='target'");
    expect((await post(kind === "self" ? {target_member_id:"sender"} : {})).value.error).toEqual({ code: "validation_error", field: "target_member_id", message: "誰のいい話かを選んでください。" });
    expect(state.saved).toEqual([]);
  });
  it.each(["UPDATE members SET opted_out_at='2026-11-16' WHERE id='target'", "UPDATE members SET is_active=0 WHERE id='target'", "DELETE FROM members WHERE id='target'"])("確認後に対象が変わっても保存せず項目エラーを返す: %s", async sql => {
    state.beforeInsert = () => state.db!.exec(sql);
    expect(await post()).toEqual({status:400,value:{error:{code:"validation_error",field:"target_member_id",message:"誰のいい話かを選んでください。"}}});
    expect(state.db!.prepare("SELECT * FROM tips").all()).toEqual([]);
  });
  it("1日20件の制限は項目なしの429を返す", async () => {
    const insert = state.db!.prepare("INSERT INTO tips (id,sender_member_id,created_at) VALUES (?,'sender',?)");
    for(let i=0;i<20;i++) insert.run(`old-${i}`,new Date().toISOString());
    expect(await post()).toEqual({status:429,value:{error:{code:"rate_limited",message:"1日20件までです。"}}});
    expect(state.saved).toEqual([]);
  });
});
