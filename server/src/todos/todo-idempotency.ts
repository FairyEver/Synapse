import { createHash } from "node:crypto"
export function todoRequestHash(action: string, id: string | null, input: object): string {
  return createHash("sha256").update(JSON.stringify({ action, id, input: Object.fromEntries(Object.entries(input).filter(([key]) => key !== "clientRequestId").sort(([a], [b]) => a.localeCompare(b))) })).digest("hex")
}
