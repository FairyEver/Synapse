import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { AgentCommandPaletteContent } from "../index"
import type { SynapseCommandCatalogItem } from "@/types/agent-session"

function command(overrides: Partial<SynapseCommandCatalogItem> = {}): SynapseCommandCatalogItem {
  return {
    id: "status",
    command: "/status",
    aliases: ["state"],
    title: "状态",
    description: "查看当前状态",
    group: "info",
    source: "builtin",
    disabled: false,
    highRisk: false,
    argsMode: "none",
    ...overrides,
  }
}

describe("agent command palette", () => {
  it("renders command items inside a cmdk Command root", () => {
    const html = renderToStaticMarkup(
      <AgentCommandPaletteContent
        commands={[
          command(),
          command({
            id: "skills",
            command: "/skills",
            aliases: ["skill"],
            title: "技能",
            description: "打开项目扫描",
          }),
        ]}
        error={null}
        loading={false}
        onSelect={() => {}}
      />,
    )

    expect(html).toContain("/status")
    expect(html).toContain("/skills")
  })

  it("shows command loading errors inside the palette", () => {
    const html = renderToStaticMarkup(
      <AgentCommandPaletteContent
        commands={[]}
        error="读取命令失败。"
        loading={false}
        onSelect={() => {}}
      />,
    )

    expect(html).toContain("读取命令失败。")
  })
})
