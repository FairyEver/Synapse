import { skillHubCapabilityManifest } from "./skill-hub/shared/manifest"
import { connectorsCapabilityManifest } from "./connectors/shared/manifest"
import type {
  AppDeepLinkDeclaration,
  AppProtocolRouteDeclaration,
  MainAppCapabilityManifest,
} from "./manifest"
import { fileOpenerCapabilityManifest } from "./file-opener/shared/manifest"
import { textFileWriterCapabilityManifest } from "./text-file-writer/shared/manifest"
import { htmlGeneratorCapabilityManifest } from "./html-generator/shared/manifest"
import { systemNotifierCapabilityManifest } from "./system-notifier/shared/manifest"
import { problemFeedbackCapabilityManifest } from "./problem-feedback/shared/manifest"
import { jsonRepairCapabilityManifest } from "./json-repair/shared/manifest"
import { agentConversationCapabilityManifest } from "./agent/shared/manifest"
import { terminalCapabilityManifest } from "./terminal/shared/manifest"
import { mailCapabilityManifest } from "./mail/shared/manifest"
import { mailInternalCapabilityManifest } from "./mail-internal/shared/manifest"
import { tunnelCapabilityManifest } from "./tunnel/shared/manifest"
import { todosCapabilityManifest } from "./todos/shared/manifest"

export {
  filterDiscoverableTypes,
  listBuiltinCapabilityPackages,
  listDiscoverableBuiltinAutomationActionTypes,
  listDiscoverableBuiltinWorkflowNodeTypes,
  validateBuiltinCapabilityPackages,
} from "./surface-discovery"

const appDeepLinkManifests = [
  connectorsCapabilityManifest,
  agentConversationCapabilityManifest,
  terminalCapabilityManifest,
  mailInternalCapabilityManifest,
  mailCapabilityManifest,
  todosCapabilityManifest,
  tunnelCapabilityManifest,
  skillHubCapabilityManifest,
  fileOpenerCapabilityManifest,
  textFileWriterCapabilityManifest,
  htmlGeneratorCapabilityManifest,
  systemNotifierCapabilityManifest,
  problemFeedbackCapabilityManifest,
  jsonRepairCapabilityManifest,
] as const satisfies readonly MainAppCapabilityManifest[]

export function resolveDeclaredAppDeepLink(
  appId: string,
  action: string,
): AppDeepLinkDeclaration | null {
  const manifest = appDeepLinkManifests.find((candidate) => candidate.id === appId)
  return manifest?.deepLinks?.find((candidate) => candidate.action === action) ?? null
}

export function resolveDeclaredProtocolRoute(
  hostname: string,
): { readonly appId: string; readonly declaration: AppProtocolRouteDeclaration } | null {
  for (const manifest of appDeepLinkManifests as readonly MainAppCapabilityManifest[]) {
    const declaration = manifest.protocolRoutes?.find((candidate) => candidate.hostname === hostname)
    if (declaration) return { appId: manifest.id, declaration }
  }
  return null
}

/** Exact declarative paths; decoding never turns a segment into a separator. */
export function resolveDeclaredAppPath(
  pathname: string,
): {
  appId: string
  action: string
  mainHandlerId: string
  params: Record<string, unknown>
} | null {
  const segments = pathname.split("/").slice(1)
  if (segments.some((s) => !s || s === "." || s === ".." || s.includes("\\"))) return null
  for (const manifest of appDeepLinkManifests as readonly MainAppCapabilityManifest[])
    for (const route of manifest.pathRoutes ?? []) {
      const pattern = route.path.split("/")
      if (pattern.length !== segments.length) continue
      const params: Record<string, string> = { ...route.defaults }
      let matched = true
      for (let i = 0; i < pattern.length; i++) {
        let value: string
        try {
          value = decodeURIComponent(segments[i])
        } catch {
          matched = false
          break
        }
        if (
          !value ||
          value.includes("/") ||
          value.includes("\\") ||
          value === "." ||
          value === ".."
        ) {
          matched = false
          break
        }
        if (pattern[i].startsWith(":")) params[pattern[i].slice(1)] = value
        else if (pattern[i] !== value) {
          matched = false
          break
        }
      }
      if (!matched) continue
      const parsed = route.paramsSchema.safeParse(params)
      if (!parsed.success) return null
      return {
        appId: manifest.id,
        action: route.action,
        mainHandlerId: route.mainHandlerId,
        params: parsed.data,
      }
    }
  return null
}
