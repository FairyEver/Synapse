# 手机端终端分组快捷命令 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手机上新建终端时，能给「电脑上给这个分组配好的启动命令」选一条来启动，而不是只能建一个空终端。

**Architecture:** 新增一条桌面 → 云 → 手机的独立消息族 `mobile.groupCommands`（形状照已有的 `mobile.toolbar`），承载「哪些分组配了命令、各叫什么名字」；手机据此在分组行上画箭头、把点进去的命令列表接上早就存在却没人调用的 `launchCommand` 意图。摘要 `mobile.summary` 一个字不动 —— 它的字节预算只剩 2.88 KiB，装不下这份列表。

**Tech Stack:** TypeScript（shared / Electron 主进程 / NestJS 服务端，vitest）、Swift 6 + SwiftUI（SynapseMobile，`Testing` 框架 + XCTest UI 测试）、pnpm workspace。

**Spec:** `docs/superpowers/specs/2026-09-23-mobile-terminal-group-commands-design.md`（本计划的每一条都能在那里找到出处；有冲突以 spec 为准）

## Global Constraints

- **只传 `groupId` / 命令 `id` / 命令 `name`。** 命令正文（`command`）、环境变量、cwd、shell 一律不上这条线。spec §3.7、§6。
- **`mobile.summary` 与套接字 `maxPayload` 一个字不动。** 这是本次最重要的非目标（spec §2、§7）。
- **上限**：`maxGroupCommandGroups: 128`、`maxGroupCommandsPerGroup: 64`、`maxGroupCommandNameLength: 80`、`maxGroupCommandsBytes: 64 * 1024`（spec §3.3）。
- **裁剪规则**：超预算时从尾部**整条**丢命令，绝不发半条；一个分组被丢空就连它一起去掉（spec §3.3）。
- **不改**：`SynapseAppModel.launchCommand`（`SynapseMobile/SynapseMobile/App/SynapseAppModel.swift:1579`）、`intent-executor.ts` 的 `case "launchCommand"` 分支（`desktop/electron/services/mobile-gateway/intent-executor.ts:612-620`）、桌面端命令管理界面、`mobile.summary`。
- **升级顺序**：服务端 → 桌面端 → 手机端（spec §5）。老服务端会对未知类型返回 `false` 并静默丢掉这条消息。
- 生产代码禁止 `console.log`；Electron 主进程日志用 `createMainLogger`。
- 每个 Task 结束提交一次，只提交本 Task 的文件。

---

### Task 1: 协议 —— 新消息族 `mobile.groupCommands`

**Files:**
- Modify: `shared/src/mobile-live-constants.cjs:117`（工具栏常量块之后）
- Modify: `shared/src/mobile-live.ts`（类型加在 `:726` 的 `Quick phrases` 段之前；校验加在 `isMobileClipboardPayload` 之后，`:1345` 附近）
- Modify: `shared/src/live.ts:31`（消息类型）、`:113-116`（两个联合类型）、`:213-216` 与 `:175-178`（两个校验函数）
- Test: `shared/src/mobile-live.test.ts`

**Interfaces:**
- Consumes: 无（本 Task 是其余所有 Task 的地基）
- Produces:
  - `MobileGroupCommand = { readonly id: string; readonly name: string }`
  - `MobileGroupCommandsEntry = { readonly groupId: string; readonly commands: readonly MobileGroupCommand[] }`
  - `MobileGroupCommandsPayload = { readonly desktopClientInstanceId: string; readonly revision: number; readonly groups: readonly MobileGroupCommandsEntry[] }`
  - `isMobileGroupCommandsPayload(value: unknown): value is MobileGroupCommandsPayload`
  - `LIVE_MESSAGE_TYPES.mobileGroupCommands === "mobile.groupCommands"`
  - 常量：`maxGroupCommandGroups` / `maxGroupCommandsPerGroup` / `maxGroupCommandNameLength` / `maxGroupCommandsBytes`

- [ ] **Step 1: 写失败的测试**

在 `shared/src/mobile-live.test.ts` 的 `toolbar()` 夹具（`:103-114`）后面加一个夹具：

```ts
function groupCommands(overrides: Partial<MobileGroupCommandsPayload> = {}): MobileGroupCommandsPayload {
  return {
    desktopClientInstanceId: "desktop-1",
    revision: 1,
    groups: [
      { groupId: "g1", commands: [{ id: "c1", name: "Claude" }, { id: "c2", name: "Codex" }] },
      { groupId: "g2", commands: [{ id: "c3", name: "小慧日报" }] },
    ],
    ...overrides,
  }
}
```

在文件里那组工具栏用例（`it("routes the toolbar through both sides of the relay")` 起，`:691`）后面加四个用例：

```ts
  it("routes the group command list through both sides of the relay", () => {
    // 两个方向各一道闸，失败的样子完全不同：在电脑那一跳被拒，云端回一个 1003 关闭，
    // 用户看到的是电脑掉线；在手机那一跳被拒，这份列表永远到不了，所有分组行都不带箭头。
    expect(isLiveDesktopClientMessage(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.mobileGroupCommands,
      groupCommands(),
      envelopeMeta,
    ))).toBe(true)
    expect(isLiveMobileServerMessage(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.mobileGroupCommands,
      groupCommands(),
      envelopeMeta,
    ))).toBe(true)
  })

  it("accepts a group command list, including one with no groups", () => {
    expect(isMobileGroupCommandsPayload(groupCommands())).toBe(true)
    // 空列表是一台电脑说「一个分组都没配」，这是一句合法的话：手机对它的表现和不带
    // 箭头的分组一样，但它与「这台电脑太旧、从没发过这条消息」不是同一件事。
    expect(isMobileGroupCommandsPayload(groupCommands({ groups: [] }))).toBe(true)
    // 只有一个分组、一条命令也是合法的：这正是最常见的账号。
    expect(isMobileGroupCommandsPayload(groupCommands({
      groups: [{ groupId: "g1", commands: [{ id: "c1", name: "Claude" }] }],
    }))).toBe(true)
  })

  it("rejects a malformed group command list", () => {
    const entry = groupCommands().groups[0]

    // 缺了它，手机无法知道这份列表是哪台电脑的。
    const withoutDesktop: Record<string, unknown> = { ...groupCommands() }
    delete withoutDesktop.desktopClientInstanceId
    expect(isMobileGroupCommandsPayload(withoutDesktop)).toBe(false)
    expect(isMobileGroupCommandsPayload(groupCommands({ desktopClientInstanceId: "" }))).toBe(false)
    expect(isMobileGroupCommandsPayload(groupCommands({ revision: -1 }))).toBe(false)
    expect(isMobileGroupCommandsPayload(groupCommands({ revision: 1.5 }))).toBe(false)
    expect(isMobileGroupCommandsPayload({ ...groupCommands(), groups: "none" })).toBe(false)

    const limits = MOBILE_FRAME_LIMITS
    const tooManyGroups = Array.from(
      { length: limits.maxGroupCommandGroups + 1 },
      (_value, index) => ({ ...entry, groupId: `g${index}` }),
    )
    expect(isMobileGroupCommandsPayload(groupCommands({ groups: tooManyGroups }))).toBe(false)
    // 分组里命令太多
    expect(isMobileGroupCommandsPayload(groupCommands({
      groups: [{
        groupId: "g1",
        commands: Array.from(
          { length: limits.maxGroupCommandsPerGroup + 1 },
          (_value, index) => ({ id: `c${index}`, name: "n" }),
        ),
      }],
    }))).toBe(false)
    // 名字与 id 的上限，和电脑自己的 schema、摘要里的分组名同值
    expect(isMobileGroupCommandsPayload(groupCommands({
      groups: [{ groupId: "g1", commands: [{ id: "c1", name: "n".repeat(limits.maxGroupCommandNameLength + 1) }] }],
    }))).toBe(false)
    expect(isMobileGroupCommandsPayload(groupCommands({
      groups: [{ groupId: "g1", commands: [{ id: "i".repeat(limits.maxSummaryIdLength + 1), name: "Claude" }] }],
    }))).toBe(false)

    // 一个分组缺了 groupId，或一条命令缺了名字：整条消息作废。这两个字段在电脑上都是
    // 非空的，产生端不出来的东西，也不该被线上放过去。
    expect(isMobileGroupCommandsPayload(groupCommands({
      groups: [{ commands: [{ id: "c1", name: "Claude" }] }],
    }))).toBe(false)
    expect(isMobileGroupCommandsPayload(groupCommands({
      groups: [{ groupId: "g1", commands: [{ id: "c1" }] }],
    }))).toBe(false)
    expect(isMobileGroupCommandsPayload(groupCommands({
      groups: [{ groupId: "g1", commands: "none" }],
    }))).toBe(false)
  })
```

同一文件顶部的 `@synapse/shared` 导入里加上 `isMobileGroupCommandsPayload`（跟 `isMobileToolbarPayload` 那些放一起）。

- [ ] **Step 2: 跑测试，确认它失败**

Run: `pnpm --filter @synapse/shared run test -- src/mobile-live.test.ts`
Expected: FAIL —— `isMobileGroupCommandsPayload` 不是一个函数（`TypeError: isMobileGroupCommandsPayload is not a function`），`LIVE_MESSAGE_TYPES.mobileGroupCommands` 是 `undefined`。

- [ ] **Step 3: 加常量**

`shared/src/mobile-live-constants.cjs`，紧接 `maxToolbarBytes: 64 * 1024,`（第 117 行）之后：

```js
  /**
   * 分组快捷命令：电脑上给每个终端分组配的启动命令，手机用它决定分组行画不画箭头。
   *
   * 条数与字节上限都照工具栏那一组自己的值 —— 同一类东西（一份「电脑上的启动命令」
   * 列表），没理由两套数。名字的 80 与终端 schema、摘要分组名的上限同值。
   */
  maxGroupCommandGroups: 128,
  maxGroupCommandsPerGroup: 64,
  maxGroupCommandNameLength: 80,
  /** Bounds one serialized group-command payload, which is trimmed command by command. */
  maxGroupCommandsBytes: 64 * 1024,
```

- [ ] **Step 4: 加类型与校验**

`shared/src/mobile-live.ts`，在 `/* --- Quick phrases --- */` 那个分隔注释（第 726 行）**之前**插入：

```ts
/* ------------------------------------------------------------------ *
 * Terminal group commands
 * ------------------------------------------------------------------ */

/**
 * 一个分组里保存的一条启动命令，手机只用来画一行。
 *
 * 只有 id 与 name，正文不上这条线：桌面自己那个「以命令启动」下拉也只写名字，而正文在
 * 电脑上是加密存储的、还可以挂自己的环境变量。这一屏要回答的是「跑哪一条」，不是
 * 「它是什么」。
 *
 * 名字上限与电脑自己 schema 的上限同值（80）。
 */
export interface MobileGroupCommand {
  readonly id: string
  readonly name: string
}

/**
 * 一个分组保存的启动命令，按电脑上的顺序（电脑侧就是创建顺序，没有排序字段）。
 *
 * 没有命令的分组**不在** `MobileGroupCommandsPayload.groups` 里，所以这个类型不需要
 * 「空列表」这种说法：手机对「不在列表里」画的和「这台电脑说了它没有」是同一个东西 ——
 * 分组行上不画箭头。
 */
export interface MobileGroupCommandsEntry {
  readonly groupId: string
  readonly commands: readonly MobileGroupCommand[]
}

/**
 * 一台电脑上那些配了启动命令的分组，fanned out to every phone of the account.
 *
 * 独立成一条消息而不是并进 `MobileSummaryPayload`，理由与工具栏那条一字不差，而且是
 * 算术：摘要不可分片 —— 手机收到一份就整包替换 —— 所以它的字节预算要一次装下所有字段。
 * 摘要自己的预算离承载它的套接字只剩不到 3 KiB（见 `maxSummaryBytes` 的注释），而在它
 * 允许的分组数上限上各带上自己的命令，远超这个数。放在这里则 `maxSummaryBytes` 一个字
 * 不用动，这条消息也有了自己的、可以单独裁剪的上限。
 *
 * `desktopClientInstanceId` 与 `revision` 的理由同 `MobileToolbarPayload`：手机可能同时
 * 连着几台电脑，只有一台拥有它正在看的那份列表；`revision` 是产生端自己的计数器，手机
 * 不比较它，它只让一份抓到的 payload 自证来历。
 */
export interface MobileGroupCommandsPayload {
  readonly desktopClientInstanceId: string
  readonly revision: number
  /**
   * 有命令的那些分组。空数组是合法值：这台电脑一个分组都没配。
   *
   * 「没配」与「这台电脑从没发过这条消息」是两回事，虽然手机对两者画出来的东西一样
   * （都不画箭头）。
   */
  readonly groups: readonly MobileGroupCommandsEntry[]
}
```

在 `isMobileClipboardPayload`（`:1339-1345`）之后加：

```ts
export function isMobileGroupCommandsPayload(value: unknown): value is MobileGroupCommandsPayload {
  if (!isRecord(value)) return false
  if (!boundedString(value.desktopClientInstanceId, 120)) return false
  if (!nonNegativeInteger(value.revision)) return false
  if (!boundedArray(value.groups, MOBILE_FRAME_LIMITS.maxGroupCommandGroups)) return false
  return (value.groups as readonly unknown[]).every(isMobileGroupCommandsEntry)
}
```

在 `isMobileQuickPhrase`（`:1607` 附近）那一族子校验旁边加：

```ts
function isMobileGroupCommandsEntry(value: unknown): value is MobileGroupCommandsEntry {
  if (!isRecord(value)) return false
  if (!boundedString(value.groupId, MOBILE_FRAME_LIMITS.maxSummaryIdLength)) return false
  if (!boundedArray(value.commands, MOBILE_FRAME_LIMITS.maxGroupCommandsPerGroup)) return false
  return (value.commands as readonly unknown[]).every(isMobileGroupCommand)
}

/**
 * 严格，和短语、剪切板一样：一条记录只有两个字符串，解不出来就是消息坏了。这两个字段
 * 在电脑上都非空（命令名有 `min(1)`，id 是 uuid），产生端不可能造出一个坏的 —— 所以
 * 放过去只会把一条坏记录留在手机那份列表里。
 */
function isMobileGroupCommand(value: unknown): value is MobileGroupCommand {
  if (!isRecord(value)) return false
  if (!boundedString(value.id, MOBILE_FRAME_LIMITS.maxSummaryIdLength)) return false
  return boundedString(value.name, MOBILE_FRAME_LIMITS.maxGroupCommandNameLength)
}
```

- [ ] **Step 5: 注册消息类型**

`shared/src/live.ts`：

`LIVE_MESSAGE_TYPES` 里 `mobileToolbar: "mobile.toolbar",` 之后：

```ts
  mobileGroupCommands: "mobile.groupCommands",
```

`LiveDesktopClientMessage` 联合类型里（`:113` 的 `mobileToolbar` 之后）：

```ts
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.mobileGroupCommands, import("./mobile-live.js").MobileGroupCommandsPayload>
```

`LiveMobileServerMessage` 联合类型里（`:148` 的 `mobileToolbar` 之后）加同一行。

`isLiveDesktopClientMessage` 里，`mobileToolbar` 那一行（`:213`）之后：

```ts
  if (value.type === LIVE_MESSAGE_TYPES.mobileGroupCommands) {
    return isMobileGroupCommandsPayload(value.payload)
  }
```

`isLiveMobileServerMessage` 里，`mobileToolbar` 那一行（`:175`）之后加同样三行。

`isMobileGroupCommandsPayload` 已经由 `export * from "./mobile-live.js"` 导出，`live.ts` 里现有的 `isMobileToolbarPayload` 就来自那里，无需新增 import。

- [ ] **Step 6: 跑测试，确认它通过**

Run: `pnpm --filter @synapse/shared run test -- src/mobile-live.test.ts`
Expected: PASS（包含新加的四个用例）。同时 `pnpm --filter @synapse/shared run test` 整体通过 —— 尤其是 `:513` 那条「最大摘要不超预算」的边界测试，它必须原样通过（这条正是本次没动摘要的证明）。

- [ ] **Step 7: 提交**

```bash
git add shared/src/mobile-live.ts shared/src/mobile-live-constants.cjs shared/src/live.ts shared/src/mobile-live.test.ts
git commit -m "feat: 手机端协议新增分组快捷命令消息族

桌面端给终端分组配的启动命令，手机需要一个列表才能决定分组行上画不画
箭头。摘要在上限上离套接字只剩不到 3 KiB，装不下这份数据，所以照
mobile.toolbar 独立成一条 mobile.groupCommands。

只带 groupId、命令 id 与名字：正文在电脑上是加密存储的、还可以挂环境
变量，而桌面自己的下拉菜单也只写名字。"
```

---

### Task 2: 桌面端投影 —— 分组命令 → 手机要的那份名字列表

**Files:**
- Create: `desktop/app-capabilities/terminal/main/mobile-group-commands.ts`
- Create: `desktop/app-capabilities/terminal/main/__tests__/mobile-group-commands.test.ts`
- Modify: `desktop/app-capabilities/terminal/main/service.ts:1428-1434`（紧邻 `listMobileToolbarButtons`）、`:3558`（返回对象）

**Interfaces:**
- Consumes: Task 1 的 `MobileGroupCommand` / `MobileGroupCommandsEntry`
- Produces:
  - `type MobileGroupCommandSource = { readonly id: string; readonly settings?: { readonly commands?: readonly { readonly id: string; readonly name: string }[] } }`
  - `projectMobileGroupCommands(groups: readonly MobileGroupCommandSource[]): readonly MobileGroupCommandsEntry[]`
  - `TerminalService.listMobileGroupCommands(): readonly MobileGroupCommandsEntry[]`

- [ ] **Step 1: 写失败的测试**

`desktop/app-capabilities/terminal/main/__tests__/mobile-group-commands.test.ts`（新建）：

```ts
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
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `pnpm --filter @synapse/desktop run test -- app-capabilities/terminal/main/__tests__/mobile-group-commands.test.ts`
Expected: FAIL —— 找不到模块 `../mobile-group-commands`。

- [ ] **Step 3: 写实现**

`desktop/app-capabilities/terminal/main/mobile-group-commands.ts`（新建）：

```ts
import type { MobileGroupCommand, MobileGroupCommandsEntry } from "@synapse/shared" with { "resolution-mode": "import" }

/**
 * 把电脑上的分组命令变成手机要的那份列表。
 *
 * 一条规则，和工具栏那份投影同源：**只传 id 与 name**。正文不进这条线 —— 桌面自己的
 * 「以命令启动」下拉也只写名字，而正文在电脑上是加密存储的、还可以挂自己的环境变量。
 * 这一屏要回答的是「跑哪一条」，不是「它是什么」。
 *
 * 输入刻意是一个**结构化的窄类型**而不是 `TerminalGroup`：这个模块是叶子，只读它用到
 * 的那两个字段，测试也就不必为了造一个分组把 createdAt 与四个 revision 全写出来。
 * 真实的 `TerminalGroup` 结构上就满足它。
 *
 * 没有命令的分组直接不出现：手机对「不在这份列表里」画的就是「没箭头」，所以这里不需要
 * 一个空列表来表达「这个分组没有命令」。
 */
export type MobileGroupCommandSource = {
  readonly id: string
  readonly settings?: {
    readonly commands?: readonly { readonly id: string; readonly name: string }[]
  }
}

export function projectMobileGroupCommands(
  groups: readonly MobileGroupCommandSource[],
): readonly MobileGroupCommandsEntry[] {
  const entries: MobileGroupCommandsEntry[] = []
  for (const group of groups) {
    const commands = group.settings?.commands
    if (!commands || commands.length === 0) continue
    entries.push({
      groupId: group.id,
      commands: commands.map((command): MobileGroupCommand => ({
        id: command.id,
        name: command.name,
      })),
    })
  }
  return entries
}
```

- [ ] **Step 4: 跑测试，确认它通过**

Run: `pnpm --filter @synapse/desktop run test -- app-capabilities/terminal/main/__tests__/mobile-group-commands.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 接到终端能力上**

`desktop/app-capabilities/terminal/main/service.ts`：

文件顶部的 `@synapse/shared` 导入里加上 `MobileGroupCommandsEntry`，并新增一行导入：

```ts
import { projectMobileGroupCommands } from "./mobile-group-commands"
```

在 `listMobileToolbarButtons`（`:1428-1434`）**之后**加：

```ts
  /**
   * 手机要的那份分组命令列表 —— 只有配了命令的分组，只有 id 与名字。
   *
   * 与 `listMobileToolbarButtons` 同一个位置、同一个理由：手机能看见什么由这个能力
   * 决定，网关不必知道终端的分组长什么样。
   */
  function listMobileGroupCommands(): readonly MobileGroupCommandsEntry[] {
    return projectMobileGroupCommands(listGroups())
  }
```

在返回对象里 `listMobileToolbarButtons,`（`:3558`）之后加一行：

```ts
    listMobileGroupCommands,
```

- [ ] **Step 6: 类型检查**

Run: `pnpm --filter @synapse/desktop run typecheck`
Expected: 通过。

- [ ] **Step 7: 提交**

```bash
git add desktop/app-capabilities/terminal/main/mobile-group-commands.ts \
  desktop/app-capabilities/terminal/main/__tests__/mobile-group-commands.test.ts \
  desktop/app-capabilities/terminal/main/service.ts
git commit -m "feat: 终端能力投影出手机要的分组命令列表

只有配了命令的分组、只有 id 与名字。正文不进这条线，并且有一条用例
逐字段钉住这一点：投影顺手多带一个字段，两端都不会报错。"
```

---

### Task 3: 桌面端发送 —— 指纹、预算裁剪、走到套接字

**Files:**
- Modify: `desktop/electron/services/mobile-gateway/transport.ts:25`（draft 类型）、`:74`（transport 方法）
- Modify: `desktop/electron/services/mobile-gateway-service.ts:89`（常量）、`:283`（状态）、`:928`（tick）、`:911` 之后（裁剪函数）
- Modify: `desktop/electron/services/live-connection-service.ts:485-493` 之后（发送方法 + 类型导入）
- Modify: `desktop/electron/bootstrap/app-ready.ts:193` 之后（接线）
- Test: `desktop/electron/services/__tests__/mobile-gateway-service.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `MobileGroupCommandsPayload`、Task 2 的 `TerminalService.listMobileGroupCommands()`
- Produces:
  - `MobileGroupCommandsDraft = Omit<MobileGroupCommandsPayload, "desktopClientInstanceId">`
  - `MobileGatewayTransport.sendGroupCommands(draft: MobileGroupCommandsDraft): void`
  - `MobileGatewayService.flushGroupCommands(): void` / `resendGroupCommands(): void`
  - `LiveConnectionService.sendMobileGroupCommands(draft: MobileGroupCommandsDraft): Promise<void>`

- [ ] **Step 1: 写失败的测试**

`desktop/electron/services/__tests__/mobile-gateway-service.test.ts`：

1. 顶部 `@synapse/shared` 的类型导入里加 `MobileGroupCommandsEntry`；`../mobile-gateway/transport` 的类型导入里加 `MobileGroupCommandsDraft`。
2. `FakeTerminal`（`:105`）里 `listMobileToolbarButtons` 之后加：

```ts
  /**
   * 手机要的那份分组命令列表，由能力侧投影好。可变，好让用例改了之后看网关认不认。
   */
  mobileGroupCommands: readonly MobileGroupCommandsEntry[] = [
    { groupId: "g1", commands: [{ id: "c1", name: "Claude" }] },
  ]

  listMobileGroupCommands(): readonly MobileGroupCommandsEntry[] {
    this.calls.push("listMobileGroupCommands")
    return this.mobileGroupCommands
  }
```

3. 夹具里（`:527` 的 `const gitStatuses` 之后）加收集数组，并在 transport 里加一行：

```ts
  const groupCommands: MobileGroupCommandsDraft[] = []
```

```ts
    sendGroupCommands: (draft) => groupCommands.push(draft),
```

4. 返回值对象（`:676-682`）里加上 `groupCommands,`。

5. 在工具栏那组用例（`:1853` 起）之后加三条：

```ts
  it("sends the group command list without anyone asking, and only when it changes", async () => {
    /*
     * 这条列表搭的是摘要那个 1 Hz 的 tick —— 终端事件发射器已经到了 Node 的监听器
     * 上限，不许再挂监听器。于是「改了命令手机多久看到」就等于这个 tick 的周期，
     * 而这一条同时是它的代价上限：什么都没变时一个字节都不发。
     */
    const harness = createHarness()
    await harness.timers.advance(1_000)

    expect(harness.groupCommands).toHaveLength(1)
    expect(harness.groupCommands[0]?.groups).toEqual([
      { groupId: "g1", commands: [{ id: "c1", name: "Claude" }] },
    ])

    // 没有变化：接下来的 tick 一条都不发。
    await harness.timers.advance(3_000)
    expect(harness.groupCommands).toHaveLength(1)

    // 电脑上改了命令，下一个 tick 就带出去 —— 指纹比的是内容，不是版本号。
    harness.terminal.mobileGroupCommands = [
      ...harness.terminal.mobileGroupCommands,
      { groupId: "g2", commands: [{ id: "c2", name: "Codex" }] },
    ]
    await harness.timers.advance(1_000)

    expect(harness.groupCommands).toHaveLength(2)
    expect(harness.groupCommands.at(-1)?.groups.map((entry) => entry.groupId)).toEqual(["g1", "g2"])
  })

  it("keeps the group command fingerprint separate from the summary's", async () => {
    // 摘要有输出时一秒一变，而分组命令只在用户改命令时变。共用一个指纹，等于每有一个
    // 终端打出新行就重发一遍这份列表。
    const harness = createHarness()
    await harness.timers.advance(1_000)
    const afterFirst = harness.groupCommands.length

    harness.terminal.events.emit("data", { sessionId: "sess-1", chunk: { seq: 2 } })
    await harness.timers.advance(3_000)

    expect(harness.groupCommands).toHaveLength(afterFirst)
  })

  it("drops whole commands, and then whole groups, when the list would not fit", async () => {
    /*
     * 上界是 64 KiB 减信封余量，真实账号远到不了（那要四百多条命令行）。这条用例要钉
     * 的是裁剪的**规则**而不是它的触发条件：丢掉的是整条命令，绝不发半条；一个分组被
     * 丢空就连它一起去掉 —— 不然手机那边会出现一个带箭头的空列表。
     *
     * 一份放到最大的列表是 128 个分组各带 64 条命令（约 1.2 MiB），所以这里用 20 个
     * 这样的分组（约 195 KiB）就足以越过 63 KiB 的线，同时不让用例跑得太久。
     */
    const harness = createHarness()
    const name = "n".repeat(MOBILE_FRAME_LIMITS.maxGroupCommandNameLength)
    const commands = Array.from({ length: MOBILE_FRAME_LIMITS.maxGroupCommandsPerGroup }, (_value, index) => ({
      id: `c${index}`,
      name,
    }))
    harness.terminal.mobileGroupCommands = [
      { groupId: "g-first", commands: [{ id: "keep", name: "Claude" }] },
      ...Array.from({ length: 20 }, (_value, index) => ({ groupId: `g-big-${index}`, commands })),
      { groupId: "g-last", commands: [{ id: "also-keep", name: "Codex" }] },
    ]

    await harness.timers.advance(1_000)

    const sent = harness.groupCommands.at(-1)?.groups ?? []
    const serialized = Buffer.byteLength(JSON.stringify(sent), "utf8")
    expect(serialized).toBeLessThanOrEqual(
      MOBILE_FRAME_LIMITS.maxGroupCommandsBytes - 1_024,
    )
    // 第一条命令留着；越过预算之后的一切都不发（尾部整段丢，与 `fitToolbarToBudget`
    // 同一条规则）；一条命令要么整条在，要么不在。
    expect(sent[0]).toEqual({ groupId: "g-first", commands: [{ id: "keep", name: "Claude" }] })
    expect(sent.length).toBeGreaterThan(1)
    expect(sent.length).toBeLessThan(21)
    expect(sent.map((entry) => entry.groupId)).not.toContain("g-last")
    for (const entry of sent) {
      expect(entry.commands.length).toBeGreaterThan(0)
      for (const command of entry.commands) {
        expect(Object.keys(command)).toEqual(["id", "name"])
        expect(command.name.length).toBeLessThanOrEqual(MOBILE_FRAME_LIMITS.maxGroupCommandNameLength)
      }
    }
  })
```

6. 同样的 `mobileGroupCommands` 也要在那份「有命令的分组才出现」的用例里验一次空列表：如果 `harness.terminal.mobileGroupCommands = []`，发出去的是 `groups: []`（一台电脑说「一个都没配」），而不是不发。在第一条用例末尾追加：

```ts
    // 一个分组都没配：发一份空列表，而不是沉默。沉默在手机上等于「这台电脑太旧」，
    // 与「它就是没配」在界面上的表现虽然一样，但在协议上是两回事。
    harness.terminal.mobileGroupCommands = []
    await harness.timers.advance(1_000)
    expect(harness.groupCommands.at(-1)?.groups).toEqual([])
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `pnpm --filter @synapse/desktop run test -- electron/services/__tests__/mobile-gateway-service.test.ts`
Expected: FAIL —— `sendGroupCommands` 不在 `MobileGatewayTransport` 上（类型报错），且 `harness.groupCommands` 恒为空数组。

- [ ] **Step 3: 加传输管道**

`desktop/electron/services/mobile-gateway/transport.ts`：

类型导入里加 `MobileGroupCommandsPayload`，draft 类型加在 `MobileToolbarDraft`（`:25`）之后：

```ts
/**
 * 分组命令列表，减去电脑身份，理由与上面几条相同。
 *
 * 手机按哪台电脑归档一份列表，所以发送者必须在消息上；而这个网关不知道自己的 id ——
 * 那是持有套接字的连接才知道的事。
 */
export type MobileGroupCommandsDraft = Omit<MobileGroupCommandsPayload, "desktopClientInstanceId">
```

transport 类型里，`sendToolbar`（`:74`）之后加：

```ts
  /**
   * 分组里配了哪些启动命令，手机据此决定分组行上画不画箭头。
   *
   * 与工具栏同一条规则：整份快照，从不发增量 —— 手机用它替换自己那份，所以丢一条只
   * 等于等下一个。与它分开是因为来源不同：这份说的是「新建面板里的分组」，那块界面
   * 与工具栏上的按钮无关。
   */
  readonly sendGroupCommands: (draft: MobileGroupCommandsDraft) => void
```

`desktop/electron/services/live-connection-service.ts`：类型导入里加 `MobileGroupCommandsDraft`（跟 `MobileToolbarDraft` 一起），并在 `sendMobileToolbar`（`:485-493`）之后加：

```ts
  /**
   * 电脑上那些配了启动命令的分组，发给它的手机。
   *
   * 没有身份就丢掉这条消息，理由与上面几条相同：手机按哪台电脑归档，说不清自己是谁的
   * 一条只会在手机上落进「没有」。
   */
  async sendMobileGroupCommands(draft: MobileGroupCommandsDraft): Promise<void> {
    const clientInstanceId = this.state.clientInstanceId
    if (!clientInstanceId) return
    const { LIVE_MESSAGE_TYPES, createLiveEnvelope } = await this.getProtocol()
    this.sendLiveEnvelope(createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileGroupCommands, {
      desktopClientInstanceId: clientInstanceId,
      ...draft,
    }, this.envelopeMetadata()))
  }
```

`desktop/electron/bootstrap/app-ready.ts`，`sendToolbar:`（`:193`）之后加：

```ts
      sendGroupCommands: (draft) => void liveConnectionService.sendMobileGroupCommands(draft),
```

- [ ] **Step 4: 加网关侧的指纹、裁剪与 tick**

`desktop/electron/services/mobile-gateway-service.ts`：

a. 顶部类型导入：加 `MobileGroupCommandsEntry`（跟 `MobileToolbarButton` 一起）。

b. 常量，紧接 `TOOLBAR_ENVELOPE_ALLOWANCE_BYTES`（`:89`）之后：

```ts
/** 同 `TOOLBAR_ENVELOPE_ALLOWANCE_BYTES`：给信封与字段名留的余量。 */
const GROUP_COMMANDS_ENVELOPE_ALLOWANCE_BYTES = 1_024
```

c. 状态，紧接 `lastToolbarContent`（`:284`）之后：

```ts
  /**
   * 分组命令列表的指纹，与上面那个分开。
   *
   * 分开的理由是它们的**变更时机**不同：按钮只在用户改工具栏时变，而这一份只在用户
   * 改分组命令时变，两者互不相干。共用一个指纹会让任何一次工具栏编辑顺带重发一遍
   * 分组命令，反之亦然。
   */
  private groupCommandsRevision = 0
  private lastGroupCommandsContent = ""
```

d. `flushSummary()` 里 `this.flushToolbar()`（`:928`）之后加一行：

```ts
    // 同样骑在这个 tick 上，理由见 `flushToolbar` 与 `flushGitStatus`。
    this.flushGroupCommands()
```

e. 在 `fitToolbarToBudget`（`:911-920`）之后加三个方法：

```ts
  /**
   * Sends the group command list in the same shape as everything else here: a full
   * snapshot, fingerprinted so an idle desktop produces no traffic.
   *
   * 骑在摘要那个 1 Hz 的 tick 上，而不是给命令的增删改挂监听器：终端事件发射器已经
   * 到了 Node 的监听器上限，这张名单不许再长（见 `start()` 那条注释）。代价是一秒一次
   * 的字符串比较，换来的是「电脑上改完命令，约一秒内手机就看到」。
   */
  private flushGroupCommands(): void {
    const transport = this.transport
    if (!transport) return
    try {
      const groups = this.fitGroupCommandsToBudget(this.terminal.listMobileGroupCommands())
      // Compared without the revision, so an unchanged list produces nothing at all.
      const serialized = JSON.stringify(groups)
      if (serialized === this.lastGroupCommandsContent) return
      this.lastGroupCommandsContent = serialized
      this.groupCommandsRevision += 1
      transport.sendGroupCommands({ revision: this.groupCommandsRevision, groups })
    } catch (error) {
      // 一份拿不到的分组命令列表，只意味着新建面板上的分组行没有箭头 —— 点一下照样
      // 能建终端，那是这条路上真正要紧的部分。
      this.logWarn("Mobile group command flush failed.", error)
    }
  }

  /** Sends even when nothing changed, for a caller that has nothing yet. */
  private resendGroupCommands(): void {
    this.lastGroupCommandsContent = ""
    this.flushGroupCommands()
  }

  /**
   * 从尾部整条丢命令，直到这份列表放得下 `maxGroupCommandsBytes`。
   *
   * 丢整条而不是把一条命令截一半：半条命令在手机上是一条「本该在、却不在」的选项，
   * 而它出现在哪个分组、叫什么名字都是确定的事实 —— 没有半个名字这种东西。
   * 一个分组被丢空就连它一起去掉：留着它会在手机上画出一个点开是空列表的箭头。
   *
   * 第一条放不下的命令之后的一切都不发，与 `fitToolbarToBudget` 的 `break` 同一条
   * 规则 —— 不做「跳过大的、塞进后面小的」这种聪明事：那会让被丢掉的东西取决于预算
   * 还剩多少字节，而谁都不知道自己在列表的哪一段。
   *
   * 真实账号到不了这里（64 KiB 约合四百多条命令行），它存在是为了那种不是的账号：
   * 宁可少几条命令，不可丢连接。
   */
  private fitGroupCommandsToBudget(
    entries: readonly MobileGroupCommandsEntry[],
  ): readonly MobileGroupCommandsEntry[] {
    const budget = MOBILE_FRAME_LIMITS.maxGroupCommandsBytes - GROUP_COMMANDS_ENVELOPE_ALLOWANCE_BYTES
    const kept: { groupId: string; commands: MobileGroupCommand[] }[] = []
    for (const entry of entries) {
      const target = { groupId: entry.groupId, commands: [] as MobileGroupCommand[] }
      for (const command of entry.commands) {
        target.commands.push(command)
        if (Buffer.byteLength(JSON.stringify([...kept, target]), "utf8") <= budget) continue
        target.commands.pop()
        break
      }
      if (target.commands.length > 0) kept.push(target)
      else break
    }
    return kept
  }
```

需要在导入里加上 `MobileGroupCommand` 类型（`kept` 的元素类型用到）。

- [ ] **Step 5: 跑测试，确认它通过**

Run: `pnpm --filter @synapse/desktop run test -- electron/services/__tests__/mobile-gateway-service.test.ts`
Expected: PASS。若裁剪那一条用例因预算算式不符而失败，**不要改预算常量** —— 按 spec §3.3 检查裁剪是从尾部整条丢、且丢空的整组被去掉。

- [ ] **Step 6: 硬约束与类型检查**

Run: `pnpm --filter @synapse/desktop run typecheck && pnpm --filter @synapse/desktop run check:hard-constraints`
Expected: 都通过。（本次没有新增 `ipcMain` 用法、没有裸写文件、没有跨模块 internal 导入。）

- [ ] **Step 7: 提交**

```bash
git add desktop/electron/services/mobile-gateway/transport.ts \
  desktop/electron/services/mobile-gateway-service.ts \
  desktop/electron/services/live-connection-service.ts \
  desktop/electron/bootstrap/app-ready.ts \
  desktop/electron/services/__tests__/mobile-gateway-service.test.ts
git commit -m "feat: 桌面端把分组命令列表发给手机

骑在既有的 1 Hz 摘要 tick 上，指纹比内容，改了才发 —— 终端事件发射器
已到监听器上限，不再挂新监听器。超预算从尾部整条丢命令，丢空的整组一并
去掉，绝不出现点开是空列表的箭头。"
```

---

### Task 4: 刚连上的手机必须收到 —— `sync` 与 `attach`

**Files:**
- Modify: `desktop/electron/services/mobile-gateway/intent-executor.ts:72`（deps 声明）、`:216-217`（sync）、`:251-252`（attach）
- Modify: `desktop/electron/services/mobile-gateway-service.ts:345-347`（deps 接线）
- Test: `desktop/electron/services/__tests__/mobile-gateway-service.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `MobileGatewayService.resendGroupCommands()`
- Produces: `MobileIntentExecutorDeps.sendGroupCommands: () => void`

- [ ] **Step 1: 写失败的测试**

`desktop/electron/services/__tests__/mobile-gateway-service.test.ts`，接在上一批之后：

```ts
  it("sends the group command list to a phone that has just arrived", async () => {
    /*
     * 指纹只对「已经收到过」的一方有意义。刚连上的手机什么都没收到，所以两个「有人
     * 正看着这台电脑」的时刻都必须无条件重推一遍 —— 少了这一条，第二台连上来的手机
     * 面板上永远没有箭头。
     */
    const harness = createHarness()
    await harness.timers.advance(1_000)
    const afterTick = harness.groupCommands.length

    await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
    expect(harness.groupCommands.length).toBeGreaterThan(afterTick)
    expect(harness.groupCommands.at(-1)?.groups).toEqual([
      { groupId: "g1", commands: [{ id: "c1", name: "Claude" }] },
    ])

    // 连内容都没变，第二台手机连上来也一样要给。
    const afterSync = harness.groupCommands.length
    await harness.gateway.handleIntent("phone-2", intent({ v: 1, intentId: "i-sync-2", kind: "sync" }))
    expect(harness.groupCommands.length).toBeGreaterThan(afterSync)
  })

  it("refreshes the group command list when a phone opens a terminal", async () => {
    // 与 `sync` 同一个理由，与工具栏共享同一个时刻：打开终端是「有人正看着这台电脑」
    // 的另一个确定的瞬间。
    const harness = createHarness()
    await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-sync", kind: "sync" }))
    const afterSync = harness.groupCommands.length

    await attach(harness)

    expect(harness.groupCommands.length).toBeGreaterThan(afterSync)
  })
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `pnpm --filter @synapse/desktop run test -- electron/services/__tests__/mobile-gateway-service.test.ts`
Expected: FAIL —— 两条新用例的 `expect(...).toBeGreaterThan(...)` 不成立（`sync` / `attach` 都不会推这份列表）。

- [ ] **Step 3: 写实现**

`desktop/electron/services/mobile-gateway/intent-executor.ts`，deps 里 `sendToolbar`（`:72` 那个声明）之后加：

```ts
  /**
   * 把电脑上的分组命令列表无条件推给它所有的手机。
   *
   * 与工具栏共享那两个时刻，理由也相同：都是「一台刚到的手机什么都没收到」，而
   * 「这台电脑最近没改过命令」不是对它的回答。
   */
  readonly sendGroupCommands: () => void
```

`sync` 分支里 `this.deps.sendQuickPhrases()`（`:217`）之后加：

```ts
        this.deps.sendGroupCommands()
```

`attach` 分支里 `this.deps.sendQuickPhrases()`（`:252`）之后加：

```ts
        this.deps.sendGroupCommands()
```

`desktop/electron/services/mobile-gateway-service.ts`，构造函数里 `sendQuickPhrases: () => this.resendQuickPhrases(),`（`:347`）之后加：

```ts
      sendGroupCommands: () => this.resendGroupCommands(),
```

- [ ] **Step 4: 跑测试，确认它通过**

Run: `pnpm --filter @synapse/desktop run test -- electron/services/__tests__/mobile-gateway-service.test.ts`
Expected: PASS（含 Task 3 的用例 —— 它们仍然要绿）。

- [ ] **Step 5: 提交**

```bash
git add desktop/electron/services/mobile-gateway/intent-executor.ts \
  desktop/electron/services/mobile-gateway-service.ts \
  desktop/electron/services/__tests__/mobile-gateway-service.test.ts
git commit -m "feat: 刚连上手机的分组命令列表随 sync 与打开终端重推

指纹只对已经收到过的一方有意义：少了这次无条件重推，第二台连上来的手机
面板上永远没有箭头。"
```

---

### Task 5: 服务端转发

**Files:**
- Modify: `server/src/live/live-desktop.gateway.ts:90` 附近（handler 接口）、`:542-549`（**消息类型白名单**）、`:765` 附近（分发）
- Modify: `server/src/mobile-live/mobile-live-relay.service.ts:89`（handler 装配）、`:252-255`（新方法）
- Test: `server/src/mobile-live/mobile-live-relay.service.spec.ts`、`server/src/live/live-desktop.gateway.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `MobileGroupCommandsPayload` / `LIVE_MESSAGE_TYPES.mobileGroupCommands`
- Produces: `LiveMobileRelayHandler.handleGroupCommands(userId: string, payload: MobileGroupCommandsPayload): void`、`MobileLiveRelayService.handleGroupCommands(userId, payload): void`

> **这里有两处要改，不是一处。** `live-desktop.gateway.ts` 的消息处理是一个白名单（`:542-549`）**加**一个分发链（`:750-781`）：类型不在白名单里根本进不了分发，会掉到后面的 pong 分支被无声丢掉 —— 那段代码自己的注释就写着「A type missing from this list is not relayed at all… which is why every phone-side family has to be named here as well as in `handleMobileRelayMessage`」。只改分发链的话，测试与真机都会表现为「什么都没发生」，且没有任何日志。

- [ ] **Step 1: 写失败的测试**

`server/src/mobile-live/mobile-live-relay.service.spec.ts`：在 `describe("MobileLiveRelayService toolbar", ...)`（`:114-161`）那段**之后**新增一段，用同一个文件级 `createHarness()`：

```ts
/**
 * 与工具栏逐条同构：转发、扇出、不落库。分开写是因为它们说的是两件事 ——
 * 工具栏是「手机上能按什么」，这一份是「新建终端时能跑哪条命令」。
 */
describe("MobileLiveRelayService group commands", () => {
  const payload = {
    desktopClientInstanceId: "client-a",
    revision: 3,
    groups: [{ groupId: "g1", commands: [{ id: "c1", name: "Claude" }] }],
  }

  it("fans a group command list out to the whole account in one call", () => {
    // 与工具栏同一条理由：载荷自带是哪台电脑发的，所以一台正看着别的电脑的手机会
    // 丢掉它、什么也不花。扇出是「连到任意一台电脑的手机都拿得到这份列表」的代价
    // 最低的做法 —— 云端不必记录谁的订阅是什么。
    const { service, sendToMobile, sendToMobileClients } = createHarness()

    service.handleGroupCommands("user-1", payload)

    expect(sendToMobileClients).toHaveBeenCalledTimes(1)
    expect(sendToMobile).not.toHaveBeenCalled()
    expect(sendToMobileClients.mock.calls[0]?.[0]).toMatchObject({
      userId: "user-1",
      message: { type: "mobile.groupCommands", payload },
    })
  })

  it("sends the list again on every call rather than deduplicating it", () => {
    // 每一次都是整份快照，手机整包替换，所以两次一样的发送只是多余、不是错。在云端
    // 去重等于让云端去决定哪台手机已经看过什么，那是它不知道的事 —— 电脑端那一层
    // 已经按内容比过一次了。
    const { service, sendToMobileClients } = createHarness()

    service.handleGroupCommands("user-1", payload)
    service.handleGroupCommands("user-1", payload)

    expect(sendToMobileClients).toHaveBeenCalledTimes(2)
  })

  it("stays quiet when no fanout is installed", () => {
    const service = new MobileLiveRelayService({} as never, {} as never)

    expect(() => service.handleGroupCommands("user-1", payload)).not.toThrow()
  })
})
```

`server/src/live/live-desktop.gateway.spec.ts`：在工具栏那条用例（搜 `handleToolbar`，`:794` 起）**之后**加一条，搭法照抄它：

```ts
  it("hands a group command list from a desktop to the relay", () => {
    const socket = new FakeSocket()
    const handleGroupCommands = vi.fn()
    const gateway = createGateway({
      registry: { listOnlineByUser: vi.fn().mockReturnValue([createClient({ clientInstanceId: "client-a" })]) },
    })
    gateway.setMobileRelayHandler({
      handleSummary: vi.fn(),
      handleFrame: vi.fn(),
      handleIntentResult: vi.fn(),
      handleTransferProgress: vi.fn(),
      handleToolbar: vi.fn(),
      handleGroupCommands,
      handleQuickPhrases: vi.fn(),
      handleClipboard: vi.fn(),
      handleGitStatus: vi.fn(),
      handleDesktopPresence: vi.fn(),
    })

    gateway.bindAuthenticatedSocket(socket as never, { userId: "user-1" })
    socket.emit("message", JSON.stringify(helloFor("client-a")))
    socket.emit("message", JSON.stringify({
      type: LIVE_MESSAGE_TYPES.mobileGroupCommands,
      id: "msg-group-commands",
      sentAt: "2026-06-06T10:00:03.000Z",
      payload: {
        desktopClientInstanceId: "client-a",
        revision: 1,
        groups: [{ groupId: "g1", commands: [{ id: "c1", name: "Claude" }] }],
      },
    }))

    expect(handleGroupCommands).toHaveBeenCalledWith("user-1", {
      desktopClientInstanceId: "client-a",
      revision: 1,
      groups: [{ groupId: "g1", commands: [{ id: "c1", name: "Claude" }] }],
    })
  })
```

**注意**：`LiveMobileRelayHandler` 是必填字段的接口，所以这个文件里**每一处** `setMobileRelayHandler({ ... })` 都要补上 `handleGroupCommands: vi.fn(),`，否则 `pnpm --filter @synapse/server run typecheck` 会报缺字段。用 `grep -n "setMobileRelayHandler" server/src/live/live-desktop.gateway.spec.ts` 找全，一处不漏。

- [ ] **Step 2: 跑测试，确认它失败**

Run: `pnpm --filter @synapse/server run test -- src/mobile-live/mobile-live-relay.service.spec.ts`
Expected: FAIL —— `service.handleGroupCommands is not a function`。

- [ ] **Step 3: 写实现**

`server/src/live/live-desktop.gateway.ts`：

类型导入里加 `MobileGroupCommandsPayload`。`LiveMobileRelayHandler` 里 `handleToolbar` 那段之后加：

```ts
  /**
   * 一台电脑上那些配了启动命令的分组。
   *
   * 转发扇出但不落库，与 `handleToolbar` 同一条理由：它只在发出它的那台电脑还在的
   * 时候才有意义 —— 一份属于已经连不上的电脑的命令列表，在手机上只会画出一个点开
   * 没有东西的箭头。
   */
  readonly handleGroupCommands: (userId: string, payload: MobileGroupCommandsPayload) => void
```

`handleMobileRelayMessage` 里 `mobileToolbar` 那个分支（`:763-766`）之后加：

```ts
      if (message.type === LIVE_MESSAGE_TYPES.mobileGroupCommands) {
        relay.handleGroupCommands(userId, message.payload)
        return
      }
```

**还有那处白名单**（`:542-549`）—— 在 `mobileGitStatus` 那一行之后加一个分支，写法照它上面的八行：

```ts
        || message.type === LIVE_MESSAGE_TYPES.mobileGroupCommands
```

改完这两个地方都别再动：白名单决定消息能不能进分发，分发决定它交给谁。

`server/src/mobile-live/mobile-live-relay.service.ts`：handler 装配里 `handleToolbar`（`:93`）之后加：

```ts
      handleGroupCommands: (userId, payload) => this.handleGroupCommands(userId, payload),
```

`handleToolbar`（`:252-255`）之后加：

```ts
  /**
   * 一台电脑上那些配了启动命令的分组，扇出给这个账号的每一台手机。
   *
   * 与 `handleToolbar` 一样转发而不缓存：一台中途连上来的手机会在它的 `sync` 意图到达
   * 时由电脑回答，而不是由这里存着的东西回答。
   */
  handleGroupCommands(userId: string, payload: MobileGroupCommandsPayload): void {
    const message = createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileGroupCommands, payload, envelopeMeta())
    this.fanout?.sendToMobileClients({ userId, message })
  }
```

（`MobileGroupCommandsPayload` 加进该文件的类型导入。）

- [ ] **Step 4: 跑测试，确认它通过**

Run: `pnpm --filter @synapse/server run test -- src/mobile-live/mobile-live-relay.service.spec.ts src/live/live-desktop.gateway.spec.ts`
Expected: PASS。

- [ ] **Step 5: 服务端整体测试与类型检查**

Run: `pnpm --filter @synapse/server run test && pnpm --filter @synapse/server run typecheck`
Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git add server/src/live/live-desktop.gateway.ts server/src/mobile-live/mobile-live-relay.service.ts \
  server/src/mobile-live/mobile-live-relay.service.spec.ts server/src/live/live-desktop.gateway.spec.ts
git commit -m "feat: 云端转发分组命令列表

转发扇出但不落库，与 mobile.toolbar 同一条路由规则。这条消息必须先于
桌面端上线：live-desktop.gateway 对未知类型返回 false，老服务端会静默
丢掉它。"
```

---

### Task 6: 手机端 —— 协议与状态

**Files:**
- Modify: `SynapseMobile/SynapseMobile/Core/Protocol/LiveProtocol.swift`（`:24` 附近消息类型；`MobileToolbarPayload` 那段之后加三个类型）
- Modify: `SynapseMobile/SynapseMobile/Core/Realtime/RealtimeClient.swift:113`（回调）、`:387`（订阅名单）、`:455`（分发）
- Create: `SynapseMobile/SynapseMobile/Features/Terminal/TerminalGroupCommandState.swift`
- Modify: `SynapseMobile/SynapseMobile/App/SynapseAppModel.swift:29`（槽位）、`:479`（登出清空）、`:800`（接线）、`:1312` 之后（读取接口）
- Test: `SynapseMobile/SynapseMobileTests/TerminalGroupCommandTests.swift`

**Interfaces:**
- Consumes: Task 1 的线上形状
- Produces:
  - `LiveMessageType.mobileGroupCommands`
  - `struct MobileGroupCommand { let id: String; let name: String }`（`Identifiable`, `Hashable`）
  - `struct MobileGroupCommandsEntry { let groupId: String; let commands: [MobileGroupCommand] }`
  - `struct MobileGroupCommandsPayload { let desktopClientInstanceId: String; let revision: Int; let groups: [MobileGroupCommandsEntry] }`
  - `TerminalGroupCommandState.adopt(_:)` / `.reset()` / `.hasCommands(for:onSelected:)` / `.commands(for:onSelected:)`
  - `SynapseAppModel.hasGroupCommands(_ groupId: String) -> Bool`、`SynapseAppModel.groupCommands(for groupId: String) -> [MobileGroupCommand]`
  - `RealtimeClient.onGroupCommands: ((MobileGroupCommandsPayload) -> Void)?`

- [ ] **Step 1: 写失败的测试**

`SynapseMobile/SynapseMobileTests/TerminalGroupCommandTests.swift`（新建）：

```swift
import Foundation
import Testing

@testable import SynapseMobile

/// 手机这一半：解出电脑发来的分组命令，以及「这个分组有没有命令」这个问题在
/// 「收到过、里面没有」与「从没收到过」两种情形下的答案。
///
/// 两者在屏幕上长得一样（都不画箭头），但只有一个是「我知道，它没有」—— 这条边界是
/// `TerminalToolbarState` 立下的同一条规矩：发过消息的电脑说了算，包括说「没有」。
struct TerminalGroupCommandTests {

    private func decode(_ json: String) -> MobileGroupCommandsPayload? {
        try? JSONDecoder().decode(MobileGroupCommandsPayload.self, from: Data(json.utf8))
    }

    @Test func decodesAGroupCommandListInOrder() throws {
        let payload = try #require(decode("""
        {
          "desktopClientInstanceId": "desktop-1",
          "revision": 3,
          "groups": [
            {"groupId": "g1", "commands": [
              {"id": "c1", "name": "Claude"},
              {"id": "c2", "name": "Codex"}
            ]},
            {"groupId": "g2", "commands": [{"id": "c3", "name": "小慧日报"}]}
          ]
        }
        """))

        #expect(payload.desktopClientInstanceId == "desktop-1")
        #expect(payload.revision == 3)
        // 顺序是电脑自己的，正是分组行要画的那个顺序。
        #expect(payload.groups.map(\.groupId) == ["g1", "g2"])
        #expect(payload.groups[0].commands.map(\.name) == ["Claude", "Codex"])
    }

    @Test func answersForTheComputerBeingViewed() {
        var state = TerminalGroupCommandState()
        state.adopt(MobileGroupCommandsPayload(
            desktopClientInstanceId: "desktop-1",
            revision: 1,
            groups: [MobileGroupCommandsEntry(
                groupId: "g1",
                commands: [MobileGroupCommand(id: "c1", name: "Claude")],
            )],
        ))

        #expect(state.hasCommands(for: "g1", onSelected: "desktop-1"))
        #expect(state.commands(for: "g1", onSelected: "desktop-1").map(\.name) == ["Claude"])
        // 这份列表里没有的分组：这台电脑说了它没有。
        #expect(!state.hasCommands(for: "g2", onSelected: "desktop-1"))
        // 另一台电脑：它自己的分组与这一份无关，不能拿这一份去画它的箭头。
        #expect(!state.hasCommands(for: "g1", onSelected: "desktop-2"))
        // 没在看任何电脑（还没有选中的那台）。
        #expect(!state.hasCommands(for: "g1", onSelected: nil))
    }

    @Test func treatsNoMessageAndAnEmptyListTheSameOnScreen() {
        // 从没收到过 —— 那台电脑太旧：没箭头、点了直接建终端。
        let neverHeard = TerminalGroupCommandState()
        #expect(!neverHeard.hasCommands(for: "g1", onSelected: "desktop-1"))

        // 收到过一份空列表 —— 那台电脑一个分组都没配：屏幕上一样。
        var empty = TerminalGroupCommandState()
        empty.adopt(MobileGroupCommandsPayload(
            desktopClientInstanceId: "desktop-1",
            revision: 1,
            groups: [],
        ))
        #expect(!empty.hasCommands(for: "g1", onSelected: "desktop-1"))
    }

    @Test func clearsTheListOnSignOut() {
        var state = TerminalGroupCommandState()
        state.adopt(MobileGroupCommandsPayload(
            desktopClientInstanceId: "desktop-1",
            revision: 1,
            groups: [MobileGroupCommandsEntry(
                groupId: "g1",
                commands: [MobileGroupCommand(id: "c1", name: "Claude")],
            )],
        ))

        state.reset()

        // 那是上一个账号的电脑上的东西。
        #expect(!state.hasCommands(for: "g1", onSelected: "desktop-1"))
    }

    @Test func keepsTheLastComputerThatSent() {
        // 谁发的就收谁的：`sync` 只发给选中的那台，所以一条别的电脑的消息是迟到的旧
        // 答案，不是错误。
        var state = TerminalGroupCommandState()
        state.adopt(MobileGroupCommandsPayload(
            desktopClientInstanceId: "desktop-1",
            revision: 1,
            groups: [MobileGroupCommandsEntry(
                groupId: "g1",
                commands: [MobileGroupCommand(id: "c1", name: "Claude")],
            )],
        ))
        state.adopt(MobileGroupCommandsPayload(
            desktopClientInstanceId: "desktop-2",
            revision: 1,
            groups: [],
        ))

        #expect(!state.hasCommands(for: "g1", onSelected: "desktop-1"))
        #expect(!state.hasCommands(for: "g1", onSelected: "desktop-2"))
    }
}
```

- [ ] **Step 2: 跑测试，确认它失败**

Run:
```bash
cd SynapseMobile
xcodebuild test -project SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileTests/TerminalGroupCommandTests -parallel-testing-enabled NO
```
Expected: 编译失败 —— `cannot find 'MobileGroupCommandsPayload' in scope`、`cannot find 'TerminalGroupCommandState' in scope`。

- [ ] **Step 3: 加协议类型**

`SynapseMobile/SynapseMobile/Core/Protocol/LiveProtocol.swift`：

`LiveMessageType` 里 `mobileToolbar` 那条声明（`:24` 起，连着它的注释）之后加：

```swift
    /// 一台电脑上那些配了启动命令的分组，手机用它决定分组行上画不画箭头。
    ///
    /// 与工具栏同族、同样独立：摘要的字节预算装不下它（理由见 `mobileToolbar` 那条），
    /// 而且「这台电脑没给任何分组配命令」与「这台电脑太旧、还不认识这条消息」是两回事。
    /// 手机对两者的表现相同（都不画箭头），但它们不能混成一份状态。
    static let mobileGroupCommands = "mobile.groupCommands"
```

`MobileToolbarPayload`（`:678` 起）那段之后加：

```swift
/// 一个分组里保存的一条启动命令。
///
/// 只有 id 与 name：正文不在这条消息里 —— 桌面自己那个「以命令启动」下拉也只写名字，
/// 而正文在电脑上是加密存储的、还可以挂自己的环境变量。
struct MobileGroupCommand: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
}

/// 一个分组保存的启动命令，按电脑上的顺序。
struct MobileGroupCommandsEntry: Decodable, Hashable {
    let groupId: String
    let commands: [MobileGroupCommand]
}

/// 一台电脑上配了启动命令的那些分组。
///
/// 整份快照，与工具栏一样：手机用它替换自己那份，所以丢一条只等于等下一个 —— 而电脑
/// 每秒都在比一次内容，变化约一秒内就会再来一次。
///
/// 与 `MobileToolbarPayload` 不同，这里**没有**逐条容错的解码：一条记录只有两个字符串，
/// 没有「更新的电脑送来的、这个版本还不认识的那种命令」。多出来的字段会被合成解码器
/// 忽略，那正是以后加字段该有的样子。
struct MobileGroupCommandsPayload: Decodable {
    let desktopClientInstanceId: String
    let revision: Int
    let groups: [MobileGroupCommandsEntry]
}
```

- [ ] **Step 4: 加状态类型**

`SynapseMobile/SynapseMobile/Features/Terminal/TerminalGroupCommandState.swift`（新建）：

```swift
import Foundation

/// 哪些分组配了启动命令，以及是哪台电脑说的。
///
/// 三个值，与 `TerminalQuickPhrasesState` 同一套规则：
///
/// - 收到过，且里面提到这个分组 → 有命令：分组行上画箭头，点进去是命令列表；
/// - 收到过，但里面没有这个分组 → 没命令：点了直接建终端，与今天完全一样；
/// - 从没收到过（那台电脑太旧）→ 同上，没箭头、直接建终端。
///
/// 后两者在屏幕上是同一个样子，所以这里不必把它们分开 —— 但整份列表必须按电脑归档：
/// 手机会同时连着几台电脑，把另一台的分组当成这一台的，就会画出一个点开是空列表的箭头。
///
/// 与 `TerminalToolbarState` 一样是**单槽**：消息自带发送者，而问题永远是「我正在看的
/// 那台电脑」。
struct TerminalGroupCommandState: Equatable {
    private var entries: [MobileGroupCommandsEntry] = []
    private var ownerDesktopClientInstanceId: String?

    /// 谁发的就收谁的，而不是「不是当前这台就丢掉」：`sync` 只发给选中的那台电脑，所以
    /// 一条别的电脑的消息是迟到的旧答案，不是错误。留着它花一个槽，省一次往返。
    mutating func adopt(_ payload: MobileGroupCommandsPayload) {
        entries = payload.groups
        ownerDesktopClientInstanceId = payload.desktopClientInstanceId
    }

    /// 登出时清空：那是上一个账号的电脑上的东西。
    mutating func reset() {
        entries = []
        ownerDesktopClientInstanceId = nil
    }

    /// 这个分组有没有配命令，对正在看的那台电脑而言。
    func hasCommands(for groupId: String, onSelected desktopClientInstanceId: String?) -> Bool {
        !commands(for: groupId, onSelected: desktopClientInstanceId).isEmpty
    }

    /// 这个分组配的命令，按电脑上的顺序。
    func commands(for groupId: String, onSelected desktopClientInstanceId: String?) -> [MobileGroupCommand] {
        guard let desktopClientInstanceId,
              ownerDesktopClientInstanceId == desktopClientInstanceId
        else { return [] }
        return entries.first { $0.groupId == groupId }?.commands ?? []
    }
}
```

- [ ] **Step 5: 接进实时客户端**

`SynapseMobile/SynapseMobile/Core/Realtime/RealtimeClient.swift`：

`onToolbar`（`:113`）之后加：

```swift
    var onGroupCommands: ((MobileGroupCommandsPayload) -> Void)?
```

`knownMessageTypes`（`:387` 的 `LiveMessageType.mobileToolbar`）之后加：

```swift
        LiveMessageType.mobileGroupCommands,
```

分发 switch 里 `case LiveMessageType.mobileToolbar:`（`:455-458`）之后加：

```swift
        case LiveMessageType.mobileGroupCommands:
            if let payload = payload(MobileGroupCommandsPayload.self, from: data) {
                onGroupCommands?(payload)
            }
```

- [ ] **Step 6: 接进 App 模型**

`SynapseMobile/SynapseMobile/App/SynapseAppModel.swift`：

槽位，`private var toolbar = TerminalToolbarState()`（`:29`）之后：

```swift
    /// 分组里配了哪些启动命令，和是哪台电脑说的。见 `TerminalGroupCommandState`。
    private var groupCommands = TerminalGroupCommandState()
```

登出清空，`toolbar.reset()`（`:479`）之后：

```swift
        groupCommands.reset()
```

接线，`realtime.onToolbar`（`:800-802`）之后：

```swift
        realtime.onGroupCommands = { [weak self] payload in
            self?.groupCommands.adopt(payload)
        }
```

读取接口，`activeToolbarButtons`（`:1312-1322`）那段之后：

```swift
    // MARK: - 分组快捷命令

    /// 这个分组配了启动命令没有 —— 有就在分组行上画箭头，点进去先选命令。
    ///
    /// 电脑没说过、或者说得太旧（从没发过这条消息）都是 `false`：那时分组行上不画
    /// 箭头，点一下直接建终端，与这条消息存在之前完全一样。
    func hasGroupCommands(_ groupId: String) -> Bool {
        groupCommands.hasCommands(for: groupId, onSelected: selectedDesktopClientInstanceId)
    }

    /// 一个分组配的命令，按电脑上的顺序。
    func groupCommands(for groupId: String) -> [MobileGroupCommand] {
        groupCommands.commands(for: groupId, onSelected: selectedDesktopClientInstanceId)
    }
```

- [ ] **Step 7: 跑测试，确认它通过**

Run:
```bash
cd SynapseMobile
xcodebuild test -project SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileTests/TerminalGroupCommandTests -parallel-testing-enabled NO
```
Expected: PASS（5 个用例）。

- [ ] **Step 8: 提交**

```bash
git add SynapseMobile/SynapseMobile/Core/Protocol/LiveProtocol.swift \
  SynapseMobile/SynapseMobile/Core/Realtime/RealtimeClient.swift \
  SynapseMobile/SynapseMobile/Features/Terminal/TerminalGroupCommandState.swift \
  SynapseMobile/SynapseMobile/App/SynapseAppModel.swift \
  SynapseMobile/SynapseMobileTests/TerminalGroupCommandTests.swift
git commit -m "feat: 手机端接收分组快捷命令列表

单槽、按电脑归档、登出清空，与终端工具栏同一套规则。「收到过、里面没有」
与「从没收到过」在屏幕上一样（都不画箭头），但用一份状态各自表达清楚。"
```

---

### Task 7: 面板 —— 箭头、命令列表、启动

**Files:**
- Modify: `SynapseMobile/SynapseMobile/Features/Sessions/NewSessionSheet.swift:26-31`（路由枚举）、`:101-107`（导航目标）、`:334-368`（分组行）、`:76-127`（根视图接待办）
- Modify: `SynapseMobile/SynapseMobile/Features/Sessions/SessionListView.swift:88-104`（新增回调）
- Test: `SynapseMobile/SynapseMobileUITests/AgentConversationUITests.swift`

**Interfaces:**
- Consumes: Task 6 的 `model.hasGroupCommands(_:)` / `model.groupCommands(for:)`
- Produces: `NewSessionSheet.onCommandLaunched: (String, String) -> Void`

- [ ] **Step 1: 写失败的 UI 测试**

`SynapseMobile/SynapseMobileUITests/AgentConversationUITests.swift`，在那个文件的测试区里加一条（并在 `:120-122` 那条用例的文档注释上补一句：点分组即建现在只对「没配命令的分组」成立）：

```swift
    /// 给分组配了快捷命令的电脑上，终端分组那一段会长出第二层：行右一个箭头，点进去是
    /// 命令列表，列表底部永远有一条「直接新建终端」。
    ///
    /// 一条命令都没配的账号跑不了这个用例 —— 有没有配是用户自己的数据，测试造不出来，
    /// 所以这里以跳过说明，而不是把电脑上的东西改掉。
    func testRunsASavedCommandFromThePanel() throws {
        let app = launch()

        app.buttons["new-session"].tap()
        XCTAssertTrue(segments(in: app)["项目"].waitForExistence(timeout: 10), "the panel never appeared")
        segments(in: app)["终端分组"].tap()

        let groups = app.buttons.matching(identifier: "terminal-group")
        XCTAssertGreaterThan(groups.count, 0, "the terminal segment lost its group list")
        groups.firstMatch.tap()

        // 第一个分组没配命令时它会直接建终端 —— 那正是「没命令的分组一点即建」，本用例
        // 要验的是另一条路，所以跳过并说清缺什么。
        let plain = app.buttons["terminal-group-command-none"]
        guard plain.waitForExistence(timeout: 10) else {
            throw XCTSkip("这个账号的第一个分组没有配快捷命令；在电脑上给任意分组加一条命令后重跑")
        }
        capture(app, name: "06-group-command-list")

        // 命令列表：至少一条命令，加底部那条「直接新建终端」。
        let commands = app.buttons.matching(identifier: "terminal-group-command")
        XCTAssertGreaterThan(commands.count, 0, "进了命令列表却没有命令")
        XCTAssertTrue(plain.isHittable, "「直接新建终端」不在列表底部")

        // 点一条命令：面板关掉，落到一个终端上 —— 与「开始对话」落的是同一屏。
        let name = commands.firstMatch.staticTexts.firstMatch.label
        XCTAssertFalse(name.isEmpty, "命令没有名字")
        commands.firstMatch.tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["terminal.text"].waitForExistence(timeout: 30),
            "点了命令没有落到终端上（命令：\(name)）"
        )
    }
```

- [ ] **Step 2: 跑测试，确认它失败（或跳过）**

Run:
```bash
cd SynapseMobile
xcodebuild test -project SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileUITests/AgentConversationUITests/testRunsASavedCommandFromThePanel \
  -parallel-testing-enabled NO
```
Expected: 没有 `SYNAPSE_TEST_EMAIL` / `SYNAPSE_TEST_PASSWORD` 时 **SKIP**（与同文件其它用例一样）；有凭据时 FAIL —— 找不到 `terminal-group-command-none`。这一条需要一台真电脑端（`server/test/mock-desktop.mjs` 的头部写明它不实现 `create` / `createAgentConversation` / `launchCommand`）。

- [ ] **Step 3: 改面板**

`SynapseMobile/SynapseMobile/Features/Sessions/NewSessionSheet.swift`：

a. `AgentRowRoute`（`:26-31`）改成：

```swift
/// 面板里那些「点了会打开另一屏」的行。
///
/// 前三条在「项目」段里，最后一条在「终端分组」段里：配了启动命令的分组点进去先选命令，
/// 而不是当场建终端。
private enum AgentRowRoute: Hashable {
    case project
    case provider
    case model
    case groupCommands(groupId: String)
}
```

b. 加待办状态（与现有 `@State` 放一起，`:48-58` 那批的末尾）：

```swift
    /// 点了之后要做完的事，由根视图执行 —— 见 `finish`。
    @State private var pending: Pending?
    private enum Pending: Equatable {
        case created(groupId: String)
        case command(groupId: String, commandId: String)
    }
```

c. 根视图（`:76-127`）里 `segmentList` 之后加 `.onChange`（挂在 `VStack` 上，与 `.navigationTitle` 等同层）：

```swift
            // 收尾统一在根视图做，而不是在点了的那一行里做。命令列表是下钻进来的一屏，
            // 在下钻的子页里调 `dismiss()` 有可能只把那一屏弹掉、面板还开着 —— 那样
            // 点了命令就什么都不会发生，而且屏幕上没有任何东西说明为什么。
            //
            // 两条路（建普通终端、跑一条命令）在这里合流，触感与关闭顺序也就只有一处。
            .onChange(of: pending) { _, finish in
                guard let finish else { return }
                pending = nil
                Haptics.commit()
                dismiss()
                switch finish {
                case .created(let groupId):
                    onCreated(groupId)
                case .command(let groupId, let commandId):
                    onCommandLaunched(groupId, commandId)
                }
            }
```

d. `onCreated` 声明（`:44`）之后加：

```swift
    /// 电脑在这个分组里跑了一条保存的命令，并开了终端。面板这时已经不在了。
    let onCommandLaunched: (String, String) -> Void
```

e. `navigationDestination`（`:101-107`）的 switch 里加：

```swift
                case .groupCommands(let groupId): groupCommandList(groupId: groupId)
```

f. `terminalRows`（`:334-368`）改成：

```swift
    /// 有命令的分组点进去先选命令，没有的仍然是一点即建。
    ///
    /// 箭头只在真的还有一层的时候出现（与 `SessionListView` 里那条「the chevron and the
    /// tap target appear exactly when they mean」同一条口径），所以没配命令的分组与今天
    /// 逐像素一致：点一下建终端，没有第二屏。
    @ViewBuilder
    private var terminalRows: some View {
        Section {
            ForEach(matchingGroups) { group in
                Button {
                    if model.hasGroupCommands(group.id) {
                        path.append(.groupCommands(groupId: group.id))
                    } else {
                        pending = .created(groupId: group.id)
                    }
                } label: {
                    HStack {
                        Text(group.name)
                            .font(.subheadline)
                        if model.hasGroupCommands(group.id) {
                            Spacer(minLength: 8)
                            Image(systemName: "chevron.forward")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
                // 一段里的每一行都是分组。测试靠它只数这一段的行——弹层背后那条会话
                // 列表和这里同在一棵树里，数 cell 会把那边的行一起数进来。
                .accessibilityIdentifier("terminal-group")
            }
        }
        // 下面两段不变，原样保留。
```

（`terminalRows` 里 `ContentUnavailableView` 那两段与 `accessibilityIdentifier` 的原注释都原样留着。）

g. 在 `allGroups`（`:370`）附近加命令列表这一屏：

```swift
    /// 一个分组里保存的启动命令，外加一条「不带命令直接建终端」。
    ///
    /// 这一屏只在下钻时出现。标题用分组名而不是「命令」：它要回答的是「建在哪个分组里」，
    /// 标题丢了这条信息，就会有人建错地方。
    private func groupCommandList(groupId: String) -> some View {
        List {
            Section {
                ForEach(model.groupCommands(for: groupId)) { command in
                    Button {
                        pending = .command(groupId: groupId, commandId: command.id)
                    } label: {
                        Text(command.name)
                            .font(.subheadline)
                    }
                    .accessibilityIdentifier("terminal-group-command")
                }
            }
            // 单独一段，而且永远在最后：它不是一条命令，是「哪条都别跑」。混在命令中间会
            // 被读成其中一条。
            Section {
                Button {
                    pending = .created(groupId: groupId)
                } label: {
                    Text("直接新建终端")
                        .font(.subheadline)
                }
                .accessibilityIdentifier("terminal-group-command-none")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(allGroups.first { $0.id == groupId }?.name ?? "命令")
        .navigationBarTitleDisplayMode(.inline)
    }
```

- [ ] **Step 4: 改调用点**

`SynapseMobile/SynapseMobile/Features/Sessions/SessionListView.swift:88-104`：

```swift
            NewSessionSheet(
                onCreated: { groupId in
                    Task {
                        if let created = await model.createSession(groupId: groupId) {
                            openNewlyCreated(created)
                        }
                    }
                },
                onCommandLaunched: { groupId, commandId in
                    // 与普通终端落的是同一屏：在协议上它就是同一个东西 —— 一个终端，
                    // 附带一条启动命令。失败落 banner（见 `performReturningSession`），
                    // 与建普通终端今天的行为一致。
                    Task {
                        if let created = await model.launchCommand(groupId: groupId, commandId: commandId) {
                            openNewlyCreated(created)
                        }
                    }
                },
                onConversationStarted: { sessionId in
                    ...原样保留...
                }
            )
```

- [ ] **Step 5: 编译并跑该文件的 UI 用例**

Run:
```bash
cd SynapseMobile
xcodebuild build -project SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
xcodebuild test -project SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileUITests/AgentConversationUITests -parallel-testing-enabled NO
```
Expected: 编译通过；有凭据时 `testRunsASavedCommandFromThePanel` PASS，`testLeavesTheTerminalSegmentAlone` 仍然 PASS（分组行、搜索框、没有确认按钮这三件事都没动）。没有凭据时全部 SKIP。

**如果 `testRunsASavedCommandFromThePanel` 报面板没关掉**：那说明在下钻的子页里 `dismiss()` 只弹掉了一屏。此时把命令列表那两个按钮改成先 `path.removeAll()` 再设 `pending`（顺序反过来：`path.removeAll()` 回到根，`pending` 由根上的 `.onChange` 收尾），两条路径的落点仍然只有一处。

- [ ] **Step 6: 提交**

```bash
git add SynapseMobile/SynapseMobile/Features/Sessions/NewSessionSheet.swift \
  SynapseMobile/SynapseMobile/Features/Sessions/SessionListView.swift \
  SynapseMobile/SynapseMobileUITests/AgentConversationUITests.swift
git commit -m "feat: 手机新建终端能选电脑上配好的快捷命令

配了命令的分组右侧出现箭头，点进去选一条命令启动，列表底部永远留着
「直接新建终端」；没配命令的分组保持一点即建，与今天逐像素一致。

面板的收尾统一由根视图做：命令列表是下钻进来的一屏，在下钻的子页里调
dismiss 有可能只弹掉那一屏、面板还开着。"
```

---

### Task 8: 发布说明与规则核对

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md:3-5`
- Read & verify: `docs/agents/capability-registry.md`、`docs/agents/module-boundaries.md`

**Interfaces:**
- Consumes: 全部前序 Task
- Produces: 无代码接口

- [ ] **Step 1: 补充待发布说明**

`RELEASE_NOTES_PENDING.md` 的 `## 新增功能` 下加一条（面向用户，不写代码路径）：

```markdown
- 手机上新建终端时，可以挑电脑上给这个终端分组配好的快捷命令来启动：分组右侧有箭头表示它配了命令，点进去选一条即可；分组没配命令就照旧点一下直接建终端。命令的增删改仍然只在电脑上。
```

- [ ] **Step 2: 核对能力注册表与模块边界**

Run: `grep -n "terminal" docs/agents/capability-registry.md | head -20`，并读 `docs/agents/module-boundaries.md` 里终端那一段。

对照结论写进提交正文：本次**不新增** capability、System App、Dock、Workflow Node、Automation Action、Deep Link（新能力走 mobile gateway，不是 `app.*` 注册表面），但新增了一个终端能力对外的读取方法 `listMobileGroupCommands` —— 若注册表为终端能力列了「对手机暴露什么」，需要补一行；若没有这样一栏，则说明「无需改动」并写清依据。

- [ ] **Step 3: 跑一遍两个包的完整检查**

Run:
```bash
pnpm --filter @synapse/shared run test
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/server run test
```
Expected: 全部通过。特别确认 `shared/src/mobile-live.test.ts` 里那条摘要字节预算的边界测试原样通过 —— 它是「本次没动摘要」的证据。

- [ ] **Step 4: 提交**

```bash
git add RELEASE_NOTES_PENDING.md docs/agents/capability-registry.md
git commit -m "docs: 补手机端分组快捷命令的待发布说明与能力核对

面向用户说明这次能得到什么；能力注册表按核对结果更新（不新增
capability，只多了一个终端能力对手机暴露的读取方法）。"
```

---

## 收尾（全部 Task 完成后）

- 真机手工验收按 spec §8.3 走：服务端 → 桌面端 → 手机端三个版本组合各一遍（新电脑 + 老手机、新电脑 + 老服务端、新手机 + 老电脑），以及「电脑上改命令，手机面板开着看它有没有跟上」（预期约一秒内）。
- 本次不涉及 Electron 打包边界与发布流程变化，不需要 `check:packaged-asar`。
