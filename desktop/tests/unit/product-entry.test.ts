import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { getAppShellTabs } from "../../src/app-shell/tabs"
import { AgentSessionsModule } from "../../src/modules/agent-sessions"
import { AutomationModule } from "../../src/modules/automation"
import { ConnectorsModule } from "../../src/modules/connectors"

describe("CC Connect product entries", () => {
  it("exposes sessions, connectors, and automation in the app shell tabs", () => {
    const tabs = getAppShellTabs()

    expect(tabs.map((tab) => tab.id)).toEqual(expect.arrayContaining([
      "agent-sessions",
      "connectors",
      "automation",
    ]))
    expect(tabs.map((tab) => tab.label)).toEqual(expect.arrayContaining([
      "会话",
      "连接",
      "自动化",
    ]))
  })

  it("renders the sessions module empty state", () => {
    const html = renderToStaticMarkup(React.createElement(AgentSessionsModule))

    expect(html).toContain("data-module=\"agent-sessions\"")
    expect(html).toContain("暂无会话")
    expect(html).not.toContain("新建会话")
    expect(html).not.toContain("运行中")
  })

  it("renders the connectors module empty state", () => {
    const html = renderToStaticMarkup(React.createElement(ConnectorsModule))

    expect(html).toContain("data-module=\"connectors\"")
    expect(html).toContain("暂无项目")
    expect(html).not.toContain("添加连接")
    expect(html).not.toContain("QR 绑定")
  })

  it("renders the automation module empty state", () => {
    const html = renderToStaticMarkup(React.createElement(AutomationModule))

    expect(html).toContain("data-module=\"automation\"")
    expect(html).toContain("定时任务")
    expect(html).toContain("Heartbeat")
    expect(html).toContain("Hooks")
    expect(html).not.toContain("新建任务")
    expect(html).not.toContain("启用 Heartbeat")
  })
})
