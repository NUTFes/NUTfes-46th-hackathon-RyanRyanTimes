import { Octokit as BaseOctokit } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";
import { retry } from "@octokit/plugin-retry";
import { monthBounds } from "../src/lib/pipeline/validation";
import type { GitHubEvent } from "../src/lib/pipeline/types";

const Octokit = BaseOctokit.plugin(throttling, retry);
export async function fetchGitHub(month: string, options: { token?: string; org?: string; fetcher?: typeof fetch } = {}): Promise<GitHubEvent[]> {
  const token = options.token ?? process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN または --fixture が必要です");
  const client = new Octokit({ auth: token, request: { fetch: options.fetcher ?? fetch }, retry: { retries: 3 }, throttle: {
    onRateLimit: (_retryAfter: number, options: { request: { retryCount: number } }) => options.request.retryCount < 2,
    onSecondaryRateLimit: (_retryAfter: number, options: { request: { retryCount: number } }) => options.request.retryCount < 2,
  } });
  const org = options.org ?? process.env.GITHUB_ORG ?? "NUTFes";
  const { start, end } = monthBounds(month);
  const since = new Date(start).toISOString(); const until = new Date(end - 1).toISOString();
  const inMonth = (value: string | null | undefined): value is string => !!value && Date.parse(value) >= start && Date.parse(value) < end;
  const output = new Map<string, GitHubEvent>();
  function add(event: GitHubEvent) { if (inMonth(event.occurred_at)) output.set(event.id, event); }
  const repositories = await client.paginate(client.repos.listForOrg, { org, type: "all", per_page: 100 });
  for (const repository of repositories) {
    const owner = repository.owner.login; const repo = repository.name; const name = repository.full_name;
    const user = (u: { login?: string; type?: string } | null | undefined) => ({ actor: u?.login ?? "unknown", is_bot: !u?.login || u.type === "Bot" });
    // 初期化前の空リポジトリは commits が409を返す。
    try {
      const commits = await client.paginate(client.repos.listCommits, { owner, repo, since, until, per_page: 100 });
      for (const commit of commits) {
        const files: string[] = [];
        for (let page = 1; ; page++) {
          const { data } = await client.repos.getCommit({ owner, repo, ref: commit.sha, per_page: 100, page });
          files.push(...(data.files ?? []).map(f => f.filename));
          if ((data.files?.length ?? 0) < 100) break;
        }
        add({ id: `${name}:commit:${commit.sha}`, kind: "commit", ...user(commit.author), repository: name, occurred_at: commit.commit.author?.date ?? commit.commit.committer?.date ?? since, url: commit.html_url, text: commit.commit.message, files });
      }
    } catch (error) { if ((error as { status?: number }).status !== 409) throw error; }
    const pullAuthors = new Map<number, string>();
    for await (const page of client.paginate.iterator(client.pulls.list, { owner, repo, state: "all", sort: "updated", direction: "desc", per_page: 100 })) {
      let older = false;
      for (const pr of page.data) {
        if (Date.parse(pr.updated_at) < start) { older = true; break; }
        pullAuthors.set(pr.number, pr.user?.login ?? "unknown");
        if (inMonth(pr.created_at)) {
          const files = await client.paginate(client.pulls.listFiles, { owner, repo, pull_number: pr.number, per_page: 100 });
          add({ id: `${name}:pr:${pr.number}:opened`, kind: "pr_opened", ...user(pr.user), repository: name, occurred_at: pr.created_at, url: pr.html_url, text: pr.title, files: files.map(f => f.filename) });
        }
        if (inMonth(pr.merged_at)) add({ id: `${name}:pr:${pr.number}:merged`, kind: "pr_merged", ...user(pr.user), repository: name, occurred_at: pr.merged_at, url: pr.html_url, text: pr.title });
        const reviews = await client.paginate(client.pulls.listReviews, { owner, repo, pull_number: pr.number, per_page: 100 });
        for (const review of reviews) if (inMonth(review.submitted_at)) add({ id: `${name}:review:${review.id}`, kind: "review", ...user(review.user), target_author: pr.user?.login, repository: name, occurred_at: review.submitted_at, url: review.html_url, text: review.body });
      }
      if (older) break;
    }
    const comments = await client.paginate(client.pulls.listReviewCommentsForRepo, { owner, repo, since, per_page: 100 });
    for (const comment of comments) {
      if (!inMonth(comment.created_at)) continue;
      const number = Number(comment.pull_request_url.split("/").pop());
      if (!pullAuthors.has(number)) { const { data } = await client.pulls.get({ owner, repo, pull_number: number }); pullAuthors.set(number, data.user?.login ?? "unknown"); }
      add({ id: `${name}:review_comment:${comment.id}`, kind: "review_comment", ...user(comment.user), target_author: pullAuthors.get(number), repository: name, occurred_at: comment.created_at, url: comment.html_url, text: comment.body });
    }
    const issues = await client.paginate(client.issues.listForRepo, { owner, repo, state: "all", since, per_page: 100 });
    for (const issue of issues) if (!issue.pull_request && inMonth(issue.created_at)) add({ id: `${name}:issue:${issue.number}`, kind: "issue_opened", ...user(issue.user), repository: name, occurred_at: issue.created_at, url: issue.html_url, text: issue.title });
  }
  return [...output.values()];
}
