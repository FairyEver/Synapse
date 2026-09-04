import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import type { SynapseSystemAppId } from "../types"

type HeaderMode = "none" | "module-page" | "window-shell"

const appEntrypoints = {
  agent: { path: "../../agent/index.tsx", header: "none" },
  "agent-personas": { path: "../../../../app-capabilities/agent-personas/renderer/index.tsx", header: "window-shell" },
  workflow: { path: "../../workflow/index.tsx", header: "module-page" },
  drive: { path: "../../drive/index.tsx", header: "module-page" },
  automation: { path: "../../automation/index.tsx", header: "module-page" },
  launcher: { path: "../components/system-app-content.tsx", header: "none" },
  settings: { path: "../../settings/index.tsx", header: "none" },
  "resource-repository": { path: "../../resource-repository/index.tsx", header: "window-shell" },
  git: { path: "../../git/index.tsx", header: "window-shell" },
  database: { path: "../../database/index.tsx", header: "window-shell" },
  "synapse-skill": { path: "../../../../app-capabilities/synapse-skill/renderer/index.tsx", header: "window-shell" },
  secrets: { path: "../../../../app-capabilities/secrets/renderer/index.tsx", header: "window-shell" },
  "quick-input": { path: "../../../../app-capabilities/quick-input/renderer/index.tsx", header: "window-shell" },
  terminal: { path: "../../../../app-capabilities/terminal/renderer/index.tsx", header: "window-shell" },
  "editor-scan": { path: "../../editor-scan/index.tsx", header: "window-shell" },
  "usage-monitor": { path: "../../usage-analysis/index.tsx", header: "window-shell" },
  "model-price": { path: "../../model-price/index.tsx", header: "window-shell" },
  connectors: { path: "../../../../app-capabilities/connectors/renderer/index.tsx", header: "window-shell" },
} as const satisfies Record<SynapseSystemAppId, { readonly path: string; readonly header: HeaderMode }>

describe("system app header architecture", () => {
  for (const [appId, entrypoint] of Object.entries(appEntrypoints)) {
    it(`${appId} declares its app header through the shared slot shell`, async () => {
      const source = await readFile(new URL(entrypoint.path, import.meta.url), "utf8")

      expect(source).not.toMatch(/<SystemAppTopBar(?:\s|>)/)
      if (entrypoint.header === "window-shell") {
        expect(source).toContain("<SystemAppWindowShell")
      } else if (entrypoint.header === "module-page") {
        expect(source).toContain("<ModulePage")
      } else {
        expect(source).not.toContain("<SystemAppWindowShell")
        expect(source).not.toContain("<ModulePage")
      }
    })
  }

  it("keeps terminal header controls on the shared action button", async () => {
    const source = await readFile(new URL(appEntrypoints.terminal.path, import.meta.url), "utf8")

    expect(source).toContain("<SystemAppTopBarActionButton")
    expect(source).toContain("embeddedLeftAddon={headerNavigation}")
  })
})
