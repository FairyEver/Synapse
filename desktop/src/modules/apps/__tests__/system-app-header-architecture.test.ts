/** @vitest-environment jsdom */
import { readFile } from "node:fs/promises"
import { URL as FileURL } from "node:url"
import { act, createElement } from "react"
import { describe, expect, it } from "vitest"
import { account, flush, mocks, mount } from "../../mail/__tests__/harness"
import { ExternalMailModule } from "../../mail"
import { EmbeddedSystemAppShell } from "../components/embedded-system-app-shell"
import type { SynapseSystemAppId } from "../types"

type HeaderMode = "none" | "module-page" | "window-shell"

const appEntrypoints = {
  agent: { path: "../../agent/index.tsx", header: "none" },
  "agent-personas": { path: "../../../../app-capabilities/agent-personas/renderer/index.tsx", header: "window-shell" },
  workflow: { path: "../../workflow/index.tsx", header: "module-page" },
  drive: { path: "../../drive/index.tsx", header: "module-page" },
  "mail-internal": { path: "../../mail-internal/index.tsx", header: "window-shell" },
  mail: { path: "../../mail/index.tsx", header: "window-shell" },
  todos: { path: "../../todos/index.tsx", header: "window-shell" },
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
  // 录音页是列表 + 详情的两栏布局，内容区自己管滚动，所以顶栏直接由壳层声明。
  meeting: { path: "../../meeting/index.tsx", header: "window-shell" },
} as const satisfies Record<SynapseSystemAppId, { readonly path: string; readonly header: HeaderMode }>

describe("system app header architecture", () => {
  for (const [appId, entrypoint] of Object.entries(appEntrypoints)) {
    it(`${appId} declares its app header through the shared slot shell`, async () => {
      const source = await readFile(new FileURL(entrypoint.path, import.meta.url), "utf8")

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

  it("keeps the dedicated mail composer on the shared window shell", async () => {
    const source = await readFile(new FileURL("../../mail/compose.tsx", import.meta.url), "utf8")
    expect(source).toContain("<SystemAppWindowShell")
    expect(source).toContain("<SystemAppTopBarActionButton")
    expect(source).not.toMatch(/<Sheet(?:\s|>)/)
  })

  it("keeps terminal header controls on the shared action button", async () => {
    const source = await readFile(new FileURL(appEntrypoints.terminal.path, import.meta.url), "utf8")

    expect(source).toContain("<SystemAppTopBarActionButton")
    expect(source).toContain("embeddedLeftAddon={headerNavigation}")
  })

  it.each(["window", "dock", "launcher"] as const)("keeps mailbox switching in the %s header while changing the visible account", async (host) => {
    mocks.api.accountList.mockResolvedValue({ items: [{ ...account, aliases: [] }, { ...account, id: "ma_two", name: "个人", aliases: [] }], nextCursor: null })
    const mail = createElement(ExternalMailModule)
    mount(host === "window" ? mail : createElement(EmbeddedSystemAppShell, { appName: "邮箱", mode: host, children: mail }))
    await flush()

    const header = document.querySelector("[data-system-app-window-toolbar], [data-embedded-system-app-header]")!
    const selector = header.querySelector<HTMLButtonElement>('button[aria-label="邮箱账号"]')
    expect(selector).not.toBeNull()
    expect(document.querySelectorAll('[aria-label="邮箱账号"]')).toHaveLength(1)
    expect(selector!.closest("[data-system-app-top-bar-left]")).not.toBeNull()
    expect(header.querySelector('[data-system-app-top-bar-actions] [aria-label="刷新邮箱"]')).not.toBeNull()
    expect(header.querySelector("[data-system-app-top-bar-actions]")?.textContent).toContain("写邮件")

    act(() => selector!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })))
    await flush()
    const personal = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(item => item.textContent?.includes("个人"))
    expect(personal).toBeTruthy()
    act(() => personal!.click())
    await flush()
    expect(header.querySelector('[aria-label="邮箱账号"]')?.textContent).toContain("个人")
  })
})
