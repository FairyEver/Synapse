# Knowledge Base 长期边界

修改 Knowledge Base、Agent Runtime、Claude SDK 参数、MCP 注册诊断或 Knowledge Base 模板时，必须阅读本文件和 `docs/agents/agent-runtime-security.md`。

## 产品与存储

- Knowledge Base 是 Synapse 托管项目，不是用户可见普通目录。用户看到 `synapse-kb://<id>`；真实 backing directory 位于 Synapse-managed storage，默认使用 Electron `userData`，也可通过全局设置迁移。
- 实际目录固定由 Synapse 创建为 `<storage-root>/knowledge-bases/<runtimeId>/`，不得变成逐库自选项目路径或 renderer 可编辑路径。
- 切换全局 storage root 必须走显式迁移：阻止新会话和写入，拒绝有运行中会话时迁移，完整复制并校验后切换配置，成功后旧目录移入系统废纸篓/回收站。失败保留旧配置和数据，不得自动分叉或回退默认目录写新数据。
- 迁移期间使用不可通过遮罩、Esc、关闭按钮或页面切换关闭的阻塞模态框。复制/校验阶段可取消；配置切换和旧目录清理阶段不可取消，应用退出也必须拦截。
- 迁移恢复状态必须持久化。切换前中断继续用旧位置；切换后验证新位置，失败回滚旧位置；新位置验证成功后即为权威位置，旧目录清理失败不得再回滚。
- 自定义 root 不可访问时，创建、资料管理和 Agent 会话必须停止，只允许重新检测；不得在源恢复前更改位置或静默回退。

## 整库导入与导出

- 整库导入每次只接受一个完整 runtime 文件夹，不接受包含多个 runtime 的 `knowledge-bases/` 父目录，不合并、不覆盖已有知识库。
- 新版导出包必须包含完整 runtime 和 `.synapse-knowledge-base.json`；元数据记录格式版本、原名称、模板版本、导出时间和逐文件 SHA-256。
- 旧版目录可以没有导出元数据，但必须是已知 Synapse runtime，且至少包含 `.claude-plugin/plugin.json`、`skills/`、`commands/`、`CLAUDE.md`、`.raw/.manifest.json` 和 `wiki/index.md`。
- 预检和复制必须拒绝符号链接/目录联接、路径越界、未知 runtime、结构缺失、元数据损坏或哈希不一致。
- 导入使用主进程持有的短期预检令牌，生成新 UUID，先复制到当前全局 storage root 的临时目录，完整校验后原子放置并登记 `synapse-kb://<newId>`。源文件夹始终不修改。
- 导入 journal 必须支持失败、取消和崩溃后清理；未完整数据不得登记，已登记数据不得因日志清理失败而误删。
- 导出单个托管知识库时，目标库不得有运行中 Agent 会话或资料写操作。导入、导出与全局存储迁移互斥。
- 整库导入/导出只处理 Knowledge Base runtime，不包含 Agent 对话、账号、身份或其它 Synapse 配置；不对导入内容自动升级模板或重写路径。

## Runtime 与 Agent

- 托管 Knowledge Base 的 renderer Agent 必须把 backing directory 作为 Claude Code SDK local plugin 加载，并允许模板中已启用的 hooks。
- 普通项目不得加载 Knowledge Base plugin、skill、hook、prompt 或快捷动作。Scheduler、Workflow 等非 renderer Agent 入口也不默认获得该 runtime；只有明确绑定托管 Knowledge Base 且策略允许时才加载。
- `settingSources` 必须包含 `['user', 'project', 'local']`，以保持与用户本机 Claude Code 的 MCP 可见性一致。不得因启用 plugin hooks 删除 `user` settings。
- 不得通过 SDK `mcpServers` 程序化注入“修复”知识库 MCP。Synapse MCP 从用户 Claude Code 配置 `~/.claude.json` 读取，server 名为 `synapse-mcp`。
- Knowledge Base 不做 MCP 隔离；是否允许工具仍走现有权限流程。
- Agent composer slash menu 只插入 `/<name>`，不自动执行/发送，也不在 renderer 侧扫描目录替代后端解析。

## 资料与 native slash

- 资料管理的上传和拖拽都是 raw file copy：原样写入当前 `.raw` 目录，保留文件名和字节。不得自动解析、生成 Markdown、写 `_attachments/originals/` 或维护“原件 + 转换产物”。
- 格式转换或摄入整理通过独立工具、显式命令或 `/wiki-ingest` 处理 `.raw` 中真实存在的文件。
- `/wiki-ingest`、`/save` 等 runtime/plugin 原生 slash 必须原样透传给 Claude SDK；不得变成 renderer 命令、普通 prompt、agent 模拟流程或目录扫描器。
- 路由优先级：已注册 prompt/custom command 和普通 skill 优先；只有命中 `agentNativeSlashAllowlist` 或 `allowAgentNativeSlash` 才进入 native passthrough。未知 slash passthrough 不等于已允许 native slash。
- 发送给 SDK 的内容保持用户完整原文，包括参数；Synapse 只增加外层可观测事件。
- passthrough annotation 只说明 Synapse 已转交，不证明 SDK 内部执行结果；必须在 `liveSession.send(...)` 成功后、读取 SDK/tool 事件前插入。
- annotation 走现有 `sdkEvent`，进入实时 timeline、`agent.events`、history 和导出；稳定 `sdkType` 为 `nativeSlashPassthrough`，summary 只记录命令名，不得记录参数、路径或正文。
- 修改路由、event bridge、history、timeline 或导出时必须测试：注册命令/skill 优先、白名单有 annotation、未知 passthrough 无 annotation、原文发送、失败无 annotation、annotation 不含参数。

## 新建 Runtime

- 模板目录 `desktop/resources/knowledge-base/synapse-knowledge-base-template/` 可同步上游 runtime 后做白标转换；用户数据净化必须发生在创建阶段。
- 新建 runtime 不得继承 demo `wiki/`、`.raw/` source 或示例 manifest。
- 最小 wiki 骨架：`wiki/index.md`、`hot.md`、`log.md`、`overview.md`、`sources/_index.md`、`concepts/_index.md`、`entities/_index.md`、`questions/_index.md` 和空 `wiki/meta/`。
- `.raw/` 重置为 `.raw/.gitkeep` 与空 `.raw/.manifest.json`；manifest 保留 `version`、`sources`、`address_map`，后两者初始为空对象。
- `.vault-meta/address-counter.txt` 重置为 `1`；保留 `tiling-thresholds.json` 等非语义默认配置。
- 保留 `.claude-plugin/`、`skills/`、`commands/`、`hooks/`、`scripts/`、`CLAUDE.md` 等 runtime 资产。
- 创建复制或净化失败时删除本次新目录并抛原错误；清理失败只做结构化 warn，不得留下半初始化目录。
- 测试覆盖 demo 清理、最小骨架、空 manifest、runtime 资产、counter、非语义配置和失败回滚。

## 模板更新与已有库

- 模板不得包含开发机绝对路径或其它不可移植路径；需要路径时基于当前 cwd/backing directory。
- `/save` 默认保存当前对话、结论或洞察为结构化 wiki note，不是一律创建 `.raw` 文件。
- 保存笔记与资料摄入保持语义区分。只有用户明确要求摄入 source/文件，或通过资料管理添加材料时，才写 `.raw`。
- `/wiki-ingest` 只处理 `.raw` 中真实存在的新/变更 source；manifest 更新必须保留已有 `sources` 和 `address_map`，优先复用既有写入能力。
- 上游更新覆盖 `skills/save/SKILL.md`、`commands/save.md` 或 `skills/wiki-ingest/SKILL.md` 后，必须复查保存语义、真实 source、manifest 保留和路径约束。
- 不自动迁移、删除或重写已有用户知识库。清理或迁移必须有显式入口和用户确认。
- SessionStart、会话启动或后台 hygiene 不得为清理模板残留而改写已有 `wiki/`、`.raw/`、manifest、log 或 `.vault-meta/`。
- 旧库中的历史本地路径只能在用户明确触发迁移时窄范围处理；不得重建、清空或批量重写内容。
