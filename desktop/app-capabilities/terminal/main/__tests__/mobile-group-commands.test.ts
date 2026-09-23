import { describe, expect, it } from "vitest"

import { isMobileGroupCommandsPayload, MOBILE_FRAME_LIMITS } from "@synapse/shared"

import { projectMobileGroupCommands, type MobileGroupCommandSource } from "../mobile-group-commands"

function group(overrides: Partial<MobileGroupCommandSource> & { id: string }): MobileGroupCommandSource {
  return {
    settings: {
      commands: [
        { id: "c1", name: "Claude" },
        { id: "c2", name: "Codex" },
      ],
    },
    ...overrides,
  }
}

describe("mobile group command projection", () => {
  it("lists only the groups that have commands, in the computer's own order", () => {
    const entries = projectMobileGroupCommands([
      group({ id: "g2" }),
      { id: "g1" },
      { id: "g3", settings: { commands: [] } },
      { id: "g4", settings: {} },
      group({ id: "g5" }),
    ])

    // 顺序是电脑自己的（分组列表的顺序），而不是按名字排的；没有命令的分组不出现 ——
    // 手机对「不在这份列表里」画的就是「没箭头」。
    expect(entries.map((entry) => entry.groupId)).toEqual(["g2", "g5"])
    expect(entries[0]?.commands.map((command) => command.name)).toEqual(["Claude", "Codex"])
  })

  it("carries the id and the name and nothing else", () => {
    /*
     * 这条是本次唯一的「不会漏出去」的守卫。命令正文在电脑上加密存储、可以挂自己的
     * 环境变量，而桌面自己那个下拉菜单也只写名字 —— 投影如果顺手把 `command` 带出来，
     * 两端都不会报错，只是悄悄把用户的命令正文搬到了云上过一遍。
     */
    const withBody = group({
      id: "g1",
      settings: {
        commands: [{
          id: "c1",
          name: "Claude",
          command: "claude --dangerously-skip-permissions",
          environment: { ANTHROPIC_API_KEY: "sk-secret" },
        } as never],
      },
    })

    const [entry] = projectMobileGroupCommands([withBody])
    expect(entry?.commands[0]).toEqual({ id: "c1", name: "Claude" })
    expect(Object.keys(entry?.commands[0] ?? {})).toEqual(["id", "name"])
  })

  it("produces a payload the wire's own validator accepts", () => {
    const entries = projectMobileGroupCommands([
      group({ id: "g".repeat(MOBILE_FRAME_LIMITS.maxSummaryIdLength) }),
    ])
    expect(isMobileGroupCommandsPayload({
      desktopClientInstanceId: "desktop-1",
      revision: 1,
      groups: entries,
    })).toBe(true)
  })
})
