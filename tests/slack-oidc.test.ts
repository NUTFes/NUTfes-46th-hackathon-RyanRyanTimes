import {describe,it,expect} from "vitest";
import {exchangeSlack,sealState,openState} from "../src/lib/slack-oidc";
const secret="test-secret-that-is-at-least-32-characters";
const config={clientId:"client",clientSecret:"secret",teamId:"TEST_TEAM",baseUrl:"https://example.test"};
async function fixture(change:Record<string,unknown>={},badSignature=false,headerChange:Record<string,unknown>={}) {
 const keys=await crypto.subtle.generateKey({name:"RSASSA-PKCS1-v1_5",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},true,["sign","verify"]);
 const header=Buffer.from(JSON.stringify({alg:"RS256",kid:"test",...headerChange})).toString("base64url");
 const body=Buffer.from(JSON.stringify({iss:"https://slack.com",aud:"client",sub:"TEST_USER",nonce:"nonce",exp:Date.now()/1000+300,iat:Date.now()/1000,"https://slack.com/team_id":"TEST_TEAM",name:"架空の局員",...change})).toString("base64url");
 const signature=Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",keys.privateKey,new TextEncoder().encode(`${header}.${body}`))).toString("base64url");
 const jwk={...await crypto.subtle.exportKey("jwk",keys.publicKey),kid:"test"};
 const calls:{url:string;body?:string}[]=[];
 const fetcher=(async (input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);calls.push({url,body:init?.body?.toString()});return Response.json(url.endsWith("token")?{ok:true,id_token:`${header}.${body}.${badSignature?"invalid":signature}`}:{keys:[jwk]});}) as typeof fetch;
 return {fetcher,calls};
}
describe("Slack OIDC",()=>{
 it("署名付きstate?return_toを検証する",async()=>{const v={state:"state",nonce:"nonce",expires:Date.now()+60000,return_to:"/me"};const cookie=await sealState(v,secret);expect(await openState(cookie,"state",secret)).toEqual(v);await expect(openState(cookie,"other",secret)).rejects.toThrow();await expect(openState(cookie+"x","state",secret)).rejects.toThrow();await expect(openState(await sealState({...v,expires:1},secret),"state",secret)).rejects.toThrow();expect((await openState(await sealState({...v,return_to:"//evil.test"},secret),"state",secret)).return_to).toBe("/tips/new");});
 it("モックのtoken交換とJWKS署名検証に成功する",async()=>{const f=await fixture();expect(await exchangeSlack("code","nonce",config,f.fetcher)).toMatchObject({slack_user_id:"TEST_USER",display_name:"架空の局員"});expect(f.calls.map(c=>c.url)).toEqual(["https://slack.com/api/openid.connect.token","https://slack.com/openid/connect/keys"]);expect(f.calls[0].body).toContain("redirect_uri=https%3A%2F%2Fexample.test%2Fapi%2Fauth%2Fslack%2Fcallback");});
 it.each([{iss:"https://evil.test"},{aud:"other"},{nonce:"other"},{exp:1},{iat:Date.now()/1000+600},{"https://slack.com/team_id":"OTHER"},{aud:["client","other"],azp:"other"},{sub:""}])("不正なclaimを拒否する %j",async change=>{const f=await fixture(change);await expect(exchangeSlack("code","nonce",config,f.fetcher)).rejects.toThrow();});
 it("不正署名と署名方式を拒否する",async()=>{for(const f of [await fixture({},true),await fixture({},false,{alg:"none"}),await fixture({},false,{kid:"missing"})])await expect(exchangeSlack("code","nonce",config,f.fetcher)).rejects.toThrow();});
 it("Slackの交換失敗を拒否する",async()=>{await expect(exchangeSlack("code","nonce",config,(async()=>Response.json({ok:false})) as typeof fetch)).rejects.toThrow();});
});
