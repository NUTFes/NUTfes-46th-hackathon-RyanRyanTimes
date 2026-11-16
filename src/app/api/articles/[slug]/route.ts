import { getArticle } from "@/lib/reader";
import { apiError } from "@/lib/errors";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const article = await getArticle((await params).slug);
  return article ? Response.json({ article }, { headers: { "Cache-Control": "no-store" } }) : apiError(404, "not_found", "記事が見つかりません。");
}
