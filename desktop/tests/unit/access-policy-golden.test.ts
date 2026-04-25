import { describe, expect, it } from "vitest"
import {
  AccessPolicyService,
  AccessRoleManager,
  allowListAllows,
  redactArgs,
  redactEnv,
  redactToken,
  resolveDisabledCommands,
  validateAccessRoleInputs,
} from "../../electron/services/access-policy-service"

function testRoles() {
  return [
    {
      name: "admin",
      userIds: ["admin1", "admin2"],
      disabledCommands: [],
      rateLimit: { maxMessages: 50, windowMs: 60_000 },
    },
    {
      name: "member",
      userIds: ["*"],
      disabledCommands: ["*"],
      rateLimit: { maxMessages: 3, windowMs: 60_000 },
    },
  ]
}

describe("access policy golden", () => {
  it("matches allow_from semantics", () => {
    expect(allowListAllows("", "user1")).toBe(true)
    expect(allowListAllows("*", "user1")).toBe(true)
    expect(allowListAllows("u1, U2", "u2")).toBe(true)
    expect(allowListAllows("u1,u2", "u3")).toBe(false)

    const policy = new AccessPolicyService({ allowFrom: "admin1,admin2" })
    expect(policy.checkUser("ADMIN1")).toEqual({ allowed: true })
    expect(policy.checkUser("unknown")).toEqual({ allowed: false, reason: "allow_from" })
  })

  it("resolves roles by exact match, default role, then wildcard", () => {
    const manager = new AccessRoleManager("member", testRoles())

    expect(manager.resolveRole("admin1")?.name).toBe("admin")
    expect(manager.resolveRole("ADMIN2")?.name).toBe("admin")
    expect(manager.resolveRole("unknown")?.name).toBe("member")
    expect(manager.resolveRole("")?.name).toBe("member")

    const defaultOnly = new AccessRoleManager("viewer", [
      { name: "admin", userIds: ["admin1"] },
      { name: "viewer", userIds: ["viewer1"], disabledCommands: ["shell"] },
    ])
    expect(defaultOnly.resolveRole("missing")?.name).toBe("viewer")

    const noMatch = new AccessRoleManager("", [{ name: "admin", userIds: ["admin1"] }])
    expect(noMatch.resolveRole("missing")).toBeNull()
  })

  it("validates duplicate users, wildcard roles, empty user_ids, and default role", () => {
    expect(validateAccessRoleInputs("admin", [
      { name: "admin", userIds: ["user1"] },
      { name: "member", userIds: ["user1"] },
    ])?.message).toContain("appears in both role")

    expect(validateAccessRoleInputs("admin", [
      { name: "admin", userIds: ["*"] },
      { name: "member", userIds: ["*"] },
    ])?.message).toContain("wildcard")

    expect(validateAccessRoleInputs("admin", [
      { name: "admin", userIds: [] },
    ])?.message).toContain("empty user_ids")

    expect(validateAccessRoleInputs("missing", [
      { name: "admin", userIds: ["user1"] },
    ])?.message).toContain("default_role")

    expect(validateAccessRoleInputs("member", testRoles())).toBeNull()
  })

  it("resolves disabled commands and lets roles override project-level ACL", () => {
    const wildcard = resolveDisabledCommands(["*"])
    expect(wildcard.has("help")).toBe(true)
    expect(wildcard.has("restart")).toBe(true)

    const specific = resolveDisabledCommands(["upgrade", "/restart", "Help"])
    expect(specific.has("upgrade")).toBe(true)
    expect(specific.has("restart")).toBe(true)
    expect(specific.has("help")).toBe(true)
    expect(specific.has("shell")).toBe(false)

    const policy = new AccessPolicyService({
      disabledCommands: ["help", "status"],
      defaultRole: "member",
      roles: [
        { name: "admin", userIds: ["admin1"], disabledCommands: [] },
        { name: "member", userIds: ["*"], disabledCommands: ["*"] },
      ],
    })

    expect(policy.checkCommand("admin1", "/help")).toEqual({ allowed: true })
    expect(policy.checkCommand("user1", "/help")).toEqual({
      allowed: false,
      reason: "command_disabled",
      role: "member",
    })

    const legacyPolicy = new AccessPolicyService({ disabledCommands: ["help"] })
    expect(legacyPolicy.checkCommand("user1", "/help")).toEqual({
      allowed: false,
      reason: "command_disabled",
    })
  })

  it("redacts env, args, and exact token values without mutating inputs", () => {
    expect(redactEnv([
      "ANTHROPIC_API_KEY=sk-secret",
      "PATH=/usr/bin",
      "NO_EQUALS",
      "BOT_TOKEN=tok",
    ])).toEqual([
      "ANTHROPIC_API_KEY=***",
      "PATH=/usr/bin",
      "NO_EQUALS",
      "BOT_TOKEN=***",
    ])

    const args = ["--api-key", "sk-secret", "--token=tok-123", "--model", "gpt-4", "-k", "short"]
    expect(redactArgs(args)).toEqual(["--api-key", "***", "--token=***", "--model", "gpt-4", "-k", "***"])
    expect(args[1]).toBe("sk-secret")

    expect(redactToken("token sk-secret leaked sk-secret", "sk-secret")).toBe("token [REDACTED] leaked [REDACTED]")
    expect(redactToken("nothing", "")).toBe("nothing")
  })
})
