import { expect, it } from "vitest";
import { fetchGitHub } from "../scripts/github";

it("レート制限後に再試行する（通信はすべて架空の応答）", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return calls === 1
      ? new Response(JSON.stringify({ message: "API rate limit exceeded" }), { status: 403, headers: { "content-type": "application/json", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "0", "retry-after": "0" } })
      : new Response("[]", { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  expect(await fetchGitHub("2026-11", { org: "fictional", token: "fake", fetcher })).toEqual([]);
  expect(calls).toBe(2);
});

it("GitHub のページを最後まで読み、以前に開いたPRの当月レビューと変更ファイルも取得する", async () => {
  const calls: string[] = [];
  const person = { login: "fixture-developer", type: "User" };
  const base = "https://api.github.com";
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    calls.push(`${url.pathname}${url.search}`);
    let data: unknown = []; const headers: Record<string, string> = { "content-type": "application/json" };
    if (url.pathname === "/orgs/fictional/repos" && !url.searchParams.has("page")) {
      data = [{ owner: { login: "fictional" }, name: "sample", full_name: "fictional/sample" }];
      headers.link = `<${base}/orgs/fictional/repos?page=2>; rel="next"`;
    } else if (url.pathname.endsWith("/commits")) data = [{ sha: "fake-sha", author: person, commit: { author: { date: "2026-11-03T00:00:00Z" }, message: "架空の変更" }, html_url: "https://example.invalid/commit" }];
    else if (url.pathname.endsWith("/commits/fake-sha")) data = { files: url.searchParams.get("page") === "1" ? Array.from({ length: 100 }, (_, i) => ({ filename: `src/fake-${i}.ts` })) : [{ filename: "docs/guide.md" }] };
    else if (url.pathname.endsWith("/pulls")) data = [
      { number: 1, user: person, title: "以前のPR", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-11-10T00:00:00Z", merged_at: "2026-11-10T00:00:00Z", html_url: "https://example.invalid/old-pr" },
      { number: 2, user: person, title: "今月のPR", created_at: "2026-11-02T00:00:00Z", updated_at: "2026-11-03T00:00:00Z", merged_at: null, html_url: "https://example.invalid/new-pr" },
    ];
    else if (url.pathname.endsWith("/pulls/2/files")) data = [{ filename: "README.md" }];
    else if (url.pathname.endsWith("/pulls/1/reviews")) data = [{ id: 5, user: { login: "fixture-reviewer", type: "User" }, submitted_at: "2026-11-09T00:00:00Z", body: "架空のレビュー", html_url: "https://example.invalid/review" }];
    else if (url.pathname.endsWith("/pulls/comments")) data = [{ id: 6, user: person, created_at: "2026-11-04T00:00:00Z", pull_request_url: `${base}/repos/fictional/sample/pulls/1`, html_url: "https://example.invalid/comment", body: "架空のコメント" }];
    else if (url.pathname.endsWith("/issues")) data = [
      { number: 3, user: person, created_at: "2026-11-06T00:00:00Z", title: "架空の課題", html_url: "https://example.invalid/issue" },
      { number: 4, user: person, created_at: "2026-10-01T00:00:00Z", title: "対象外" },
      { number: 5, user: person, created_at: "2026-11-07T00:00:00Z", pull_request: {} },
    ];
    return new Response(JSON.stringify(data), { headers });
  }) as typeof fetch;
  const events = await fetchGitHub("2026-11", { org: "fictional", token: "fake-token", fetcher: fakeFetch });
  expect(events.map(e => e.kind).sort()).toEqual(["commit", "issue_opened", "pr_merged", "pr_opened", "review", "review_comment"]);
  expect(events.find(e => e.kind === "commit")?.files).toHaveLength(101);
  expect(events.find(e => e.kind === "pr_opened")?.files).toEqual(["README.md"]);
  expect(events.find(e => e.kind === "review")?.target_author).toBe("fixture-developer");
  expect(calls.some(c => c.includes("repos?page=2"))).toBe(true);
  expect(calls.some(c => c.includes("fake-sha") && c.includes("page=2"))).toBe(true);
});
