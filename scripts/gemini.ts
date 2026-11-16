import { templateDraft, validateDraft, type Prompt } from "../src/lib/pipeline/drafts";
import type { Draft } from "../src/lib/pipeline/types";

export async function generateDraft(prompt: Prompt, options: { apiKey?: string; model?: string; fetcher?: typeof fetch; wait?: (attempt: number) => Promise<void> } = {}): Promise<Draft | null> {
  if (!options.apiKey) return validateDraft(templateDraft(prompt));
  const fetcher = options.fetcher ?? fetch;
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model ?? "gemini-2.5-flash")}:generateContent`, {
        method: "POST", signal: AbortSignal.timeout(60000),
        headers: { "Content-Type": "application/json", "x-goog-api-key": options.apiKey },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: prompt.system_instruction }] }, contents: [{ role: "user", parts: [{ text: JSON.stringify(prompt.input) }] }], generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { headline: { type: "STRING" }, body: { type: "STRING" }, reporter_comment: { type: "STRING" } }, required: ["headline", "body", "reporter_comment"] } } }),
      });
      if (!response.ok) throw new Error("生成APIの応答エラー");
      const payload = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      return validateDraft(JSON.parse(payload.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("") ?? ""));
    } catch {
      // 応答本文やキー、資料をエラーログに出さない。
      if (attempt === 3) return null;
      await (options.wait ?? (n => new Promise(resolve => setTimeout(resolve, 500 * 2 ** n))))(attempt);
    }
  }
  return null;
}
