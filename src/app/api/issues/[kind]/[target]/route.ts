import { getIssue } from "@/lib/reader";
import { apiError } from "@/lib/errors";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; target: string }> }) {
  const { kind, target } = await params;
  const issue = await getIssue(kind, target);
  return issue ? Response.json({ issue }, { headers: { "Cache-Control": "no-store" } }) : apiError(404, "not_found", "号が見つかりません。");
}
