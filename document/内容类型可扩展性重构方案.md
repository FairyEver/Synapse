# 内容类型可扩展性重构方案

> 目标：把当前硬编码 `rule | skill` 两种内容类型的实现，重构成可通过"注册表"扩展的通用内容框架。未来新增"提示词（prompt）"、"代码片段（snippet）"等类型时，只改配置 + 增少量类型特定代码，不再碰 IPC、下载、动作按钮、模块壳等通用层。
>
> 本方案必须：**保留所有现有功能、保留 rule 和 skill 之间的所有差异、不破坏历史数据格式**。

---

## 0. 背景与本次重构想解决的问题

当前 `rule` 和 `skill` 两种内容类型看似相似，但后端逻辑差异明显：

| 维度 | Rule | Skill |
|---|---|---|
| Payload 字段 | `title/description/category/icon/iconBg/content` | Rule 全部字段 + `files: CreateSkillFilePayload[]` |
| 附件 | 无附件 | 有附件池，写入时生成 `attachments.json` |
| 下载产物 | 单个 `.md` 文件 | `.zip` 压缩包（含 `main.md` + 附件） |
| 复制正文 | 直接读 `main.md` 内容 | 直接读 `main.md` 内容 |
| 安装到编辑器 | 单文件覆写 | 目录覆写（有覆盖确认对话框） |
| 存储目录 | `rulesDir` | `skillsDir` |
| 历史 / Git / category 机制 | 完全相同 | 完全相同 |

未来要新增的 `prompt` 类型特征：

- 纯文本（类似 Rule），无附件
- 只支持 **下载** (`.txt` 或 `.md`) + **复制正文**，**没有"安装到编辑器"能力**
- 和 Rule/Skill 共用：历史、分类、Git、搜索、列表、详情、创建、编辑、删除、冲突检测

## 1. 目前的硬编码痛点（按影响面排序）

以下每一处目前都通过 `contentType === "rule" ? A : B` 或穷举 `getRules/getSkills` 的方式实现，新增第三种类型必须全部改。

### 1.1 类型联合被穷举

- [src/types/content.ts:1](src/types/content.ts#L1) `SynapseContentType = "rule" | "skill"`
- [src/types/content.ts:56-79](src/types/content.ts#L56-L79) 手写 `SynapseRuleMeta / SynapseSkillMeta / SynapseRuleDetail / SynapseSkillDetail`
- [src/types/content.ts:121-144](src/types/content.ts#L121-L144) Create/Update 各 type 一份 Payload，字段高度重复

### 1.2 IPC channel 按类型穷举

- [electron/ipc/channels.ts:3-22](electron/ipc/channels.ts#L3-L22) 成对定义 `getRules/getSkills`、`createRule/createSkill`、`updateRule/updateSkill`、`downloadRule/downloadSkill`、`getRuleContent/getSkillContent`、`getRuleDetail/getSkillDetail`、`getRuleHistory/getSkillHistory`、`getRuleHistoryVersion/getSkillHistoryVersion`，共 14 个通道
- [electron/preload.ts:7-28,86-110](electron/preload.ts#L7-L28) preload 镜像一份
- [electron/ipc/content-handlers.ts:164-353](electron/ipc/content-handlers.ts#L164-L353) handlers 各一份
- [src/app-shell/content.ts:38-245](src/app-shell/content.ts#L38-L245) renderer 桥接 wrapper 各一份
- [src/types/bridge.ts:54-79](src/types/bridge.ts#L54-L79) bridge 类型各一份

### 1.3 服务方法按类型穷举

- [electron/services/content-service.ts:67-175](electron/services/content-service.ts#L67-L175) `getRules/getSkills/getRuleContent/getSkillContent/getRuleDetail/getSkillDetail/getRuleHistory/getSkillHistory/getRuleHistoryVersion/getSkillHistoryVersion` — 10 个公共方法，内部其实都是同一个实现只是 `contentType` 参数不同
- [electron/services/content-submission-service.ts:283-311](electron/services/content-submission-service.ts#L283-L311) `createRule / createSkill / updateRule / updateSkill`
- [electron/services/content-write-service.ts:271-301](electron/services/content-write-service.ts#L271-L301) 同样 4 个方法
- [electron/services/content-download-service.ts:153-198](electron/services/content-download-service.ts#L153-L198) `downloadRule / downloadSkill` — **真正有差异**（扩展名、打包方式）

### 1.4 UI 层 type 分支

- [src/modules/content/components/content-action-split-button.tsx:42-46](src/modules/content/components/content-action-split-button.tsx#L42-L46) `supportsContentType(adapter, item)` 三元
- [src/modules/content/components/content-action-split-button.tsx:70](src/modules/content/components/content-action-split-button.tsx#L70) `contentLabel` 三元
- [src/modules/content/components/content-action-split-button.tsx:107-109,161-163](src/modules/content/components/content-action-split-button.tsx#L107-L109) 下载 / 复制各有三元
- [src/modules/content/components/content-browser-page.tsx:67](src/modules/content/components/content-browser-page.tsx#L67) `getSingularLabel` 三元
- [src/lib/content-categories.ts:24](src/lib/content-categories.ts#L24) `getContentTypeLabel` 三元
- [src/modules/content/components/content-install-dialog.tsx:303-311,453](src/modules/content/components/content-install-dialog.tsx#L303) 安装确认对话框针对 skill 特殊处理
- [src/modules/rules/index.tsx](src/modules/rules/index.tsx)、[src/modules/skills/index.tsx](src/modules/skills/index.tsx) 两个模块入口几乎是镜像代码
- [src/App.tsx:24-37,80-84,196-210](src/App.tsx#L24-L210) App tabs 和 dialog state 完全硬编码两套

### 1.5 配置、分类、编辑器适配器按类型穷举

- [src/types/config.ts:15-16](src/types/config.ts#L15-L16) `rulesDir: string; skillsDir: string`
- [src/constants/defaults.ts:8-17](src/constants/defaults.ts#L8-L17) 常量也是两个字段
- [src/lib/config.ts:111,115,209-210](src/lib/config.ts#L111-L210) 校验和规范化都按字段手写
- [src/config/categories/index.ts:6-13](src/config/categories/index.ts#L6-L13) `categoryRegistry` 字面量两个 key
- [src/types/editor.ts:18-19](src/types/editor.ts#L18-L19) `supportsRule / supportsSkill`
- [electron/services/editor-adapters/*.ts](electron/services/editor-adapters/) 每个 adapter 两个布尔 + `if (contentType === "rule")` 分支
- [electron/services/content-index-service.ts:40,134](electron/services/content-index-service.ts#L40-L134) 直接比较字符串 `"rule" / "skill"`、从目录名反查类型

## 2. 重构总体思路

核心是引入 **"内容类型注册表"（Content Type Registry）**，把"每种内容类型的能力、字段、存储、展示、可执行动作"全部放进一个声明式配置里。通用层（IPC、service 分发、UI 组件）只依赖 `SynapseContentType`（字符串）+ 注册表，不再依赖字面量 `"rule" / "skill"`。

### 改造分 6 层

1. **类型层** — `SynapseContentType` 保持字符串联合，扩展基础类型使其支持带参数的字段扩展（例如 skill 才有的 `files`），Meta/Detail 加一个 `capability` 判别符让类型收窄更稳
2. **注册表层（新增）** — `src/config/content-types/` 每个类型一份定义，`src/config/content-types/index.ts` 汇总
3. **配置层** — `SynapseRepositoryConfig` 把 `rulesDir / skillsDir` 改成 `contentDirs: Record<SynapseContentType, string>`，同时保留向后兼容读取
4. **IPC / Service 层** — 14 个通道合并为 ~9 个通用通道，所有通道的第一个参数改为 `{ contentType, ... }`。现有服务方法改为单一签名，按 `contentType` 分发
5. **UI 层** — `content-action-split-button`、`content-browser-page`、`content-install-dialog`、模块壳改为由注册表驱动。Rule/Skill 模块文件夹保留（放它们各自特有的 create-dialog、detail-dialog），但新增一个 `createContentModule()` 工厂把共享壳抽出来
6. **数据迁移** — 不动磁盘数据格式（`rules/<id>/history/...` 不变），只动进程内/配置内的表达

### 不改的事情

- 磁盘目录结构、`meta.json / main.md / attachments.json / snapshot.json` 格式全部保持
- 历史管理、Git commit 消息、push 逻辑、冲突检测流程不动
- 现有的 `content-history-service / content-index-service / content-write-service / content-submission-service` 内部逻辑不动，只改对外方法签名（`rule/skill` 合并为 `contentType` 参数）
- 目前已经接受 `contentType` 参数的内部函数（例如 `resolveContentRootPath`、`readCurrentDetail`、`writeNextHistory`）保持不变

---

## 3. 注册表（Content Type Registry）— 这是重构的"发动机"

### 3.1 位置与结构

新目录 `src/config/content-types/`：

```
src/config/content-types/
  index.ts          // 入口、registry、查找函数
  rule.ts           // Rule 定义
  skill.ts          // Skill 定义
  types.ts          // 定义 ContentTypeDefinition 等接口
```

### 3.2 `types.ts` 接口

```ts
// src/config/content-types/types.ts
import type { SynapseContentType } from "@/types/content"
import type { SynapseCategoryDefinition } from "@/types/category"

// UI/Service 行为的能力位
export type ContentTypeCapabilities = {
  hasAttachments: boolean              // 是否支持附件（skill=true, rule=false, prompt=false）
  canInstallToEditor: boolean          // 是否显示"安装到 XX"菜单
  canCopyContent: boolean              // 是否显示"复制正文"
  canDownload: boolean                 // 是否显示"下载"
}

// 下载策略
export type ContentDownloadSpec = {
  // 扩展名（带点），如 ".md" / ".zip" / ".txt"
  extension: string
  // Save dialog 的 filter 描述
  dialogFilterName: string
  // 打包器名字；决定走哪个策略实现
  // "text-file" = 直接写 content 到文件
  // "zip-archive" = 写成目录再打包 zip（当前 skill）
  exporter: "text-file" | "zip-archive"
}

// 安装策略（confirmMessage 让每种策略可带自定义二次确认文案，避免文案被代码硬编码）
export type ContentInstallSpec =
  | { kind: "none" }                                          // 不支持安装（prompt）
  | { kind: "single-file" }                                   // 单文件覆写（rule）
  | { kind: "directory-overwrite"; confirmMessage: string }   // 目录覆写（skill）

// 目录配置键名映射（兼容旧配置）
export type ContentRepositoryDirMapping = {
  defaultDirectoryName: string         // 新仓库默认用这个
  legacyConfigKey?: "rulesDir" | "skillsDir"  // 读取旧配置时兜底的字段名
}

export type ContentTypeDefinition = {
  id: SynapseContentType               // "rule" / "skill" / "prompt" / ...
  singularLabel: string                // "Rule" / "Skill" / "Prompt"
  pluralLabel: string                  // "Rules" / "Skills" / "Prompts"
  tabLabel: string                     // App tab 上显示的
  emptyStateNoun: string               // "当前目录还没有 ${X}"
  capabilities: ContentTypeCapabilities
  download: ContentDownloadSpec
  install: ContentInstallSpec
  repositoryDir: ContentRepositoryDirMapping
  // 该类型支持的内置分类；空数组表示"只显示全部"
  categories: readonly SynapseCategoryDefinition[]
  // Create/Update payload 的 "files" 字段是否必填（运行时校验用）
  requiresFilesInPayload: boolean
}
```

> **设计说明**：`installRequiresOverwriteConfirm` 这一布尔被故意**从 capabilities 移到 install spec** 作为 `directory-overwrite` 的必填字段。这样 TS 能保证：只有走目录覆写策略的类型必须提供确认文案，走 `single-file` / `none` 的类型从类型上就不会被误读到这个字段。同时把 `categories` 并入定义是为了让"某个内容类型的一切"集中在一个文件，而不是分散在 `src/config/content-types/` 和 `src/config/categories/` 两处。

### 3.3 具体定义

```ts
// src/config/content-types/rule.ts
import { rulesCategories } from "@/config/categories/rules"

export const ruleContentTypeDefinition: ContentTypeDefinition = {
  id: "rule",
  singularLabel: "Rule",
  pluralLabel: "Rules",
  tabLabel: "Rules",
  emptyStateNoun: "Rule",
  capabilities: {
    hasAttachments: false,
    canInstallToEditor: true,
    canCopyContent: true,
    canDownload: true,
  },
  download: { extension: ".md", dialogFilterName: "Markdown", exporter: "text-file" },
  install: { kind: "single-file" },
  repositoryDir: {
    defaultDirectoryName: "rules",
    legacyConfigKey: "rulesDir",
  },
  categories: rulesCategories,
  requiresFilesInPayload: false,
}

// src/config/content-types/skill.ts
import { skillsCategories } from "@/config/categories/skills"

export const skillContentTypeDefinition: ContentTypeDefinition = {
  id: "skill",
  singularLabel: "Skill",
  pluralLabel: "Skills",
  tabLabel: "Skills",
  emptyStateNoun: "Skill",
  capabilities: {
    hasAttachments: true,
    canInstallToEditor: true,
    canCopyContent: true,
    canDownload: true,
  },
  download: { extension: ".zip", dialogFilterName: "Zip Archive", exporter: "zip-archive" },
  install: {
    kind: "directory-overwrite",
    confirmMessage: "Skill 安装会整体替换目标目录中的现有内容。",
  },
  repositoryDir: {
    defaultDirectoryName: "skills",
    legacyConfigKey: "skillsDir",
  },
  categories: skillsCategories,
  requiresFilesInPayload: true,
}
```

以后新增 prompt：

```ts
// src/config/content-types/prompt.ts
export const promptContentTypeDefinition: ContentTypeDefinition = {
  id: "prompt",
  singularLabel: "Prompt",
  pluralLabel: "Prompts",
  tabLabel: "Prompts",
  emptyStateNoun: "Prompt",
  capabilities: {
    hasAttachments: false,
    canInstallToEditor: false,          // ← 关键：不支持安装
    canCopyContent: true,
    canDownload: true,
  },
  download: { extension: ".md", dialogFilterName: "Markdown", exporter: "text-file" },
  install: { kind: "none" },
  repositoryDir: { defaultDirectoryName: "prompts" },
  categories: [],                        // 暂无内置分类，只显示"全部"
  requiresFilesInPayload: false,
}
```

### 3.4 入口

```ts
// src/config/content-types/index.ts
import type { SynapseContentType } from "@/types/content"
import { ruleContentTypeDefinition } from "./rule"
import { skillContentTypeDefinition } from "./skill"
import type { ContentTypeDefinition } from "./types"

// 用对象字面量 + satisfies：新增 "prompt" 到 SynapseContentType 后，若此处未补齐
// TS 会立即报 "Property 'prompt' is missing"，从而强制扩展者不遗漏。
export const CONTENT_TYPE_REGISTRY = {
  rule: ruleContentTypeDefinition,
  skill: skillContentTypeDefinition,
  // 未来：prompt: promptContentTypeDefinition,
} as const satisfies Record<SynapseContentType, ContentTypeDefinition>

export const CONTENT_TYPE_DEFINITIONS: readonly ContentTypeDefinition[] =
  Object.values(CONTENT_TYPE_REGISTRY)

export function getContentTypeDefinition(id: SynapseContentType): ContentTypeDefinition {
  return CONTENT_TYPE_REGISTRY[id]
}

export function getAllContentTypeIds(): SynapseContentType[] {
  return Object.keys(CONTENT_TYPE_REGISTRY) as SynapseContentType[]
}
```

注意两点：
1. `SynapseContentType` 保持 `"rule" | "skill"` 这样的字面量 union；新增 prompt 时同步 `src/types/content.ts:1` 加 `| "prompt"`。`satisfies Record<SynapseContentType, ...>` 会立即迫使 registry 补齐。
2. `getContentTypeDefinition` 不再手动检查 `undefined` —— 因为 union 键强制存在，无需运行时 tribal knowledge 式兜底。如果未来有"运行时从备份读到未知 type"的场景，专门写一个 `tryGetContentTypeDefinition` 返回 `| null`，别污染主路径。

---

## 4. 类型层改造（`src/types/content.ts`）

### 4.1 保留 Rule/Skill 字面量分支，但把通用结构抽出

```ts
export type SynapseContentType = "rule" | "skill"

// Meta / Detail 保持 tagged union
// 但通过泛型让新增 type 只需扩展 type 字段
type SynapseContentSummaryBase = { /* 原来的 */ }
export type SynapseContentMeta<T extends SynapseContentType = SynapseContentType> =
  SynapseContentSummaryBase & { type: T }

export type SynapseRuleMeta = SynapseContentMeta<"rule">
export type SynapseSkillMeta = SynapseContentMeta<"skill">
```

### 4.2 Payload 泛型化

把 Create/Update 统一为一个带 type 参数的泛型，然后针对有 `files` 的类型再扩展：

```ts
export type SynapseCreateContentPayloadBase = {
  title: string
  description: string
  category: string
  icon: string
  iconBg: string
  content: string
}

export type SynapseCreateContentPayload<T extends SynapseContentType> =
  T extends "skill"
    ? SynapseCreateContentPayloadBase & { files: SynapseCreateSkillFilePayload[] }
    : SynapseCreateContentPayloadBase

// 老的保留作为别名（向后兼容，外部仍能 import）
export type SynapseCreateRulePayload = SynapseCreateContentPayload<"rule">
export type SynapseCreateSkillPayload = SynapseCreateContentPayload<"skill">
```

**原则**：所有外部 import 的类型名（`SynapseRuleMeta / SynapseCreateRulePayload / ...`）都保留为 alias，避免大规模替换。内部新代码用泛型版本。

**同时必须清理模块本地重复定义**（原方案遗漏，复盘时发现）：
- [src/modules/rules/types.ts:1-12](src/modules/rules/types.ts#L1-L12) 定义了一个本地 `CreateRulePayload`，字段和 `SynapseCreateRulePayload` 完全相同，属于事实上的重复。改造时**删除这个文件里的 `CreateRulePayload`**，改为 `export type CreateRulePayload = SynapseCreateRulePayload` 或直接让调用方 import `SynapseCreateRulePayload`。`RuleCreateFieldName / RuleCreateFieldErrors` 这些"表单校验专用"类型继续保留在这里。
- [src/modules/skills/types.ts](src/modules/skills/types.ts) 同样处理 `CreateSkillPayload / CreateSkillFilePayload`。注意原文件里的 `CreateSkillFilePayload` 多了一个 `file?: File` 字段（渲染器本地需要），和 `SynapseCreateSkillFilePayload` 不完全相同；这个差异要保留 —— 模块里的 `CreateSkillFilePayload` 是"表单层类型"（包含浏览器 File 对象），`SynapseCreateSkillFilePayload` 是"IPC 传输层类型"（已序列化成 bytes）。应重命名模块里的为 `SkillCreateFilePayloadDraft`，让两者用途一眼能分辨。

### 4.3 统一 Create/Update IPC payload

新增"带 contentType 的外壳 payload"，供通用通道使用：

```ts
export type SynapseCreateContentRequest =
  | { contentType: "rule"; payload: SynapseCreateRulePayload }
  | { contentType: "skill"; payload: SynapseCreateSkillPayload }

export type SynapseUpdateContentRequest =
  | { contentType: "rule"; payload: SynapseUpdateRulePayload }
  | { contentType: "skill"; payload: SynapseUpdateSkillPayload }
```

---

## 5. 配置层改造（兼容旧字段）

### 5.1 新形态

```ts
// src/types/config.ts
export type SynapseRepositoryConfig = {
  uuid: string
  name: string
  localPath: string
  contentDirs: Partial<Record<SynapseContentType, string>>
  // 过渡：保留旧字段做向后兼容读取；写入时不再写
  rulesDir?: string    // @deprecated 仅供迁移读取
  skillsDir?: string   // @deprecated 仅供迁移读取
}
```

### 5.2 迁移逻辑（在 `src/lib/config.ts` 的 `normalize...` 中）

读取一个仓库配置时：

```ts
function resolveContentDirs(raw): Record<SynapseContentType, string> {
  const out: Partial<Record<SynapseContentType, string>> = {}

  for (const def of CONTENT_TYPE_DEFINITIONS) {
    // 优先读 contentDirs[id]
    const fromMap = raw.contentDirs?.[def.id]
    if (typeof fromMap === "string" && fromMap.trim()) {
      out[def.id] = fromMap.trim()
      continue
    }
    // 回落到 legacy key（rulesDir/skillsDir）
    if (def.repositoryDir.legacyConfigKey) {
      const legacy = raw[def.repositoryDir.legacyConfigKey]
      if (typeof legacy === "string" && legacy.trim()) {
        out[def.id] = legacy.trim()
        continue
      }
    }
    // 兜底默认
    out[def.id] = def.repositoryDir.defaultDirectoryName
  }

  return out as Record<SynapseContentType, string>
}
```

### 5.3 读取方（所有用到 `rulesDir / skillsDir` 的地方）

统一替换为：

```ts
function getContentDir(repository: SynapseRepositoryConfig, contentType: SynapseContentType): string {
  return repository.contentDirs?.[contentType]
    ?? CONTENT_TYPE_REGISTRY[contentType].repositoryDir.defaultDirectoryName
}
```

- [electron/services/content-history-service.ts:52-55](electron/services/content-history-service.ts#L52-L55) `resolveContentRootPath` 改为调用 `getContentDir(repository, contentType)`
- [electron/services/content-index-service.ts:134](electron/services/content-index-service.ts#L134) 反查也改为：遍历 `getAllContentTypeIds()`，比对 `getContentDir(repository, id)` 是否匹配当前目录名
- [electron/services/config-backup-service.ts:105-143](electron/services/config-backup-service.ts#L105-L143) 配置备份的校验器，把 `rulesDir / skillsDir` 的硬校验替换为：对 `contentDirs` 每个 key 校验；同时兼容读取老备份
- [src/modules/settings/components/repository-list-editor.tsx](src/modules/settings/components/repository-list-editor.tsx) 需要展示/编辑每个 contentType 的目录名（见 §9.4）

### 5.4 首次写入时升级

保存一次 `configStore.save()` 后，旧字段不再写。读 legacy 字段只用于"第一次迁移"。

---

## 6. IPC 层改造

### 6.1 新通道定义（[electron/ipc/channels.ts](electron/ipc/channels.ts) 和 [electron/preload.ts](electron/preload.ts) 同步改）

14 个旧通道 → 9 个新通道：

```ts
content: {
  // 列表 / 明细 / 历史（合并 8 个通道 → 4 个）
  list: "synapse:content:list",                                    // args: { contentType }
  getContent: "synapse:content:get-content",                       // args: { contentType, id }
  getDetail: "synapse:content:get-detail",                         // args: { contentType, id }
  getHistory: "synapse:content:get-history",                       // args: { contentType, id }
  getHistoryVersion: "synapse:content:get-history-version",        // args: { contentType, id, historyDirname }

  // 写操作（合并 4 个 → 2 个；删除本来就通用）
  create: "synapse:content:create",                                // args: SynapseCreateContentRequest
  update: "synapse:content:update",                                // args: SynapseUpdateContentRequest
  deleteContent: "synapse:content:delete-content",                 // 保持原样

  // 下载（合并 2 个 → 1 个）
  download: "synapse:content:download",                            // args: { contentType, id }

  // 编辑器适配器 & 安装（保持原样）
  getEditorAdapters: "synapse:content:get-editor-adapters",
  installToEditor: "synapse:content:install-to-editor",
  resolveEditorInstallTarget: "synapse:content:resolve-editor-install-target",
}
```

### 6.2 保留向后兼容通道（可选，推荐）

为了降低改造风险，可以**暂时保留旧通道**，让它们在 handler 内部转发到新通道（见 §6.4）。如果此项目不需要向下兼容，直接删除老通道、老 bridge、老 renderer wrapper。

> **决策点**：本项目是 Electron 桌面应用，preload/renderer/main 三端同时升级，无跨版本问题，因此**直接删除老通道**，不要保留兼容层。版本号已经在 `0.1.14+`，正好作为 break 点。

### 6.3 Handler 改造（[electron/ipc/content-handlers.ts](electron/ipc/content-handlers.ts)）

把 `getRules / getSkills` 合并成一个 handler：

```ts
handleValidatedIpc(
  SYNAPSE_IPC_CHANNELS.content.list,
  async (_event, args: { contentType: SynapseContentType }) => {
    return contentService.listContent(args.contentType)
  },
)
```

其他类似。对 `create / update` 使用 discriminated union：

```ts
handleValidatedIpc(
  SYNAPSE_IPC_CHANNELS.content.create,
  async (event, request: SynapseCreateContentRequest) => {
    logger.info("Handling content.create.", { contentType: request.contentType })

    const result = await contentSubmissionService.createContent(request)
    const repository = await resolveActiveRepository()
    await notifyPendingPushesUpdated(event.sender, repository)

    if (result.status === "saved" && result.pendingPushCount > 0 && repository) {
      scheduleBackgroundPush(event.sender, repository)
    }

    return result
  },
)
```

对 `download`：

```ts
handleValidatedIpc(
  SYNAPSE_IPC_CHANNELS.content.download,
  async (event, args: { contentType: SynapseContentType; id: string }) => {
    const def = getContentTypeDefinition(args.contentType)
    const ownerWindow = BrowserWindow.fromWebContents(event.sender)
    const filePath = await chooseDownloadPath(ownerWindow, {
      buttonLabel: "下载",
      defaultPath: path.join(app.getPath("downloads"), `${args.id}${def.download.extension}`),
      filters: [
        {
          extensions: [def.download.extension.replace(/^\./, "")],
          name: def.download.dialogFilterName,
        },
      ],
    })
    if (!filePath) {
      return { canceled: true, filePath: null }
    }

    await contentDownloadService.download(args.contentType, args.id, filePath)
    return { canceled: false, filePath }
  },
)
```

### 6.4 bridge 和 renderer wrapper

- [src/types/bridge.ts](src/types/bridge.ts) 的 `content` 对象删除所有按类型的方法，换成 `list / getContent / getDetail / getHistory / getHistoryVersion / create / update / download` 8 个通用方法
- [electron/preload.ts](electron/preload.ts) 的 `content` 对象同步改
- [src/app-shell/content.ts](src/app-shell/content.ts) 彻底重写：
  ```ts
  export async function listContent<T extends SynapseContentType>(contentType: T): Promise<SynapseContentMeta<T>[]>
  export async function readContent(contentType: SynapseContentType, id: string): Promise<SynapseTextContentFile>
  export async function readDetail(contentType: SynapseContentType, id: string): Promise<SynapseContentDetail>
  export async function readHistory(contentType, id): Promise<SynapseContentHistoryEntry[]>
  export async function readHistoryVersion(contentType, id, dirname): Promise<SynapseContentHistoryVersion>
  export async function createContent<T extends SynapseContentType>(contentType: T, payload: SynapseCreateContentPayload<T>): Promise<SynapseContentMutationResult>
  export async function updateContent<T extends SynapseContentType>(contentType: T, payload: SynapseUpdateContentPayload<T>): Promise<SynapseContentMutationResult>
  export async function downloadContent(contentType: SynapseContentType, id: string): Promise<SynapseContentDownloadResult>
  ```
- **同时保留薄的向后兼容 wrapper**（给现有调用点逐步迁移）：
  ```ts
  export const createRule = (p: SynapseCreateRulePayload) => createContent("rule", p)
  export const createSkill = (p: SynapseCreateSkillPayload) => createContent("skill", p)
  // ... 等
  ```
  这些 alias 放 [src/app-shell/content.ts](src/app-shell/content.ts) 底部，标 `@deprecated`，方便一轮替换完后删除。

---

## 7. 后端 Service 层改造

### 7.1 `content-service.ts`

改为单入口方法：

```ts
class ContentService {
  async listContent(contentType: SynapseContentType): Promise<SynapseContentMeta[]> {
    const context = await getActiveRepositoryContext()
    if (!context) return []
    await contentIndexService.syncIndex(context.repository)
    return contentIndexService.listContent(context.repository, contentType)
  }

  async getContent(contentType: SynapseContentType, id: string): Promise<SynapseTextContentFile> {
    const detail = await readCurrentDetail(contentType, id)
    return createTextFile("main.md", detail.content)
  }

  async getDetail(contentType: SynapseContentType, id: string): Promise<SynapseContentDetail> {
    return readCurrentDetail(contentType, id)
  }

  async getHistory(contentType: SynapseContentType, id: string): Promise<SynapseContentHistoryEntry[]> { /* ... */ }

  async getHistoryVersion(contentType, id, historyDirname): Promise<SynapseContentHistoryVersion> { /* ... */ }
}
```

同时保留 `getRules / getSkills / getRuleContent / ...` 作为内联 alias（调用新方法），标 deprecated，用完后删除。

错误消息用注册表：

```ts
throw new Error(`找不到对应的 ${getContentTypeDefinition(contentType).singularLabel} 内容。`)
```

### 7.2 `content-submission-service.ts` / `content-write-service.ts`

对外暴露：

```ts
// content-submission-service
async createContent<T extends SynapseContentType>(
  req: SynapseCreateContentRequest,
): Promise<SynapseContentMutationResult> {
  const identity = await userIdentityService.requireReadyIdentity()
  const writeResult = await contentWriteService.createContent(req, identity)
  return this.commitAndMaybePush("create", writeResult, { deferPush: true })
}

async updateContent(req: SynapseUpdateContentRequest): Promise<SynapseContentMutationResult> { ... }
```

内部已经在用 `updateContent(contentType, payload, identity)` 私有方法，就不改。

`content-write-service.ts` 把 `createRule / createSkill / updateRule / updateSkill` 合并为：

```ts
async createContent(req: SynapseCreateContentRequest, identity): Promise<ContentWriteResult> {
  assertRequiredCreateFields(req.payload)
  // 如果注册表 requiresFilesInPayload=true，校验 payload.files 存在
  const def = getContentTypeDefinition(req.contentType)
  if (def.requiresFilesInPayload && !("files" in req.payload)) {
    throw new Error(`${def.singularLabel} 创建必须带 files 字段。`)
  }
  return this.createContentInternal(req.contentType, req.payload, identity)
}

async updateContent(req: SynapseUpdateContentRequest, identity): Promise<ContentWriteResult> { ... }
```

[electron/services/content-write-service.ts:198-268](electron/services/content-write-service.ts#L198-L268) 的 `resolveAttachmentRecords` 里 `if (contentType === "rule")` 改成 `if (!def.capabilities.hasAttachments)`。

### 7.3 `content-download-service.ts`（**这里是真正的类型差异处**）

改造前两个 public 方法 `downloadRule / downloadSkill`。改造后：

```ts
class ContentDownloadService {
  async download(contentType: SynapseContentType, id: string, targetPath: string): Promise<void> {
    const def = getContentTypeDefinition(contentType)

    switch (def.download.exporter) {
      case "text-file":
        return this.exportAsTextFile(contentType, id, targetPath)
      case "zip-archive":
        return this.exportAsZipArchive(contentType, id, targetPath)
    }
  }

  private async exportAsTextFile(contentType, id, targetPath) {
    const file = await contentService.getContent(contentType, id)
    const ext = getContentTypeDefinition(contentType).download.extension
    await withTemporaryOutput(ext, async (tempPath) => {
      await writeFile(tempPath, file.content, "utf8")
      await copyFile(tempPath, targetPath)
    })
    logger.info("Text content download completed.", { contentType, id, targetPath })
  }

  private async exportAsZipArchive(contentType, id, targetPath) {
    // 复制原 downloadSkill 的实现，把 "skill" 换成 contentType
    const repositoryRootPath = await getActiveRepositoryRootPath()
    const detail = await contentService.getDetail(contentType, id)
    // ... 原逻辑不变 ...
  }
}
```

这样 prompt 直接能用 `text-file` 导出；未来如果还有别的打包策略（例如"带 frontmatter 的 markdown"），就加一个 `case`。

### 7.4 `content-install-service.ts`

[electron/services/content-install-service.ts:155-186](electron/services/content-install-service.ts#L155) 的 `if (payload.contentType === "rule")` 分支改为使用 `def.install.kind`：

```ts
const def = getContentTypeDefinition(payload.contentType)
switch (def.install.kind) {
  case "none":
    throw new Error(`${def.singularLabel} 不支持安装到编辑器。`)
  case "single-file": {
    if (target.targetKind !== "file") throw new Error(...)
    const file = await contentService.getContent(payload.contentType, payload.contentId)
    await replaceFileAtomically(target.targetPath, file.content)
    break
  }
  case "directory-overwrite": {
    if (target.targetKind !== "directory") throw new Error(...)
    // 原 skill 分支不变
    break
  }
}
```

### 7.5 `content-index-service.ts`

- [electron/services/content-index-service.ts:40](electron/services/content-index-service.ts#L40) `row.type !== "rule" && row.type !== "skill"` 改成 `!getAllContentTypeIds().includes(row.type)`
- [electron/services/content-index-service.ts:134](electron/services/content-index-service.ts#L134) 按目录名反查 contentType 改成查注册表：
  ```ts
  function resolveContentTypeByDirectoryName(repository, directoryName): SynapseContentType | null {
    for (const def of CONTENT_TYPE_DEFINITIONS) {
      if (getContentDir(repository, def.id) === directoryName) return def.id
    }
    return null
  }
  ```
- [electron/services/content-index-service.ts:181-182](electron/services/content-index-service.ts#L181-L182) `allRules / allSkills` 改为循环所有注册类型

### 7.6 `editor-adapter-service.ts` 和 adapters（**编辑器 × 内容类型矩阵**）

目前 `supportsRule / supportsSkill` 是两个布尔。改为：

```ts
// src/types/editor.ts
export type SynapseEditorAdapterSummary = {
  id: SynapseEditorId
  label: string
  supportsGlobal: boolean
  supportsProject: boolean
  supportedContentTypes: SynapseContentType[]   // ← 替换 supportsRule/supportsSkill
}
```

每个 adapter（[electron/services/editor-adapters/claude-code-adapter.ts:20-21](electron/services/editor-adapters/claude-code-adapter.ts#L20-L21) 等）从两个布尔改为数组：

```ts
supportedContentTypes: ["rule", "skill"],
```

adapter 内部现有的 `if (contentType === "rule") { ... } else { /* assume skill */ }` 必须改成 **显式 switch + default 抛错**（复盘时发现的隐藏 bug）：

```ts
// 原代码（隐藏 bug：任何非 rule 的 contentType 都会落入 skill 分支）
if (contentType === "rule") {
  return resolveRuleTarget(...)
}
return resolveSkillTarget(...)

// 改为
switch (contentType) {
  case "rule":
    return resolveRuleTarget(...)
  case "skill":
    return resolveSkillTarget(...)
  default:
    // 不在 supportedContentTypes 里时理论上外层已经过滤掉；这里是最后一道护栏
    throw new Error(`${this.label} 暂不支持 ${contentType} 类型。`)
}
```

这点很关键：原来的二元 if/else 等价于"假设 contentType 要么是 rule 要么是 skill"——未来加上 prompt 后如果漏了哪里的过滤，就会悄悄走进 skill 分支造成错误安装。switch+default 把这个风险封堵在代码层面。

另外，`editorAdapterService.resolveTarget()` 在调用 adapter 前要先看 `supportedContentTypes.includes(payload.contentType)`，不包含就直接返回 `status: "unsupported"`（不抛错，让 UI 优雅降级）。

`editorAdapterService.listAdapters()` 返回的 summary 也改字段（见 §9.6）。

---

## 8. 前端公用层改造

### 8.1 `content-categories.ts`

- [src/lib/content-categories.ts:24](src/lib/content-categories.ts#L24) `getContentTypeLabel` 改为 `getContentTypeDefinition(contentType).pluralLabel`
- 其他描述文案里的 "Rules 模块 / Skills 模块" 改为 `getContentTypeDefinition(contentType).pluralLabel + " 模块"`

### 8.2 分类注册表

- [src/config/categories/index.ts](src/config/categories/index.ts) 的 `categoryRegistry` 保持按 key 查找，但增加：新增类型时如果没提供 category 文件就 fallback 到空数组（避免 TS 编译时就要求所有类型都必须有分类定义）：

```ts
const categoryRegistry: Partial<Record<SynapseContentType, readonly SynapseCategoryDefinition[]>> = {
  rule: rulesCategories,
  skill: skillsCategories,
  // prompt: promptsCategories, // 未来补
}

export function getBuiltInCategories(contentType: SynapseContentType): readonly SynapseCategoryDefinition[] {
  return categoryRegistry[contentType] ?? []
}
```

### 8.3 `use-content-catalog.ts`

- [src/modules/content/hooks/use-content-catalog.ts:74](src/modules/content/hooks/use-content-catalog.ts#L74) `contentType === "rule" ? readRules() : readSkills()` 替换为 `listContent(contentType)`
- 整个 hook 的泛型简化（items 直接是 `SynapseContentMeta<T>[]`）

### 8.4 `content-action-split-button.tsx`

这是改动重点，按注册表驱动整个按钮：

```tsx
function ContentActionSplitButton({ item, onInstallDialogOpenChange }) {
  const def = getContentTypeDefinition(item.type)
  const { canDownload, canCopyContent, canInstallToEditor } = def.capabilities

  // ... 按 def 控制渲染 ...

  // 下载：改为调 downloadContent(item.type, item.id)
  // 复制：改为调 readContent(item.type, item.id)
  // 安装：canInstallToEditor === false 时，整个下拉菜单隐藏安装段

  const supportedAdapters = (adapters ?? []).filter(
    (a) => a.supportedContentTypes.includes(item.type),
  )

  return (
    <ButtonGroup>
      {canDownload ? <Button onClick={handleDownload}>下载</Button> : null}
      {(canInstallToEditor || canCopyContent) ? (
        <DropdownMenu ...>
          <DropdownMenuContent>
            {canInstallToEditor ? (
              <>
                <DropdownMenuLabel>安装</DropdownMenuLabel>
                {supportedAdapters.map(...)}
              </>
            ) : null}
            {canCopyContent ? (
              <>
                {canInstallToEditor ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem onSelect={handleCopy}>复制正文</DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </ButtonGroup>
  )
}
```

边界情况：`prompt` 的 `canInstallToEditor=false`，所以 dropdown 只剩"复制正文"一项。如果一个类型 `canInstallToEditor && !canCopyContent`（假设），dropdown 也能正常只显示安装段。

### 8.5 `content-install-dialog.tsx`

- [src/modules/content/components/content-install-dialog.tsx:303-311](src/modules/content/components/content-install-dialog.tsx#L303-L311) `if (item.type === "skill")` 改为检测 `def.install.kind === "directory-overwrite"`。TS 在此分支内能自动把 `def.install` 收窄，从而 `def.install.confirmMessage` 可直接使用，不用可选链。
- 第 453 行附件/目录相关 UI 按 `def.capabilities.hasAttachments` 控制显示
- AlertDialogDescription 里硬编码的 "Skill 安装会整体替换目标目录中的现有内容。" 改为 `def.install.kind === "directory-overwrite" ? def.install.confirmMessage : null`
- 整体原则：dialog 里所有出现字符串 "Skill" / "Rule" 的位置，都换成 `def.singularLabel`

### 8.6 `content-browser-page.tsx`

- [src/modules/content/components/content-browser-page.tsx:67](src/modules/content/components/content-browser-page.tsx#L67) `getSingularLabel` 删除，直接用 `getContentTypeDefinition(contentType).singularLabel`
- `title` prop 去掉（复盘时发现的 DRY 违反）——原来 rules/skills 的 index.tsx 各自传 `title="Rules" / title="Skills"`，其实完全能从 `CONTENT_TYPE_REGISTRY[contentType].pluralLabel` 里读出。去掉后：
  - 组件 props 减少一个字段
  - 模块壳工厂 `createContentModule` 不再需要为 `title` 做参数传递
  - 未来新增类型只改 definition，不改任何 ContentBrowserPage 调用点
- 组件内部搜索占位符等文案也由 `getContentTypeDefinition(contentType)` 派生

### 8.7 模块壳工厂（**消除 rules/skills 镜像代码**）

新建 [src/modules/content/create-content-module.tsx](src/modules/content/create-content-module.tsx)：

```tsx
type ContentModuleConfig<T extends SynapseContentType> = {
  contentType: T
  // 由各模块提供的"创建对话框"组件（负责特有字段，例如 skill 的 files 上传器）
  CreateDialog: ComponentType<{
    open: boolean
    onOpenChange: (open: boolean) => void
    onSubmit: (payload: SynapseCreateContentPayload<T>) => void
  }>
  // 详情对话框（类似）
  DetailDialog: ComponentType<{
    item: SynapseContentMeta<T> | null
    open: boolean
    refreshSignal: number
    onContentChanged: () => void
    onOpenChange: (open: boolean) => void
  }>
  // submit 前的 payload 变换（例如 skill 要把 File 转成 bytes）
  transformCreatePayload?: (p: SynapseCreateContentPayload<T>) => Promise<SynapseCreateContentPayload<T>>
}

export function createContentModule<T extends SynapseContentType>(
  config: ContentModuleConfig<T>,
) {
  const def = getContentTypeDefinition(config.contentType)

  return function ContentModule({
    onCreateDialogOpenChange,
    onDetailDialogOpenChange,
    onInstallDialogOpenChange,
  }: {
    onCreateDialogOpenChange?: (open: boolean) => void
    onDetailDialogOpenChange?: (open: boolean) => void
    onInstallDialogOpenChange?: (open: boolean) => void
  }) {
    const logger = useMemo(() => createRendererLogger(config.contentType), [])
    const { activeRepository } = useAppConfig()
    const { promise } = useAppNotifications()
    const { waitForBackgroundPush } = useRepositoryManager()
    const { handleCreated, isCreateDialogOpen, refreshSignal, setIsCreateDialogOpen } =
      useContentCreationState(onCreateDialogOpenChange)

    const handleSubmit = (payload: SynapseCreateContentPayload<T>) => {
      void promise(
        async () => {
          const finalPayload = config.transformCreatePayload
            ? await config.transformCreatePayload(payload)
            : payload
          const result = await createContent(config.contentType, finalPayload)
          if (result.status === "saved" && result.pendingPushCount > 0 && activeRepository) {
            await waitForBackgroundPush(activeRepository.uuid)
          }
          return result
        },
        { loading: "正在保存...", success: (r) => r.status === "saved" ? "保存成功。" : null,
          error: (e) => e instanceof Error ? e.message : "保存失败。" },
      ).then((result) => {
        if (result?.status === "saved") handleCreated()
      }).catch((error) => logger.error(`${def.singularLabel} save failed.`, error))
    }

    return (
      <>
        <ContentBrowserPage
          contentType={config.contentType}
          refreshSignal={refreshSignal}
          onCreateClick={() => setIsCreateDialogOpen(true)}
          onDetailDialogOpenChange={onDetailDialogOpenChange}
          onInstallDialogOpenChange={onInstallDialogOpenChange}
          renderDetailDialog={({ item, onContentChanged, onOpenChange, open, refreshSignal: dr }) => (
            <config.DetailDialog
              item={item?.type === config.contentType ? item as SynapseContentMeta<T> : null}
              open={open}
              refreshSignal={dr}
              onContentChanged={onContentChanged}
              onOpenChange={onOpenChange}
            />
          )}
        />
        <config.CreateDialog
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
          onSubmit={handleSubmit}
        />
      </>
    )
  }
}
```

然后 [src/modules/rules/index.tsx](src/modules/rules/index.tsx) 缩水为 10 行：

```tsx
import { createContentModule } from "@/modules/content/create-content-module"
import { RuleCreateDialog } from "./components/rule-create-dialog"
import { RuleDetailDialog } from "./components/rule-detail-dialog"

export const RulesModule = createContentModule({
  contentType: "rule",
  CreateDialog: RuleCreateDialog,
  DetailDialog: RuleDetailDialog,
})
```

[src/modules/skills/index.tsx](src/modules/skills/index.tsx) 类似，`transformCreatePayload` 负责调用 `serializeCreateSkillFiles`。

### 8.8 App.tsx 按注册表生成 tabs

完整代码示例（复盘后补齐，避免另一个 AI 拿到方案后自己猜 helper 的形状）：

```tsx
// src/App.tsx
import { CONTENT_TYPE_DEFINITIONS, getAllContentTypeIds } from "@/config/content-types"
import type { SynapseContentType } from "@/types/content"
import { RulesModule } from "@/modules/rules"
import { SkillsModule } from "@/modules/skills"
// 新增模块只在这里补一行引用
import { SettingsModule } from "@/modules/settings"

type AppTabId = SynapseContentType | "settings"

type DialogKind = "create" | "detail" | "install"

type ContentDialogState = Record<DialogKind, boolean>
type ContentDialogStateMap = Record<SynapseContentType, ContentDialogState>

function createEmptyDialogStateMap(): ContentDialogStateMap {
  return Object.fromEntries(
    getAllContentTypeIds().map((id) => [id, { create: false, detail: false, install: false }]),
  ) as ContentDialogStateMap
}

// 模块组件查找表：静态、显式，不用 lazy
const CONTENT_MODULE_COMPONENTS: Record<SynapseContentType, React.ComponentType<{
  onCreateDialogOpenChange?: (open: boolean) => void
  onDetailDialogOpenChange?: (open: boolean) => void
  onInstallDialogOpenChange?: (open: boolean) => void
}>> = {
  rule: RulesModule,
  skill: SkillsModule,
  // 未来：prompt: PromptsModule,
}

function App() {
  // ... 其他 state ...
  const [contentDialogStates, setContentDialogStates] = useState<ContentDialogStateMap>(
    createEmptyDialogStateMap,
  )
  const [isPendingPushDialogOpen, setIsPendingPushDialogOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<AppTabId>("rule")

  // helper：集中封装 "某 type × 某 kind" 的 setter，避免 setState 回调散落
  const setContentDialogOpen = useCallback(
    (type: SynapseContentType, kind: DialogKind, open: boolean) => {
      setContentDialogStates((current) => ({
        ...current,
        [type]: { ...current[type], [kind]: open },
      }))
    },
    [],
  )

  const hasContentDialogOpen = useMemo(
    () => Object.values(contentDialogStates).some((s) => s.create || s.detail || s.install),
    [contentDialogStates],
  )
  const hasBlockingModalOpen = hasContentDialogOpen || isPendingPushDialogOpen

  const tabs = useMemo(
    () => [
      ...CONTENT_TYPE_DEFINITIONS.map((def) => ({ id: def.id, label: def.tabLabel })),
      { id: "settings", label: "Settings" },
    ],
    [],
  )

  return (
    // ...
    <div className="flex h-full min-h-0 flex-col">
      {CONTENT_TYPE_DEFINITIONS.map((def) => {
        if (activeTab !== def.id) return null
        const ModuleComponent = CONTENT_MODULE_COMPONENTS[def.id]
        return (
          <ModuleComponent
            key={def.id}
            onCreateDialogOpenChange={(open) => setContentDialogOpen(def.id, "create", open)}
            onDetailDialogOpenChange={(open) => setContentDialogOpen(def.id, "detail", open)}
            onInstallDialogOpenChange={(open) => setContentDialogOpen(def.id, "install", open)}
          />
        )
      })}
      {activeTab === "settings" ? <SettingsModule /> : null}
    </div>
  )
}
```

**设计要点**：
1. `CONTENT_MODULE_COMPONENTS` 是"模块实例注册表"，和 `CONTENT_TYPE_REGISTRY`（能力声明表）职责分离：前者是 React 组件，后者是纯数据配置。如果强行合并会把 React 运行时引入 `src/config/`，破坏分层。
2. `setContentDialogOpen(type, kind, open)` 这个三元签名让 `RulesModule / SkillsModule / ...` 使用方完全对称，消除现有 App.tsx 里 6 个独立 state setter 的散乱。
3. `createEmptyDialogStateMap` 用 `getAllContentTypeIds()` 派生，保证添加新类型时 state 自动初始化，不会出现"新类型的 dialog state 访问到 undefined"的 bug。

---

## 9. 各处具体改动清单（给执行 AI 当 checklist）

### 9.1 新增文件

1. `src/config/content-types/types.ts` — ContentTypeDefinition 等接口
2. `src/config/content-types/rule.ts`
3. `src/config/content-types/skill.ts`
4. `src/config/content-types/index.ts` — registry + 查询函数
5. `src/modules/content/create-content-module.tsx` — 模块壳工厂

### 9.2 类型层

修改：

- [src/types/content.ts](src/types/content.ts)
  - 把 Meta/Detail 抽为 `SynapseContentMeta<T>` 泛型，保留 `SynapseRuleMeta = ...<"rule">` alias
  - 新增 `SynapseCreateContentPayload<T>`, `SynapseUpdateContentPayload<T>` 泛型
  - 保留 `SynapseCreateRulePayload / SynapseCreateSkillPayload / ...` alias
  - 新增 `SynapseCreateContentRequest / SynapseUpdateContentRequest` discriminated union
- [src/types/config.ts](src/types/config.ts)
  - `SynapseRepositoryConfig` 加 `contentDirs?: Partial<Record<SynapseContentType, string>>`
  - 保留 `rulesDir? / skillsDir?` 作为 deprecated legacy
- [src/types/editor.ts:18-19](src/types/editor.ts#L18-L19)
  - `supportsRule / supportsSkill` → `supportedContentTypes: SynapseContentType[]`
- [src/modules/rules/types.ts](src/modules/rules/types.ts)（复盘补）
  - 删除本地 `CreateRulePayload`，改为 `export type CreateRulePayload = SynapseCreateRulePayload`（或直接让调用点 import 中心类型）。`RuleCreateFieldName / RuleCreateFieldErrors` 保留。
- [src/modules/skills/types.ts](src/modules/skills/types.ts)（复盘补）
  - 删除本地 `CreateSkillPayload`；同时把本地 `CreateSkillFilePayload`（含浏览器 `File` 的草稿版本）重命名为 `SkillCreateFilePayloadDraft`，避免与 IPC 层 `SynapseCreateSkillFilePayload` 混淆。上层调用 `serializeCreateSkillFiles` 做"草稿 → IPC"转换。

### 9.3 配置层

- [src/lib/config.ts:111-115,209-210](src/lib/config.ts#L111-L210)
  - 校验 `contentDirs`
  - 兼容读取 `rulesDir / skillsDir`
- [src/constants/defaults.ts](src/constants/defaults.ts)
  - `DEFAULT_REPOSITORY_CONTENT_DIRECTORIES` 改成从注册表生成：
    ```ts
    export const DEFAULT_REPOSITORY_CONTENT_DIRECTORIES: Record<SynapseContentType, string> =
      Object.fromEntries(CONTENT_TYPE_DEFINITIONS.map(d => [d.id, d.repositoryDir.defaultDirectoryName])) as any
    ```
- [electron/services/config-backup-service.ts:105-143](electron/services/config-backup-service.ts#L105-L143)
  - 校验逻辑按所有 contentType 循环；兼容老备份

### 9.4 Settings UI

- [src/modules/settings/components/repository-list-editor.tsx](src/modules/settings/components/repository-list-editor.tsx)
  - 目录编辑区从"rulesDir/skillsDir 两行"改为"遍历 CONTENT_TYPE_DEFINITIONS，每种类型一行"
  - 默认值取注册表的 `defaultDirectoryName`

### 9.5 IPC 层

- [electron/ipc/channels.ts](electron/ipc/channels.ts) — 替换 `content` 对象为 §6.1 的 9 通道
- [electron/preload.ts:7-28,86-110](electron/preload.ts#L7-L110) — 同步替换通道常量 + bridge 方法
- [src/types/bridge.ts:54-79](src/types/bridge.ts#L54-L79) — bridge 类型改为 8 个通用方法
- [electron/ipc/content-handlers.ts:159-370](electron/ipc/content-handlers.ts#L159-L370) — handlers 全部重写为通用版，见 §6.3
- [src/app-shell/content.ts](src/app-shell/content.ts) — 全部重写为通用 wrapper，附 deprecated alias 见 §6.4

### 9.6 Service 层

- [electron/services/content-service.ts](electron/services/content-service.ts) — 合并 10 个方法为 5 个，见 §7.1
- [electron/services/content-submission-service.ts:283-315](electron/services/content-submission-service.ts#L283-L315) — `createContent / updateContent` 单入口，见 §7.2
- [electron/services/content-write-service.ts:207,271-301](electron/services/content-write-service.ts#L207) — 同 §7.2
- [electron/services/content-download-service.ts:153-198](electron/services/content-download-service.ts#L153-L198) — 改为按 `download.exporter` 策略分发，见 §7.3
- [electron/services/content-install-service.ts:155-186](electron/services/content-install-service.ts#L155-L186) — 按 `install.kind` 分发，见 §7.4
- [electron/services/content-index-service.ts:40,134,181-182](electron/services/content-index-service.ts#L40-L182) — 改为注册表查询
- [electron/services/content-history-service.ts:52-55](electron/services/content-history-service.ts#L52-L55) — `resolveContentRootPath` 改用 `getContentDir()`
- [electron/services/editor-adapter-service.ts:16-34](electron/services/editor-adapter-service.ts#L16-L34) — summary 字段改名
- [electron/services/editor-adapters/claude-code-adapter.ts](electron/services/editor-adapters/claude-code-adapter.ts)、[codex-adapter.ts](electron/services/editor-adapters/codex-adapter.ts)、[cursor-adapter.ts](electron/services/editor-adapters/cursor-adapter.ts) — 两个布尔改为 `supportedContentTypes` 数组

### 9.7 前端通用层

- [src/lib/content-categories.ts:23-25](src/lib/content-categories.ts#L23) — `getContentTypeLabel` 改为从 `CONTENT_TYPE_REGISTRY` 读 `pluralLabel`
- [src/lib/content-categories.ts:27-29](src/lib/content-categories.ts#L27-L29) — `getSortedCategoryDefinitions` 改为 `[...CONTENT_TYPE_REGISTRY[contentType].categories].sort(...)`；**删除** `src/config/categories/index.ts` 的 `getBuiltInCategories`（功能已内联到 definition），`rulesCategories / skillsCategories` 文件保留但只被 definition 引用
- [src/modules/content/hooks/use-content-catalog.ts:74](src/modules/content/hooks/use-content-catalog.ts#L74) — 调 `listContent(contentType)`

### 9.8 UI 组件

- [src/modules/content/components/content-action-split-button.tsx](src/modules/content/components/content-action-split-button.tsx) — 按 §8.4 重写
- [src/modules/content/components/content-browser-page.tsx:50-58,66-68](src/modules/content/components/content-browser-page.tsx#L50) — 删 `getSingularLabel`、**删除 `title` prop**（从 registry 派生）、内部文案改为由 `getContentTypeDefinition(contentType)` 获取
- [src/modules/content/components/content-install-dialog.tsx:303-311,453](src/modules/content/components/content-install-dialog.tsx#L303) — 按 §8.5

### 9.9 模块壳

- 新建 [src/modules/content/create-content-module.tsx](src/modules/content/create-content-module.tsx)
- [src/modules/rules/index.tsx](src/modules/rules/index.tsx) — 缩水为一行 `createContentModule(...)`
- [src/modules/skills/index.tsx](src/modules/skills/index.tsx) — 同上，带 `transformCreatePayload` 做 `serializeCreateSkillFiles`
- [src/App.tsx:24,30-37,78-85,196-210](src/App.tsx#L24-L210) — tabs / dialog state / 模块渲染全部按注册表驱动，见 §8.8

### 9.10 不要改动的地方（护栏）

- 磁盘格式：`meta.json / main.md / attachments.json / snapshot.json` schemaVersion 保持 1
- Git commit 消息格式：`[synapse] ${action} ${type} ${id.slice(0,8)}` 保持
- `pending-pushes.json` 格式不动
- `repository-cache.sqlite` 的列不动（`type` 列已经是字符串，新类型直接兼容）
- 现有 Rule/Skill 用户数据全部不动

---

## 10. 执行顺序（建议分 5 个提交，每个可独立验证）

### 提交 1：注册表 + 类型层（纯新增，不影响运行时）

- 新建 `src/config/content-types/*`
- `src/types/content.ts` 加泛型 alias
- `src/types/editor.ts` 加 `supportedContentTypes`，暂时和 `supportsRule/Skill` 并存
- 不修改任何 runtime 代码
- **验证**：`pnpm typecheck && pnpm build` 通过

### 提交 2：配置层迁移

- `SynapseRepositoryConfig.contentDirs` 新增
- `config.ts / config-backup-service.ts` 读写兼容
- `content-history-service.resolveContentRootPath` 改用 `getContentDir`
- `content-index-service` 反查逻辑改用注册表
- [src/modules/settings/components/repository-list-editor.tsx](src/modules/settings/components/repository-list-editor.tsx) 改为按注册表渲染目录编辑
- **验证**：启动 app，老用户的 `rulesDir/skillsDir` 能正确读出；新增仓库写入的是 `contentDirs`

### 提交 3：Service 层合并 + 后端通用化

- `content-service / content-submission-service / content-write-service / content-download-service / content-install-service` 按 §7 重写
- **关键顺序：先新增通用方法（`listContent / getContent / getDetail / getHistory / getHistoryVersion / createContent / updateContent / download`），旧的 `getRules / getSkills / createRule / ...` 保留为 thin alias 调新方法**。这样提交 3 结束后老的 IPC handler 仍能编译通过（它们调 alias），直到提交 4 把 handler 一起替换
- 编辑器 adapters 的 `supportedContentTypes` 替换完成；内部 `if` 改 `switch + default throw`（§7.6）
- 内部逻辑保持 case-by-case（download exporter、install kind）
- **验证**：对 rule 和 skill 分别执行创建、编辑、删除、下载、安装、复制；历史切换正常

### 提交 4：IPC / bridge 通道合并

- [electron/ipc/channels.ts](electron/ipc/channels.ts) / [electron/preload.ts](electron/preload.ts) / [src/types/bridge.ts](src/types/bridge.ts) / [electron/ipc/content-handlers.ts](electron/ipc/content-handlers.ts) / [src/app-shell/content.ts](src/app-shell/content.ts) 按 §6 改
- 所有旧 channel / 旧 bridge 方法一次性删除（不走兼容层）
- renderer 里对 `createRule` 等 alias 的调用保持（alias 内部调通用方法），等下一提交再清理
- **验证**：全量走一遍 rule 和 skill 流程，功能一致

### 提交 5：UI 层通用化 + 模块壳工厂

- [src/modules/content/components/content-action-split-button.tsx](src/modules/content/components/content-action-split-button.tsx) 改 §8.4
- [src/modules/content/components/content-install-dialog.tsx](src/modules/content/components/content-install-dialog.tsx) 改 §8.5
- [src/modules/content/components/content-browser-page.tsx](src/modules/content/components/content-browser-page.tsx) 改 §8.6
- 新建 `create-content-module.tsx`，`rules/index.tsx`、`skills/index.tsx` 缩水
- [src/App.tsx](src/App.tsx) 按注册表驱动 tabs 和 dialog state
- deprecated alias `createRule / createSkill / ...` 删除，替换为 `createContent("rule", payload)` 等调用
- **验证**：完整 e2e：创建 rule、编辑 rule、删除 rule；创建 skill（含附件）、编辑 skill、下载 skill zip、安装 skill 到 cursor；切换 tab；关闭修改目录名后重启正常

### 提交 6（可选）：新增 Prompt 类型验证扩展性

- 新建 `src/config/content-types/prompt.ts`（`categories: []` 表示暂无内置分类）
- `src/types/content.ts:1` 加 `| "prompt"` —— TS 会立即在 `CONTENT_TYPE_REGISTRY` 的 `satisfies` 处报错，迫使你补齐
- 在 `CONTENT_TYPE_REGISTRY` 里加 `prompt: promptContentTypeDefinition`
- 新建 `src/modules/prompts/components/prompt-create-dialog.tsx`、`prompt-detail-dialog.tsx`（参考 rule-* 复制改名）
- 新建 `src/modules/prompts/index.tsx`（3 行 `createContentModule`）
- `src/App.tsx` 的 `CONTENT_MODULE_COMPONENTS` 加 `prompt: PromptsModule` —— 这里也是 `Record<SynapseContentType, ...>` 类型，TS 同样会强制补齐
- 这一步**不改动任何通用层（lib/hooks/components/services/ipc）**。如果需要改说明前 5 个提交没做到位
- **验证**：App 出现 "Prompts" tab，能创建、下载、复制；没有"安装到 XX"菜单；历史、分类、搜索、Git 同步都正常

---

## 11. 风险与回避

| 风险 | 描述 | 缓解 |
|---|---|---|
| 配置迁移丢失 | 老用户 `rulesDir` 被清掉 | 读取时先查 `contentDirs`，再回落 legacy key，最后再默认值；单测覆盖三种输入 |
| Discriminated union 类型收窄失败 | `SynapseCreateContentRequest` 作为 IPC 参数传递时 TS 可能无法自动收窄 | 用 `switch (req.contentType)` 显式 narrow；必要时在 handler 里加 `asserts` |
| **Payload 运行时缺字段**（复盘补） | IPC 绕过 TS 保护：renderer 传过来一个 `{ contentType: "skill", payload: { ...无 files } }`，后端直接读 `payload.files.length` 崩溃 | `content-write-service.createContent` 首行按 `def.requiresFilesInPayload` 做运行时校验：缺则抛 `${singularLabel} 创建必须带 files 字段`。防守在服务边界，不污染业务逻辑 |
| SQLite 列 schema | 现在 `type` 列只接 `"rule"/"skill"`，新增 prompt 会写 `"prompt"` | 列本身是 TEXT，不需要改 schema；但 [content-index-service.ts:40](electron/services/content-index-service.ts#L40) 的字面量守卫要改成动态注册表查询（`!getAllContentTypeIds().includes(row.type)`），否则 prompt 行会被过滤掉 |
| editor adapter 漏注册 | 新类型没在任何 adapter 支持 | `resolveEditorInstallTarget` 看 `supportedContentTypes` 决定是否抛 "unsupported"，对 prompt 本来就不展示安装菜单所以不会调用 |
| **adapter 内部类型分支漏 default**（复盘补） | 老代码 `if (contentType === "rule") A; else B;` 把非 rule 的情况全当 skill 处理 | §7.6 全量改为 `switch + default throw`。default 抛错让错误"早失败、显式失败"，防止 prompt 走进 skill 分支污染文件系统 |
| dialog state 爆炸 | App.tsx 里手动维护 6 个 state，改成 map 后访问路径变长 | `setContentDialogOpen(type, kind, open)` 三元 helper（§8.8 已给出完整实现） |
| 向后兼容 alias 残留 | 一轮改完后 `createRule / readRules / ...` 还是有人调 | 提交 5 的 verify 里加 grep `grep -rn "createRule\\|readRules\\|createSkill\\|readSkills" src/` 应为 0（除了 `app-shell/content.ts` 的 alias 定义本身） |
| 新类型的分类为空 | `definition.categories` 是 `[]`，UI 侧栏只有"全部" | 允许，不是 bug |
| **Config 备份导出格式**（复盘补） | 备份文件 schema 该不该继续写 `rulesDir / skillsDir`？ | **不写**。导出当前版本的 config 原样（只含 `contentDirs`）。如果用户用老版本 app 导入新备份会读不懂 legacy fallback —— 这是可接受的版本升级断点。在 `config-backup-service.ts` 的导出路径里要显式 omit 掉 `rulesDir / skillsDir` 字段，避免某些"老字段残留在对象里"的情况误导调试 |

---

## 12. 验证清单（每个提交都要跑一遍）

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm build`（Electron 主进程 + renderer）通过
- [ ] 启动 app，激活一个已有仓库，能看到 Rules 列表（不空）
- [ ] 创建一个新 Rule，保存成功，出现在列表里
- [ ] 编辑 Rule，历史版本增加
- [ ] 下载 Rule，得到 `.md` 文件，内容正确
- [ ] 安装 Rule 到 Cursor/Codex/Claude-Code，文件被写入
- [ ] 复制 Rule 正文到剪贴板
- [ ] Skills 列表正常
- [ ] 创建 Skill（上传一个附件），保存成功，能看到附件计数
- [ ] 下载 Skill，得到 `.zip`，解压能看到 `main.md` 和附件
- [ ] 安装 Skill 到 Cursor，覆盖确认弹出，继续安装后目录被替换
- [ ] 冲突检测：两个窗口/进程同时编辑同一条，后者收到 conflict 提示
- [ ] 删除一个 Rule/Skill，列表刷新，历史里标记 deleted
- [ ] 分类侧栏切换、搜索、"未识别分类" fallback 正常
- [ ] Settings 里修改仓库目录名，保存后重启能正确读到新目录
- [ ] Pending push → 后台 push → UI 状态更新
- [ ] Config 备份导出/导入往返通过
- [ ] 提交 6 完成后：Prompts tab 出现；创建、下载、复制、历史、分类、同步全部正常；按钮菜单里**没有"安装到 XX"**

---

## 13. 一张图看完整改动

```
┌──────────────────────────────────────────────────────────────────────┐
│                    CONTENT TYPE REGISTRY (新增)                      │
│  src/config/content-types/{rule.ts,skill.ts,types.ts,index.ts}       │
│  - capabilities (hasAttachments, canInstall, canCopy, canDownload)   │
│  - download (extension, exporter: "text-file" | "zip-archive")       │
│  - install  (kind: "none" | "single-file" | "directory-overwrite")   │
│  - repositoryDir (defaultDirectoryName, legacyConfigKey)             │
└───────────┬──────────────────────────────────────────────────────────┘
            │ 被以下模块消费
┌───────────┴─────────┬────────────┬────────────┬────────────┬─────────┐
│                     │            │            │            │         │
▼                     ▼            ▼            ▼            ▼         ▼
Config 层         IPC channels   Service 层   UI 按钮      模块壳     App tabs
- contentDirs     - 9 个通用通道  - 单入口方法  - 按能力渲染  - 工厂    - 循环注册
- 兼容旧字段       - 通用 bridge   - 按策略分发   - 隐藏 N/A   - 10 行    表生成
                                                              一个      tabs
```

这张图就是最终形态。改造完之后：**新增 Prompt = 1 个 definition 文件 + 1 个 type 字符串扩展 + 2 个 dialog 组件（复制 Rule 的改名）+ 1 个模块壳（3 行）= 约 4 文件、~150 行代码**。目前改造完第 5 个提交后再做 Prompt，实际工作量 < 1 小时。

---

## 14. 关键决策备忘

1. **为什么不把 Create/Update 也做成注册表**（例如注册一个 `buildPayload(input)` 函数）？
   答：Payload 字段差异来自业务（skill 的 files 是真实不同），让每个模块自己定义 create-dialog 更自然；通用层用 `transformCreatePayload` hook 已足够。

2. **为什么 install 策略保留 case-by-case 而不是注册 `installer` 函数**？
   答：install 的策略数量有限（目前只有两种），case 可枚举；注册函数会让实现分散在多处，排查更难。如果未来出现第 4、5 种策略再抽 installer 接口不迟。

3. **为什么允许 `categoryRegistry` 里 prompt 缺席**？
   答：不是所有内容类型都需要分类；空数组 fallback 让"先有内容类型再补分类"成为合法中间状态，降低扩展成本。

4. **为什么 download 和 install 的策略名要显式枚举而不是字符串任意值**？
   答：这是 discriminated union 的语义信号，TS 会在 switch 里提醒遗漏 case；换成任意字符串就失去了这个保护。

---

## 15. 复盘修订记录

写完初稿后做了一轮自审，从"严谨性 / 复用性 / 组织性 / 未来扩展 / 引发现有 bug"五个维度逐条检查，发现并**已在正文中直接修正**以下 8 处。列出来便于执行 AI 理解"为什么这些地方特别强调"。

| # | 维度 | 原稿问题 | 修订 | 正文位置 |
|---|---|---|---|---|
| 1 | 严谨性 | `CONTENT_TYPE_REGISTRY` 用 `Object.fromEntries` 构造，返回类型其实是 `Record<string, ...>`，新增 `SynapseContentType` 不会被 TS 强制要求补齐 | 改为对象字面量 + `satisfies Record<SynapseContentType, ContentTypeDefinition>`。新增 type 时漏补会立即 TS 报错 | §3.4 |
| 2 | 严谨性 | editor adapter 内部 `if (contentType === "rule") A; else B;` 把所有非 rule 情况当 skill 处理，是隐藏 bug 而非风格问题 | 强制改为 `switch + default throw`。任何未声明支持的类型都会早期失败 | §7.6、§11 新增风险行 |
| 3 | 严谨性 | 没有对"payload 缺 files 字段"的运行时防御 —— 如果 renderer 绕过 TS 直接 IPC 送一个不合规的 payload，后端会崩 | `content-write-service.createContent` 开头按 `def.requiresFilesInPayload` 做运行时校验 | §11 新增风险行 |
| 4 | 复用性 | `src/modules/rules/types.ts` 的 `CreateRulePayload` 是和 `SynapseCreateRulePayload` 的完全重复，原稿漏了清理；`src/modules/skills/types.ts` 的 `CreateSkillFilePayload` 虽然和 IPC 版本有差异（包含 `File` 对象）但名字完全一样，很容易用混 | 删掉 rules 模块的 `CreateRulePayload`；把 skills 模块的本地 `CreateSkillFilePayload` 重命名为 `SkillCreateFilePayloadDraft`，用名字强制区分"草稿版"和"IPC 版" | §4.2、§9.2 |
| 5 | 复用性 | `ContentBrowserPage` 的 `title` prop 和 `contentType` 同时传，实际上 title 能从 registry 的 `pluralLabel` 派生，多一个参数就多一处漂移风险 | 删 title prop，组件内部自己查 registry | §8.6、§8.7、§9.8 |
| 6 | 组织性 | 一个内容类型的"定义"和它的"分类列表"分别放在 `src/config/content-types/rule.ts` 和 `src/config/categories/rules.ts`，新增类型要动两个目录 | `ContentTypeDefinition` 里新增 `categories: readonly SynapseCategoryDefinition[]` 字段，让 definition 持有 categories 引用。`getBuiltInCategories` 从 registry 读，分类文件本身保留但只被 definition import | §3.2、§3.3、§9.7 |
| 7 | 组织性 | `installRequiresOverwriteConfirm: boolean` 和文案 `"Skill 安装会整体替换..."` 是耦合的，放在 capabilities 里会让 `kind: "none"` / `"single-file"` 的类型上也挂一个"永远是 false"的字段 | 把这两个信息合并进 `install: { kind: "directory-overwrite", confirmMessage: string }`。TS 收窄在 `kind === "directory-overwrite"` 分支里时 confirmMessage 必有；其他 kind 不能访问 | §3.2、§3.3、§8.5 |
| 8 | 未来扩展 / 隐藏 bug | 原稿的 §8.8 App.tsx 只用一句话说"用 helper 函数封装"，没给具体实现；另一个 AI 拿到方案容易自己猜 setter 形状，出现 `setDialogStates(s => ({ ...s, rule: { ...s.rule, create: true } }))` 这类散落调用 | 给出完整的 `setContentDialogOpen(type, kind, open)` 三元 helper 代码、`ContentDialogStateMap` 类型、`createEmptyDialogStateMap()` 初始化函数、以及 `CONTENT_MODULE_COMPONENTS` 静态查找表 | §8.8 |

### 复盘后保留不改的决定（即方案是对的，但是容易被问）

- **保留 `SynapseCreateRulePayload / SynapseRuleMeta / ...` alias 不删**：外部调用点太多，一次性替换成 `SynapseCreateContentPayload<"rule">` 会让 diff 爆炸，且没有语义收益。alias 永久保留即可。
- **模块壳工厂不接管 CreateDialog / DetailDialog 的具体实现**：rule-create-dialog.tsx 和 skill-create-dialog.tsx 内部是真·类型特有的 UI（skill 有附件上传器），强行抽象只会引入空壳的插槽参数。当前"工厂提供通用 pipe，模块提供类型特有的两个 dialog"的切分是最干净的。
- **editor-adapter 内部分支不抽注册表**：每个编辑器对每种 type 的物理落点（文件 vs 目录、具体路径）是真正的编辑器特定知识，抽成"路径策略注册表"会把信息分散到两处。保持 switch+default 足够。
- **`SynapseContentType` 继续用字面量 union** 而不是用 `string`：虽然字面量会在新增类型时要求补齐代码，但这正是好事——它把"应该但尚未"的遗漏从运行时转移到编译时。

### 结论

修订后的方案在以下几点上更强：

1. **TS 强制性**：新增类型时，registry、`CONTENT_MODULE_COMPONENTS`、`SynapseContentType` 三处若有不同步，TS 必然报错。不可能 silent break。
2. **默认安全**：`switch + default throw` 替代 `if/else` 把"未覆盖类型"从隐藏 bug 变成显式错误。
3. **组织紧凑**：一个类型的定义、分类、install 文案、导出策略、默认目录全部集中在 `src/config/content-types/{type}.ts`。
4. **运行时护栏**：服务边界对 payload 做 `requiresFilesInPayload` 校验，不信任 IPC 输入。
5. **文档可执行**：App.tsx 的 helper、注册表字面量、adapter switch 等都给出了完整 TS 代码，不是"意会"的描述。

**方案（修订版）完。**

---

## 16. 第二轮核查：基于真实代码的补丁

本章节是"再基于真实代码复盘一遍"的产出。前文经过第一轮复盘已经修正，但**执行 checklist** 和**风险表**还有遗漏。这里把 6 处补丁集中列出，每条精确到文件+行号，执行 AI 读完 §1-§15 后再把以下补丁合并进去。

### 16.1 漏列文件：详情对话框里的 legacy API 调用

第一轮复盘没有把 rule/skill 详情对话框放进改造清单，但它们直接调了 4 个 legacy API（实测 grep 命中）：

**[src/modules/rules/components/rule-detail-dialog.tsx](src/modules/rules/components/rule-detail-dialog.tsx)**
- 第 11-14 行：`readRuleDetail / readRuleHistory / readRuleHistoryVersion / updateRule` 的 import
- 第 180-181 行：`readRuleDetail(item.id), readRuleHistory(item.id)`
- 第 184 行：`if (nextDetail.type !== "rule")` 守卫（改造后依然需要，但可以用 `item.type` 常量而非字面量）
- 第 249 行：`readRuleHistoryVersion(item.id, selectedHistoryDirname)`
- 第 251 行：`if (nextVersion.type !== "rule")` 同上
- 第 300 行：`getCategoryLabel("rule", resolvedItem.category)` —— `"rule"` 改成 `item.type`
- 第 322 行：`updateRule({ ... })`

**[src/modules/skills/components/skill-detail-dialog.tsx](src/modules/skills/components/skill-detail-dialog.tsx)** 同构改动：第 11-14、206-207、210、275、277、326、348 行。

**处置**：所有对 `readRuleDetail / readSkillDetail` 等调用，替换为通用 API，如：
```ts
// 改前
import { readRuleDetail, readRuleHistory, readRuleHistoryVersion, updateRule } from "@/app-shell/content"
readRuleDetail(item.id)
readRuleHistory(item.id)
readRuleHistoryVersion(item.id, dirname)
updateRule(payload)

// 改后
import { readDetail, readHistory, readHistoryVersion, updateContent } from "@/app-shell/content"
readDetail("rule", item.id)
readHistory("rule", item.id)
readHistoryVersion("rule", item.id, dirname)
updateContent("rule", payload)
```

skill-detail-dialog 同理（把 "rule" 换成 "skill"）。

**加到 §9.9 的改动清单**：
- [src/modules/rules/components/rule-detail-dialog.tsx](src/modules/rules/components/rule-detail-dialog.tsx) — 4 个 API 调用、2 个类型守卫、1 个 `getCategoryLabel` 改为通用 API + `item.type`
- [src/modules/skills/components/skill-detail-dialog.tsx](src/modules/skills/components/skill-detail-dialog.tsx) — 同上

### 16.2 install-dialog 硬编码文案比方案列的多

方案 §8.5 只指出了一处 "Skill 安装会整体替换..."，**真实代码有 2 处 + 1 处隐含**：

| 行 | 原文 | 改造 |
|---|---|---|
| [327](src/modules/content/components/content-install-dialog.tsx#L327) | `"Skill 安装会整体替换目标目录中的现有内容。"` | `def.install.kind === "directory-overwrite" ? def.install.confirmMessage : ""`（这是覆盖确认 AlertDialog 里的） |
| [440](src/modules/content/components/content-install-dialog.tsx#L440) | `{activeTarget.targetKind === "file" ? "将写入单个文件。" : "将写入技能目录。"}` | `"将写入技能目录"` 把 "技能" 写死了，改成 `def.install.kind === "directory-overwrite" ? \`将写入 ${def.singularLabel} 目录。\` : "将写入单个文件。"` |
| [455](src/modules/content/components/content-install-dialog.tsx#L455) | `"安装 Skill 时会整体替换目标目录中的现有内容。"` | 同 327，改为 `def.install.confirmMessage`。注意**此处和 327 文案不一致**（一处是 "Skill 安装会整体...", 一处是 "安装 Skill 时会..."），说明原本就有轻微文案漂移；收敛到 registry 后自然统一 |

还有一处不是硬编码但需要确认：[440 行](src/modules/content/components/content-install-dialog.tsx#L440) 的 "将写入技能目录" 用到了 skill 语义。由于 prompt 的 `install.kind === "none"`，它根本不会打开这个对话框，所以 UI 现象不会出错；但代码里留着 "技能" 二字会让下一个看代码的人误会。统一收敛到 registry 是干净做法。

### 16.3 Service 层错误文案还有 4 处

方案 §7.1 说了 `content-service.ts:60` 的错误文案，但漏了：

- [electron/services/content-write-service.ts:316](electron/services/content-write-service.ts#L316) — `contentType === "rule" ? "找不到对应的 Rule 内容。" : "找不到对应的 Skill 内容。"`
- [electron/services/content-write-service.ts:440](electron/services/content-write-service.ts#L440) — 同上
- [electron/services/content-submission-service.ts:369](electron/services/content-submission-service.ts#L369) — 同上
- [electron/services/content-submission-service.ts:409](electron/services/content-submission-service.ts#L409) — `payload.type === "rule" ? ... : ...`（这里用 `payload.type` 而非 `contentType`，但本质一样）

**全部统一改为**：
```ts
throw new Error(`找不到对应的 ${getContentTypeDefinition(contentType).singularLabel} 内容。`)
```

**加到 §9.6 的改动清单**（用替换全局的方式表达更简洁）：
- 所有 service 文件里 `contentType === "rule" ? "找不到对应的 Rule 内容。" : "找不到对应的 Skill 内容。"` 模板，统一替换为基于 `getContentTypeDefinition(contentType).singularLabel` 的插值字符串

### 16.4 `content-index-service.ts:130` 的现有 bug（重构会顺手修）

[electron/services/content-index-service.ts:130](electron/services/content-index-service.ts#L130) 当前代码：
```ts
if ((directoryName !== "rules" && directoryName !== "skills") || !contentId) {
  continue
}
const contentType = directoryName === "rules" ? "rule" : "skill"
```

这段代码读的是 `git diff` 输出的**路径段**，逻辑假设目录名就是字面量 `"rules" / "skills"`。**如果用户自定义了 `rulesDir = "my-rules"`，这段代码会漏识别所有该类型的变更，索引不再同步**。属于现有 bug。

重构时用**基于 `repository.contentDirs` 的动态匹配**代替：

```ts
function resolveContentTypeByDirectoryName(
  repository: SynapseRepositoryConfig,
  directoryName: string,
): SynapseContentType | null {
  for (const id of getAllContentTypeIds()) {
    if (getContentDir(repository, id) === directoryName) return id
  }
  return null
}

// 替换：
const contentType = resolveContentTypeByDirectoryName(repository, directoryName)
if (!contentType || !contentId) continue
```

**加到 §11 风险表**：
> **既有 bug 顺带修复** — content-index-service.ts:130 硬编码 "rules"/"skills" 目录名比较，用户自定义目录名会让增量索引失效。重构用 registry 查表后自动修复；需要测试时覆盖"自定义 rulesDir"场景。

### 16.5 `app-shell/content.ts` alias 的重写量

方案 §6.4 说"保留薄的向后兼容 wrapper"，但真实代码里 [src/app-shell/content.ts:38-212](src/app-shell/content.ts#L38-L212) 每个函数是**独立的完整 wrapper**（各自做 bridge 检查、throw 处理），不是简单 forward。重构后这些 alias 需要改成 forward 调用：

```ts
// 改前（现状）
function createRule(payload: SynapseCreateRulePayload): Promise<SynapseContentMutationResult> {
  const bridge = getContentBridge()
  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  }
  return bridge.createRule(payload)
}

// 改后（通用方法承载所有 bridge 检查）
function createContent<T extends SynapseContentType>(
  contentType: T,
  payload: SynapseCreateContentPayload<T>,
): Promise<SynapseContentMutationResult> {
  const bridge = getContentBridge()
  if (!bridge) return Promise.reject(createMissingBridgeError(DEFAULT_CONTENT_BRIDGE_ERROR_MESSAGE))
  return bridge.createContent({ contentType, payload } as SynapseCreateContentRequest)
}

// alias 变薄
const createRule = (p: SynapseCreateRulePayload) => createContent("rule", p)
const createSkill = (p: SynapseCreateSkillPayload) => createContent("skill", p)
```

这一改让 alias 从"14 个独立实现"变成"14 个一行 forward"。方案 §10 提交 5 的 verify "grep createRule 应为 0"是对的，但前提是这些 alias 先变薄 — **建议提交 4 就同步做这件事**，否则提交 4 完成时文件会混杂两种风格的 wrapper。

**修订 §10 提交 4 结尾**：新增一条 "把 [src/app-shell/content.ts](src/app-shell/content.ts) 里的 14 个 legacy 函数从独立实现改成 forward 到通用方法"。

### 16.6 `handleValidatedIpc` 的作用范围澄清

方案 §11 提到"payload 运行时缺字段"风险，但没明说**为什么**必须在 service 层守。真实原因：[electron/ipc/validated-ipc.ts:36-44](electron/ipc/validated-ipc.ts#L36) 的 `assertTrustedIpcSender` **只校验发送者来源**（判断是不是自家 renderer 而非被注入的第三方页面），**完全不校验 args 的 schema**。`ipcMain.handle(channel, (event, ...args) => handler(event, ...(args as Args)))` 这里 `as Args` 是裸强制转换。

**加到 §11 风险表**（强化表述）：
> `handleValidatedIpc` 的 "validated" 仅指发送端受信，不校验 payload schema。因此 `content-write-service.createContent` 必须自己做 `requiresFilesInPayload` 运行时 assert。这是方案把运行时守门放在 service 层（而非 IPC 层）的**硬性原因**，不可省略。

### 16.7 最终 Grep 验收门槛（重构完成后必须为这些结果）

```bash
# 1. UI 组件不应再三元判断内容类型
grep -rn '"rule"\|"skill"' src/modules/content/ | grep -v '// OK:' 
# 期望：0 命中（除了明确标注 OK 的静态默认值）

# 2. renderer 不应再调 legacy per-type API
grep -rn 'readRuleDetail\|readSkillDetail\|createRule(\|createSkill(\|updateRule(\|updateSkill(\|downloadRule(\|downloadSkill(' src/ | grep -v 'app-shell/content.ts'
# 期望：0 命中（alias 定义和 alias 的 forward body 除外）

# 3. 后端服务方法不应再有 per-type public 接口
grep -n 'getRules\|getSkills\|getRuleDetail\|getSkillDetail' electron/services/content-service.ts
# 期望：0 命中（或仅 private alias，用完即删）

# 4. 错误文案不应再有硬编码 "Rule/Skill"
grep -rn '找不到对应的 Rule\|找不到对应的 Skill' electron/ src/
# 期望：0 命中

# 5. IPC 通道定义应只剩 9 条 content 通道
grep -c '"synapse:content:' electron/ipc/channels.ts
# 期望：9 行

# 6. Registry 是唯一真相来源
grep -rn 'CONTENT_TYPE_REGISTRY\|getContentTypeDefinition\|getAllContentTypeIds' src/ electron/ | wc -l
# 期望：显著 >0（证明通用层的确在读 registry）
```

把这 6 条加到 §12 验证清单末尾，作为"结构性验收门槛"（区别于功能性验收）。

### 16.8 风险表最终追加项

除了正文 §11 已有 9 条 + 第一轮复盘追加 3 条，第二轮再追加：

| 风险 | 描述 | 缓解 |
|---|---|---|
| 详情对话框内部 type 字面量守卫 | `if (nextDetail.type !== "rule") throw ...` 在 rule-detail-dialog 和 skill-detail-dialog 各有 2 处，重构时容易漏 | 改造 §16.1 的同时把字面量改成 `item.type` 常量；这样未来换成更通用的 DetailDialog 时守卫自然跟着走 |
| 既有 bug 被无声修复 | content-index-service.ts:130 的硬编码目录名比较 | §16.4；测试清单加"自定义 rulesDir=my-rules"场景 |
| Alias 重写混杂风格 | 如果 alias 在提交 4、5 分两次重写，中途的 `app-shell/content.ts` 会一半独立实现一半 forward，让 code review 困难 | §16.5；提交 4 一次性把 alias 全部变薄 |
| `handleValidatedIpc` 被误以为做 schema 校验 | 开发者可能以为既然叫 validated 就不需要在 service 层再验一遍 payload | §16.6；方案显式说明"validated = sender validated，not payload validated" |

---

## 17. 本次复盘的结论

方案的**架构方向**（注册表 + 能力位 + 策略模式 + 模块壳工厂）没有需要推翻的地方。两轮复盘发现的问题全部是 **执行清单的完整性 / 隐藏 bug / 文档表述精度** 层面，不触及设计本身。

按照 §1-§17 全量执行后：

- **新增 prompt 预计改动**：3 个新文件（definition + 2 个 dialog）+ 3 个注册表补齐（`SynapseContentType` / `CONTENT_TYPE_REGISTRY` / `CONTENT_MODULE_COMPONENTS`）= **6 个地方，TS 会强制提示全部补齐，漏一处就编译失败**。
- **既有功能行为**：零变化。Rule 和 Skill 的所有差异（附件、zip 打包、目录覆写确认、编辑器 install 路径）通过注册表的 `capabilities / download.exporter / install.kind / install.confirmMessage` 全部保留。
- **隐藏 bug 修复**：顺手修掉 content-index-service 的硬编码目录名（§16.4）。
- **代码组织**：每个内容类型集中在 `src/config/content-types/{type}.ts` + `src/modules/{type}/*`，同类聚合；通用层完全不依赖字面量类型名。

**方案（第二轮复盘版）完。**
