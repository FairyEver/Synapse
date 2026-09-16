import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

import { createPermissionGuard, type PermissionAction } from "../../runtime/security/permission-guard"
import {
  MOBILE_GATEWAY_ACTOR,
  MOBILE_GATEWAY_ALLOWED_ACTIONS,
  MOBILE_GATEWAY_RELAY_ACTIONS,
  MOBILE_RELAY_RESOURCE,
  mobileGatewayFileRelayPolicy,
  mobileGatewayTerminalPolicy,
} from "../mobile-gateway/controller"

/*
 * The wire between two things that must not drift: the actions the mobile gateway asks for,
 * and the table that lets them through.
 *
 * They did drift. A phone's wipe-to-delete was added, its `authorize("terminal.session.delete")`
 * call came with it, and the table was not updated — so the phone showed "本地策略拒绝了这个操作。"
 * for one feature while every neighbouring one worked. Nothing caught it, because the gateway's
 * own tests inject a stub authorizer: the real permission policy was never exercised by that
 * path, so "the gateway asks for something the policy denies" was invisible from inside the
 * suite. These assertions read the gateway's source instead, which is the only place the two
 * lists meet.
 */

/**
 * Both halves of the gateway: the `mobile-gateway/` directory, which holds the executor that
 * names the actions, and `mobile-gateway-service.ts`, a sibling file, which holds the single
 * place the permission guard is actually consulted. Miss either one and the assertions below
 * check a surface that does not contain what they are about.
 */
const SERVICES_DIR = path.resolve(import.meta.dirname, "..")

type Call = {
  readonly file: string
  readonly line: number
  /** The literal first argument, or null when it is not a string literal. */
  readonly action: string | null
  readonly snippet: string
}

function gatewaySourceFiles(): readonly { readonly file: string; readonly source: string }[] {
  const files: { file: string; source: string }[] = []
  /*
   * `insideGateway` matters: the name filter selects the directory at the top level, but the
   * files inside it are named `controller.ts`, `intent-executor.ts` and so on. Applying the
   * filter at every level collected the sibling service file and nothing else, which made every
   * assertion here pass while checking nothing.
   */
  const collect = (dir: string, insideGateway: boolean): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "__tests__") continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (insideGateway || entry.name.startsWith("mobile-gateway")) collect(full, true)
        continue
      }
      if (!entry.name.endsWith(".ts")) continue
      if (!insideGateway && !entry.name.startsWith("mobile-gateway")) continue
      files.push({ file: path.relative(SERVICES_DIR, full), source: readFileSync(full, "utf8") })
    }
  }
  collect(SERVICES_DIR, false)
  return files
}

/** Call expressions, not definitions: `authorize(action: PermissionAction) => …` is not a call. */
function scan(source: string, file: string): { readonly authorizes: readonly Call[]; readonly guardChecks: readonly Call[] } {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const authorizes: Call[] = []
  const guardChecks: Call[] = []
  const at = (node: ts.Node): number => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const snippet = node.getText(sourceFile).replace(/\s+/g, " ").slice(0, 80)
      /*
       * The executor reaches the callback as `this.deps.authorize(…)`, so a bare-identifier
       * match would find nothing and this whole file would pass without checking anything.
       * A property access counts, with one exception: `this.authorize(…)` is the gateway's own
       * funnel, which the executor callback delegates into with the action already chosen —
       * it decides nothing and names no action of its own.
       */
      const isAuthorizeCall = (ts.isIdentifier(node.expression) && node.expression.text === "authorize")
        || (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "authorize")
      const isFunnelMethod = ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "authorize"
        && node.expression.expression.getText(sourceFile) === "this"
      if (isAuthorizeCall && !isFunnelMethod) {
        const first = node.arguments[0]
        authorizes.push({
          file,
          line: at(node),
          action: first && ts.isStringLiteral(first) ? first.text : null,
          snippet,
        })
      }
      if (
        ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "check"
        && node.expression.expression.getText(sourceFile).includes("permissionGuard")
      ) {
        guardChecks.push({ file, line: at(node), action: null, snippet })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return { authorizes, guardChecks }
}

const scanned = gatewaySourceFiles().map(({ file, source }) => ({ file, ...scan(source, file) }))

/**
 * Every way the gateway may be let through: the terminal table, which grants by
 * action, and the file relay, which grants by action *and* resource. An action the
 * gateway asks for has to appear in one of them or it fails on the user's phone.
 */
const GRANTED_ACTIONS = new Set<string>([
  ...MOBILE_GATEWAY_ALLOWED_ACTIONS,
  ...MOBILE_GATEWAY_RELAY_ACTIONS,
])

describe("mobile gateway permission table", () => {
  it("allows every action the gateway authorizes", () => {
    const unlisted: string[] = []
    for (const { authorizes } of scanned) {
      for (const call of authorizes) {
        if (call.action === null) continue // reported by the literal assertion below
        if (GRANTED_ACTIONS.has(call.action as PermissionAction)) continue
        unlisted.push(
          `${call.file}:${call.line} authorizes "${call.action}", which is in neither `
          + `MOBILE_GATEWAY_ALLOWED_ACTIONS nor MOBILE_GATEWAY_RELAY_ACTIONS (controller.ts). `
          + `Add it to the one that matches how it is granted, or this action fails on the `
          + `phone as "本地策略拒绝了这个操作。" — ${call.snippet}`,
        )
      }
    }
    expect(unlisted).toEqual([])
  })

  it("authorizes with string literals only, so the assertion above can see every action", () => {
    // A computed action name would slip past the subset check, which matches literals.
    const computed: string[] = []
    for (const { authorizes } of scanned) {
      for (const call of authorizes) {
        if (call.action !== null) continue
        computed.push(
          `${call.file}:${call.line} calls authorize() with something other than a string `
          + `literal, so the permission table cannot be checked against it — ${call.snippet}`,
        )
      }
    }
    expect(computed).toEqual([])
  })

  it("lets the mobile actor through for a listed action and refuses an unlisted one", async () => {
    /*
     * The assertions above compare two tables. This one runs the real guard with the real
     * policy, which is where the phone's wipe-to-delete actually failed: the table, the policy
     * and the actor identity all have to line up before an action is allowed.
     */
    const guard = createPermissionGuard()
    guard.registerPolicy(mobileGatewayTerminalPolicy)
    const resource = "terminal:session:11111111-1111-4111-8111-111111111111"

    await expect(guard.check({
      action: "terminal.session.delete",
      actor: MOBILE_GATEWAY_ACTOR,
      resource,
      context: {},
    })).resolves.toMatchObject({ allowed: true })

    // Deleting a group is exactly what the table exists to keep on the desktop.
    await expect(guard.check({
      action: "terminal.group.delete",
      actor: MOBILE_GATEWAY_ACTOR,
      resource,
      context: {},
    })).resolves.toMatchObject({ allowed: false })
  })

  it("scopes the file relay's disk write to its own landing directory", async () => {
    /*
     * `fs.write.outside-userdata` is a whole-home-directory power, so unlike the
     * terminal actions it cannot be granted on the action alone. The policy pairs it
     * with a resource, and this is the assertion that the pairing is real: the same
     * action against anything else has to stay denied, or a phone that could deliver
     * one file could write anywhere the desktop can.
     */
    const guard = createPermissionGuard()
    guard.registerPolicy(mobileGatewayFileRelayPolicy)

    await expect(guard.check({
      action: "fs.write.outside-userdata",
      actor: MOBILE_GATEWAY_ACTOR,
      resource: MOBILE_RELAY_RESOURCE,
      context: {},
    })).resolves.toMatchObject({ allowed: true })

    for (const resource of [
      "/Users/someone",
      "/Users/someone/Downloads",
      "/Users/someone/Downloads/SynapseTemp",
      "downloads:SynapseTemp/../..",
      "downloads:synapsetemp",
    ]) {
      await expect(guard.check({
        action: "fs.write.outside-userdata",
        actor: MOBILE_GATEWAY_ACTOR,
        resource,
        context: {},
      })).resolves.toMatchObject({ allowed: false })
    }

    // The terminal table must not have grown this action in the process.
    expect(MOBILE_GATEWAY_ALLOWED_ACTIONS.has("fs.write.outside-userdata")).toBe(false)
  })

  it("funnels every permission check through the gateway's own authorize method", () => {
    // One funnel means the table is the only gate. A second guard call would be a way to
    // authorize that the subset assertion cannot see.
    const sites = scanned.flatMap(({ guardChecks }) => guardChecks)
      .map((call) => `${call.file}:${call.line} — ${call.snippet}`)
    expect(sites).toHaveLength(1)
  })
})
