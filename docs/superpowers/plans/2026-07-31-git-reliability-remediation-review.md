# Git 可靠性问题修复复盘

## 结论

前轮逐项复现确认的 12 项问题与本轮补充确认的 10 项问题均会影响真实用户路径、数据安全或状态可信度，不属于既有 Non-Goal；因此均进行了结构性修复。远程分支管理、合并编辑器、stash、cherry-pick、tag、reset、force push、LFS 和 submodule 管理仍为 Non-Goal。

| # | 复现与用户影响 | 缺陷定性 | 修复与验证 |
|---:|---|---|---|
| 1 | 目录选择器返回已存在目录，旧实现直接作为 clone 目标，必然失败 | 明确缺陷 | 改为父目录 + 单段目录名，主进程计算最终路径并拒绝覆盖；真实 bare remote 克隆测试通过 |
| 2 | 新分支无 upstream 时 ahead/behind 都为 0，界面误报已同步 | 明确缺陷 | Snapshot 增加 tracked/untracked/detached；首次推送选择远端并执行 `--set-upstream`；真实远端验证 upstream |
| 3 | 文件同时有暂存与未暂存内容时，预览与路径提交语义不一致 | 数据完整性缺陷 | 预览统一为 HEAD 到工作树，提交前完整暂存所选路径；真实混合 index 测试确认提交内容等于预览工作树 |
| 4 | remove 的 trash-local 可作用于任意登记路径 | 高危安全缺陷 | 删除本地删除能力、IPC 与 UI；添加时 realpath + Git 顶层目录校验，移除只删注册记录 |
| 5 | 分叉冲突时 `rebase -X theirs` 会静默选择远端内容 | 数据完整性缺陷 | 使用普通 rebase；仅中止本次启动的冲突 rebase，停止 push 并进入错误/attention 流程 |
| 6 | 未跟踪文本没有 index，普通 diff 返回空 | 明确缺陷 | 使用 `git diff --no-index /dev/null file`，将退出码 1 视为正常差异；真实未跟踪文件测试通过 |
| 7 | SSH URL 的用户名/端口丢失，首次主机确认依赖交互终端 | 兼容性与安全缺陷 | descriptor 保留用户名/端口；严格校验、扫描 SHA-256 指纹、确认后原子写 known_hosts；changed key 禁止覆盖 |
| 8 | 错误模型声明 retry，但界面没有处理器 | 明确交互缺陷 | 操作控制器保留非敏感操作闭包；仅网络/超时原样重试，non-fast-forward 转工作台处理 |
| 9 | 多窗口对同仓库并发写会竞争 index.lock | 并发可靠性缺陷 | 真实 Git 根路径键控 FIFO，System App 与内容仓库共用锁；读取等待写入，锁不再按固定时间强制释放 |
| 10 | 预览输出超过默认 1 MiB 时受控进程失败 | 确定性边界缺陷 | 通用输出增加 error/truncate 策略；diff/detail 以 UTF-8 安全方式截断到 2 MiB 并显示提示 |
| 11 | 弱网 Git 进程只能等待超时 | 设计契约缺口 | 客户端 operation ID、AbortController、取消 IPC 与状态事件贯通；排队任务可移除，运行任务终止进程组后刷新状态 |
| 12 | 配置 helper 先 unset-all，会破坏企业多 helper 链 | 配置破坏缺陷 | 读取完整来源链并分类；外部/多 helper 只读，唯一用户级明文 helper 使用 replace-all 并在失败时恢复 |

## 本轮补充复盘

| # | 复现与用户影响 | 缺陷定性 | 修复与验证 |
|---:|---|---|---|
| 13 | 内容同步使用自动选边 rebase，同一行冲突会静默覆盖一侧内容 | 严重数据完整性缺陷 | 唯一安全 rebase 只执行普通 `pull --rebase`；冲突时仅中止本次 rebase。真实双端仓库确认本地内容和双方提交仍可达 |
| 14 | 自动内容提交沿用共享 index，用户预先暂存的无关文件会进入自动提交 | 严重数据完整性缺陷 | 统一使用规范化相对路径、literal pathspec 和 path-limited commit；真实仓库确认目标提交与用户 index 相互隔离 |
| 15 | 内容写文件、提交、pending 入队和后台 push 分别加锁，事务中间可被同仓库操作插入 | 并发一致性缺陷 | 以真实 Git 根目录为键建立完整变更事务；公开加锁入口与已加锁内部入口分离，System Git、内容 Git、维护与后台 push 共用协调层 |
| 16 | commit 成功后 pending 写入失败或进程退出，数据库无法证明存在待推送提交 | 状态一致性缺陷 | pending 仅保留元数据；快照以 upstream ahead 为事实，并在无 upstream 时检查所有远端均不存在的本地提交；结果明确返回 `recovery-needed` |
| 17 | HTTP 被当成 HTTPS，非默认端口在凭据 approve/reject 中丢失 | 认证兼容性缺陷 | remote、IPC、preload、renderer 与 credential 输入保留 `http`/`https`、host、port、username；保存和清除共用完整上下文，并覆盖 IPv6 |
| 18 | 注册表从有效备份读取后不修复主文件，后续启动仍可能丢仓库 | 持久化缺陷 | 结构校验后原子恢复主文件；主备均损坏时保留证据并显式报错，不再返回空列表 |
| 19 | 提交文件列表没有与 diff 同等的输出限制，大提交详情可能失败或占用过量内存 | 稳定性缺陷 | 文件列表与 diff 分别限流，返回 `filesTruncated`、`diffTruncated` 及兼容聚合字段，UI 分区提示 |
| 20 | 默认 push remote 可能取配置中的第一个远端 | 行为缺陷 | 严格执行 `branch.pushRemote` → `remote.pushDefault` → `branch.remote` → `origin` → 唯一远端；仍不明确则要求选择 |
| 21 | 快速切换历史提交时，较慢的旧详情响应可覆盖新选择 | 交互一致性缺陷 | 仓库、列表和选择变化递增请求代次，只有最新请求可更新详情、错误和 loading；反转响应顺序测试通过 |
| 22 | 自动提交通过 local config 写入 Bot 身份，污染用户后续手工提交 | 仓库兼容性缺陷 | 用户完整身份优先；任一字段缺失时仅在本次 commit 命令注入完整 Bot 身份，操作前后不写仓库配置 |

## 验证边界

Git 定向测试覆盖路径语义、仓库边界拒绝、tracking、首次推送、精确提交、FIFO、跨仓库并行、取消、分区截断、HTTP/HTTPS/SSH、非默认端口、IPv6、注册表恢复、远端优先级、历史请求竞态和 credential helper，共 30 个测试文件、255 项测试通过且没有 React `act(...)` 警告。真实临时仓库覆盖同一行冲突、用户预暂存隔离、命令级 Bot 身份、无 upstream 的本地提交恢复、克隆、未跟踪文件 diff 与首次推送建立 upstream。desktop 全量测试、TypeScript typecheck 和 `check:hard-constraints` 均通过；全量测试仍输出非 Git 模块已有的日志环境与 React 测试警告，本轮未越界修改这些模块。
