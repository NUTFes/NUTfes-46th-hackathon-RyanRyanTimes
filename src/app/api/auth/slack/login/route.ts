import {cookies} from "next/headers";
import {authEnvironment} from "@/lib/auth";
import {slackConfig} from "@/lib/slack-config";
import {OIDC_COOKIE,sealState} from "@/lib/slack-oidc";
import {safeReturnTo} from "@/lib/session";
import {apiError} from "@/lib/errors";
export async function GET(request:Request) {
 try {const config=await slackConfig(); const state=crypto.randomUUID(),nonce=crypto.randomUUID();
 (await cookies()).set(OIDC_COOKIE,await sealState({state,nonce,return_to:safeReturnTo(new URL(request.url).searchParams.get("return_to")),expires:Date.now()+600000},(await authEnvironment()).secret),{httpOnly:true,secure:true,sameSite:"lax",path:"/api/auth/slack",maxAge:600});
 const url=new URL("https://slack.com/openid/connect/authorize"); url.search=new URLSearchParams({response_type:"code",scope:"openid profile email",client_id:config.clientId,redirect_uri:`${config.baseUrl}/api/auth/slack/callback`,state,nonce,team:config.teamId}).toString();
 return Response.redirect(url,302);
 } catch {return apiError(400,"validation_error","Slack ログインの環境変数を確認してください。");}
}
