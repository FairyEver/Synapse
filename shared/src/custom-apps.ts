import { z } from "zod"

export const SYSTEM_APP_IDS = [
  "agent",
  "agent-personas",
  "workflow",
  "drive",
  "mail-internal",
  "mail",
  "todos",
  "automation",
  "launcher",
  "settings",
  "resource-repository",
  "git",
  "database",
  "synapse-skill",
  "secrets",
  "quick-input",
  "terminal",
  "editor-scan",
  "model-price",
  "connectors",
  "meeting",
] as const

export type SynapseSystemAppId = (typeof SYSTEM_APP_IDS)[number]

export const DEFAULT_DOCK_APP_IDS = [
  "agent",
  "drive",
  "automation",
  "workflow",
  "terminal",
  "settings",
  "mail-internal",
  "mail",
  "launcher",
] as const satisfies readonly SynapseSystemAppId[]

export const DOCK_CATALOG_VERSION = 1

export const CUSTOM_APPS_API_PATHS = {
  snapshot: "/api/custom-apps/snapshot",
  bootstrap: "/api/custom-apps/bootstrap",
  apps: "/api/custom-apps/apps",
  dockOperations: "/api/custom-apps/dock/operations",
  icons: "/api/custom-apps/icons",
} as const

export type CustomAppId = `cwa_${string}`

export const customAppIdSchema = z.string().regex(
  /^cwa_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  "Invalid custom app id.",
).transform((value) => value as CustomAppId)

export type SynapseAppId = SynapseSystemAppId | CustomAppId

export const customAppIconSourceSchema = z.enum(["favicon", "custom"])
export type CustomAppIconSource = z.infer<typeof customAppIconSourceSchema>

export const customAppKindSchema = z.string().trim().min(1).max(32)

export function countUnicodeCodePoints(value: string): number {
  return Array.from(value).length
}

const customAppNameSchema = z.string()
  .trim()
  .min(1)
  .max(256)
  .refine((value) => countUnicodeCodePoints(value) <= 64, "App name is too long.")

export function parseCustomAppUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 2048) return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
  if (parsed.username || parsed.password) return null
  return parsed.toString()
}

export const customAppUrlSchema = z.string()
  .max(2048)
  .refine((value) => parseCustomAppUrl(value) !== null, "Invalid web app URL.")
  .transform((value) => parseCustomAppUrl(value)!)

const iconPngBase64Schema = z.string()
  .min(1)
  .max(200_000)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/u)

export const customAppDtoSchema = z.object({
  id: customAppIdSchema,
  kind: customAppKindSchema,
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(256),
  startUrl: customAppUrlSchema,
  iconUrl: z.string().min(1).max(2048).nullable(),
  iconSource: customAppIconSourceSchema,
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict()

export type CustomAppDto = {
  readonly id: CustomAppId
  readonly kind: string
  readonly schemaVersion: 1
  readonly name: string
  readonly startUrl: string
  readonly iconUrl: string | null
  readonly iconSource: CustomAppIconSource
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

export const customAppSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  initialized: z.boolean(),
  dockCatalogVersion: z.number().int().positive(),
  apps: z.array(customAppDtoSchema).max(100),
  dockAppIds: z.array(z.string().trim().min(1).max(200)).max(200),
  dockMigrationIds: z.array(z.string().trim().min(1).max(200)).max(200),
}).strict()

export type CustomAppSnapshotDto = z.infer<typeof customAppSnapshotSchema>

export const customAppsSyncStateSchema = z.enum([
  "signed-out",
  "loading",
  "ready",
  "offline",
  "unsupported",
  "error",
])

export const customAppsClientStateSchema = z.object({
  accountId: z.string().min(1).nullable(),
  snapshot: customAppSnapshotSchema.nullable(),
  syncState: customAppsSyncStateSchema,
  errorCode: z.string().min(1).nullable(),
}).strict()

export type CustomAppsSyncState = z.infer<typeof customAppsSyncStateSchema>
export type CustomAppsClientState = z.infer<typeof customAppsClientStateSchema>

export const customWebAppNavigationActionSchema = z.enum(["back", "forward", "reload", "open-external"])
export type CustomWebAppNavigationAction = z.infer<typeof customWebAppNavigationActionSchema>

export const customWebAppViewStateSchema = z.object({
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  isLoading: z.boolean(),
  currentUrl: z.string().min(1).nullable(),
  error: z.enum(["none", "load_failed", "certificate"]),
}).strict()
export type CustomWebAppViewState = z.infer<typeof customWebAppViewStateSchema>

export const customAppCreateInputSchema = z.object({
  operationId: z.string().trim().min(1).max(200),
  id: customAppIdSchema,
  name: customAppNameSchema,
  startUrl: customAppUrlSchema,
  iconSource: customAppIconSourceSchema,
  iconPngBase64: iconPngBase64Schema.optional(),
}).strict()

export type CustomAppCreateInput = z.infer<typeof customAppCreateInputSchema>

export const customAppUpdateInputSchema = z.object({
  operationId: z.string().trim().min(1).max(200),
  name: customAppNameSchema.optional(),
  startUrl: customAppUrlSchema.optional(),
  iconSource: customAppIconSourceSchema.optional(),
  iconPngBase64: iconPngBase64Schema.nullable().optional(),
}).strict().refine(
  (value) => value.name !== undefined
    || value.startUrl !== undefined
    || value.iconSource !== undefined
    || value.iconPngBase64 !== undefined,
  "At least one field must change.",
)

export type CustomAppUpdateInput = z.infer<typeof customAppUpdateInputSchema>

const customAppDockMigrationSchema = z.object({
  id: z.string().trim().min(1).max(200),
  operations: z.array(z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("move-to-end"),
      appId: z.string().trim().min(1).max(200),
    }).strict(),
    z.object({
      kind: z.literal("insert-before"),
      appId: z.string().trim().min(1).max(200),
      targetAppId: z.string().trim().min(1).max(200),
    }).strict(),
  ])).min(1).max(100),
}).strict()

export const customAppDockActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("pin"),
    appId: z.string().trim().min(1).max(200),
  }).strict(),
  z.object({
    type: z.literal("unpin"),
    appId: z.string().trim().min(1).max(200),
  }).strict(),
  z.object({
    type: z.literal("move"),
    appId: z.string().trim().min(1).max(200),
    beforeAppId: z.string().trim().min(1).max(200).nullable(),
  }).strict(),
  z.object({
    type: z.literal("restore-default"),
  }).strict(),
  z.object({
    type: z.literal("apply-migrations"),
    migrations: z.array(customAppDockMigrationSchema).min(1).max(100),
  }).strict(),
])

export type CustomAppDockAction = z.infer<typeof customAppDockActionSchema>

export const customAppDockOperationSchema = z.intersection(
  z.object({ operationId: z.string().trim().min(1).max(200) }).strict(),
  customAppDockActionSchema,
)

export type CustomAppDockOperation = CustomAppDockAction & {
  readonly operationId: string
}

export const customAppBootstrapInputSchema = z.object({
  operationId: z.string().trim().min(1).max(200),
  dockAppIds: z.array(z.string().trim().min(1).max(200)).max(200),
  dockMigrationIds: z.array(z.string().trim().min(1).max(200)).max(200),
}).strict()

export type CustomAppBootstrapInput = z.infer<typeof customAppBootstrapInputSchema>

export interface CustomAppsChangedPayload {
  readonly revision: number
}

const SYSTEM_APP_ID_SET = new Set<string>(SYSTEM_APP_IDS)

function isKnownDockAppId(value: string, knownCustomAppIds: ReadonlySet<string>): value is SynapseAppId {
  return SYSTEM_APP_ID_SET.has(value) || knownCustomAppIds.has(value)
}

export function normalizeCustomAppDockIds(
  values: readonly unknown[] | undefined,
  knownCustomAppIds: ReadonlySet<string>,
): SynapseAppId[] {
  const next: SynapseAppId[] = []
  for (const value of values ?? []) {
    if (typeof value !== "string" || !isKnownDockAppId(value, knownCustomAppIds) || next.includes(value)) continue
    next.push(value)
  }
  if (!next.includes("launcher")) next.push("launcher")
  return next
}

function moveBefore(
  values: readonly SynapseAppId[],
  appId: SynapseAppId,
  beforeAppId: string | null,
): SynapseAppId[] {
  if (!values.includes(appId)) return [...values]
  const without = values.filter((value) => value !== appId)
  if (beforeAppId === null) return [...without, appId]
  const targetIndex = without.indexOf(beforeAppId as SynapseAppId)
  if (targetIndex < 0) {
    const launcherIndex = without.indexOf("launcher")
    return launcherIndex < 0
      ? [...without, appId]
      : [...without.slice(0, launcherIndex), appId, ...without.slice(launcherIndex)]
  }
  return [...without.slice(0, targetIndex), appId, ...without.slice(targetIndex)]
}

export function applyCustomAppDockAction(
  values: readonly unknown[] | undefined,
  action: CustomAppDockAction,
  knownCustomAppIds: ReadonlySet<string>,
  appliedMigrationIds: readonly string[] = [],
): SynapseAppId[] | { readonly appIds: SynapseAppId[]; readonly migrationIds: string[] } {
  const current = normalizeCustomAppDockIds(values, knownCustomAppIds)
  const appId = "appId" in action && typeof action.appId === "string"
    && isKnownDockAppId(action.appId, knownCustomAppIds)
    ? action.appId
    : null

  if (action.type === "restore-default") return [...DEFAULT_DOCK_APP_IDS]
  if (action.type === "pin") {
    if (!appId || current.includes(appId)) return current
    const launcherIndex = current.indexOf("launcher")
    return [
      ...current.slice(0, launcherIndex),
      appId,
      ...current.slice(launcherIndex),
    ]
  }
  if (action.type === "unpin") {
    if (!appId || appId === "launcher") return current
    return current.filter((value) => value !== appId)
  }
  if (action.type === "move") {
    if (!appId) return current
    return moveBefore(current, appId, action.beforeAppId)
  }

  let next = current
  const migrationIds = [...new Set(appliedMigrationIds)]
  for (const migration of action.migrations) {
    if (migrationIds.includes(migration.id)) continue
    for (const operation of migration.operations) {
      if (operation.kind === "move-to-end") {
        if (next.includes(operation.appId as SynapseAppId)) {
          next = [...next.filter((value) => value !== operation.appId), operation.appId as SynapseAppId]
        }
        continue
      }
      if (!isKnownDockAppId(operation.appId, knownCustomAppIds)) continue
      if (next.includes(operation.appId)) next = next.filter((value) => value !== operation.appId)
      const targetId = isKnownDockAppId(operation.targetAppId, knownCustomAppIds)
        ? operation.targetAppId
        : "launcher"
      const targetIndex = next.indexOf(targetId)
      next = targetIndex < 0
        ? [...next, operation.appId]
        : [...next.slice(0, targetIndex), operation.appId, ...next.slice(targetIndex)]
    }
    migrationIds.push(migration.id)
  }
  return { appIds: next, migrationIds }
}
