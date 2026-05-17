export function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined
  const code = (error as { readonly code?: unknown }).code
  return typeof code === "string" ? code : undefined
}
