export type PermissionLevel = "module" | "action" | "management"
export type PermissionStatus = "active" | "deprecated"
export type PermissionClientVisibility = "visible" | "hidden"

export interface PermissionDefinition {
  readonly key: string
  readonly label: string
  readonly description?: string
  readonly group: string
  readonly level: PermissionLevel
  readonly status: PermissionStatus
  readonly clientVisibility: PermissionClientVisibility
}

const definitions = [
  { key: "content.rule.use", label: "规则", group: "content", level: "module", clientVisibility: "visible" },
  { key: "content.skill.use", label: "技能", group: "content", level: "module", clientVisibility: "visible" },
  { key: "content.prompt.use", label: "提示词", group: "content", level: "module", clientVisibility: "visible" },
  { key: "agent.chat.use", label: "对话", group: "agent", level: "module", clientVisibility: "visible" },
  { key: "agent.provider.manage", label: "模型配置", group: "agent", level: "management", clientVisibility: "visible" },
  { key: "agent.permission-mode.manage", label: "权限模式", group: "agent", level: "management", clientVisibility: "visible" },
  { key: "database.use", label: "数据", group: "database", level: "module", clientVisibility: "visible" },
  { key: "scheduler.use", label: "定时", group: "automation", level: "module", clientVisibility: "visible" },
  { key: "workflow.use", label: "工作流", group: "automation", level: "module", clientVisibility: "visible" },
  { key: "local.ide-scan.view", label: "本机", group: "local", level: "module", clientVisibility: "visible" },
  { key: "usage.view", label: "使用分析", group: "usage", level: "module", clientVisibility: "visible" },
  { key: "team.member.manage", label: "成员管理", group: "team", level: "management", clientVisibility: "visible" },
  { key: "team.role.manage", label: "角色管理", group: "team", level: "management", clientVisibility: "visible" },
  { key: "team.invitation.manage", label: "邀请管理", group: "team", level: "management", clientVisibility: "visible" },
] as const satisfies readonly Omit<PermissionDefinition, "status">[]

export const permissionDefinitions: readonly PermissionDefinition[] = definitions.map((item) => ({
  ...item,
  status: "active",
}))

export const allPermissionKeys: readonly string[] = permissionDefinitions.map((item) => item.key)

const definitionByKey = new Map(permissionDefinitions.map((item) => [item.key, item]))

export function getPermissionDefinition(key: string): PermissionDefinition | null {
  return definitionByKey.get(key) ?? null
}

export function isActivePermissionKey(key: string): boolean {
  return getPermissionDefinition(key)?.status === "active"
}

export function assertActivePermissionKey(key: string): void {
  const definition = getPermissionDefinition(key)
  if (!definition) throw new Error(`Unknown permission key: ${key}`)
  if (definition.status !== "active") throw new Error(`Permission key is not active: ${key}`)
}

export function normalizePermissionKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const key of keys) {
    assertActivePermissionKey(key)
    seen.add(key)
  }
  return [...seen].sort()
}
