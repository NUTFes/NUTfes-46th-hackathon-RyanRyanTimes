import { getIssues } from "@/lib/reader";
export const dynamic = "force-dynamic";
export async function GET() { return Response.json({ issues: await getIssues() }, { headers: { "Cache-Control": "no-store" } }); }
