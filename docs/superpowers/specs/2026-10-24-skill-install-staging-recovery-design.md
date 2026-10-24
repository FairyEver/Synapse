# Skill 安装暂存中断恢复

## 根因与证据

旧 `replaceDirectoryAtomically` 直接在编辑器 skills 根创建六位随机暂存目录，先写 SKILL.md 和身份文件，再逐一复制附件。成功时 rename 会消耗暂存目录；普通异常也有 catch 清理。但 SIGKILL、崩溃或开发热重启不会执行 catch/finally，旧实现没有后续回收，半成品因此长期暴露为 Skill 入口。

本机两份旧残留的身份都是 synapse-skill，带不同旧 sourceFingerprint，其中一份只有部分附件。日志已轮转，不能确认历史具体中断事件。真实子进程在 populate 及 transaction.json 写入中途被 SIGKILL 的测试均复现了相应回收缺口。

## 安装协议

- 同文件系统创建 `.synapse-install-dir-p<PID>-<6位随机字符>` 容器，实际 Skill 写入其 payload 子目录，根不含 SKILL.md。
- PID 在 mkdtemp 创建目录时已编码到名称中。transaction.json 记录 version、ownerPid、targetName；即使还没创建标记、标记只写了一部分，仍能判断新容器所属进程。
- payload 继续使用现有原子交换和 .env 并发校验。成功和普通错误都通过 finally 回收整个容器，不把 transaction.json 带入正式安装。
- `.synapse-install-backup-*` 是恢复材料，不作为垃圾清理；原有备份保留、冲突和恢复失败协议不变。

## 后台回收边界

`core.editor-install-recovery` 是 degraded、background 的 ServiceRegistry 服务，依赖配置、PermissionGuard 和 AuditSink。复用 listTrustedSkillRoots，只访问编辑器适配器声明的全局和已配置项目 Skill 根，不遍历用户主目录。

- 新 PID 容器：只接受有效正整数 PID；只有 process.kill(pid, 0) 明确报 ESRCH 才回收。活进程、EPERM、PID 被复用等情况保守跳过。PID 重用可能延迟回收，不冒险误动活安装。
- 兼容早期带完整 transaction.json 的六位容器：标记必须是普通小文件，读取前后快照一致，版本和 PID 有效，且所属进程确认消失。
- 旧六位容器无标记：至少 24 小时，并且 `.synapse.json` 可验证、同身份正式安装存在；才作为遗弃暂存回收。正式安装查找排除所有暂存与 backup，自身不能充当匹配。旧空容器同样等待 24 小时。旧目录无法恢复 PID 信息，因此年龄加身份是保守兼容规则，不宣称能证明历史退出事件。
- 软链接、未知身份、格式不明标记、普通隐藏目录、没有正式安装的旧副本、恢复 backup 均保留。
- 回收使用系统废纸篓而非永久删除，包含配置材料的暂存也可恢复。失败保留并结构化记录，下一次启动重试。回收前检查读写权限、复查进程与目录快照，成功/失败/拒绝写入审计；日志不包含原始错误或文件内容。
- 精确系统 actor 的权限策略限制于可信根和匹配目录，随服务存活，到 stop 才注销，避免后台回收完成触发全局权限撤销而影响 Agent 会话。

Agent 的暂存过滤同步识别新旧格式，作为安装正在进行、回收无权限等情况的可见性保护；实际回收不依赖 Agent 创建会话。MCP/schema 和正式 Skill 指南内容均不变。

## 验证与回滚

测试覆盖可发现性、成功/普通失败无残留、真实子进程 SIGKILL（写标记及复制阶段）、活进程、历史残留、非法 PID、软链接、未知文件、读写拒绝、废纸篓失败后重试、恢复备份保留、后台启动接入、SDK 新旧别名过滤及正式文件不变。现有安装、复制和 Skill .env 安全专项继续运行。

回滚此轮提交即可恢复旧安装方式；已经移入废纸篓的历史材料可由用户恢复，不自动移回可加载目录。未新增依赖、配置项、MCP 或发布产物。
