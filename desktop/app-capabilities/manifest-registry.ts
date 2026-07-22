import type { AppDeepLinkDeclaration, MainAppCapabilityManifest } from "./manifest"
import { fileOpenerCapabilityManifest } from "./file-opener/shared/manifest"

const manifests = [fileOpenerCapabilityManifest] as const satisfies readonly MainAppCapabilityManifest[]

export function resolveDeclaredAppDeepLink(
  appId: string,
  action: string,
): AppDeepLinkDeclaration | null {
  const manifest = manifests.find((candidate) => candidate.id === appId)
  return manifest?.deepLinks?.find((candidate) => candidate.action === action) ?? null
}
