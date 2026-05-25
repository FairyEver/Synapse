export type ModulePermissionStatus = "active" | "deprecated"

export interface ModulePermissionDefinition {
  readonly key: string
  readonly label: string
  readonly group: string
  readonly sortOrder: number
  readonly status: ModulePermissionStatus
}

const definitions = [
  { key: "module.skill", label: "技能", group: "content", sortOrder: 10 },
  { key: "module.rule", label: "规则", group: "content", sortOrder: 20 },
  { key: "module.prompt", label: "提示词", group: "content", sortOrder: 30 },
  { key: "module.agent", label: "对话", group: "agent", sortOrder: 40 },
  { key: "module.database", label: "数据", group: "database", sortOrder: 50 },
  { key: "module.scheduler", label: "定时", group: "automation", sortOrder: 60 },
  { key: "module.workflow", label: "工作流", group: "automation", sortOrder: 70 },
  { key: "module.tools", label: "工具", group: "tools", sortOrder: 80 },
  { key: "module.local", label: "本机", group: "local", sortOrder: 90 },
  { key: "module.usage", label: "使用分析", group: "usage", sortOrder: 100 },
] as const satisfies readonly Omit<ModulePermissionDefinition, "status">[]

export const modulePermissionDefinitions: readonly ModulePermissionDefinition[] = definitions.map((item) => ({
  ...item,
  status: "active",
}))

export const allModulePermissionKeys: readonly string[] = modulePermissionDefinitions.map((item) => item.key)

const definitionByKey = new Map(modulePermissionDefinitions.map((item) => [item.key, item]))
const registryOrder = new Map(allModulePermissionKeys.map((key, index) => [key, index]))

export function getModulePermissionDefinition(key: string): ModulePermissionDefinition | null {
  return definitionByKey.get(key) ?? null
}

export function isActiveModulePermissionKey(key: string): boolean {
  return getModulePermissionDefinition(key)?.status === "active"
}

export function assertActiveModulePermissionKey(key: string): void {
  const definition = getModulePermissionDefinition(key)
  if (!definition) throw new Error(`Unknown module permission key: ${key}`)
  if (definition.status !== "active") throw new Error(`Module permission key is not active: ${key}`)
}

export function normalizeModulePermissionKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const key of keys) {
    assertActiveModulePermissionKey(key)
    seen.add(key)
  }
  return [...seen].sort((a, b) => (registryOrder.get(a) ?? 0) - (registryOrder.get(b) ?? 0))
}
