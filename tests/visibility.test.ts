import { describe, expect, it } from "vitest";
import { isArticleVisible, visibleArticles } from "../src/lib/visibility";
describe("読者に返す記事", () => {
  const base = { issue_status: "published", opted_out_at: null };
  it.each(["draft", "selected", "unselected", "retracted", "hidden"])("%s は一覧・個別の公開対象外", status => {
    expect(isArticleVisible({ ...base, status })).toBe(false);
  });
  it("公開中の記事だけを残す", () => {
    expect(visibleArticles(["draft", "published", "hidden", "published", "retracted"].map((status, id) => ({ ...base, status, id }))).map(a => a.id)).toEqual([1, 3]);
  });
  it("公開記事でも未発行の号・号なし・オプトアウトは対象外", () => {
    expect(isArticleVisible({ ...base, status: "published", issue_status: "editing" })).toBe(false);
    expect(isArticleVisible({ ...base, status: "published", issue_status: null })).toBe(false);
    expect(isArticleVisible({ ...base, status: "published", opted_out_at: "2026-11-16T00:00:00Z" })).toBe(false);
  });
});
