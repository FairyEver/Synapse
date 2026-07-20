import { expect, it, vi } from "vitest"
import { createInMemoryHarness } from "../../../runtime/ipc"

const resolveForContent = vi.hoisted(() => vi.fn(async () => ({ entries: [] })))

vi.mock("../../../services/editor-install-status-service", () => ({
  editorInstallStatusService: { resolveForContent },
}))

import { editorInstallStatusIpcModule } from "../ipc"

it("preserves source fingerprints in install status requests", async () => {
  const harness = createInMemoryHarness()
  harness.registry.register(editorInstallStatusIpcModule, {
    moduleId: "editor-install-status",
    resolve: () => {
      throw new Error("No service resolution expected.")
    },
  })

  await harness.invoke("synapse:app:editor_install_status:operation:resolve_for_content", {
    contentType: "skill",
    contentId: "synapse-skill",
    contentName: "synapse-skill",
    sourceFingerprint: "sha256:current",
    projects: [],
  })

  expect(resolveForContent).toHaveBeenCalledWith(expect.objectContaining({
    sourceFingerprint: "sha256:current",
  }))
})
