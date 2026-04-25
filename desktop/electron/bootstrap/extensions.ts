/**
 * Phase 0.6 — Bootstrap-side extension registration.
 *
 * Wires existing hardcoded enums into the ExtensionRegistry so future plugin
 * code can introspect them (and append to them) without changing the core.
 *
 * SPEC §1 hard rule: `runtime/*` doesn't import `modules/*` / business code,
 * so the wiring lives here in `bootstrap/`.
 *
 * Phase 0.6 scope:
 *   - `content.types`: re-publish existing CONTENT_TYPE_DEFINITIONS
 *   - `editors`: ide-registry adapter list (read once at startup)
 *   - `editor-scan.providers`: empty placeholder; future migrations push their
 *     scanner factories here
 */

import { CONTENT_TYPE_DEFINITIONS } from "../../src/config/content-types"
import {
  type ExtensionRegistry,
  createExtensionRegistry,
} from "../runtime/extension"

export interface BootstrapContentType {
  readonly id: string
  readonly displayName: string
}

export interface BootstrapEditorAdapter {
  readonly id: string
  readonly displayName?: string
}

export interface BootstrapEditorScanProvider {
  readonly id: string
}

export const EXTENSION_POINT_IDS = {
  contentTypes: "content.types",
  editors: "editors",
  editorScanProviders: "editor-scan.providers",
} as const

export function registerCoreExtensions(registry: ExtensionRegistry = createExtensionRegistry()): {
  registry: ExtensionRegistry
  contentTypes: BootstrapContentType[]
} {
  const contentTypePoint = registry.definePoint<BootstrapContentType>(
    EXTENSION_POINT_IDS.contentTypes,
  )
  const editorPoint = registry.definePoint<BootstrapEditorAdapter>(EXTENSION_POINT_IDS.editors)
  const editorScanPoint = registry.definePoint<BootstrapEditorScanProvider>(
    EXTENSION_POINT_IDS.editorScanProviders,
  )

  // Content types: copy SPEC §15.1 mapping.
  for (const definition of CONTENT_TYPE_DEFINITIONS) {
    contentTypePoint.register({
      id: definition.id,
      displayName: definition.singularLabel ?? definition.id,
    })
  }

  // Editors / editor-scan providers: Phase 0.6 leaves these empty so future
  // commits register concrete adapters via this same chokepoint. The points
  // are defined so consumers can iterate them today and get a stable empty list.
  void editorPoint
  void editorScanPoint

  return {
    registry,
    contentTypes: contentTypePoint.list().slice(),
  }
}
