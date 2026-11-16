import type { TipField } from "./tip-validation";

export class RequestError extends Error {
  constructor(message: string, public field?: TipField) { super(message); }
}

const failure = "処理に失敗しました。時間をおいてもう一度お試しください。";

export async function request(url: string, method = "GET", body?: Record<string, unknown>) {
  const res = await fetch(url, {
    method,
    headers: method === "GET" ? {} : { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let value: any;
  try { value = await res.json(); }
  catch { throw new RequestError(failure); }
  if (!res.ok) throw new RequestError(value?.error?.message ?? failure, value?.error?.field);
  return value;
}
