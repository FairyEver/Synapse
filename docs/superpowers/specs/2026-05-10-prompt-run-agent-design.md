# Prompt "Run" — 从提示词卡片一键发给 Agent 执行

**Date:** 2026-05-10
**Status:** Draft
**Scope:** Renderer + existing Agent IPC

## 1. 概述

在 Prompt 类型的内容卡片上新增"运行"操作，用户可以直接选择项目和 Agent 类型，将提示词正文一键发送给 Agent 执行。本质上是将"复制提示词 → 切到 Agent 面板 → 选项目 → 粘贴发送"这一手动流程自动化。

## 2. 决策摘要

| 项目         | 决定                                         |
| ------------ | -------------------------------------------- |
| 适用类型     | 仅 Prompt                                    |
| 入口位置     | `ContentListCard` 右上角操作区               |
| 弹窗配置     | 项目 + Agent 类型（精简版）                  |
| 会话策略     | 每次新建                                     |
| 提交方式     | "后台发送" + "发送并跳转" 两个按钮          |
| 执行路径     | 交互式（`createSession` + `send`），非定时任务路径 |

## 3. 入口设计

### 3.1 卡片按钮

在 `ContentActionSplitButton` 中，当 `item.type === "prompt"` 时，在现有"复制"按钮**左侧**新增一个"▶ 运行"按钮。

**可见性规则：**

- 仅 Prompt 类型显示
- `config.global.projects` 为空时 → 按钮 disabled，tooltip："请先在设置中添加项目"
- `builtin` 来源的 Prompt 也可以运行（运行不修改内容）

### 3.2 不在详情弹窗添加入口

运行操作仅在卡片列表层级提供，详情弹窗 (`ContentDetailMenubar`) 暂不添加。

## 4. 运行弹窗 (PromptRunDialog)

### 4.1 结构

从上到下：

1. **头部**：提示词图标 + 标题 + 简介（只读）
2. **项目选择**：`Select` 下拉，数据源 `config.global.projects`
3. **Agent 类型选择**：`ToggleGroup`，选项来自 `agentDefinitions`（当前 Claude Code / Codex）
4. **底部操作栏**：两个提交按钮

### 4.2 字段行为

**项目 Select：**

- 默认选中第一个项目
- 选中项目后，如果项目配置了 `defaultAgentId`，自动切换 Agent 类型

**Agent ToggleGroup：**

- 展示所有已注册的 Agent 定义（当前 Claude Code / Codex）
- 选中的 Agent 如果 CLI 未安装（通过 `AgentRuntimeStatus` 检查），展示未就绪提示并禁止提交

**执行路径：**

- 使用交互式路径：`bridge.agent.createSession` + `bridge.agent.send`
- 与 Agent 面板手动发消息完全等价，不走定时任务的 `sendScheduled`
- 不涉及执行模式选择

### 4.3 提交按钮

| 按钮         | variant   | 行为                                                       |
| ------------ | --------- | ---------------------------------------------------------- |
| 后台发送     | `outline` | 关闭弹窗 → Toast "已发送到 Agent" → 用户留在当前页面      |
| 发送并跳转   | `default` | 关闭弹窗 → 导航到 Agent 模块 → 选中新建的会话             |

两个按钮在提交中均显示 loading 状态，互斥禁用。

## 5. 执行流程

```
用户点击"运行"
  → 打开 PromptRunDialog
  → 用户选项目 + Agent 类型
  → 用户点击提交按钮
  → readContent("prompt", item.id)   // 读取提示词正文
  → bridge.agent.createSession({      // 新建会话
      projectId,
      sessionKey: DEFAULT_LOCAL_SESSION_KEY,
      name: `${item.title} ${timestamp}`,
      agentType,
    })
  → bridge.agent.send({               // 发送提示词
      projectId,
      sessionKey,
      content: promptContent,
      clientSubmittedAt: now,
    })
  → 后台发送: Toast + 关闭弹窗
     发送并跳转: 导航到 Agent 模块，传入 projectId + conversationId
```

## 6. 错误处理

| 阶段           | 处理                                                  |
| -------------- | ----------------------------------------------------- |
| 读取提示词失败 | Toast 错误 "读取提示词失败"，不关闭弹窗               |
| 创建会话失败   | Toast 错误，保持弹窗打开                               |
| 发送消息失败   | Toast 错误 "发送失败"，会话已创建但消息未送达         |
| Agent 未就绪   | 提交按钮 disabled，提示所选 Agent 未安装               |

## 7. 涉及文件

### 7.1 新增

- `desktop/src/modules/prompts/components/prompt-run-dialog.tsx` — 运行弹窗组件
- `desktop/src/modules/prompts/hooks/use-prompt-run.ts` — 运行逻辑 hook（读内容 → 建会话 → 发消息 → 导航）

### 7.2 修改

- `desktop/src/modules/content/components/content-action-split-button.tsx` — Prompt 类型时渲染"运行"按钮
- `desktop/src/config/content-types/types.ts` — `ContentTypeCapabilities` 新增 `canRunAsAgent: boolean`
- `desktop/src/config/content-types/prompt.ts` — `canRunAsAgent: true`
- `desktop/src/config/content-types/rule.ts` — `canRunAsAgent: false`
- `desktop/src/config/content-types/skill.ts` — `canRunAsAgent: false`
- `desktop/src/app-shell/navigation.ts` — 新增 `requestNavigateToAgentSession(projectId, conversationId)` 方法

### 7.3 不修改

- Agent 模块的 IPC / bridge / service 层 — 全部复用现有 `createSession` + `send` 接口
- 定时任务模块 — 不受影响
- 提示词的 create/edit/detail 流程 — 不受影响

## 8. 复用与边界

- **复用 `readContent`** 拿到提示词正文（已有 IPC）
- **复用 `bridge.agent.createSession` + `bridge.agent.send`**（已有 IPC）
- **复用 `agentDefinitions`** 获取 Agent 列表和 unattended 模式（renderer-registry）
- **复用 `useAgentRuntimeStatus`** 检查 Agent 可用性
- **不引入新的 IPC channel** — 全部走现有 Agent bridge
- **不改变 Agent 模块的会话管理逻辑** — 只是外部触发创建 + 发送

## 9. 不在本次范围内

- 详情弹窗 (`ContentDetailMenubar`) 中的运行入口
- Rule / Skill 类型的运行支持
- 运行历史记录（由 Agent 会话自然承载）
- 执行模式、超时、会话策略等高级配置
- 提示词变量替换（如有 `{{variable}}` 占位符，发送原文）
