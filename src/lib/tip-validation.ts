export type TipField = "target_member_id" | "body" | "links";
export type TipFeedback = { message: string; field?: TipField };

export function normalizeTipLinks(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map(line => {
    if (typeof line !== "string") return line;
    const trimmed = line.trim();
    return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(trimmed)
      ? `https://${trimmed}` : trimmed;
  }).filter(line => line !== "");
}

function validLink(value: unknown) {
  if (typeof value !== "string" || value.length > 2048 || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return /^https?:\/\//i.test(value) && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}

// Shared by the form and the API so normalization and Japanese feedback stay identical.
export function validateTip(value: Record<string, unknown>, targetIds?: string[]) {
  const normalized = normalizeTipLinks(value.links);
  const links = normalized.map(link => validLink(link) ? new URL(link as string).href : link);
  // Keep the original textarea line number, including blank lines.
  const lineNumbers = Array.isArray(value.links) ? value.links.flatMap((line, i) => typeof line === "string" && !line.trim() ? [] : [i + 1]) : [];
  let error: TipFeedback | undefined;
  if (typeof value.target_member_id !== "string" || !value.target_member_id.trim() || (targetIds && !targetIds.includes(value.target_member_id)))
    error = { field: "target_member_id", message: "誰のいい話かを選んでください。" };
  else if (typeof value.body !== "string" || !value.body.trim())
    error = { field: "body", message: "何が良かったかを書いてください。" };
  else if ([...value.body].length > 1000)
    error = { field: "body", message: "何が良かったかは1000字までです。" };
  else if (links.length > 3)
    error = { field: "links", message: "関連リンクは3件までです。" };
  else if (!Array.isArray(value.links) || links.some(link => !validLink(link)))
    error = { field: "links", message: `関連リンクは https:// から始まる URL を1行に1つずつ書いてください（${lineNumbers[links.findIndex(link => !validLink(link))] ?? 1}行目）。` };
  else if (typeof value.is_anonymous !== "boolean")
    error = { message: "入力内容を確認してください。" };
  return { links, error };
}
