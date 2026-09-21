import { describe, expect, it } from "vitest"

import { searchSynapseTools } from "../../electron/services/agent-runtime/synapse-tool-router"
import { EXEMPT_SEGMENTS, LEXICON } from "../../electron/services/agent-runtime/synapse-tool-router-lexicon"
import { buildAllMcpTools } from "../../synapse-capabilities/shared/registry"

/**
 * 真实用户说法 → 期望工具。
 *
 * 语料集中在已知的相似工具互相挤占区：`drive`(64) 与 `app`(79) 这两个 domain
 * 各自塞了远超其他 domain 的工具数，`item_*` / `link_*` / `direct_link_*` / `site_*`
 * 这类同前缀家族最容易被 Fuse 检索串到一起；`app` 里的 terminal 49 个工具同理。
 * 其余 domain 各留 1-3 条，只为证明没有被完全挤出，不做深度覆盖。
 *
 * 每条都要求「有唯一可辩护的正确答案」，两可的说法不收，否则这条测试就只是把
 * 作者的偏好固化成断言。中英文混排，因为真实调用方两种都说。
 *
 * 断言的是 top-5 命中：`search` 的 search 模式单次最多返回 5 个工具的完整 schema，
 * 所以第 6 名和没返回等价。
 */
export const INTENT_CORPUS: readonly { readonly intent: string; readonly expect: string }[] = [
  // ---- drive (16)：同前缀家族互相挤占的重灾区 ----
  { intent: "云盘里有哪些文件", expect: "app_drive_item_list" },
  { intent: "看下这个文件夹的目录树", expect: "app_drive_item_tree_list" },
  { intent: "云盘用量还剩多少", expect: "app_drive_usage_get" },
  { intent: "把这个本地文件夹同步到云盘", expect: "app_drive_sync_binding_create" },
  { intent: "暂停云盘同步", expect: "app_drive_sync_binding_pause" },
  { intent: "改一下云盘同步的排除规则", expect: "app_drive_sync_binding_exclude_rules_update" },
  { intent: "同步冲突了怎么处理", expect: "app_drive_sync_conflict_resolve" },
  { intent: "回收站里有什么", expect: "app_drive_trash_list" },
  { intent: "把回收站清空", expect: "app_drive_trash_delete" },
  { intent: "把一个文件夹发布成网页", expect: "app_drive_site_create" },
  { intent: "把发布的网站重新发布一次", expect: "app_drive_site_republish" },
  { intent: "这个文件的历史版本有哪些", expect: "app_drive_file_version_list" },
  // 与下一条是一对易混：版本回滚 vs 回收站还原
  { intent: "回滚到上一个版本", expect: "app_drive_file_version_restore" },
  { intent: "从回收站还原这个文件", expect: "app_drive_item_restore" },
  { intent: "分享链接的评论线程有哪些", expect: "app_drive_link_annotation_thread_list" },
  { intent: "把我分享出去的链接列出来", expect: "app_drive_share_list" },

  // ---- app (18)：terminal 49 个工具分 session/workspace/group/group_command 四组 ----
  { intent: "终端现在开了哪些会话", expect: "app_terminal_session_list" },
  { intent: "新建一个终端会话", expect: "app_terminal_session_create" },
  { intent: "看下这个终端会话的最新输出", expect: "app_terminal_session_output_observe" },
  { intent: "往终端里输入 ls 并回车", expect: "app_terminal_session_input_command" },
  { intent: "停掉这个终端会话", expect: "app_terminal_session_stop" },
  { intent: "终端标签有哪些", expect: "app_terminal_workspace_list" },
  { intent: "终端分个屏", expect: "app_terminal_workspace_pane_create" },
  { intent: "给这个终端标签改个名", expect: "app_terminal_workspace_rename" },
  { intent: "终端分组列表", expect: "app_terminal_group_list" },
  { intent: "给这个分组加个快捷命令", expect: "app_terminal_group_command_create" },
  { intent: "跑一下这个分组的快捷命令", expect: "app_terminal_group_command_launch" },
  { intent: "我保存的密钥有哪些", expect: "app_secrets_item_list" },
  { intent: "新增一个密钥", expect: "app_secrets_item_create" },
  { intent: "当前登录的是哪个账号", expect: "app_account_state_get" },
  { intent: "帮我登录一下 Synapse", expect: "app_account_login_start" },
  { intent: "新建一个 Agent 对话", expect: "app_agent_conversation_create" },
  { intent: "Agent 对话能用哪些供应商和模型", expect: "app_agent_provider_list" },
  { intent: "让 Agent 把当前这一轮停下", expect: "app_agent_turn_stop" },

  // ---- 其余 domain (13)：只证明没被完全挤出 ----
  { intent: "数据库里有哪些表", expect: "app_database_table_list" },
  { intent: "描述这张表格的字段", expect: "app_database_table_describe" },
  { intent: "查一下这张表的数据", expect: "app_database_row_list" },
  { intent: "工作流列表", expect: "app_workflow_definition_list" },
  { intent: "新建一个工作流", expect: "app_workflow_definition_create" },
  { intent: "有哪些定时任务", expect: "app_automation_item_list" },
  { intent: "把这个定时任务停用", expect: "app_automation_item_disable" },
  { intent: "这个定时任务跑过几次", expect: "app_automation_run_list" },
  { intent: "资源仓库里有哪些规则", expect: "app_resource_repository_rule_list" },
  { intent: "在资源仓库新建一条 Prompt", expect: "app_resource_repository_prompt_create" },
  { intent: "云端的 Skill 仓库有哪些", expect: "app_skill_repository_list" },
  { intent: "把这个本地 Skill 上传到云端仓库", expect: "app_skill_repository_import_local" },
  { intent: "模型价格规则有哪些", expect: "app_model_price_rule_list" },
  { intent: "最近用过哪些模型", expect: "app_model_price_used_model_list" },
  { intent: "设置仓库里有什么", expect: "app_settings_repository_item_list" },
]

/**
 * 英文对照组。英文检索当前是好的，这里把它固定成断言：任何破坏英文检索的改动
 * 都会让这条测试变红。token 集合形态刻意贴近中文查询修好后应当展开成的样子。
 */
export const ENGLISH_CORPUS: readonly { readonly intent: string; readonly expect: string }[] = [
  // 20 组 token 集合（形态 = 中文查询展平后的样子）
  { intent: "drive sync binding pause", expect: "app_drive_sync_binding_pause" },
  { intent: "drive sync binding exclude rules update", expect: "app_drive_sync_binding_exclude_rules_update" },
  { intent: "drive trash delete", expect: "app_drive_trash_delete" },
  { intent: "drive site republish", expect: "app_drive_site_republish" },
  { intent: "drive file version restore", expect: "app_drive_file_version_restore" },
  { intent: "drive item restore", expect: "app_drive_item_restore" },
  { intent: "terminal workspace pane create", expect: "app_terminal_workspace_pane_create" },
  { intent: "terminal group command launch", expect: "app_terminal_group_command_launch" },
  { intent: "terminal session output observe", expect: "app_terminal_session_output_observe" },
  { intent: "terminal session input command", expect: "app_terminal_session_input_command" },
  { intent: "secret item list", expect: "app_secrets_item_list" },
  { intent: "account state get", expect: "app_account_state_get" },
  { intent: "automation item disable", expect: "app_automation_item_disable" },
  { intent: "automation run list", expect: "app_automation_run_list" },
  { intent: "resource repository rule list", expect: "app_resource_repository_rule_list" },
  { intent: "skill repository import local", expect: "app_skill_repository_import_local" },
  { intent: "drive link annotation thread list", expect: "app_drive_link_annotation_thread_list" },
  { intent: "drive item tree list", expect: "app_drive_item_tree_list" },
  { intent: "drive usage get", expect: "app_drive_usage_get" },
  { intent: "database table describe", expect: "app_database_table_describe" },
  // 9 组英文自然语言说法
  { intent: "list terminal sessions", expect: "app_terminal_session_list" },
  { intent: "create a terminal session", expect: "app_terminal_session_create" },
  { intent: "list drive files", expect: "app_drive_item_list" },
  { intent: "drive usage", expect: "app_drive_usage_get" },
  { intent: "list trash", expect: "app_drive_trash_list" },
  { intent: "list secrets", expect: "app_secrets_item_list" },
  { intent: "list workflows", expect: "app_workflow_definition_list" },
  { intent: "list scheduled automation items", expect: "app_automation_item_list" },
  { intent: "list workspace tabs", expect: "app_terminal_workspace_list" },
]

async function topToolNames(intent: string): Promise<readonly string[]> {
  const result = await searchSynapseTools({ query: intent, limit: 5 })
  return result.tools.map((tool) => tool.name)
}

describe("synapse tool router search", () => {
  it("keeps every curated intent within the top-5 results", async () => {
    const misses: string[] = []

    for (const { intent, expect: expected } of INTENT_CORPUS) {
      const names = await topToolNames(intent)
      if (!names.includes(expected)) {
        misses.push(`「${intent}」期望 ${expected}，实际 top-5：${names.join("、") || "(空)"}`)
      }
    }

    // 用拼接字符串断言：数组 diff 会被 vitest 截断成 [ …(N) ]，看不到具体是哪几条。
    expect(misses.join("\n")).toBe("")
  })

  it("keeps the english control group within the top-5 results", async () => {
    const misses: string[] = []

    for (const { intent, expect: expected } of ENGLISH_CORPUS) {
      const names = await topToolNames(intent)
      if (!names.includes(expected)) {
        misses.push(`「${intent}」期望 ${expected}，实际 top-5：${names.join("、") || "(空)"}`)
      }
    }

    // 用拼接字符串断言：数组 diff 会被 vitest 截断成 [ …(N) ]，看不到具体是哪几条。
    expect(misses.join("\n")).toBe("")
  })

  it("covers every tool-name segment that appears in more than one tool", () => {
    const frequency = new Map<string, number>()
    for (const tool of buildAllMcpTools()) {
      for (const segment of tool.name.replace(/^app_/, "").split("_")) {
        frequency.set(segment, (frequency.get(segment) ?? 0) + 1)
      }
    }

    const covered = new Set(LEXICON.map(([, token]) => token))
    const missing = [...frequency]
      .filter(([segment, count]) => count >= 2 && !covered.has(segment) && !(segment in EXEMPT_SEGMENTS))
      .map(([segment, count]) => `${segment}(${count} 个工具)`)
      .sort()

    expect(missing.join("\n")).toBe("")
  })

  it("routes by domain when the caller already narrowed it", async () => {
    const result = await searchSynapseTools({ query: "列表", domain: "automation", limit: 5 })

    expect(result.tools.length).toBeGreaterThan(0)
    expect(result.tools.every((tool) => tool.domain === "automation")).toBe(true)
  })
})
