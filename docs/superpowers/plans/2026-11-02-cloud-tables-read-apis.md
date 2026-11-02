# Cloud Tables Read APIs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供字段投影、同级AND/OR、条件计数和存在判断，同步API文档。

**Architecture:** 复用当前查询编译、事务鉴权和公平队列。公共筛选编译独立于分页排序，query/count/exists共用；投影在SQL内构造。

**Tech Stack:** NestJS、TypeScript、Zod、Prisma、PostgreSQL16、Vitest、VitePress。

**Spec:** `docs/superpowers/specs/2026-11-02-cloud-tables-read-apis-design.md`（用户已批准）。

## Global Constraints

- 当前main执行，无新分支/worktree；不新增依赖、迁移、MCP、Skill或Console控件。
- 保留scope、ACL、own、软删除、超时、请求预算与游标默认兼容性。
- 完成后仅本任务本地中文提交，不push或部署。
- 用户已要求开始执行，计划直接沿已批准设计执行，无需再申请相同实施授权。

## Review Focus

- OR必须括在业务条件内，不能突破跨表、own或删除边界。
- 空投影返回空values，排序仍使用真实存储值，归档字段必须拒绝。
- 默认all旧游标兼容；改变投影、模式或schema必须拒绝续页。
- count/exists不接受分页参数、不读正文，count不允许安全整数溢出。
- 新入口在HTTP、匿名、只写密钥、撤权及资源限制下行为一致。

---

### Task 1: 查询契约、编译与读取端点

**Files:** `server/src/cloud-tables/cloud-table-{contract,query,service,controller}.ts`；新建`cloud-table-query.spec.ts`、`cloud-table-read.spec.ts`；修改`server/test/cloud-tables{,-http,-agent}.e2e.spec.ts`和`server/test/fixtures/cloud-tables-agent-client.mjs`。

**Interfaces:** `filterSchema`提供filters/filterMode；`filterPlan(fields, filter)`返回安全SQL；`queryPlan(...)`保留原签名并消费fields/filterMode；service新增`records.count/exists`，controller分别路由。

- [x] 写失败测试：querySchema接受fields/any；投影校验；旧游标绑定；COUNT安全范围；SQL层OR和投影；真实PG和HTTP权限及分页。
- [x] 执行单测确认缺失功能失败：9个预期失败，再实现至12项通过。
- [x] 实现共享字段/筛选编译、数据库投影、计数和EXISTS、控制器路由。
- [x] 运行`pnpm --filter @synapse/server run test:cloud-tables:agent`：隔离PG及HTTP/Agent共33项通过。Agent读取本次Markdown与隔离服务的OpenAPI，完成全部21项接口和66次表API请求；100字段投影及JSON类型保真通过。

### Task 2: 机器契约和文档

**Files:** `server/src/cloud-tables/cloud-table-openapi{,.spec}.ts`、`document/open-api/{index,api/cloud-tables}.md`、`docs/agents/module-boundaries.md`、原云表设计、`RELEASE_NOTES_PENDING.md`。

**Interfaces:** OpenAPI新增`countCloudTableRecords`和`existsCloudTableRecords`，响应分别count整数和exists布尔；query文档包含fields/filterMode。

- [x] 写OpenAPI失败测试：16个路径/21个操作、参数默认和严格schema、201响应、read授权、无写幂等键。
- [x] 执行OpenAPI测试观察2个预期失败，再实现契约与用户文档、规则和发布说明。
- [x] 云表单测38项、server typecheck和文档build通过；server全套2440项通过、156项跳过、1项无关失败：独立提交77d48598f的readyz启动脚本与`src/dev-scripts.spec.ts`的旧healthz断言不一致，未混入修复。
- [x] 整体独立只读审阅通过，未发现Critical/Important/Minor；检查diff与暂存范围后本地提交，不push或部署。
