# Drive Agent 文件工具重设计

日期：2026-09-24
范围：现有用户本人云盘中的文件读取与文本编辑，`app_drive_file_*` MCP 能力及内置 Drive Skill

## 问题与目标

一次真实编辑中，约 46 KiB 的 Markdown 经 `app_drive_file_content_read` 返回约 105,000 字符。该工具从浏览器预览同时带回 Markdown 原文和渲染 HTML，Claude Code 拒收过大的工具结果。随后 AI 虽成功写入一个新版本，却再次使用旧 `baseVersionId`，服务端正确返回 `DRIVE_FILE_CONTENT_STALE`。正式环境还出现过 45 KiB 正文被整篇替换为 2 KiB、随后从历史版本恢复的记录；现有证据不能确定那次替换由谁发起。

目标：

1. AI 通过工具名、描述和返回字段即可判断：新建文件用上传，检查内容用分段读取，修改现有文本用带版本校验的局部编辑，保存二进制或本地处理用下载。
2. 任意受支持大小的文本文件都能按同一个不可变版本完整读取。单次 MCP 响应有明确预算，不把渲染 HTML、浏览器状态或重复正文混入源文本响应。
3. 常见追加、前后插入、精确替换无需 AI 在上下文中重建整篇文档。并发冲突和目标歧义显式失败，不覆盖较新的内容。
4. 保留现有文件 ID、分享链接、版本历史、协同代际和权限边界；旧 MCP 工具仅在同次开发的对比验证阶段保留，通过后删除，不随最终版本发布。
5. 局部编辑不能成为变相的整篇覆盖；正在网页协同编辑的用户不能因无效补丁或明显过期的版本检查而被反复打断。

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
| 阅读已保存的 Markdown、纯文本、HTML 源码 | 新 `app_drive_file_content_read_chunk` | 使用 `nextCursor` 继续；只返回原文，小文件可顺序读完 |
| 追加、插入或替换现有文本 | 新 `app_drive_file_content_patch` | 使用 `inspect.versionId` 作 `baseVersionId` |
| 创建新文件 | 现有 `app_drive_file_upload` | 不借用覆盖路径创建文件 |
| 二进制文件或需要本地程序处理的大文件 | 现有 `app_drive_file_download_create`；若要固定版本，使用 `app_drive_file_version_download_create` | 文本超过 64 KiB 且需要通读或定位未知位置时，有本地处理能力和写入权限才默认下载固定版本 |
| 查看或恢复历史 | 现有 `app_drive_file_version_*` | 恢复仍创建新版本 |

`app_drive_item_preview_get` 是浏览器页面状态，不用于 AI 读取正文。旧 `app_drive_file_content_read` 和 `app_drive_file_content_write` 在新旧对比完成后从 MCP 注册表移除；浏览器整篇编辑的 HTTP 接口继续保留。

## 新工具契约

### `app_drive_file_content_inspect`

输入：`{ itemId }`。

输出：`{ itemId, name, kind, sizeBytes, versionId, editable }`。`versionId` 指向已保存的、不可变的文件版本；`sizeBytes` 是该版本 UTF-8 原文的字节数。文件不可用、不是受支持的文本类型或没有可读版本时返回稳定错误码，不返回浏览器预览或正文。

服务端必须从同一文件版本记录取得 `versionId`、对象键和大小，避免先取正文再取“当前版本号”的竞态。浏览器协同中尚未检查点保存的草稿不算 MCP 已保存版本。

### `app_drive_file_content_read_chunk`

输入：`{ itemId, versionId, cursor?, start?, anchorByte? }`。首次省略 `cursor`，`start` 可选 `beginning`（默认）、`tail` 或 `around`；`around` 必须同时传入本次 `patch.applied` 返回的 `startByte` 或 `endByte` 作为 `anchorByte`，用于提交后核对，不让 AI 自行计算字节偏移。之后原样传回 `nextCursor`，且不得再传 `start` 或 `anchorByte`。`tail` 只读取末尾一块，方便追加前检查最后的标题与换行；`around` 只读取覆盖该位置及其前后内容的一块。两者都不能当成全文。每次仍重新验证当前用户对文件的读取权。游标只定位版本和偏移，不充当授权凭证。

输出：`{ itemId, versionId, text, startByte, endByte, totalBytes, nextCursor, endOfFile }`。只返回源文本；`endOfFile` 表示当前块到达文件末尾，`nextCursor` 此时为 `null`。从 `beginning` 顺序读取的每个块与前块在原始 UTF-8 字节序列上首尾相接，不丢、不重、不拆断字符。`tail` 和 `around` 结果的 `startByte` 可能大于零，`endOfFile=true` 不代表已读完整文档；`around` 返回块必须覆盖指定的 `anchorByte`，并尽可能保留其前后上下文。即使包含超长单行、中文、emoji、CRLF 或大量 JSON 转义字符，也必须能够按顺序还原原文件。

单块原文目标上限 8 KiB，**完整序列化 MCP 响应**硬上限 16 KiB；必要时缩小本块并返回下一游标，不能静默截断或仅给一个没有继续入口的 `truncated`。所有块固定读取 `versionId` 的不可变对象；期间出现新当前版本，也继续读完旧版本，并让后续编辑的版本校验决定是否冲突。首次分块读取为该版本建立短期读租约，连续读取续期，版本清理须尊重租约；租约过期后明确返回 `DRIVE_FILE_READ_SNAPSHOT_EXPIRED` 并要求重新检查，不得静默切换到当前版本。存储适配层需提供有界范围读取，不能为了每个游标反复从 COS 下载整份大文件。范围读取必须验证对象长度和实际字节数。

64 KiB 是 Agent 默认**全文读取**路径的分流阈值，不是服务端文件大小上限：显式需要时仍可用游标完整读取任意受支持大小的文本。超过阈值但只需文件开头或末尾时，仍可读少量分块；需要通读或定位未知位置时，先确认当前客户端具备本地文件处理能力和下载所需的写入权限，再默认下载 `inspect.versionId` 对应的固定版本，用本地程序定位相关片段或分段处理，避免模型为查找某一段而扫描数百或数千块。仅为任务处理而下载时使用受控临时路径，任务结束后清理；用户明确要求保存本地副本时才保留到指定位置。若下载不可用或权限未获准，Agent 可在实际调用和上下文预算内继续分块读取。无法读完时必须说明已读范围，不能把已读片段称为全文，也不能为了完成任务静默申请公开分享或改用不固定版本的下载。

### `app_drive_file_content_patch`

输入：`{ itemId, baseVersionId, idempotencyKey, operations }`。`idempotencyKey` 是同一次逻辑编辑在重试时复用的随机标识；`operations` 为有序、非空、最多 10 项的数组；单次新增文本合计最多 64 KiB。操作类型：

- `append`：`{ type: "append", text }`，在文件末尾原样追加，不暗中插入换行。
- `insert_before` / `insert_after`：`{ type, target: { exact, prefix?, suffix? }, text }`。
- `replace_exact`：`{ type, target: { exact, prefix?, suffix? }, text }`；允许空 `text` 表示删除明确命中的原文。

非追加操作要求 `target` 在 `baseVersionId` 的完整源文本中**唯一命中**；`prefix` / `suffix` 用于消歧，不能用“第几个”让 AI 猜。所有目标先在同一基线版本上定位并验证不重叠，再一次性应用；任一失败则整批不写入。追加和其它操作同时出现时，追加始终作用于基线文档末尾。输出为 `{ itemId, previousVersionId, versionId, sizeBytes, appliedCount, applied }`，不回传新正文；`applied` 按输入顺序为每项操作返回 `{ operationIndex, startByte, endByte }`，字节范围指向最终版本中的新增或替换内容，删除操作的起止位置相同。Agent 可将这些位置原样传给新版本的 `read_chunk(start=around)` 核对落点，不用从头扫描。下一次编辑必须使用本次返回的 `versionId`。

局部补丁有不可绕过的范围保护：每个 `target.exact` 的 UTF-8 原文字节数最多 16 KiB；将全部操作一次性应用后，若新文件比基线减少至少 1 KiB，且新文件小于基线大小的 50%，拒绝整批写入。两项都由服务端按完整基线和最终结果计算，不能依赖 Agent 自报意图；`prefix` / `suffix` 不计入替换范围。拒绝时返回 `DRIVE_FILE_PATCH_TOO_BROAD`、基线与拟生成文件的字节数及“明确整篇改写时改用固定版本下载和 `file_upload(expectedVersionId)`”的提示，不回显正文。这只是针对极端缩短的兜底，不证明低于阈值的删改一定符合用户意图；正常的大幅精简也可能被挡住。用户已明确要求大段删改且 Agent 能从完整基线核对最终差异时，改走整篇重建；若用户只要求局部改动而结果大幅缩短，应停下说明差异并请用户确认。Agent 不得通过多次小补丁规避该保护。

服务端复用现有 owner 权限、`commitTextFileChange` 的版本历史、配额校验、协同代际切换与无正文审计；不可另建绕过版本协调的写入管线。先检查明显过期的 `baseVersionId`、锚点、重叠和范围保护，再进入可能暂停网页协同写入的提交流程；提交前在持有现有 item 写入协调的条件下再次比较当前版本与 `baseVersionId`。预检查不替代提交时的复查。若协同房间在准备外部修改时检查点保存了未落盘草稿，导致版本变化，本次补丁必须返回 `DRIVE_FILE_CONTENT_STALE`、恢复协同写入并保留该草稿；Agent 重新检查与定位后才能提交，不能自动重放。一次用户任务中可确定的多个局部操作尽量合并为同一补丁，避免每次保存都使网页编辑器短暂只读、切换代际和重新连接。单次用户任务遇到冲突后最多自动重新定位并提交一次；再次冲突时停止写入，说明文件仍在更新、改动未保存，待编辑稳定后再继续，不能循环重试或反复暂停网页编辑器。

同一个用户、文件、`idempotencyKey` 和请求摘要重复到达时返回首次提交的结果，不再追加一次；同一 key 携带不同请求则拒绝。去重记录只存请求摘要、结果版本和 `applied` 字节范围等重现首次响应必需的元数据，设有限保留期，不存正文。`DRIVE_FILE_CONTENT_STALE` 返回当前版本标识和明确的“重新检查、重新定位后再提交”动作提示；锚点缺失、锚点重复、操作重叠分别返回可区分错误，均不得保存。错误不回显正文片段。

机器可读错误至少区分 `DRIVE_FILE_CONTENT_STALE`、`DRIVE_FILE_PATCH_TARGET_NOT_FOUND`、`DRIVE_FILE_PATCH_TARGET_AMBIGUOUS`、`DRIVE_FILE_PATCH_OVERLAP`、`DRIVE_FILE_PATCH_TOO_BROAD`、`DRIVE_FILE_PATCH_IDEMPOTENCY_CONFLICT` 和 `DRIVE_FILE_READ_SNAPSHOT_EXPIRED`。工具描述与内置 Skill 要写明每种错误的下一步；不能只返回一条笼统的“保存失败”。

## AI 调用流程

**读完整文档**：先 `inspect`。不超过 64 KiB 时，可 `read_chunk(itemId, versionId, start=beginning)` → 按 `nextCursor` 循环至 `endOfFile=true`，并确认首块 `startByte=0`、相邻块连续、末块 `endByte=totalBytes`。不能将单个块当成全文。超过 64 KiB 且任务需要通读时，确认本地处理能力和写入权限后，默认用 `inspect.versionId` 调现有历史版本下载工具取得同一快照，在本地按任务需要搜索、处理或分段概括；否则按预算分块读取或说明无法完成全文分析。即使用户要求全文分析，也不要求模型一次装入整篇文件。

**追加**：`inspect` → 必要时 `read_chunk(start=tail)` 检查末尾 → `patch(append, baseVersionId, idempotencyKey)` → 使用返回的新版本号继续操作。AI 只发送新增段落；提交结果不确定时用同一个 key 重试。

**在章节中插入或修改**：`inspect` → 对已知开头或末尾位置读取少量分块；未知位置或需要通读的大文件，在本地处理可用且有写入权限时下载固定版本并定位，否则按预算分块读取，取得足以判断语义位置的原文锚点 → 将同一任务中可确定的操作合并调用一次 `patch(insert_before / insert_after / replace_exact)`。锚点不唯一时补充上下文；版本冲突时重新读取新版本并重新生成操作，使用新的 `idempotencyKey`，不原样重放旧补丁，且一次任务最多自动重做一次。`DRIVE_FILE_PATCH_TOO_BROAD` 时按用户原意判断是否走整篇重建，不拆成多个补丁绕过限制。

**提交后核对**：检查返回的 `versionId`、`appliedCount` 和 `sizeBytes`；追加可再读取新版本 `tail`，中间章节的修改用每项 `applied.startByte` 调 `read_chunk(start=around)`，较长的替换还可用 `endByte` 核对末端，不要求从文件开头重读到该处。上下文与目标章节不符、无法判断是否改在正确位置，或最终大小与用户意图明显不符时，不得直接报告完成；继续读取固定新版本核查，仍无法判断时如实说明。

**整篇重建**：仅当用户确实要替换整篇、或局部操作无法表达时，下载固定版本到本地并用现有 `file_upload(expectedVersionId)` 覆盖。大范围删改需从完整基线生成最终文件，并在提交前核对文件大小和改动范围符合用户意图；不能把局部补丁被拒绝直接当成整篇覆盖授权。不得把分块读取的一部分作为整篇文件上传。

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

1. 先在服务端实现版本绑定的元数据、范围读取与局部编辑；加入明确的授权、配额、版本、补丁范围和协同测试。大文件读取不得通过浏览器 Markdown 渲染器。
2. 同次开发先并存新旧工具，以相同文件对比读取、编辑和版本结果；对比通过后删除旧的两个 MCP capability/tool 及其桌面封装，最终只发布三个新正文工具。
3. 更新 `docs/agents/capability-registry.md` 的数量和例外、Synapse MCP 描述/schema、内置 Drive Skill、Agent 指南与工具搜索描述；旧工具名调用返回 `Unknown tool`。
4. 对齐浏览器仍使用的整篇 `PATCH /content` 在 Nginx 与应用层的请求体限制。当前应用层允许大文本，通用代理路由却没有相同额度；该问题与本次 46 KiB 故障不同。

## 验收

- 用这次约 46 KiB Markdown 的形态构造回归样本：读取工具不返回 HTML，每个 MCP 响应不超过预算，按游标还原的字节与原文件一致。
- 在中文、emoji、CRLF、长行、转义字符和版本变更中验证游标连续性、UTF-8 完整性、末尾读取、租约续期及固定版本读取。
- 追加与定点插入不要求 AI 提交旧正文；连续两次编辑可直接使用上次返回的版本号。
- 45 KiB 原文被单个或多个 `replace_exact` 缩到 2 KiB 时返回 `DRIVE_FILE_PATCH_TOO_BROAD`、不产生新版本；16 KiB 以上的单个精确替换目标同样被拒绝。普通小范围替换和明确的整篇重建仍可完成；合法的大幅精简被挡住后能按完整基线改走整篇重建，不以拆分补丁规避限制。
- 在中间章节插入、替换和删除时，成功响应只返回最终版本中的改动字节范围；Agent 用该位置读取固定新版本的一块核对落点后再报告完成，不为核对一处修改从头顺序读取大文件。幂等重试返回相同范围，无须保存正文。
- 提交成功后连接中断并用相同 `idempotencyKey` 重试，不得重复追加或新增第二个版本；相同 key 的不同请求必须拒绝。
- 旧版本、重复锚点、缺失锚点和重叠操作都不生成新版本；冲突后重新读取和重做可成功。
- 明显过期、锚点无效和范围过大的补丁在进入协同冻结前失败；协同检查点产生新版本时保留网页草稿、恢复写入并返回冲突；多个操作合并提交只触发一次协同代际切换。持续冲突时一次任务最多自动重做一次，并停止反复暂停网页编辑器。
- 46 KiB 文本默认分块读取；超过 64 KiB 时，已知文件末尾的追加仍可只读 `tail`，具备本地处理能力和写入权限时才默认下载固定版本。用无本地写入权限、1 MiB 和 100 MiB 文本验证 Agent 不强制下载、不为定位一处内容顺序调用数百或数千次分块工具，也不把局部结果报告为全文；仅为处理任务下载的临时副本在任务结束后被清理。
- 文件版本、分享 URL、协同文档切换、配额、权限和审计与现有整篇编辑一致；二进制和分享链接仍不能走 owner 文本补丁。
- 开发对比阶段的新旧读取原文和独立编辑结果一致；最终 MCP 搜索与调用不再提供旧工具，浏览器整篇编辑的契约测试继续通过；生产代理对现有整篇写入的上限与服务端保持一致。
