import type { AuthenticatedUserRequest } from "../auth/user-auth.guard"
import { hubError } from "./skill-hub-error"

export function assertHubWriteOrigin(
  request: Pick<AuthenticatedUserRequest, "headers" | "userAuthMethod">,
  appPublicUrl?: string,
): void {
  if (request.userAuthMethod === "bearer") return
  const origin = request.headers.origin
  if (request.userAuthMethod !== "cookie" || !appPublicUrl || origin !== new URL(appPublicUrl).origin) {
    throw hubError(403, "HUB_INVALID_ORIGIN", "请从当前 Skill Hub 网页重新发起操作。")
  }
}
