# Drive Agent 文件工具重设计

日期：2026-09-24
范围：现有用户本人云盘中的文件读取与文本编辑，`app_drive_file_*` MCP 能力及内置 Drive Skill

## 问题与目标

一次真实编辑中，约 46 KiB 的 Markdown 经 `app_drive_file_content_read` 返回约 105,000 字符。该工具从浏览器预览同时带回 Markdown 原文和渲染 HTML，Claude Code 拒收过大的工具结果。随后 AI 虽成功写入一个新版本，却再次使用旧 `baseVersionId`，服务端正确返回 `DRIVE_FILE_CONTENT_STALE`。正式环境还出现过 45 KiB 正文被整篇替换为 2 KiB、随后从历史版本恢复的记录；现有证据不能确定那次替换由谁发起。

目标：

1. AI 通过工具名、描述和返回字段即可判断：新建文件用上传，检查内容用分段读取，修改现有文本用带版本校验的局部编辑，保存二进制或本地处理用下载。
2. 任意受支持大小的文本文件都能按同一个不可变版本完整读取。单次 MCP 响应有明确预算，不把渲染 HTML、浏览器状态或重复正文混入源文本响应。
3. 常见追加、前后插入、精确替换无需 AI 在上下文中重建整篇文档。并发冲突和目标歧义显式失败，不覆盖较新的内容。
4. 保留现有文件 ID、分享链接、版本历史、协同代际和权限边界；旧工具在迁移期可用。

## 边界

- 新工具只操作当前登录用户本人云盘中已保存的文件。`/share`、`/sites`、`/files` 的链接读取继续由 `app_drive_link_*` 负责；分享编辑、评论和实时协同不通过这些新工具开放。
- API Key 鉴权的 Open API 仍用于公共链接制品下载。它返回临时地址和文件字节，不是本人私有云盘文本编辑接口；AI 不得为了编辑而创建公开分享或申请 API Key。
- 不把文档正文放进数据库、日志、审计、MCP 搜索结果或错误对象；不新增依赖或持久化正文缓存。
- 不自动重试冲突写入，不自动猜测重复锚点，也不根据截断结果构造整篇替换。

## 工具选择

| 用户意图 | 首选工具 | 后续操作 |
| --- | --- | --- |
| 找文件、确认类型和位置 | 现有 `app_drive_item_list` / `app_drive_item_get` | 不读取正文 |
| 判断文本大小、获取编辑基线 | 新 `app_drive_file_content_inspect` | 返回版本和字节数，不返回正文 |
| 阅读已保存的 Markdown、纯文本、HTML 源码 | 新 `app_drive_file_content_read_chunk` | 使用 `nextCursor` 继续；只返回原文 |
| 追加、插入或替换现有文本 | 新 `app_drive_file_content_patch` | 使用 `inspect.versionId` 作 `baseVersionId` |
| 创建新文件 | 现有 `app_drive_file_upload` | 不借用覆盖路径创建文件 |
| 二进制文件或需要本地程序处理的大文件 | 现有 `app_drive_file_download_create`；若要固定版本，使用 `app_drive_file_version_download_create` | 本地读取不经过 MCP 正文响应 |
| 查看或恢复历史 | 现有 `app_drive_file_version_*` | 恢复仍创建新版本 |

`app_drive_item_preview_get` 是浏览器页面状态，不用于 AI 读取正文。现有 `app_drive_file_content_read` 和 `app_drive_file_content_write` 标为兼容入口；新 Skill 不再把它们作为已有文档的默认编辑流程。

## 新工具契约

### `app_drive_file_content_inspect`

输入：`{ itemId }`。

输出：`{ itemId, name, kind, sizeBytes, versionId, editable }`。`versionId` 指向已保存的、不可变的文件版本；`sizeBytes` 是该版本 UTF-8 原文的字节数。文件不可用、不是受支持的文本类型或没有可读版本时返回稳定错误码，不返回浏览器预览或正文。

服务端必须从同一文件版本记录取得 `versionId`、对象键和大小，避免先取正文再取“当前版本号”的竞态。浏览器协同中尚未检查点保存的草稿不算 MCP 已保存版本。

### `app_drive_file_content_read_chunk`

输入：`{ itemId, versionId, cursor?, start? }`。首次省略 `cursor`，`start` 可选 `beginning`（默认）或 `tail`；之后原样传回 `nextCursor`，且不得再传 `start`。`tail` 只读取末尾一块，方便追加前检查最后的标题与换行；不能把这一块当成全文。不让 AI 计算字节偏移。每次仍重新验证当前用户对文件的读取权。游标只定位版本和偏移，不充当授权凭证。

输出：`{ itemId, versionId, text, startByte, endByte, totalBytes, nextCursor, endOfFile }`。只返回源文本；`endOfFile` 表示当前块到达文件末尾，`nextCursor` 此时为 `null`。从 `beginning` 顺序读取的每个块与前块在原始 UTF-8 字节序列上首尾相接，不丢、不重、不拆断字符。`tail` 结果的 `startByte` 可能大于零，`endOfFile=true` 不代表已读完整文档。即使包含超长单行、中文、emoji、CRLF 或大量 JSON 转义字符，也必须能够按顺序还原原文件。

单块原文目标上限 8 KiB，**完整序列化 MCP 响应**硬上限 16 KiB；必要时缩小本块并返回下一游标，不能静默截断或仅给一个没有继续入口的 `truncated`。所有块固定读取 `versionId` 的不可变对象；期间出现新当前版本，也继续读完旧版本，并让后续编辑的版本校验决定是否冲突。首次分块读取为该版本建立短期读租约，连续读取续期，版本清理须尊重租约；租约过期后明确返回 `DRIVE_FILE_READ_SNAPSHOT_EXPIRED` 并要求重新检查，不得静默切换到当前版本。存储适配层需提供有界范围读取，不能为了每个游标反复从 COS 下载整份大文件。范围读取必须验证对象长度和实际字节数。

### `app_drive_file_content_patch`

输入：`{ itemId, baseVersionId, idempotencyKey, operations }`。`idempotencyKey` 是同一次逻辑编辑在重试时复用的随机标识；`operations` 为有序、非空、最多 10 项的数组；单次新增文本合计最多 64 KiB。操作类型：

- `append`：`{ type: "append", text }`，在文件末尾原样追加，不暗中插入换行。
- `insert_before` / `insert_after`：`{ type, target: { exact, prefix?, suffix? }, text }`。
- `replace_exact`：`{ type, target: { exact, prefix?, suffix? }, text }`；允许空 `text` 表示删除明确命中的原文。

非追加操作要求 `target` 在 `baseVersionId` 的完整源文本中**唯一命中**；`prefix` / `suffix` 用于消歧，不能用“第几个”让 AI 猜。所有目标先在同一基线版本上定位并验证不重叠，再一次性应用；任一失败则整批不写入。追加和其它操作同时出现时，追加始终作用于基线文档末尾。输出仅含 `{ itemId, previousVersionId, versionId, sizeBytes, appliedCount }`，不回传新正文。下一次编辑必须使用本次返回的 `versionId`。

服务端复用现有 owner 权限、`commitTextFileChange` 的版本历史、配额校验、协同代际切换与无正文审计；不可另建绕过版本协调的写入管线。提交前在持有现有 item 写入协调的条件下再次比较当前版本与 `baseVersionId`。同一个用户、文件、`idempotencyKey` 和请求摘要重复到达时返回首次提交的结果，不再追加一次；同一 key 携带不同请求则拒绝。去重记录只存摘要和结果版本，设有限保留期，不存正文。`DRIVE_FILE_CONTENT_STALE` 返回当前版本标识和明确的“重新检查、重新定位后再提交”动作提示；锚点缺失、锚点重复、操作重叠分别返回可区分错误，均不得保存。错误不回显正文片段。

机器可读错误至少区分 `DRIVE_FILE_CONTENT_STALE`、`DRIVE_FILE_PATCH_TARGET_NOT_FOUND`、`DRIVE_FILE_PATCH_TARGET_AMBIGUOUS`、`DRIVE_FILE_PATCH_OVERLAP`、`DRIVE_FILE_PATCH_IDEMPOTENCY_CONFLICT` 和 `DRIVE_FILE_READ_SNAPSHOT_EXPIRED`。工具描述与内置 Skill 要写明每种错误的下一步；不能只返回一条笼统的“保存失败”。

## AI 调用流程

**读完整文档**：`inspect` → `read_chunk(itemId, versionId, start=beginning)` → 按 `nextCursor` 循环至 `endOfFile=true`，并确认首块 `startByte=0`、相邻块连续、末块 `endByte=totalBytes`。不能将单个块当成全文。需要本地程序处理时，优先用 `inspect.versionId` 调现有历史版本下载工具取得同一快照；不要求模型把全部文件装进上下文。

**追加**：`inspect` → 必要时 `read_chunk(start=tail)` 检查末尾 → `patch(append, baseVersionId, idempotencyKey)` → 使用返回的新版本号继续操作。AI 只发送新增段落；提交结果不确定时用同一个 key 重试。

**在章节中插入或修改**：`inspect` → 逐块读取至足以唯一确定原文锚点 → `patch(insert_before / insert_after / replace_exact)`。锚点不唯一时补充上下文；版本冲突时重新读取新版本并重新生成操作，使用新的 `idempotencyKey`，不原样重放旧补丁。

**整篇重建**：仅当用户确实要替换整篇、或局部操作无法表达时，下载固定版本到本地并用现有 `file_upload(expectedVersionId)` 覆盖。不得把分块读取的一部分传给旧 `content_write`。旧整篇写入保留为兼容入口，但不作为内置 Skill 默认建议。

典型的“在标题后插入”调用只传新增正文和唯一标题，不复制整篇文档：

```json
{
  "itemId": "<item-id>",
  "baseVersionId": "<inspect 返回的 versionId>",
  "idempotencyKey": "<本次编辑的随机标识>",
  "operations": [{
    "type": "insert_after",
    "target": { "exact": "## 3.2 预案管理" },
    "text": "\n新增段落。\n"
  }]
}
```

## 兼容与实施

1. 先在服务端实现版本绑定的元数据、范围读取与局部编辑；加入明确的授权、配额、版本和协同测试。大文件读取不得通过浏览器 Markdown 渲染器。
2. 同批注册三个 MCP capability/tool，更新 `docs/agents/capability-registry.md` 的数量和例外、Synapse MCP 描述/schema、内置 Drive Skill 与 Agent 指南；保留现有工具名和响应契约，避免旧客户端突然收到不同形状的结果。
3. 修改工具搜索描述，使“读或改已有文档”优先发现新流程；旧工具描述明确标注整篇正文和渲染 HTML 可能超出 AI 工具结果预算。
4. 另外对齐现有整篇 `PATCH /content` 在 Nginx 与应用层的请求体限制。当前应用层允许大文本，通用代理路由却没有相同额度；该问题与本次 46 KiB 故障不同，但兼容期仍会影响旧工具。
5. 新工具稳定后再评估旧 `content_read` / `content_write` 的弃用时间；不在首批删除或改写其既有行为。

## 验收

- 用这次约 46 KiB Markdown 的形态构造回归样本：读取工具不返回 HTML，每个 MCP 响应不超过预算，按游标还原的字节与原文件一致。
- 在中文、emoji、CRLF、长行、转义字符和版本变更中验证游标连续性、UTF-8 完整性、末尾读取、租约续期及固定版本读取。
- 追加与定点插入不要求 AI 提交旧正文；连续两次编辑可直接使用上次返回的版本号。
- 提交成功后连接中断并用相同 `idempotencyKey` 重试，不得重复追加或新增第二个版本；相同 key 的不同请求必须拒绝。
- 旧版本、重复锚点、缺失锚点和重叠操作都不生成新版本；冲突后重新读取和重做可成功。
- 文件版本、分享 URL、协同文档切换、配额、权限和审计与现有整篇编辑一致；二进制和分享链接仍不能走 owner 文本补丁。
- 旧工具的契约测试仍通过；生产代理对现有整篇写入的上限与服务端保持一致。
