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

export {
  filterDiscoverableTypes,
  listBuiltinCapabilityPackages,
  listDiscoverableBuiltinAutomationActionTypes,
  listDiscoverableBuiltinWorkflowNodeTypes,
  validateBuiltinCapabilityPackages,
} from "./surface-discovery"

const appDeepLinkManifests = [
  agentConversationCapabilityManifest,
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
