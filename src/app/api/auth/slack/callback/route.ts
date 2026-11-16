import {cookies} from "next/headers";
import {eq} from "drizzle-orm";
import {getDb} from "@/db";
import {members,sessions} from "@/db/schema";
import {authEnvironment} from "@/lib/auth";
import {slackConfig} from "@/lib/slack-config";
import {OIDC_COOKIE,openState,exchangeSlack} from "@/lib/slack-oidc";
import {SESSION_COOKIE,SESSION_SECONDS,sessionCookieOptions,signSession} from "@/lib/session";
import {apiError} from "@/lib/errors";
export async function GET(request:Request) {
 const jar=await cookies(); const saved=jar.get(OIDC_COOKIE)?.value; jar.set(OIDC_COOKIE,"",{httpOnly:true,secure:true,sameSite:"lax",path:"/api/auth/slack",maxAge:0});
 try {const query=new URL(request.url).searchParams; const {secret}=await authEnvironment(); const state=await openState(saved,query.get("state"),secret); const code=query.get("code"); if(!code || query.has("error")) throw new Error("cancelled");
 const config=await slackConfig(); const profile=await exchangeSlack(code,state.nonce,config); const db=await getDb(); const now=new Date();
 let member=await db.query.members.findFirst({where:eq(members.slack_user_id,profile.slack_user_id)});
 if(member && !member.is_active) return apiError(403,"forbidden","在籍中の局員のみ利用できます。");
 if(!member) {await db.insert(members).values({id:crypto.randomUUID(),...profile,created_at:now.toISOString(),updated_at:now.toISOString()}).onConflictDoNothing(); member=await db.query.members.findFirst({where:eq(members.slack_user_id,profile.slack_user_id)});}
 else if(!member.opted_out_at) await db.update(members).set({...profile,updated_at:now.toISOString()}).where(eq(members.id,member.id));
 if(!member) throw new Error("member"); const id=crypto.randomUUID(); await db.insert(sessions).values({id,member_id:member.id,created_at:now.toISOString(),expires_at:new Date(now.getTime()+SESSION_SECONDS*1000).toISOString()});
 jar.set(SESSION_COOKIE,await signSession(id,secret),sessionCookieOptions()); return new Response(null,{status:303,headers:{Location:state.return_to,"Cache-Control":"no-store"}});
 }catch{return apiError(400,"validation_error","Slack 認証を確認できませんでした。ログインをやり直してください。");}
}
