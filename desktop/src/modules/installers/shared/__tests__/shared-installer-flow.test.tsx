/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SynapseEditorAdapterSummary } from "@/types/editor"
import type { SynapseRuleInstallerSource } from "@/types/installers"
import { SharedInstallerFlow } from "../shared-installer-flow"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const editor: SynapseEditorAdapterSummary = {
  id: "codex" as SynapseEditorAdapterSummary["id"],
  label: "Codex",
  order: 1,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill", "prompt"],
}

const ruleSource: SynapseRuleInstallerSource = {
  kind: "rule",
  origin: "inline",
  sourceIdentity: "inline-rule:abc",
  inlineSourceId: "source-1",
  name: "team.rule",
  body: "# Rule",
}

let roots: Root[] = []

async function renderFlow() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <SharedInstallerFlow
        mode="modal"
        source={ruleSource}
        editors={[editor]}
        projects={[]}
        onCancel={vi.fn()}
        onInstalled={vi.fn()}
      />,
    )
  })
}

function clickButton(text: string) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent === text)

  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("SharedInstallerFlow", () => {
  it("starts embedded sources at editor selection", async () => {
    await renderFlow()

    expect(document.body.textContent).toContain("选择编辑器")
    await act(async () => {
      clickButton("Codex")
    })
    expect(document.body.textContent).toContain("目标位置")
  })
})
