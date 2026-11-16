import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { SlackConfig } from "./slack-oidc";
export async function slackConfig():Promise<SlackConfig> {
 const {env}=await getCloudflareContext({async:true});
 const value=(name:"SLACK_CLIENT_ID"|"SLACK_CLIENT_SECRET"|"SLACK_TEAM_ID"|"APP_BASE_URL")=>process.env[name]??env[name]??"";
 const config={clientId:value("SLACK_CLIENT_ID"),clientSecret:value("SLACK_CLIENT_SECRET"),teamId:value("SLACK_TEAM_ID"),baseUrl:value("APP_BASE_URL").replace(/\/$/,"")};
 if(Object.values(config).some(v=>!v)) throw new Error("Slack ログインの環境変数を設定してください。"); return config;
}
