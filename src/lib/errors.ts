export type ErrorCode = "validation_error" | "unauthorized" | "forbidden" | "not_found" | "invalid_state_transition" | "rate_limited" | "not_implemented";
export function apiError(status: number, code: ErrorCode, message: string, field?: string) {
  return Response.json({ error: { code, message, ...(field ? { field } : {}) } }, { status, headers: { "Cache-Control": "no-store" } });
}
