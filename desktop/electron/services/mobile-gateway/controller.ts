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
 */
export const MOBILE_GATEWAY_ALLOWED_ACTIONS: ReadonlySet<PermissionAction> = new Set([
  "terminal.discover",
  "terminal.state.read",
  "terminal.output.read",
  "terminal.command.launch",
  "terminal.session.create",
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
