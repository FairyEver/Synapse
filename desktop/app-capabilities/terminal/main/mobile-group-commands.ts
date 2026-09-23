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
