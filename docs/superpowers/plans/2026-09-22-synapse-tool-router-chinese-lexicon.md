# Synapse MCP 检索中文词表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `synapse-tool-router` 的 `search` 能用中文自然语言命中正确的 `app_*` 工具，且不回归英文。

**Architecture:** 新增一个不依赖 Agent SDK 的中文词表模块，把中文查询展开成工具名里**真实出现的英文段**，交给现有 Fuse + `lexicalRelevance` 排序管线。不改排序权重、不改 `threshold`、不做中文分词。配套三道门禁（中文语料、名段覆盖、工具可达性）防止词表随工具增长而腐烂。

**Tech Stack:** TypeScript、Vitest、Fuse.js（既有）、Zod（既有）。

**Spec:** `docs/superpowers/specs/2026-09-22-synapse-tool-router-chinese-search-lexicon-design.md`

## Global Constraints

- 词表条目的 `term` 长度 **≥2 字**。
- 词表条目的 `token` **必须是工具名里真实出现的段**：243 个工具名去掉 `app_` 前缀后按 `_` 切分，共 165 个不同段。
- 不改 `threshold`（现值 `0.42`）、不改排序权重、不改 `lexicalRelevance`、不改 `mergeFuseResults`、不改分词器 `tokenizeSearchText`、不改 `DOMAIN_ALIASES`。
- OOV 中文继续返回空集，不做兜底。
- 测试只用根命令 `pnpm --filter @synapse/desktop run ...` 或 `npx vitest run`，不启动应用。
- 提交信息用中文说明目的，结尾附 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 不提交任何处于红状态的测试。

## 实测基线（实现前已确认，用于对照）

- 中文 49 条语料：命中 2 / 返回空集 37 / 命中错工具 10。
- 英文 20 组 token 集合 + 9 组英文说法：**全部命中，且全部第 1 名**。
- 名段分布：165 个不同段；出现在 ≥2 个工具里的 **95** 个；只出现 1 次的 70 个。

## File Structure

| 文件 | 职责 |
|---|---|
| `desktop/electron/services/agent-runtime/synapse-tool-router-lexicon.ts`（新建） | 中文词表数据 + `lexiconTokens()` 纯函数 + 豁免段清单。不依赖 Agent SDK。 |
| `desktop/electron/services/agent-runtime/synapse-tool-router.ts`（改） | 删除 `SEARCH_QUERY_ALIASES` 与私有 `queryAliasTokens`，调用点改用 `lexiconTokens`。 |
| `desktop/tests/unit/synapse-tool-router-search.test.ts`（改） | 中文语料、英文对照组、门禁 2、门禁 3。 |
| `RELEASE_NOTES_PENDING.md`（改） | 用户可感知的能力修复记录。 |
| `docs/superpowers/specs/2026-08-25-agent-synapse-mcp-tool-router-design.md`（改） | 加 supersede 说明。 |

---

### Task 1: 英文对照组基线

先建立安全网：英文检索当前是好的，把它固定成断言，后续任务若破坏英文会立刻红。

**Files:**
- Modify: `desktop/tests/unit/synapse-tool-router-search.test.ts`（在既有 49 条中文语料之后追加）

**Interfaces:**
- Consumes: `searchSynapseTools({ query, limit })`（已存在，从 `../../electron/services/agent-runtime/synapse-tool-router` 导入）
- Produces: `ENGLISH_CORPUS` 常量，供 Task 4 复用

- [ ] **Step 1: 写入英文对照组测试**

在 `desktop/tests/unit/synapse-tool-router-search.test.ts` 中，`INTENT_CORPUS` 之后追加：

```ts
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
```

在同一文件的 `describe("synapse tool router search", ...)` 内追加一条测试：

```ts
  it("keeps the english control group within the top-5 results", async () => {
    const misses: string[] = []

    for (const { intent, expect: expected } of ENGLISH_CORPUS) {
      const names = await topToolNames(intent)
      if (!names.includes(expected)) {
        misses.push(`「${intent}」期望 ${expected}，实际 top-5：${names.join("、") || "(空)"}`)
      }
    }

    expect(misses).toEqual([])
  })
```

- [ ] **Step 2: 运行，确认全绿**

Run: `cd desktop && npx vitest run tests/unit/synapse-tool-router-search.test.ts`
Expected: 英文对照组 PASS（29 条全中）。中文语料那条仍 FAIL —— 这是预期的，Task 2 修。

- [ ] **Step 3: 提交**

```bash
git add desktop/tests/unit/synapse-tool-router-search.test.ts
git commit -m "test: 固定英文检索对照组作为中文词表改造的安全网

英文检索当前 29 条全部命中且均排第 1 名，先把它固化成断言，
后续引入中文词表展开时若破坏英文会立即变红。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 词表模块 + 接入 router，中文语料转绿

这是本次的主要工作。词表内容用门禁驱动迭代，而不是一次写完。

**Files:**
- Create: `desktop/electron/services/agent-runtime/synapse-tool-router-lexicon.ts`
- Modify: `desktop/electron/services/agent-runtime/synapse-tool-router.ts`（删除 48-56 行 `SEARCH_QUERY_ALIASES`；删除 410-415 行 `queryAliasTokens`；修改第 321 行调用点；新增 import）

**Interfaces:**
- Produces:
  - `LEXICON: readonly (readonly [term: string, token: string])[]`
  - `EXEMPT_SEGMENTS: Readonly<Record<string, string>>`（段 → 豁免理由）
  - `lexiconTokens(query: string): string[]` —— 返回去重后的英文 token，顺序按 `LEXICON` 表内出现顺序。返回**可变** `string[]`，与它取代的 `queryAliasTokens` 签名一致，避免调用点出现类型错误。
- Consumes: 无（本模块不导入任何业务模块）

- [ ] **Step 1: 建立模块骨架**

创建 `desktop/electron/services/agent-runtime/synapse-tool-router-lexicon.ts`：

```ts
/**
 * MCP search 的中文词表。
 *
 * search 的索引是工具名与英文描述，中文查询与它没有词面交集，所以必须有一层
 * 「中文词 → 工具名里真实出现的英文段」的桥。本模块只做这件事：把查询串里
 * 命中的中文词展开成英文 token，交给既有的 Fuse + lexicalRelevance 排序管线。
 *
 * 两条硬约束（由 synapse-tool-router-search.test.ts 的门禁强制）：
 * 1. `term` 长度 >= 2 字。单字条目（如「表」）会命中「报表」这类复合词引入假阳性。
 * 2. `token` 必须是工具名里真实出现的段。发出的 token 若不在任何 `name` 里，
 *    就匹配不到 `name` 字段，展开等于无效。
 */

/** 出现在多个工具名里、但没有语义、不值得配中文词的粘合段。每条必须给理由。 */
export const EXEMPT_SEGMENTS: Readonly<Record<string, string>> = {
  to: "extract_to_file 的结构助词，语义由 extract 与 file 承载",
  set: "set_visibility 的动词，语义由 visibility 承载",
  used: "used_model 的修饰词，语义由 model 承载",
}

/**
 * 中文词 -> 工具名段。同义词各占一行，后者与前者映射到同一个 token。
 * 条目顺序决定 lexiconTokens 的输出顺序，排定后不要随手重排（顺序会影响
 * mergeFuseResults 的输入次序与 uniqueQueryTokens 的首次出现次序）。
 */
export const LEXICON: readonly (readonly [term: string, token: string])[] = [
  // --- 动词 ---
  ["列表", "list"],
  ["列出", "list"],
  ["清单", "list"],
  ["查询", "get"],
  ["读取", "get"],
  ["新建", "create"],
  ["创建", "create"],
  ["新增", "create"],
  ["更新", "update"],
  ["修改", "update"],
  ["删除", "delete"],
  ["移除", "remove"],
  // --- 名词：drive ---
  ["云盘", "drive"],
  ["网盘", "drive"],
  ["文件", "item"],
  ["文件夹", "folder"],
  ["目录", "folder"],
  // --- 名词：terminal（Task 2 先覆盖语料所需，Task 3 补全） ---
  ["终端", "terminal"],
  ["会话", "session"],
  ["标签", "workspace"],
]

export function lexiconTokens(query: string): string[] {
  const normalized = query.toLowerCase()
  const tokens: string[] = []
  for (const [term, token] of LEXICON) {
    if (normalized.includes(term) && !tokens.includes(token)) tokens.push(token)
  }
  return tokens
}
```

- [ ] **Step 2: 接入 router**

> **定位方式：按内容查找，不要按行号。** 本步骤要删一个常量、删一个函数、改一处调用点，都在同一个文件里；删掉前面的内容后，后面的行号会整体位移。下面的行号只是执行前的初始位置，供你第一次定位用。

在 `desktop/electron/services/agent-runtime/synapse-tool-router.ts` 中：

(a) 在既有 import 之后（第 15 行 `import type { McpToolDefinition } ...` 下方）新增：

```ts
import { lexiconTokens } from "./synapse-tool-router-lexicon"
```

(b) 删除第 48-56 行的整个 `SEARCH_QUERY_ALIASES` 常量。

(c) 删除第 410-415 行的整个 `queryAliasTokens` 函数。

(d) 把第 321 行的调用点 `const aliasTokens = queryAliasTokens(query)` 改为：

```ts
  const aliasTokens = lexiconTokens(query)
```

(e) 第 320-326 行 `queryTokens` 的构造逻辑**保持原样不动**（含「别名命中时丢弃中文 token」那条过滤）。丢弃整串中文 token 是净收益：那些整串本就是垃圾 token，留着只会稀释 `lexicalRelevance` 的分母。

- [ ] **Step 3: 运行中文语料，看缺口**

Run: `cd desktop && npx vitest run tests/unit/synapse-tool-router-search.test.ts`
Expected: 英文对照组仍全绿；中文语料从「47 条失败」改善，但仍有失败 —— 失败信息会逐条列出「期望 X，实际 top-5：…」。

- [ ] **Step 4: 按缺口补词表，直到中文语料全绿**

对每一条失败信息，把缺失的中文词加进 `LEXICON`（遵守两条硬约束）。重复运行 Step 3，直到：

Run: `cd desktop && npx vitest run tests/unit/synapse-tool-router-search.test.ts`
Expected: 中文语料 49 条**全部命中，不留豁免名单**；英文对照组 29 条全绿。

若某条始终无法命中，先尝试给它补更具体的名词或动词；确实无解则**停下来报告**，不要把它从语料里删掉。

- [ ] **Step 5: 确认没有破坏既有的能力表面测试**

Run: `cd desktop && npx vitest run tests/unit/api-mcp-capability-surface.test.ts`
Expected: PASS，243 个工具与 2 个公开工具表面未变。

- [ ] **Step 6: 提交**

```bash
git add desktop/electron/services/agent-runtime/synapse-tool-router-lexicon.ts \
        desktop/electron/services/agent-runtime/synapse-tool-router.ts \
        desktop/tests/unit/synapse-tool-router-search.test.ts
git commit -m "fix: 中文自然语言能检索到 Synapse MCP 工具

search 的 instructions 承诺支持中文，但实测 49 条真实中文说法只有 2 条命中、
37 条返回空集。根因是「中文 -> 英文 token」这座桥几乎不存在：分词器把中文
整串当成一个 token；中文别名挂在 domain 字段上被 app domain 79 个工具平分，
无法在域内区分（app_terminal_* 49 个工具在中文下从未出现）；别名命中时丢弃
全部中文 token，导致「终端列表」只剩 [list] 而捞出跨域工具。

新增中文词表模块，把中文查询展开成工具名里真实出现的英文段，交给既有排序
管线。排序权重、threshold、分词器均未改动。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 门禁 2 —— 名段覆盖

防止新增工具引入新名词后词表静默腐烂。

**Files:**
- Modify: `desktop/tests/unit/synapse-tool-router-search.test.ts`

**Interfaces:**
- Consumes: `LEXICON`、`EXEMPT_SEGMENTS`（Task 2 产出）；`buildAllMcpTools`（从 `../../synapse-capabilities/shared/registry` 导入）
- Produces: 无（纯门禁）

- [ ] **Step 1: 写门禁 2 测试**

在 `desktop/tests/unit/synapse-tool-router-search.test.ts` 顶部补充导入：

```ts
import { buildAllMcpTools } from "../../synapse-capabilities/shared/registry"
import { EXEMPT_SEGMENTS, LEXICON } from "../../electron/services/agent-runtime/synapse-tool-router-lexicon"
```

在 `describe` 块内追加：

```ts
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

    expect(missing).toEqual([])
  })
```

- [ ] **Step 2: 运行，看缺哪些段**

Run: `cd desktop && npx vitest run tests/unit/synapse-tool-router-search.test.ts`
Expected: 该条 FAIL，失败信息列出所有缺中文词的名段 —— 这就是待办清单。预期缺口约 90 个（95 个 ≥2 段减去 Task 2 已覆盖的、再减去豁免的）。

- [ ] **Step 3: 补全词表**

为失败信息里的每个段补一条中文词（≥2 字）。段到中文的对应关系参考（门禁的实际输出才是权威清单，下面只是起点）：

```ts
  // 名词
  ["工作流", "workflow"], ["节点", "node"], ["边", "edge"],
  ["数据库", "database"], ["表格", "table"], ["列", "column"], ["字段", "column"],
  ["行", "row"], ["记录", "row"], ["密钥", "secrets"],
  ["定时任务", "automation"], ["自动化", "automation"],
  ["资源", "resource"], ["仓库", "repository"], ["技能", "skill"],
  ["规则", "rule"], ["提示词", "prompt"], ["模型", "model"], ["价格", "price"],
  ["账号", "account"], ["登录", "login"], ["对话", "conversation"],
  ["工作区", "workspace"], ["分组", "group"], ["命令", "command"], ["快捷", "command"],
  ["同步", "sync"], ["绑定", "binding"], ["回收站", "trash"], ["站点", "site"],
  ["分享", "share"], ["链接", "link"], ["直链", "direct"],
  ["评论", "comment"], ["批注", "annotation"], ["线程", "thread"],
  ["版本", "version"], ["快照", "snapshot"], ["用量", "usage"], ["统计", "stats"],
  ["冲突", "conflict"], ["排除", "exclude"], ["重新扫描", "rescan"],
  ["文档", "document"], ["模板", "template"], ["文本", "text"],
  ["通知", "notifier"], ["系统", "system"], ["声音", "sound"],
  ["反馈", "feedback"], ["问题", "problem"], ["访问", "access"],
  ["可见性", "visibility"], ["公开", "public"], ["分叉", "fork"],
  ["本地", "local"], ["运行时", "runtime"], ["回调", "webhook"],
  ["执行器", "executor"], ["触发器", "trigger"], ["布局", "layout"],
  ["参数", "param"], ["打包", "zip"], ["路径", "path"], ["整理", "reorganization"],
  ["权限", "permission"], ["消息", "message"], ["轮次", "turn"],
  ["供应商", "provider"], ["预设", "preset"], ["选项", "choice"],
  ["概览", "overview"], ["日志", "log"], ["数量", "count"], ["排序", "reorder"],
  ["诊断", "diagnostics"], ["能力", "capabilities"], ["操作", "operation"],
  ["面板", "view"], ["摘要", "summary"], ["设置", "settings"],
  // 动词
  ["暂停", "pause"], ["恢复", "resume"], ["停止", "stop"], ["停用", "disable"],
  ["启用", "enable"], ["上传", "upload"], ["下载", "download"], ["还原", "restore"],
  ["重命名", "rename"], ["移动", "move"], ["预览", "preview"], ["执行", "execute"],
  ["运行", "run"], ["生成", "generate"], ["提取", "extract"], ["写入", "write"],
  ["读取", "read"], ["输入", "input"], ["输出", "output"], ["观察", "observe"],
  ["检查", "inspect"], ["描述", "describe"], ["打开", "open"], ["启动", "launch"],
  ["发送", "send"], ["提交", "submit"], ["发布", "republish"], ["安装", "install"],
  ["导入", "import"], ["修复", "repair"], ["播放", "play"], ["粘贴", "paste"],
  ["调整", "resize"], ["覆盖", "override"], ["申请", "acquire"], ["续期", "renew"],
  ["释放", "release"], ["强制", "force"],
```

四点注意：

1. **`table` 的 term 用「表格」，不要用「表」。** 单字会命中「报表」「表单」这类复合词，违反 ≥2 字约束。
2. **同一个中文词映射到两个 token 是有意的**，需要时把它列两遍。例如 `读取` 同时给 `read` 和 `get`，`提交` 同时给 `submit` 和 `commit`。`lexiconTokens` 会两个都发出。
3. 变量名用复数、语义与单数不同的段（如 `rules`），按需补第二条同词条目。
4. **示例表里出现过的段也可能漏，以门禁输出为准**；示例只是让你知道粒度该多细。

对确实无语义的粘合段，加进 `EXEMPT_SEGMENTS` 并写理由。

- [ ] **Step 4: 运行，确认全绿**

Run: `cd desktop && npx vitest run tests/unit/synapse-tool-router-search.test.ts`
Expected: 门禁 2 PASS，且 Task 1 的英文对照组与 Task 2 的中文语料保持全绿 —— 补词表可能影响既有命中，必须一起复跑。

- [ ] **Step 5: 提交**

```bash
git add desktop/electron/services/agent-runtime/synapse-tool-router-lexicon.ts \
        desktop/tests/unit/synapse-tool-router-search.test.ts
git commit -m "test: 加名段覆盖门禁，强制词表跟上工具增长

新增工具若引入新名词段而词表没跟上，中文检索会静默退化。这条门禁要求
所有出现在 2 个以上工具里的名段都有中文词，把补词表变成强制动作，而不是
事后对账。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 门禁 3 —— 工具可达性

最强的一道防腐烂门禁：每个工具都要能用中文查询落到 top-5。

**Files:**
- Modify: `desktop/tests/unit/synapse-tool-router-search.test.ts`

**Interfaces:**
- Consumes: `LEXICON`、`EXEMPT_SEGMENTS`（Task 2/3 产出）、`searchSynapseTools`、`buildAllMcpTools`
- Produces: 无（纯门禁）

- [ ] **Step 1: 写门禁 3 测试**

在 `describe` 块内追加：

```ts
  it("reaches every tool through a chinese query built from its own name segments", async () => {
    // 段 -> 中文词的反查表，取表中第一条命中的
    const chineseFor = new Map<string, string>()
    for (const [term, token] of LEXICON) {
      if (!chineseFor.has(token)) chineseFor.set(token, term)
    }

    const misses: string[] = []
    for (const tool of buildAllMcpTools()) {
      const segments = tool.name
        .replace(/^app_/, "")
        .split("_")
        .filter((segment) => !(segment in EXEMPT_SEGMENTS))
      const terms = segments.map((segment) => chineseFor.get(segment))
      if (terms.some((term) => term === undefined)) {
        misses.push(`${tool.name}：段 ${segments.filter((s) => !chineseFor.has(s)).join("、")} 缺中文词`)
        continue
      }

      const query = terms.join("")
      const names = await topToolNames(query)
      if (!names.includes(tool.name)) {
        misses.push(`${tool.name}：「${query}」实际 top-5：${names.join("、") || "(空)"}`)
      }
    }

    expect(misses).toEqual([])
  })
```

- [ ] **Step 2: 运行，看漏哪些工具**

Run: `cd desktop && npx vitest run tests/unit/synapse-tool-router-search.test.ts`
Expected: 该条 FAIL，失败信息分两类 —— 「缺中文词」（补 Task 3 的表）与「可达性未命中」（需要更有区分度的词）。

- [ ] **Step 3: 迭代到全绿**

按失败信息逐条处理：缺词的补词；可达性未命中的，给它或它的兄弟工具补更具体的名词/动词以拉开区分度（例如 `session_state_list` 与 `session_list` 靠「状态」这个词区分）。重复运行直到：

Run: `cd desktop && npx vitest run tests/unit/synapse-tool-router-search.test.ts`
Expected: 三条测试（英文对照组、中文语料、名段覆盖、工具可达性）全部 PASS。

**若某个工具确实无法在任何中文查询下落进 top-5：停下来报告用户，不要给它加豁免、不要放宽断言。**

- [ ] **Step 4: 提交**

```bash
git add desktop/electron/services/agent-runtime/synapse-tool-router-lexicon.ts \
        desktop/tests/unit/synapse-tool-router-search.test.ts
git commit -m "test: 加工具可达性门禁，每个工具都要能被中文查询命中

用每个工具自己的名段反查中文词拼成查询，要求该工具落在 top-5。这条门禁
覆盖名段覆盖门禁管不到的情况：新旧工具靠新组合区分时，光有词还不够，组合
出来还得真的排得进去。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: 文档与发布说明

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`
- Modify: `docs/superpowers/specs/2026-08-25-agent-synapse-mcp-tool-router-design.md`

**Interfaces:**
- Consumes: 无
- Produces: 无

- [ ] **Step 1: 更新发布说明**

在 `RELEASE_NOTES_PENDING.md` 中新增一条，面向用户说明得到什么（**不写代码路径、不写实现细节**）：

```markdown
- 修复：用中文让 AI 操作 Synapse 时，很多指令找不到对应能力（例如「终端会话列表」「回收站里有什么」）。现在中文说法能正确匹配到工具，不再返回不相关的结果。
```

- [ ] **Step 2: 给旧设计文档加 supersede 说明**

在 `docs/superpowers/specs/2026-08-25-agent-synapse-mcp-tool-router-design.md` 第 3 行的 superseded note 之后补一段：

```markdown
> 中文检索范围另有更新：原文「内部协议」一节中「索引覆盖……中英文 domain 别名」以及
> 「中文常用的云盘、文件和列表词汇映射到规范索引词，不为单个模型维护别名」的表述已被
> `docs/superpowers/specs/2026-09-22-synapse-tool-router-chinese-search-lexicon-design.md`
> 取代 —— 中文支持从 7 条别名扩展为覆盖全部工具名段的中文词表。
```

- [ ] **Step 3: 确认能力注册清单无需改动**

Run: `git diff --stat docs/agents/capability-registry.md`
Expected: 无输出。本次不改工具数、不改公开工具表面，该文件不应变动。

- [ ] **Step 4: 提交**

```bash
git add RELEASE_NOTES_PENDING.md docs/superpowers/specs/2026-08-25-agent-synapse-mcp-tool-router-design.md
git commit -m "docs: 记录中文检索修复并标注旧设计的取代关系

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 收尾验证

**Files:** 无（只运行检查）

- [ ] **Step 1: 跑本次相关测试**

Run: `cd desktop && npx vitest run tests/unit/synapse-tool-router-search.test.ts tests/unit/api-mcp-capability-surface.test.ts`
Expected: 全部 PASS。

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @synapse/desktop run typecheck`
Expected: 无错误。

- [ ] **Step 3: 硬约束检查**

Run: `pnpm --filter @synapse/desktop run check:hard-constraints`
Expected: PASS。新模块不导出服务单例、不裸用 IPC，不应触发任何规则。

- [ ] **Step 4: 确认 diff 聚焦**

Run: `git status --short && git diff --stat HEAD`
Expected: 只包含本计划涉及的文件；工作区里既有的 `terminal-git-*` 与 `mobile-live*` 改动**不得**被带进任何提交。

---

## 完成标准

- 中文语料 49 条全部命中 top-5，英文对照组 29 条全绿。
- 门禁 2、门禁 3 全绿，且都**没有豁免名单**（`EXEMPT_SEGMENTS` 只含无语义粘合段，逐条给了理由）。
- `threshold`、排序权重、分词器、`DOMAIN_ALIASES` 均未被改动。
- 工具数与公开工具表面不变（243 / 2）。
- `RELEASE_NOTES_PENDING.md` 已记录；`capability-registry.md` 未被改动。
