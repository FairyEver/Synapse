import type { PermissionAction, PermissionPolicy } from "../../runtime/security/permission-guard"
import type { TerminalControllerContext } from "../../../app-capabilities/terminal/main/service"

/**
 * The actor every cloud-delivered mobile command runs as.
 *
 * It must never be `{ kind: "user" }`: that would match the built-in
 * `userInitiatedAllowPolicy`, which allows everything, and would turn a phone
 * into an unauthenticated remote control for a machine with no process sandbox.
 * Registering a narrow agent identity instead means unlisted actions fall through
 * to the default deny.
 */
export const MOBILE_GATEWAY_ACTOR_ID = "mobile-gateway"
export const MOBILE_GATEWAY_ACTOR = { kind: "agent", id: MOBILE_GATEWAY_ACTOR_ID } as const

/**
 * Actions a phone may perform on a terminal. Deliberately excludes group and
 * command management: those mutate persisted configuration and stay on the
 * desktop, where the user has a keyboard and can see what they are editing.
 *
 * Deleting a session *is* allowed, which follows from the same rule: a session is
 * runtime state, not configuration, and `stop` — which is already allowed — removes a
 * running one on its own, because the PTY exiting destroys the session. Deleting only
 * adds the removal of an already-ended session's record.
 *
 * `terminal.session.resize` is listed although nothing currently authorizes it: it is
 * kept for the phone-side resize this table was written to allow. Leaving it here with
 * a reason is the point — a permission entry with no stated purpose is what made the
 * missing `session.delete` entry hard to spot.
 *
 * `mobile-gateway-permissions.test.ts` keeps this table and the executor's calls in
 * step, so a new capability cannot ship unauthorised and fail on a user's phone.
 */
export const MOBILE_GATEWAY_ALLOWED_ACTIONS: ReadonlySet<PermissionAction> = new Set([
  "terminal.discover",
  "terminal.state.read",
  "terminal.output.read",
  "terminal.command.launch",
  "terminal.session.create",
  "terminal.session.delete",
  "terminal.session.control",
  "terminal.session.resize",
  "terminal.session.stop",
  "terminal.metadata.manage",
])

export const mobileGatewayTerminalPolicy: PermissionPolicy = {
  id: "mobile-gateway-terminal",
  decide: (request) => {
    const isMobileGateway = request.actor.kind === MOBILE_GATEWAY_ACTOR.kind
      && request.actor.id === MOBILE_GATEWAY_ACTOR_ID
    if (!isMobileGateway) return "defer-to-next"
    return MOBILE_GATEWAY_ALLOWED_ACTIONS.has(request.action) ? "allow" : "defer-to-next"
  },
}

/**
 * The one place a phone may cause a file to be written outside the app's own data
 * directory: the relay directory a phone-delivered file lands in.
 *
 * `fs.write.outside-userdata` is a whole-disk power, so the action alone cannot be
 * the unit of permission here the way it is for the terminal table above — that
 * would hand a phone the user's entire home directory. The resource names the
 * directory, and only that exact resource is allowed.
 */
export const MOBILE_RELAY_DIRECTORY_NAME = "SynapseTemp"

/**
 * Derived from the directory rather than written out again, because this string is
 * the *only* thing standing between the action above and a phone writing anywhere
 * on the disk: if the two drifted, the policy would be guarding a path the relay
 * does not use.
 *
 * The bootstrap descriptor takes the directory name from here too, so the value
 * checked and the value written are the same one.
 */
export const MOBILE_RELAY_RESOURCE = `downloads:${MOBILE_RELAY_DIRECTORY_NAME}`

/**
 * The actions `mobileGatewayFileRelayPolicy` can allow, declared separately from the
 * terminal table because they are granted on different grounds — these are paired
 * with a resource, those are not — and a future edit should have to say which kind
 * it is adding. `mobile-gateway-permissions.test.ts` checks the executor's calls
 * against the union of both.
 */
export const MOBILE_GATEWAY_RELAY_ACTIONS: ReadonlySet<PermissionAction> = new Set([
  "fs.write.outside-userdata",
])

export const mobileGatewayFileRelayPolicy: PermissionPolicy = {
  id: "mobile-gateway-file-relay",
  decide: (request) => {
    const isMobileGateway = request.actor.kind === MOBILE_GATEWAY_ACTOR.kind
      && request.actor.id === MOBILE_GATEWAY_ACTOR_ID
    if (!isMobileGateway) return "defer-to-next"
    return request.action === "fs.write.outside-userdata" && request.resource === MOBILE_RELAY_RESOURCE
      ? "allow"
      : "defer-to-next"
  },
}

/**
 * Lease ownership is a `(clientId, controllerInstanceId)` pair, and the terminal
 * service caps concurrent leases per controller at four.
 *
 * Giving every session its own controller keeps that cap from becoming a limit on
 * how many terminals a phone may watch at once, while `clientId` stays stable per
 * device so idempotency keys and connection-level revocation still work.
 */
export function mobileControllerFor(input: {
  readonly mobileClientInstanceId: string
  readonly sessionId: string
}): TerminalControllerContext {
  const scope = `mobile:${input.mobileClientInstanceId}`
  return {
    clientId: scope,
    controllerInstanceId: `${scope}:${input.sessionId}`,
    actorKind: "agent",
  }
}

export function mobileClientScope(mobileClientInstanceId: string): string {
  return `mobile:${mobileClientInstanceId}`
}
