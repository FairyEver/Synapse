# 云表 Agent 管理 API 核对（2026-11-01）

## 目标与边界

用户要求建表、表配置、字段配置、权限等全部面向AI、Agent和Skill开放，同时管理操作必须使用本人身份和授权。沿用此前“不提供独立Skill”的决定，由开放REST、OpenAPI、可整页复制的Markdown供Agent或用户现有Skill调用；不新增桌面入口、MCP、Skill安装包或依赖。

仓库 `/Users/liyang/Documents/code/github/Synapse`，分支 `main`。核对后确认业务实现已覆盖全部19项API，本轮不改变身份、业务授权或数据库结构。

## 身份与管理能力核对

- API建表：密钥所属用户为新表表主，需 `tables.manage` 加 `all_owned`，不要求事先在Console建表。
- 已有表配置：改名、完整活动字段列表更新、字段归档/恢复、匿名配置、协作者解析/授权、整表删除/恢复、记录回收站、操作日志均有API；须表主身份、`tables.manage`及表资源范围。
- 协作者使用本人密钥并获得表授权，可发现结构及操作授权范围内的记录；管理scope不能使协作者成为表主，也不隐含记录读写scope。
- 官方Console使用本人登录状态和独立接口；开放API只接受密钥或匿名，不接受Cookie或普通登录Token。分享网页仅执行显式开放的匿名操作，不能取得管理能力。
- 用户初始创建密钥及扩展scope/资源由Console完成；云表API不会替Agent自动签发或扩大密钥权限。

## 补齐的 Agent 入口

1. 文档的准备流程提供“Agent从零建表”和“只操作已有表”两条路径，明确不必先手工建表。
2. 增加调用身份矩阵和从发现契约、建表、配置字段/权限、记录操作、导出、日志到恢复的完整调用顺序；说明完整替换字段与授权配置的副作用、版本用途、权限不足时停止。
3. 19个OpenAPI操作增加摘要和各自的scope、表主要求、分页、最小响应及副作用，供Agent直接发现管理能力。
4. 修正OpenAPI错误声明的幂等请求头：仅建表、记录新增/修改/删除及批量写入声明 `Idempotency-Key`，不在查询或记录恢复上暗示幂等保证。
5. 同步开放接口入口页、模块边界和待发布说明。没有恢复独立Skill下载，也没有修改已有权限模型。

## 本次验证

- 修复前新增的两项OpenAPI测试失败，证明管理操作缺少说明、查询和记录恢复错误声明幂等键；修复后通过。
- `pnpm --filter @synapse/server exec vitest run src/cloud-tables src/api-keys src/open-api`：18文件、90项通过。
- `pnpm --filter @synapse/server test:cloud-tables:e2e`：临时PostgreSQL16，2文件、28项通过；新增HTTP套件258次请求，19项开放API和19项Console API成功路径全部覆盖；包括协作者持有全部云表scopes仍不能管理他人的表、Cookie不升级身份、普通JWT拒绝及撤权检查。临时容器由运行器清理。
- `pnpm --filter @synapse/server typecheck`：完整通过，包含服务端单元测试源码。
- `pnpm --filter @synapse/document build`：通过。
- `node --test scripts/__tests__/document-copy-markdown.test.mjs scripts/__tests__/document-deployment-links.test.mjs`：8项通过。
- `git diff --check`：通过。

原始日志位于 `/Users/liyang/Documents/code/github/Synapse/.superpowers/cloud-tables/agent-api-contract/`（Git忽略，无在线报告链接）。本轮不做生产数据写入或压力测试，不以本地测试冒充生产完整授权CRUD。
