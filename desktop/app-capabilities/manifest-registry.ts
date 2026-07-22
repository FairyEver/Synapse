import type { AppDeepLinkDeclaration, MainAppCapabilityManifest } from "./manifest"
import { fileOpenerCapabilityManifest } from "./file-opener/shared/manifest"
import { textFileWriterCapabilityManifest } from "./text-file-writer/shared/manifest"

const manifests = [fileOpenerCapabilityManifest, textFileWriterCapabilityManifest] as const satisfies readonly MainAppCapabilityManifest[]

export function resolveDeclaredAppDeepLink(
  appId: string,
  action: string,
): AppDeepLinkDeclaration | null {
  const manifest = manifests.find((candidate) => candidate.id === appId)
  return manifest?.deepLinks?.find((candidate) => candidate.action === action) ?? null
}
