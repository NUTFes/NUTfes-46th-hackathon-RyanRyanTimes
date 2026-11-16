import { guardRole } from "@/lib/auth";
import { workflow, WorkflowError } from "@/lib/workflow";
import { apiError, type ErrorCode } from "@/lib/errors";
async function handle(request: Request, context: {params: Promise<{path:string[]}>}) {
  const {path}=await context.params;
  const auth=await guardRole(path[0]==="editor"?"editor":"member"); if(auth.error) return auth.error;
  if(request.method!=="GET" && request.headers.get("origin")!==new URL(request.url).origin) return apiError(403,"forbidden","このリクエストは受け付けられません。");
  try { const body=request.method==="GET"?{}:await request.json(); if(!body || typeof body!=="object" || Array.isArray(body)) return apiError(400,"validation_error","入力内容を確認してください。"); return Response.json(await workflow(path,request.method,body,new URL(request.url).searchParams,auth.member),{headers:{"Cache-Control":"no-store"}}); }
  catch(e) { if(e instanceof WorkflowError) return apiError(e.status,e.code as ErrorCode,e.message); if(e instanceof SyntaxError) return apiError(400,"validation_error","JSONを確認してください。"); if(String(e).includes("UNIQUE constraint")) return apiError(400,"validation_error","登録済みの値です。"); console.error(e); return Response.json({error:{code:"internal_error",message:"処理に失敗しました。"}},{status:500}); }
}
export {handle as GET,handle as POST,handle as PATCH};
