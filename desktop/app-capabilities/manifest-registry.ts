import type { AppDeepLinkDeclaration, MainAppCapabilityManifest } from "./manifest"
import { fileOpenerCapabilityManifest } from "./file-opener/shared/manifest"
import { textFileWriterCapabilityManifest } from "./text-file-writer/shared/manifest"
import { htmlGeneratorCapabilityManifest } from "./html-generator/shared/manifest"

const manifests = [fileOpenerCapabilityManifest, textFileWriterCapabilityManifest, htmlGeneratorCapabilityManifest] as const satisfies readonly MainAppCapabilityManifest[]

export function resolveDeclaredAppDeepLink(
  appId: string,
  action: string,
): AppDeepLinkDeclaration | null {
  const manifest = manifests.find((candidate) => candidate.id === appId)
  return manifest?.deepLinks?.find((candidate) => candidate.action === action) ?? null
}
