# Synapse MCP 检索的中文词表设计

## 背景

`synapse-tool-router` 的 `search` 是全部 MCP 客户端的唯一工具入口，`initialize` 的 instructions 明确承诺可以用中文自然语言调用（"with the user's intent in natural language (Chinese or English)"）。实测这个承诺对中文基本不成立。

用 49 条真实中文说法跑现有 `searchSynapseTools`：

| 结果 | 条数 |
|---|---:|
| 命中期望工具 | 2 |
| 返回空集 | 37 |
| 有返回但命中的是错工具 | 10 |

同一批意图的英文说法 9/9 命中。问题在中文侧，且不在排序。

## 根因

三处缺陷，共同根因是「中文 → 英文 token」这座桥几乎不存在。

**缺陷 1：分词器把中文整串当成一个 token。**
`tokenizeSearchText` 用 `/[\p{L}\p{N}]+/gu`，对中文产出整段作为一个 token，永远匹配不上任何索引内容。

```
「终端」      → 5 条结果   （精确命中别名）
「终端 会话」 → 5 条结果   （加空格即正常）
「终端会话」  → (空)      （两字连写即失效）
```

**缺陷 2：中文别名挂在 domain 字段上，无法在 domain 内区分。**
`DOMAIN_ALIASES` 的中文词（`app: ["应用","终端","通知","模板","文件","密钥",…]`）随 `domain` 字段进入索引，而 `app` domain 有 79 个工具共享它。Fuse 命中后 79 个工具同分，中文 token 的 `lexicalRelevance` 又全为 0，最终按字母序打破平局。

```
「终端」 → app_account_login_start, app_account_state_get, app_agent_conversation_create …
「密钥」 → app_account_login_start, app_account_state_get, app_agent_conversation_create …
```

`app_terminal_*` 这 49 个工具在中文下从未出现。

**缺陷 3：孤立别名把无关工具捞上来，给出「貌似对的错答案」。**
`queryTokens` 的构造在别名命中时丢弃全部中文 token：

```ts
...tokenizeSearchText(query).filter((token) => (
  !SEARCH_STOP_WORDS.has(token)
  && (aliasTokens.length === 0 || !containsHan(token))
)),
...aliasTokens,
```

于是只命中 `列表→list` 的查询只剩 `[list]`：

```
「终端列表」   → app_automation_run_list, app_secrets_item_list, …
「回收站 列表」→ app_automation_run_list, app_secrets_item_list, …
```

比返回空集更危险：调用方会拿这个工具名去 `invoke`。

## 已验证的前提

现有排序机制本身是好的，坏的只有中文到英文 token 的桥。用 20 组英文 token 集合（即中文查询修好后应当展开成的样子）验证，**20/20 命中，且全部第 1 名**：

```
「terminal workspace pane create」 → app_terminal_workspace_pane_create  (第 1 名)
「drive file version restore」     → app_drive_file_version_restore      (第 1 名)
「automation item disable」        → app_automation_item_disable         (第 1 名)
「database table describe」        → app_database_table_describe         (第 1 名)
```

工具名 `name` 字段权重 0.4，远高于 domain 别名的 0.05，所以正确的英文 token 天然解决缺陷 2，不需要新架构。

## 目标

中文自然语言查询能命中正确的 `app_*` 工具，且不回归英文。

## 非目标

- 不改 `threshold`。它在中文下无意义：76% 的中文查询候选池为空，调高调低都不解决问题。
- 不改排序权重、`lexicalRelevance`、`mergeFuseResults`。
- 不做最长匹配分词，不引入中文分词依赖。词表外的中文（OOV）继续返回空集 —— 这比现状的「貌似对的错答案」更安全。
- 不为每个工具手写一条中文工具名。
- 不改 `DOMAIN_ALIASES`。它在 catalog 侧（`aliases` 字段）参与索引，与查询侧的展开职责不同；`name` 权重已足以压制它的噪声。

## 设计

### 组件 1：中文词表模块（新增）

`desktop/electron/services/agent-runtime/synapse-tool-router-lexicon.ts`

```ts
export const LEXICON: readonly (readonly [term: string, token: string])[]
export function lexiconTokens(query: string): readonly string[]
```

约束：

1. **`term` 长度 ≥2 字。** 单字条目（如「表」）会命中「报表」这类复合词，引入假阳性。
2. **`token` 必须是工具名里真实出现的段。** 词表英文侧取自 243 个工具名按 `_` 切分后的 165 个不同段（去掉 `app` 前缀）。这是硬约束：发出的 token 若不在任何 `name` 里，就匹配不到 `name` 字段，展开等于无效。
3. **词表规模。** 名段分布实测：共 165 个不同段，其中出现在 ≥2 个工具里的 95 个、只出现 1 次的 70 个。词表需覆盖全部 165 段，外加同义词（如 `item` ← 文件/文件夹/条目），预计 200–250 条。

   注：本设计早期估计「约 90 条」，那是按「覆盖 9 个 domain + 常用动词」估的。要达到下文的门禁 3（243 个工具全部可达），实际需要覆盖全部名段，**估计修正为 200–250 条**。这是机械劳动（每段一行），相对 243 个工具不构成维护负担。

4. 模块**不依赖 Agent SDK**，可被单测廉价引入。

### 组件 2：替换展开逻辑

- 删除 `SEARCH_QUERY_ALIASES`（7 条，被词表取代）。
- `queryAliasTokens()` 的调用点改用 `lexiconTokens()`。
- **保留**「词表命中时丢弃中文整串 token」的现有行为：那些整串本就是垃圾 token，丢弃使 `lexicalRelevance` 的分母不再被稀释，是净收益。
- 实现方式是扫查询串、命中的词条全部展开成英文 token 后去重。**输出顺序必须确定**：按词条在 `LEXICON` 表中的出现顺序排列。顺序会影响 `mergeFuseResults` 的输入数组次序与 `uniqueQueryTokens` 的首次出现次序，因此必须可复现 —— 上一条规范允许实现自由排布词表，但一旦排定，同一查询的 token 序列就必须固定。

改动落在 `synapse-tool-router.ts` 一个函数的体与一个常量的删除。

### 组件 3：三道门禁

| 门禁 | 断言 | 防的是什么 |
|---|---|---|
| 中文语料 | 49 条真实说法全部命中 top-5，**不留豁免名单** | 真实意图被挤出 |
| 词表覆盖 | 出现在 ≥2 个工具里的 95 个名段，每个都有中文词 | 新增工具引入新名词后词表静默腐烂 |
| 可达性 | 243 个工具，各自用其名段反查出的中文查询，落在 top-5 | 新工具与旧工具靠新组合区分时漏词 |

门禁 1 的语料已写在 `desktop/tests/unit/synapse-tool-router-search.test.ts`，当前为红。

门禁 2 需要一份**显式豁免清单**，覆盖没有语义的粘合段（如 `to`、`set`），每条豁免在词表模块内附一行理由。豁免必须逐条给理由，不允许静默缺口。

门禁 3 用各工具名段中**已有中文词**的段拼查询。单段工具若因此不可达，会被这条门禁自然逼出覆盖，所以词表最终趋向覆盖全部 165 段。

### 组件 4：英文不得回归

已验证的 20 组英文 token 集合 + 9 组英文说法写进同一测试文件作为对照组，断言英文仍 100% 命中。

## 验证

- `npx vitest run tests/unit/synapse-tool-router-search.test.ts`（新，含中文语料、英文对照、两道新门禁）
- `npx vitest run tests/unit/api-mcp-capability-surface.test.ts`（确认 243 个工具与 2 个公开工具表面未变）
- desktop typecheck

按 TDD 执行：语料已在红状态，先补门禁 2、3 的测试，再实现词表直到全绿。

## 风险

1. **门禁 3 可能对少数天生难分的工具对过严**，例如 `app_terminal_session_list` 与 `app_terminal_session_state_list`（终端会话列表 / 终端会话状态列表）。处理：靠词表增加区分词解决；若确实无解，**报给用户**，不在测试里塞豁免。
2. **词表 200–250 条超出早期估计**，实现工作量高于最初设想。
3. **中文 OOV 仍返回空集**，不做兜底。这是刻意的：空集比错答案安全，且会推动词表继续扩充。
4. **`DOMAIN_ALIASES` 的中文条目保留**，会继续给 domain 内所有工具一点噪声分。判断是 `name` 权重 0.4 足以压制，但若实测发现它干扰，需要回头删掉其中文条目。

## 文档与发布说明影响

- `RELEASE_NOTES_PENDING.md`：**必须记录**。中文用户能搜到此前搜不到的工具，属用户可感知的能力修复。
- `docs/superpowers/specs/2026-08-25-agent-synapse-mcp-tool-router-design.md`：该文第 28 行「中文常用的云盘、文件和列表词汇映射到规范索引词」的决定被本设计取代，需加 supersede 说明。
- MCP instructions 与 Synapse Skill 的 `SKILL.md` **不改**：修好后「Chinese or English」的承诺才第一次真正成立，不需要加免责声明或词汇范围说明。
- `docs/agents/capability-registry.md`：不涉及能力注册表面（工具数与公开表面均不变），不改。
