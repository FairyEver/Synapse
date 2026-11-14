# 云表多值筛选修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 多值筛选复用现有 JSONB 索引，同时保持既有查询语义。

**Architecture:** 修改现有 filterPlan 的 in 分支，与 eq 共享非空业务字段的包含谓词；不变更接口和存储。

**Tech Stack:** TypeScript、Prisma SQL、Vitest、PostgreSQL。

**Spec:** docs/superpowers/specs/2026-11-14-cloud-table-in-query-design.md

## Global Constraints

- 当前 main，不创建分支/worktree，不新增依赖、迁移或索引。
- 保留查询的权限、软删除、游标和类型边界。
- 不停止/重载 TeamRobot PR 服务，不中断正在执行的审核。

## Review Focus

- null 候选继续匹配缺失字段和显式 null。
- false、0、空字符串不得被丢弃。
- 日期候选统一 UTC；系统字段保持原来的 timestamp 比较。
- 多值 OR 仍被表/权限/游标边界包围。
- 拒绝非法候选和超过100项的输入；不改变游标签名。

### Task 1: 修复多值筛选并验证

**Files:** server/src/cloud-tables/cloud-table-query.ts、cloud-table-query.spec.ts、server/test/cloud-tables.e2e.spec.ts、RELEASE_NOTES_PENDING.md、docs/agents/module-boundaries.md。

**Interfaces:** 保留 filterPlan/queryPlan 的签名和返回类型。

- [x] Step 1: 添加业务字段可索引多值、混合 null、false/0/空字符串和日期归一化测试；隔离数据库验证候选匹配与分页。
- [x] Step 2: 运行新增回归并观察旧实现的性能谓词测试失败。
  Run: `pnpm --filter @synapse/server exec vitest run src/cloud-tables/cloud-table-query.spec.ts`
  Expected: 新增可索引多值测试失败，原有测试通过。
- [x] Step 3: 复用 eq 的非空 JSONB 包含谓词，保留 null/系统字段路径；同步说明和发布记录。
- [x] Step 4: 运行云表单测、现有 server 全部单测、类型检查和构建；有本机 PostgreSQL 时运行隔离 e2e；只读核对生产计划。
  Expected: 全部实际运行的检查通过；不可运行项单独记录。
- [ ] Step 5: 独立审核后仅提交本次任务；记录部署门槛与回滚提交，不推送或触发整版发布。

## 实际验证与上线门槛

- 旧实现新增5项回归失败；修复后查询单测18/18通过。完整server单测在Homebrew OpenSSL3环境下2330通过、3跳过；初次系统LibreSSL不支持verify_hostname导致1项失败，调整测试PATH后通过，未修改证书业务。
- server类型检查和构建通过。本机隔离PostgreSQL16服务专项29通过、1项Console启动测试排除；完整e2e中该登录及HTTP套件初始化因既有调用缺少Origin而403，HTTP全链路未通过，未放宽来源检查。
- 生产只读8候选SQL使用BitmapOr/GIN，实际执行6.581ms；这不是已部署REST接口的耗时。
- 独立审阅无Critical/Important。非阻断补充留待后续：真实缺失键fixture（当前空对象写入会补null）；100/101/空候选数量边界测试。对应生产空值比较和100项校验保持原样。
- Ruling: 单实例API切换仍会影响在途请求，因此先准备只包含本次编译模块的补丁镜像，等待MacMini确认安全窗口再切换。代价是生产暂时继续旧IN行为；不运行含无关资源退役与迁移的完整deploy.sh，不触碰PR主服务。
