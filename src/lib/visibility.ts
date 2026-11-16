export type PublicationState = {
  status: string;
  issue_status: string | null;
  opted_out_at: string | null;
};
export function isArticleVisible(article: PublicationState) {
  return article.status === "published" && article.issue_status === "published" && article.opted_out_at === null;
}
export function visibleArticles<T extends PublicationState>(articles: T[]) {
  return articles.filter(isArticleVisible);
}
