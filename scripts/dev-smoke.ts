import {spawn} from "node:child_process";
import {createWriteStream} from "node:fs";
import {getPlatformProxy} from "wrangler";
import assert from "node:assert/strict";
const base=process.env.SMOKE_BASE_URL??"http://localhost:3117";
const external=!!process.env.SMOKE_BASE_URL;
const editor="smoke-editor",sender="smoke-sender",target="smoke-target";
const pnpm=process.env.npm_execpath??"../.tools/node_modules/pnpm/bin/pnpm.cjs";
async function command(args:string[]) {await new Promise<void>((resolve,reject)=>{const p=spawn(process.execPath,[pnpm,...args],{stdio:"inherit",env:{...process.env,GEMINI_API_KEY:""}});p.on("exit",code=>code===0?resolve():reject(new Error(`??: ${args.join(" ")}`)));p.on("error",reject);});}
const proxy=await getPlatformProxy<CloudflareEnv>({persist:{path:".wrangler/state/v3"}});
try {
 const db=proxy.env.DB;
 // このスクリプト専用の架空データだけを再初期化する。
 await db.batch([
  db.prepare("DELETE FROM notices WHERE article_id IN (SELECT id FROM articles WHERE member_id LIKE 'smoke-%')"),
  db.prepare("DELETE FROM regeneration_requests WHERE article_id IN (SELECT id FROM articles WHERE member_id LIKE 'smoke-%')"),
  db.prepare("DELETE FROM evidences WHERE seed_id IN (SELECT id FROM seeds WHERE member_id LIKE 'smoke-%') OR tip_id IN (SELECT id FROM tips WHERE sender_member_id LIKE 'smoke-%' OR target_member_id LIKE 'smoke-%') OR author_member_id LIKE 'smoke-%'"),
  db.prepare("DELETE FROM articles WHERE member_id LIKE 'smoke-%'"),db.prepare("DELETE FROM seeds WHERE member_id LIKE 'smoke-%'"),db.prepare("DELETE FROM monthly_stats WHERE member_id LIKE 'smoke-%'"),db.prepare("DELETE FROM tips WHERE sender_member_id LIKE 'smoke-%' OR target_member_id LIKE 'smoke-%'"),db.prepare("DELETE FROM sessions WHERE member_id LIKE 'smoke-%'"),db.prepare("DELETE FROM issues WHERE id LIKE 'smoke-%'")]);
 for(const [id,edit] of [[editor,1],[sender,0],[target,0]] as const) await db.prepare("INSERT INTO members (id,slack_user_id,display_name,is_editor,is_active,created_at,updated_at) VALUES (?,?,?, ?,1,?,?) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,is_editor=excluded.is_editor,is_active=1,opted_out_at=NULL,github_login=NULL").bind(id,`SMOKE_${id}`,`架空・${id}`,edit,new Date().toISOString(),new Date().toISOString()).run();

 const stamp=new Date().toISOString();
 for(const [sid,mid] of [["smoke-target-seed",target],["smoke-other-seed",editor]]) await db.prepare("INSERT INTO seeds (id,member_id,month,kind,score,summary,metrics,created_at) VALUES (?,?, '2026-10','K-11',10,'架空の継続','{}',?)").bind(sid,mid,stamp).run();
 for(const [aid,slug,mid,sid] of [["smoke-target-article","smoketarget1",target,"smoke-target-seed"],["smoke-other-article","smokeother01",editor,"smoke-other-seed"]]) await db.prepare("INSERT INTO articles (id,slug,member_id,status,headline,body,reporter_comment,main_seed_id,generated_at) VALUES (?,?,?,'hidden','架空の削除検証','架空の本文','ありがとうだよ',?,?)").bind(aid,slug,mid,sid,stamp).run();
 await db.prepare("INSERT INTO evidences (id,seed_id,source,author_member_id,excerpt,occurred_at) VALUES ('smoke-other-evidence','smoke-other-seed','slack',?,'オプトアウト時に外す架空投稿',?)").bind(target,stamp).run();
 await db.prepare("INSERT INTO monthly_stats (member_id,month,weeks_in_month) VALUES (?,'2026-11',5)").bind(target).run();
 const raws=[{id:"slack",key:"raw/slack/2026-11/smoke-optout.json",data:{messages:[{user:`SMOKE_${target}`,text:"消す投稿"},{user:`SMOKE_${sender}`,text:"残す投稿",reactions:[{name:"heart",users:[`SMOKE_${target}`,`SMOKE_${sender}`]}]}]}},{id:"github",key:"raw/github/smoke-optout.json",data:[{actor:"smoke-github",text:"消す活動"},{actor:"smoke-other",target_author:"smoke-github",text:"残す活動"}]}];
 for(const raw of raws) {await proxy.env.RAW.put(raw.key,JSON.stringify(raw.data));await db.prepare("INSERT OR REPLACE INTO activity_imports (id,source,month,r2_key,item_count,imported_at,expires_at) VALUES (?,?,'2026-11',?,2,?,'2099-01-01T00:00:00Z')").bind(`smoke-raw-${raw.id}`,raw.id,raw.key,stamp).run();}
 await proxy.env.RAW.put("images/articles/smoketarget1.png","fake-image");
}finally{await proxy.dispose();}
const log=createWriteStream(".wrangler/dev-smoke.log");
const server=external?null:spawn(process.execPath,["node_modules/next/dist/bin/next","dev","--webpack","--port","3117","--hostname","127.0.0.1"],{env:{...process.env,DEV_LOGIN:"1",APP_ENV:"local",TIMES_DIST_DIR:".next-smoke",SESSION_SECRET:"smoke-only-local-session-secret-32-characters",GEMINI_API_KEY:""},stdio:["ignore","pipe","pipe"]});
server?.stdout?.pipe(log);server?.stderr?.pipe(log);
let cookie="";
async function req(path:string,method="GET",body?:unknown,expected=200) {
 const res=await fetch(base+path,{method,redirect:"manual",headers:{origin:base,...(cookie?{cookie}:{}),...(body?{"content-type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
 const set=res.headers.get("set-cookie");if(set)cookie=set.split(";")[0];const text=await res.text();assert.equal(res.status,expected,`${method} ${path}: ${res.status} ${text.slice(0,500)}`);return text?JSON.parse(text):null;
}
async function login(id:string){await req("/api/auth/dev-login","POST",{member_id:id,return_to:"/me"},303);}
try {
 for(let i=0;i<120;i++){try{const res=await fetch(base+"/login");if(res.ok)break;}catch{} if(i===119)throw new Error("開発サーバーが起動しません。ログ: .wrangler/dev-smoke.log"); await new Promise(r=>setTimeout(r,1000));}
 await req("/api/me","GET",undefined,401);
 await login(sender);await req("/api/editor/summary","GET",undefined,403);
 const targets=await req("/api/members/tip-targets");assert(!targets.some((m:any)=>m.id===sender));assert(targets.some((m:any)=>m.id===target));
 const tip={target_member_id:target,body:"架空の手引きを整えて、仲間の質問に丁寧に答えた。",links:[],is_anonymous:false};
 const named=await req("/api/tips","POST",tip);const anonymous=await req("/api/tips","POST",{...tip,is_anonymous:true});
 const withdrawn=await req("/api/tips","POST",tip);await req(`/api/tips/${withdrawn.id}/withdraw`,"POST",{});await req(`/api/tips/${withdrawn.id}/withdraw`,"POST",{},409);
 await login(editor);await req(`/api/editor/tips/${named.id}/adopt`,"POST",{});await req(`/api/editor/tips/${named.id}/decline`,"POST",{},409);await req(`/api/editor/tips/${anonymous.id}/decline`,"POST",{});await req(`/api/editor/tips/${anonymous.id}/reopen`,"POST",{});await req(`/api/editor/tips/${anonymous.id}/adopt`,"POST",{});
 await command(["drafts","2026-11"]);
 const articles=await req("/api/editor/articles?month=2026-11");const article=articles.find((a:any)=>a.member_id===target&&a.status==="draft");assert(article,"採用したタレコミから下書きが生成される");
 await req(`/api/editor/articles/${article.id}/regenerate`,"POST",{note:"架空の再生成依頼"});
 const saved=await req(`/api/editor/articles/${article.id}`,"PATCH",{headline:"仲間を支えた手引き",body:"徹夜という表現を確認するための架空の記事。",reporter_comment:"りゃんりゃん、ありがとうだよ〜。"});assert(saved.lint_warnings.length>0);
 const existingIssues=await req("/api/editor/issues");let year=2099;while(existingIssues.some((i:any)=>i.kind==="annual"&&i.target===String(year)))year++;const issue=await req("/api/editor/issues","POST",{kind:"annual",target:String(year)});
 await req(`/api/editor/articles/${article.id}/select`,"POST",{issue_id:issue.id},409);await req(`/api/editor/articles/${article.id}/select`,"POST",{issue_id:issue.id,confirm_warnings:true});
 await req(`/api/editor/articles/${article.id}/unselect`,"POST",{},409);
 await req(`/api/editor/issues/${issue.id}`,"PATCH",{title:"架空のsmoke検証号",editor_note:"りゃんりゃん、ありがとうだよ〜。",article_ids:[article.id],top_article_id:article.id});
 await req(`/api/editor/issues/${issue.id}/publish`,"POST",{confirm:true});await req(`/api/editor/issues/${issue.id}/publish`,"POST",{confirm:true},409);
 await req(`/api/articles/${article.slug}`);await req(`/api/editor/articles/${article.id}/hide`,"POST",{});await req(`/api/articles/${article.slug}`,"GET",undefined,404);await req(`/api/editor/articles/${article.id}/restore`,"POST",{});await req(`/api/articles/${article.slug}`);
 const notices=await req(`/api/editor/issues/${issue.id}/notices`);assert.equal(notices.length,1);assert(notices[0].message.includes(article.slug));await req(`/api/editor/notices/${notices[0].id}/mark-sent`,"POST",{});
 assert((await req(`/api/editor/issues/${issue.id}/notices`))[0].sent_at);
 for(const page of ["/editor","/editor/tips","/editor/articles",`/editor/articles/${article.id}`,"/editor/issues",`/editor/issues/${issue.id}`,`/editor/issues/${issue.id}/notices`,"/editor/members","/editor/imports"]){const res=await fetch(base+page,{headers:{cookie}});assert.equal(res.status,200,page);}
 await login(target);await req(`/api/me/articles/${article.slug}/retract`,"POST",{confirm:true});await req(`/api/articles/${article.slug}`,"GET",undefined,404);
 // 受け取り側、送り主、raw他人の根拠から削除されることを確認する。
 await req("/api/me","PATCH",{github_login:"smoke-github"});
 await req("/api/me/opt-out","POST",{confirm:true});
 await login(editor);await req(`/api/editor/articles/${article.id}`,"GET",undefined,404);
 const members=await req("/api/editor/members");const minimal=members.find((m:any)=>m.id===target);assert(minimal.opted_out_at);assert.equal(minimal.display_name,"");assert.equal(minimal.github_login,null);
 assert(!(await req("/api/editor/tips")).some((t:any)=>t.target_member_id===target));assert(!(await req("/api/members/tip-targets")).some((m:any)=>m.id===target));
 const verify=await getPlatformProxy<CloudflareEnv>({persist:{path:".wrangler/state/v3"}});
 try {
  for(const table of ["articles","seeds","monthly_stats","sessions","notices"])assert.equal((await verify.env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE member_id=?`).bind(target).first<{count:number}>())?.count,0,table);
  assert.equal((await verify.env.DB.prepare("SELECT COUNT(*) AS count FROM evidences WHERE author_member_id=?").bind(target).first<{count:number}>())?.count,0);
  assert.equal((await verify.env.DB.prepare("SELECT COUNT(*) AS count FROM regeneration_requests WHERE article_id=?").bind(article.id).first<{count:number}>())?.count,0);
  assert(await verify.env.DB.prepare("SELECT id FROM articles WHERE id='smoke-other-article'").first());
  for(const key of ["raw/slack/2026-11/smoke-optout.json","raw/github/smoke-optout.json"]){const raw=await verify.env.RAW.get(key);assert(raw);const text=await raw.text();assert(!text.includes(`SMOKE_${target}`));assert(!text.includes("smoke-github"));assert(text.includes("残す"));}
  assert.equal(await verify.env.RAW.get("images/articles/smoketarget1.png"),null);
 }finally{await verify.dispose();}
 await login(target);await req("/api/me/opt-in","POST",{});assert.equal((await req("/api/me")).articles.length,0);
 // 回数制限は取り消しを含めて1日20件
 await login(sender);const me=await req("/api/me");const today=new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Tokyo"});let count=me.tips.filter((t:any)=>new Date(t.created_at).toLocaleDateString("sv-SE",{timeZone:"Asia/Tokyo"})===today).length;
 for(;count<20;count++)await req("/api/tips","POST",tip);await req("/api/tips","POST",tip,429);
 console.log("dev smoke 成功: 認証・権限、記名/匿名投稿、取消、採用、offline drafts、lint確認、号の作成/発行、非公開/復元、通知送信済、本人取り下げ404、オプトアウト削除/解除、20件制限。");
}finally{server?.kill();log.end();}
