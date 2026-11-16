import { afterEach, describe, expect, it, vi } from "vitest";
import { request, RequestError } from "../src/lib/workspace-request";

afterEach(() => vi.unstubAllGlobals());

describe("workspace request", () => {
  it.each([200, 502])("非JSON応答はステータス%sでも再試行を案内する", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>upstream error</html>", {status})));
    await expect(request("/api/me")).rejects.toEqual(new RequestError("処理に失敗しました。時間をおいてもう一度お試しください。"));
  });
  it("APIの項目情報を維持する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({error:{message:"誰のいい話かを選んでください。",field:"target_member_id"}},{status:400})));
    await expect(request("/api/tips","POST",{})).rejects.toMatchObject({message:"誰のいい話かを選んでください。",field:"target_member_id"});
  });
  it("JSONのエラー詳細がなくても再試行を案内する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(null,{status:500})));
    await expect(request("/api/me")).rejects.toMatchObject({message:"処理に失敗しました。時間をおいてもう一度お試しください。"});
  });
  it("成功したJSONを返し、POST本文を送る", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({id:"tip"}));
    vi.stubGlobal("fetch", fetcher);
    await expect(request("/api/tips","POST",{body:"ありがとう"})).resolves.toEqual({id:"tip"});
    expect(fetcher).toHaveBeenCalledWith("/api/tips",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({body:"ありがとう"})});
  });
});
