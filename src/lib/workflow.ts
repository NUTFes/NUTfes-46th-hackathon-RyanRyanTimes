import { validateTip } from "./tip-validation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lintDraft } from "./pipeline/drafts";
import { invalidatePublicCache, validIssuePath } from "./reader";

// D1 の JSON 列は境界で復元し、更新を同一オリジンと権限で保護する。
export type Row = Record<string, any>;
export class WorkflowError extends Error { constructor(public status: number, public code: string, message: string, public field?: string) { super(message); } }
export function check(ok: unknown, message = "入力内容を確認してください。", status = 400, code = "validation_error", field?: string): asserts ok { if (!ok) throw new WorkflowError(status, code, message, field); }
export function transition(status: string, allowed: string[]) { check(allowed.includes(status), "この状態では操作できません。", 409, "invalid_state_transition"); }
const jsonFields = ["links", "metrics", "seed_ids", "tip_ids", "lint_warnings", "firsts"];
export function decode(row: Row): Row { for (const k of jsonFields) if (typeof row[k] === "string") row[k] = JSON.parse(row[k]); return row; }
export async function workflow(path: string[], method: string, b: Row, query: URLSearchParams, actor: Row) {
  const { env } = await getCloudflareContext({ async: true }); const db = env.DB;
  const stmt = (sql: string, args: any[] = []) => db.prepare(sql).bind(...args);
  const all = async (sql: string, args: any[] = []) => (await stmt(sql, args).all<Row>()).results.map(decode);
  const one = async (sql: string, args: any[] = []) => { const r = (await all(sql,args))[0]; check(r,"見つかりません。",404,"not_found"); return r; };
  const run = async (sql: string, args: any[] = []) => stmt(sql,args).run();
  const now = new Date().toISOString(); const id = () => crypto.randomUUID();
  const editor = path[0] === "editor"; if (editor) { check(actor.is_editor,"編集部の権限が必要です。",403,"forbidden"); path = path.slice(1); }
  const route=path.join("/");
  const routes: [RegExp,string[]][] = editor ? [
    [/^(summary|seeds|imports)$/, ["GET"]], [/^tips$/, ["GET"]], [/^tips\/[^/]+\/(adopt|decline|reopen)$/, ["POST"]],
    [/^articles$/, ["GET"]], [/^articles\/[^/]+$/, ["GET","PATCH"]], [/^articles\/[^/]+\/(regenerate|select|unselect|to-draft|hide|restore)$/, ["POST"]],
    [/^issues$/, ["GET","POST"]], [/^issues\/[^/]+$/, ["GET","PATCH"]], [/^issues\/[^/]+\/publish$/, ["POST"]], [/^issues\/[^/]+\/notices$/, ["GET"]],
    [/^notices\/[^/]+\/mark-sent$/, ["POST"]], [/^members$/, ["GET"]], [/^members\/[^/]+$/, ["PATCH"]]
  ] : [[/^me$/, ["GET","PATCH"]], [/^me\/(opt-out|opt-in)$/, ["POST"]], [/^me\/articles\/[^/]+\/retract$/, ["POST"]], [/^members\/tip-targets$/, ["GET"]], [/^tips$/, ["POST"]], [/^tips\/[^/]+\/withdraw$/, ["POST"]]];
  check(routes.some(([pattern,methods])=>pattern.test(route)&&methods.includes(method)),"見つかりません。",404,"not_found");
  const [resource, key, action] = path;
  if (!editor && resource === "me") {
    if (method === "GET") return { member: actor, articles: await all("SELECT a.*,i.title AS issue_title,i.kind AS issue_kind,i.target AS issue_target FROM articles a JOIN issues i ON i.id=a.issue_id WHERE a.member_id=? AND a.status='published' AND i.status='published'",[actor.id]), tips: await all("SELECT t.id,t.target_member_id,m.display_name,t.body,t.links,t.is_anonymous,t.status,t.created_at FROM tips t JOIN members m ON m.id=t.target_member_id WHERE sender_member_id=? ORDER BY t.created_at DESC",[actor.id]) };
    if (method === "PATCH") { check(!actor.opted_out_at,"記事の対象に戻ってから変更してください。"); const login = github(b.github_login); await run("UPDATE members SET github_login=?,updated_at=? WHERE id=?",[login,now,actor.id]); return {ok:true}; }
    if (key === "articles" && path[3] === "retract") {
      check(b.confirm === true,"取り下げると元に戻せません。確認してください。");
      const a = await one("SELECT * FROM articles WHERE slug=? AND member_id=?",[action,actor.id]); check(a.status==="published","公開中の記事だけ取り下げられます。",409,"invalid_state_transition");
      await run("UPDATE articles SET status='retracted',retracted_at=?,updated_at=? WHERE id=? AND status='published'",[now,now,a.id]); invalidatePublicCache(); return {ok:true};
    }
    if (key === "opt-in") { check(actor.opted_out_at,"すでに記事の対象です。",409,"invalid_state_transition"); await run("UPDATE members SET opted_out_at=NULL,display_name=?,updated_at=? WHERE id=?",[actor.slack_user_id,now,actor.id]); return {ok:true}; }
    if (key === "opt-out") {
      check(b.confirm === true,"過去の記事を含めて、あなたのデータをすべて削除します。元に戻せません。");
      for(const article of await all("SELECT slug FROM articles WHERE member_id=?",[actor.id])) await env.RAW.delete(`images/articles/${article.slug}.png`);
      // raw 内の投稿、リアクション、プロフィール、参加記録も削除する。
      for (const imp of await all("SELECT * FROM activity_imports")) {
        const obj = await env.RAW.get(imp.r2_key); if (!obj) continue;
        const scrub = (v: any): any => {
          if (Array.isArray(v)) return v.filter(x => !((typeof x === "string" && [actor.slack_user_id,actor.github_login].includes(x)) || (x && typeof x === "object" && [x.user,x.user_id,x.id,x.actor,x.author_login,x.github_login,x.login].some(y => y && [actor.slack_user_id,actor.github_login].includes(y))))).map(scrub);
          if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k,x]) => ![actor.slack_user_id,actor.github_login].filter(Boolean).includes(k) && !(typeof x === "string" && [actor.slack_user_id,actor.github_login].filter(Boolean).includes(x))).map(([k,x])=>[k,scrub(x)])); return v;
        };
        await env.RAW.put(imp.r2_key,JSON.stringify(scrub(await obj.json())));
      }
      const ownArticles = "SELECT id FROM articles WHERE member_id=?"; const ownSeeds = "SELECT id FROM seeds WHERE member_id=?"; const ownTips = "SELECT id FROM tips WHERE target_member_id=? OR sender_member_id=?";
      const statements = [
        stmt(`DELETE FROM notices WHERE member_id=? OR article_id IN (${ownArticles})`,[actor.id,actor.id]),
        stmt(`DELETE FROM regeneration_requests WHERE article_id IN (${ownArticles})`,[actor.id]),
        stmt(`DELETE FROM evidences WHERE author_member_id=? OR seed_id IN (${ownSeeds}) OR tip_id IN (${ownTips})`,[actor.id,actor.id,actor.id,actor.id]),
        stmt("DELETE FROM articles WHERE member_id=?",[actor.id]), stmt("DELETE FROM seeds WHERE member_id=?",[actor.id]),
        stmt("DELETE FROM monthly_stats WHERE member_id=?",[actor.id]), stmt("DELETE FROM tips WHERE target_member_id=? OR sender_member_id=?",[actor.id,actor.id]),
        stmt("UPDATE articles SET edited_by=NULL WHERE edited_by=?",[actor.id]), stmt("UPDATE tips SET decided_by=NULL WHERE decided_by=?",[actor.id]),
        stmt("DELETE FROM sessions WHERE member_id=?",[actor.id]),
        stmt("UPDATE members SET display_name='',real_name=NULL,avatar_url=NULL,github_login=NULL,joined_at=NULL,joined_at_source='estimated',is_editor=0,opted_out_at=?,updated_at=? WHERE id=?",[now,now,actor.id])
      ]; await db.batch(statements); invalidatePublicCache(); return {ok:true};
    }
  }
  if (!editor && resource === "members" && key === "tip-targets") return all("SELECT id,display_name FROM members WHERE opted_out_at IS NULL AND is_active=1 AND id<>? AND display_name LIKE ?",[actor.id,`%${query.get("q") ?? ""}%`]);
  if (resource === "tips") {
    if (method === "GET" && editor) return all("SELECT t.*,s.display_name AS sender_name,m.display_name AS target_name FROM tips t JOIN members s ON s.id=t.sender_member_id JOIN members m ON m.id=t.target_member_id WHERE (?='' OR t.status=?) ORDER BY t.created_at DESC",[query.get("status") ?? "",query.get("status") ?? ""]);
    if (!key && method === "POST" && !editor) {
      check(!actor.opted_out_at,"記事の対象に戻ってから送信してください。");
      const validated = validateTip(b);
      check(!validated.error, validated.error?.message, 400, "validation_error", validated.error?.field);
      const target = (await all("SELECT id,opted_out_at,is_active FROM members WHERE id=?",[b.target_member_id]))[0];
      check(target, "誰のいい話かを選んでください。", 400, "validation_error", "target_member_id");
      check(target.id !== actor.id && !target.opted_out_at && target.is_active, "その局員にはタレコミを送れません。", 400, "validation_error", "target_member_id");
      b.links = validated.links;
      const tipId=id();
      await run("INSERT INTO tips (id,target_member_id,sender_member_id,is_anonymous,body,links,status,created_at) SELECT ?,?,?,?,?,?,'received',? WHERE (SELECT COUNT(*) FROM tips WHERE sender_member_id=? AND date(created_at,'+9 hours')=date(?,'+9 hours'))<20",[tipId,b.target_member_id,actor.id,Number(b.is_anonymous),b.body.trim(),JSON.stringify(b.links),now,actor.id,now]);
      check((await all("SELECT id FROM tips WHERE id=?",[tipId])).length,"1日20件までです。",429,"rate_limited"); return {id:tipId};
    }
    const t=await one("SELECT * FROM tips WHERE id=?",[key]);
    if (!editor) check(t.sender_member_id===actor.id && action==="withdraw","操作できません。",403,"forbidden");
    const states: Row={adopt:["received","adopted"],decline:["received","declined"],reopen:["declined","received"],withdraw:["received","withdrawn"]};
    check(states[action] && (editor ? action!=="withdraw" : action==="withdraw"),"このタレコミは取り消せません。"); check(t.status===states[action][0], action==="withdraw"?"受付中のタレコミだけ取り消せます。":"この状態では操作できません。",409,"invalid_state_transition");
    const ops=[stmt("UPDATE tips SET status=?,decided_by=?,decided_at=? WHERE id=? AND status=?",[states[action][1],editor?actor.id:null,now,key,t.status])];
    if(action==="adopt") { const sid=`tip-seed:${key}`; ops.push(stmt("INSERT OR IGNORE INTO seeds (id,member_id,month,kind,score,summary,metrics,created_at) VALUES (?,?,?,'K-12',1010,'仲間から推薦された','{}',?)",[sid,t.target_member_id,t.created_at.slice(0,7),now])); ops.push(stmt("INSERT OR IGNORE INTO evidences (id,seed_id,tip_id,source,author_member_id,excerpt,occurred_at) VALUES (?,?,?,'tip',?,?,?)",[`tip-evidence:${key}`,sid,key,t.sender_member_id,t.body.slice(0,200),t.created_at])); }
    await db.batch(ops); return {ok:true};
  }
  check(editor,"見つかりません。",404,"not_found");
  if(resource==="seeds") return all("SELECT s.*,m.display_name FROM seeds s JOIN members m ON m.id=s.member_id WHERE (?='' OR month=?) ORDER BY score DESC",[query.get("month")??"",query.get("month")??""]);
  if(resource==="articles") {
    if(!key) return all("SELECT a.*,m.display_name,s.kind,s.month,NOT EXISTS(SELECT 1 FROM articles p JOIN issues i ON i.id=p.issue_id WHERE p.member_id=a.member_id AND p.status='published' AND i.id IN (SELECT id FROM issues WHERE status='published' ORDER BY published_at DESC LIMIT 3)) AS recently_unpublished FROM articles a JOIN members m ON m.id=a.member_id JOIN seeds s ON s.id=a.main_seed_id WHERE (?='' OR s.month=?) AND (?='' OR a.status=?)",[query.get("month")??"",query.get("month")??"",query.get("status")??"",query.get("status")??""]);
    const a=await one("SELECT * FROM articles WHERE id=?",[key]);
    if(method==="GET") return {...a,seeds:await all("SELECT * FROM seeds WHERE id=? OR id IN (SELECT value FROM json_each(?))",[a.main_seed_id,JSON.stringify(a.seed_ids)]),evidences:await all("SELECT * FROM evidences WHERE seed_id=? OR seed_id IN (SELECT value FROM json_each(?)) OR tip_id IN (SELECT value FROM json_each(?))",[a.main_seed_id,JSON.stringify(a.seed_ids),JSON.stringify(a.tip_ids)]),tips:await all("SELECT * FROM tips WHERE id IN (SELECT value FROM json_each(?))",[JSON.stringify(a.tip_ids)])};
    if(method==="PATCH") { transition(a.status,["draft","published"]); b={headline:a.headline,body:a.body,reporter_comment:a.reporter_comment,...b}; for(const k of ["headline","body","reporter_comment"]) check(typeof b[k]==="string" && b[k].trim() && b[k].length<10000); const warnings=lintDraft(b as {headline:string;body:string;reporter_comment:string}); await run("UPDATE articles SET headline=?,body=?,reporter_comment=?,lint_warnings=?,edited_by=?,updated_at=? WHERE id=?",[b.headline,b.body,b.reporter_comment,JSON.stringify(warnings),actor.id,now,key]); if(a.status==="published") invalidatePublicCache(); return {lint_warnings:warnings}; }
    if(action==="regenerate") { transition(a.status,["draft"]); check(typeof b.note==="string" && b.note.length<=1000); await run("INSERT INTO regeneration_requests (id,article_id,note,status,created_at) VALUES (?,?,?,'pending',?)",[id(),key,b.note,now]); return {ok:true}; }
    const states:Row={select:["draft","selected"],unselect:["draft","unselected"],"to-draft":[["selected","unselected"],"draft"],hide:["published","hidden"],restore:["hidden","published"]}; check(states[action]); transition(a.status,Array.isArray(states[action][0])?states[action][0]:[states[action][0]]);
    let issueId=a.issue_id;
    if(action==="select") { check(!a.lint_warnings.length || b.confirm_warnings===true,"表現チェックの警告を確認してください。",409,"invalid_state_transition"); const issue=await one("SELECT * FROM issues WHERE id=?",[b.issue_id]); transition(issue.status,["editing"]); issueId=issue.id; }
    if(action==="to-draft") issueId=null;
    await run("UPDATE articles SET status=?,issue_id=?,is_top=CASE WHEN ? IS NULL THEN 0 ELSE is_top END,hidden_at=?,updated_at=? WHERE id=? AND status=?",[states[action][1],issueId,issueId,action==="hide"?now:null,now,key,a.status]); if(["hide","restore"].includes(action)) invalidatePublicCache(); return {ok:true};
  }
  if(resource==="issues") {
    if(!key && method==="GET") return all("SELECT * FROM issues ORDER BY number DESC");
    if(!key && method==="POST") { check(validIssuePath(b.kind,b.target)); check(!(await all("SELECT id FROM issues WHERE kind=? AND target=?",[b.kind,b.target])).length,"同じ対象の号があります。",409,"invalid_state_transition"); const iid=id(); await run("INSERT INTO issues (id,kind,target,number,title,status) VALUES (?,?,?,(SELECT COALESCE(MAX(number),0)+1 FROM issues),?,'editing')",[iid,b.kind,b.target,`良良タイムズ ${b.target}号`]); return one("SELECT * FROM issues WHERE id=?",[iid]); }
    const issue=await one("SELECT * FROM issues WHERE id=?",[key]);
    if(action==="notices") return (await all("SELECT n.*,m.display_name,m.slack_user_id FROM notices n JOIN members m ON m.id=n.member_id WHERE n.issue_id=?",[key])).map(n=>({...n,dm_url:`slack://user?team=${encodeURIComponent(process.env.SLACK_TEAM_ID??env.SLACK_TEAM_ID??"")}&id=${encodeURIComponent(n.slack_user_id)}`}));
    if(method==="GET") return {...issue,articles:await all("SELECT * FROM articles WHERE issue_id=? ORDER BY sort_order",[key])};
    transition(issue.status,["editing"]);
    if(method==="PATCH") { const current=await all("SELECT * FROM articles WHERE issue_id=? AND status='selected' ORDER BY sort_order",[key]); b={title:issue.title,editor_note:issue.editor_note??"",article_ids:current.map(a=>a.id),top_article_id:current.find(a=>a.is_top)?.id??null,...b}; check(typeof b.title==="string" && b.title.trim() && typeof b.editor_note==="string" && Array.isArray(b.article_ids)); const selected=await all("SELECT id FROM articles WHERE issue_id=? AND status='selected'",[key]); check(new Set(b.article_ids).size===selected.length && b.article_ids.length===selected.length && selected.every(a=>b.article_ids.includes(a.id))); check(b.top_article_id===null || b.article_ids.includes(b.top_article_id)); await db.batch([stmt("UPDATE issues SET title=?,editor_note=? WHERE id=?",[b.title,b.editor_note,key]),...b.article_ids.map((aid:string,i:number)=>stmt("UPDATE articles SET sort_order=?,is_top=? WHERE id=? AND issue_id=?",[i,Number(aid===b.top_article_id),aid,key]))]); return {ok:true}; }
    if(action==="publish") { check(b.confirm===true,"発行を確認してください。"); const selected=await all("SELECT a.*,m.display_name FROM articles a JOIN members m ON m.id=a.member_id WHERE issue_id=? AND a.status='selected' AND m.opted_out_at IS NULL",[key]); check(selected.length,"掲載決定の記事を選んでください。",409,"invalid_state_transition"); const base=(process.env.APP_BASE_URL??env.APP_BASE_URL??"http://localhost:3000").replace(/\/$/,""); await db.batch([stmt("UPDATE issues SET status='published',published_at=? WHERE id=? AND status='editing'",[now,key]),stmt("UPDATE articles SET status='published',published_at=?,updated_at=? WHERE issue_id=? AND status='selected'",[now,now,key]),...selected.map(a=>stmt("INSERT OR IGNORE INTO notices (id,issue_id,article_id,member_id,message) VALUES (?,?,?,?,?)",[`notice:${key}:${a.id}`,key,a.id,a.member_id,`りゃんりゃんだよ〜。今月の良良タイムズに${a.display_name}さんの記事が載ったよ！ ${base}/articles/${a.slug}`]))]); invalidatePublicCache(); return {ok:true}; }
  }
  if(resource==="notices" && action==="mark-sent") { await one("SELECT id FROM notices WHERE id=?",[key]); await run("UPDATE notices SET sent_at=COALESCE(sent_at,?) WHERE id=?",[now,key]); return {ok:true}; }
  if(resource==="members") {
    if(method==="GET") return all("SELECT * FROM members ORDER BY display_name");
    const m=await one("SELECT * FROM members WHERE id=?",[key]); check(!m.opted_out_at,"オプトアウト中のデータは変更できません。");
    const joinedSource=Object.hasOwn(b,"joined_at")?"manual":m.joined_at_source;
    b={github_login:m.github_login,joined_at:m.joined_at,is_active:!!m.is_active,is_editor:!!m.is_editor,...b};
    check(typeof b.is_active==="boolean" && typeof b.is_editor==="boolean"); check(b.joined_at===null || (typeof b.joined_at==="string" && /^\d{4}-\d{2}-\d{2}$/.test(b.joined_at) && !isNaN(Date.parse(b.joined_at)) && new Date(b.joined_at).toISOString().slice(0,10)===b.joined_at));
    await run("UPDATE members SET github_login=?,joined_at=?,joined_at_source=?,is_active=?,is_editor=?,updated_at=? WHERE id=?",[github(b.github_login),b.joined_at,joinedSource,Number(b.is_active),Number(b.is_editor),now,key]); return {ok:true};
  }
  if(resource==="imports" || resource==="summary") {
    const imports=await all("SELECT * FROM activity_imports ORDER BY month DESC"); const stats=await all("SELECT month,COUNT(*) AS count FROM monthly_stats GROUP BY month"); const seedCounts=await all("SELECT month,COUNT(*) AS count FROM seeds GROUP BY month"); const draftCounts=await all("SELECT s.month,COUNT(*) AS count FROM articles a JOIN seeds s ON s.id=a.main_seed_id GROUP BY s.month");
    const previous=new Date(); previous.setUTCDate(1); previous.setUTCMonth(previous.getUTCMonth()-1); const prev=previous.toISOString().slice(0,7);
    const warnings:string[]=[]; for(const source of ["slack","github"]) if(!imports.some(i=>i.month===prev&&i.source===source)) warnings.push(`${prev} の ${source} が未取り込みです。`);
    for(const i of imports) if(Date.now()-Date.parse(i.imported_at)>80*86400000 && !stats.some(s=>s.month===i.month)) warnings.push(`${i.month} は取り込みから80日を過ぎて未集計です。`);
    return {imports,stats,seeds:seedCounts,drafts:draftCounts,warnings,issues:await all("SELECT * FROM issues ORDER BY number DESC"),received:(await one("SELECT COUNT(*) AS count FROM tips WHERE status='received'")).count,draft_count:(await one("SELECT COUNT(*) AS count FROM articles WHERE status='draft'")).count};
  }
  throw new WorkflowError(404,"not_found","見つかりません。");
}
function github(v: unknown) { check(v===null || v==="" || (typeof v==="string" && /^(?!-)[a-zA-Z0-9-]{1,39}(?<!-)$/.test(v)),"GitHub アカウントを確認してください。"); return v?String(v).toLowerCase():null; }

