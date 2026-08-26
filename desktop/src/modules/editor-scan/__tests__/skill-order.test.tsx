/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { EditorScanItemSource, EditorScanSkillItem } from "@/types/editor-scan"
import { GlobalOverview } from "../components/global-overview"
import { ProjectOverview } from "../components/project-overview"

vi.mock("../components/scan-item-card", () => ({
  ScanItemCard: ({ name, source }: { name: string; source: EditorScanItemSource }) => (
    <div data-scan-item-source={source}>{name}</div>
  ),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

function createSkill(name: string, source: EditorScanItemSource): EditorScanSkillItem {
  return {
    name,
    path: `/skills/${name}`,
    source,
    synapseContentId: source === "synapse" ? `${name}-content` : null,
    repositoryVersion: null,
    preview: `${name} preview`,
    fileCount: 1,
    trash: { mode: "path" },
  }
}

async function render(node: React.ReactNode) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(node)
  })
}

function renderedSkillNames() {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-scan-item-source]"))
    .map((item) => item.textContent)
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.innerHTML = ""
})

describe("IDE management skill order", () => {
  const skills = [
    createSkill("external-a", "external"),
    createSkill("synapse-a", "synapse"),
    createSkill("external-b", "external"),
    createSkill("synapse-b", "synapse"),
  ]

  it("lists Synapse-installed global skills before external skills", async () => {
    await render(
      <GlobalOverview
        result={{
          editorId: "codex",
          editorLabel: "Codex",
          status: "detected",
          skills,
          duplicateSkillNames: [],
          rules: [],
          rulesSupported: true,
        }}
        contentTab="skill"
      />,
    )

    expect(renderedSkillNames()).toEqual([
      "synapse-a",
      "synapse-b",
      "external-a",
      "external-b",
    ])
  })

  it("lists Synapse-installed project skills before external skills", async () => {
    await render(
      <ProjectOverview
        projects={[{
          projectPath: "/projects/synapse",
          projectName: "Synapse",
          pathExists: true,
          editors: [{
            editorId: "codex",
            editorLabel: "Codex",
            skills,
            rules: [],
          }],
        }]}
        selectedEditorId="codex"
        selectedEditorLabel="Codex"
        contentTab="skill"
      />,
    )

    expect(renderedSkillNames()).toEqual([
      "synapse-a",
      "synapse-b",
      "external-a",
      "external-b",
    ])
  })
})
