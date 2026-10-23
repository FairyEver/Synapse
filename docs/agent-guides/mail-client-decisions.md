# 邮箱实施取舍记录

按两份批准计划顺序实施。以下保留全部 Ruling 原文及代价，按作出顺序归档。它们不构成真实账号或生产发布验收。

## 站内信改名

- Ruling: Work in current main checkout — explicitly required by user and approved plans; no worktree or branch created — changes share the checkout.
- Ruling: Preserve unrelated dirty router/naming files and desktop/coverage; stage only task-owned files.
- Ruling: Normalize task headings to Task N: Rn/Cn so supplied task-start/task-done tools can track both existing plans; no scope change.
- Task 2: Ruling: Rename shared notification source constant with desktop consumers now so type checking remains coherent; server producers and migration follow in R3 before release.
- Task 3: Ruling: Execute migration SQL against isolated in-memory SQLite fixtures to validate update semantics/idempotency without business DB access; actual PostgreSQL preflight remains release acceptance. SourceKey, readAt/deletedAt unchanged.

## 本机邮箱及最终审阅

- Ruling: Inline on current main per explicit user authorization; preserve dirty router/naming. No separate worktree/branch.
- Task 2: Ruling: Persist immutable asset file keys before byte writes, and collect unpinned staging/unreferenced local assets after 24 hours in bounded post-window batches — recovers crashes without touching draft/send pins — unused imported assets older than a day may require re-import.
- Task 3: Ruling: Store immutable credential generations and collect unreferenced secrets after 24 hours — failed account commits cannot overwrite the active credential — unused secrets remain encrypted until maintenance.
- Task 3: Ruling: Require advertised UIDPLUS for precise expunge — SDK IMAP4rev2 support also depends on negotiation state — an IMAP4rev2-only server will report unsupported until explicitly verified.
- Task 4: Ruling: Stop cancels queued account work without waiting while the account lifecycle holds its queue — prevents pause/configuration deadlock; queued work validates the aborted context before IO — cleanup completion is awaited by top-level dispose.
- Task 5: Ruling: Initial body search scans cached text only; explicit resume enables bounded remote text scans — avoids unexpected downloads and preserves truthful incomplete results — users must continue to cover uncached bodies.
- Task 6: Ruling: Add mail tests to the normal test typecheck and compile the not-yet-registered mail production tree through a focused scratch tsconfig — default Electron roots do not reach it before C11; earlier electron tsc success was a workspace check — other pre-existing app-capability test suites remain outside this task's typecheck scope.
- Task 6: Ruling: Search caches text parts separately from the complete display body — remote search counts actual downloaded text bytes without fetching HTML alternatives or attachments — a later display can fetch HTML separately.
- Task 7: Ruling: A mutation that entered network submission but lacks complete confirmation remains unknown; repeat request IDs return its persisted result and do not replay — Alibaba COPY/timeout cannot be safely retried — some outcomes require user reconciliation instead of automatic completion.
- Task 8: Ruling: Expose logical draft content revisions independently from storage CAS revisions — sync status cannot invalidate an editor's unchanged content — internal callers must use the repository revision for metadata CAS.
- Task 8: Ruling: Pin new references before draft commit, release old references afterward, and rebuild counts from pinnedAssetIds under the account queue before cache GC — the global 128-item atomic limit cannot cover 100 attachments — interrupted writes may temporarily retain extra pinned bytes until recovery.
- Task 8: Ruling: Index remote drafts as metadata-only placeholders and hydrate their original MIME on first open — the spec's metadata-first boundary takes precedence over the plan's literal first-index snapshot wording — first open needs network access; unopened drafts do not all download attachments.
- Task 8: Ruling: Unknown draft APPEND reconciliation requires a unique generated Message-ID plus exact complete raw hash within the newest 1000 UID candidates — ID alone is insufficient proof — servers rewriting draft MIME, older results or ambiguous copies remain unknown for manual reconciliation.
- Task 8: Ruling: IMAP endpoint/auth namespace changes rebuild folder IDs and stale old message IDs, preserving local content and marking old remote drafts conflicted; a durable reindexRequired gate survives interruption — a new server may reuse UIDVALIDITY/UID — old links and folder mappings need rebuilding after a connection namespace change.
- Task 9: Ruling: Continue metadata history as separate 50/100-header and 100-flag cycles, closing the work connection and releasing the account queue between them — a monolithic history pass would block foreground read/write actions — reconnecting per batch costs extra handshakes until a shared connection lease is implemented.
- Task 9: Ruling: Add explicit From to the preview DTO and bind frozen content to the authenticated primary address plus connection fingerprint — reviewers need the exact sender and old previews must not target a new server — a connection change requires a new preview.
- Task 9: Ruling: operation.get remains read-only; only a repeated confirmed send request repairs a definitely unsubmitted client Sent copy, and never repeats SMTP — matches the public tool's read-only promise — callers must retry the original send intent to repair a known copy failure.
- Task 9: Ruling: A matching Sent copy confirms archived content but cannot reconstruct lost per-recipient RCPT outcomes; retain SMTP unknown with sentCopyState saved — avoids inventing recipient acceptance — some interrupted sends need manual confirmation even after their copy is found.
- Ruling: use account EventBus domain with trusted rendererIds and owner/generation payload rather than adding a hardcoded EventDomain — preserves extension boundary and prevents broadcasts of mailbox data to other identities.
- Ruling: public MCP results wrap validated DTO as {externalData:true,value}; UI receives raw DTO through private envelope — makes untrusted external content explicit without editing another task's dirty router.
- Ruling: background service assembly is nonblocking and starts after main window; core.mail itself only composes dependencies — avoids delaying startup for network/recovery.
- Ruling: C12 creates panel integration callbacks; C13 immediately binds them to real settings/compose state — keeps the approved sequential UI split, temporary entry buttons remain disabled until next task. This is an intermediate commit, not claimed as a finished mailbox product.
- Ruling: reused the repository's existing envelope PNG for mail, preserving visual conventions without adding a design dependency. Both apps have separate identities and names.
- Ruling: complete safe iframe has fixed viewport with its own scrolling; controlled links appear outside body. No scripts/same-origin or top navigation, no visual/browser acceptance claimed.
- Ruling: six exact Tiptap3.32.0 packages include core and pm as explicit peer dependencies; StarterKit already owns link/underline — avoids duplicate extensions, maintains uniform MIT version. Cost is48 extra transitive packages; candidate bundle audit in C14.
- Ruling: native image NodeView renders private draft-associated bytes, and pasted images save before insertion — avoids loading arbitrary sender/clipboard URLs and supports reopening drafts; failed import/save remains visible and does not insert an unsafe URL.
- Ruling: known failed/unknown sends require explicit new-draft copy rather than a second send button, while unknown offers read-only receipt reconciliation — conservative user flow avoids accidental re-send.
- Ruling: local removal presents explicit draft/unknown-operation acknowledgement flags and relies on core's final impact check; no remote mailbox data deletion. Normal folder actions and mapping share the core service.
- Ruling: actual application/browser visual acceptance remains pending because project forbids app/browser startup without explicit request. Keyboard-capable Radix controls and JSDOM behavior verified, not visual or OS permission acceptance.
- Applied synapse-capability-mcp-skill-audit. Ruling: its historic templates paths are stale; use repository-authoritative app-capabilities/synapse-skill/skill-package instead — root rules explicitly designate it. No changes to old templates.
- Ruling: isolate malformed/oversized envelope as a clearly incomplete item and require original-header review before reply/forward — protects remaining inbox and avoids guessed recipients; affected mail cannot be directly replied to until manually reviewed.
- Ruling: API reference is generated, not hand-maintained; runtime search/invoke schema remains authoritative — prevents drift, costs regenerated50KiB documentation.
- Ruling: use isolated local candidate output with signing auto-discovery disabled (electron-builder applies an ad-hoc signature, not a production certificate) — avoids publishing/notarization or overwriting previous build output; does not prove production signature/update behavior or Windows compatibility.
- Ruling: default check:packaged-asar scans all release history and fails on old release/mac-arm64 hashes; preserve historical artifacts and run the same verifier against release/mail-client-candidate explicitly — current candidate has meaningful source/hash and runtime verification, while whole-history command remains reported as failed. No deletion or weakening of checks.
- Final: Ruling: 保留当前main和已有本地提交，不执行finishing-a-development-branch的分支菜单、合并或推送；沿用计划明确要求的最小充分验证 — 用户已明确当前目录/分支及仅本地提交，重复扩大测试和另建集成流程不在范围内 — 风险是未覆盖的无关模块问题不由本次回归保证。
- Final: Ruling: 保留忽略目录中的实施台账、测试日志与候选审计材料，不执行Skill建议的工作目录删除 — 用户禁止未经授权的破坏性清理，材料有验收价值 — 成本是本机继续占用审计文件空间。
- Final: Ruling: 真实阿里收发、COPY、Sent改写及持续IDLE — 保持真实账号待验，既有mock和旧实验不足以推定新客户端兼容 — 若判断错误会把协议适配缺陷带入真实邮箱，因此不宣称正式验收。
- Final: Ruling: 原生退出、休眠、OS通知和视觉/焦点 — 仅修复源码可确定的导航丢稿，其余保持真实应用待验，未擅自启动应用 — 成本是尚不能保证原生交互通过。
- Final: Ruling: Windows文件系统、安装包和运行时 — 当前环境不外推Windows结论，保留平台验收项 — 成本是Windows交付尚待对应环境。
- Final: Ruling: PostgreSQL生产迁移和多端切换 — 保持发布前预检及协调切换，不访问业务库或部署 — 若遗漏预检会有半迁移风险。
- Final: Ruling: 历史release全目录ASAR失败 — 历史产物保留，当前候选单独使用同一校验脚本，全集失败继续公开记录 — 成本是全目录命令仍不能作为当前候选的单一通过指标。
- Final: Ruling: 正文扫描在开始下一封前预留5MiB单封上限，不引入邮件内偏移协议 — 已允许的正文可在下一批完整扫描，避免误报完整 — 成本是每个20MiB批次可能有不足5MiB的未用预算。
- Final: Ruling: 直接持有锁定版本Nodemailer的SMTPConnection，MIME仍复用现有编译器 — 非池transport.close并不关闭活动连接，必须明确控制底层生命周期 — 成本是升级Nodemailer时需保留真实适配层取消及包内子路径导出检查。

## 独立审阅修复

唯一一次整段审阅由独立上下文的 gpt-6-astra 完成，只读覆盖两份计划的实现提交；没有再次派发复审。两项内容丢失/删除风险和五项正确性问题均进入一次 TDD 修复。

- 永久删除限回收站，混合批次仅处理合法项。
- Dock、启动器返回/重置及转窗口前等待保存；失败保留编辑，异步打开窗口后再次检查新编辑。
- 正文检索不把批次预算截断的余文记作已完成。
- SMTP 取消关闭真实连接，迟到回调不能继续认证或发送。
- prepared 操作恢复沿用持久 MIME、Message-ID 与回执。
- 联系人显示名中的逗号、分号、引号和多语言可往返。
- 原邮件失效后缓存附件公开下载也失效，内部固定内容继续保留。

每项均观察到失败回归再修复；扩大桌面回归285项通过。没有延期小项。最终类型、候选构建及真实验收边界见 `mail-client-acceptance.md`。
