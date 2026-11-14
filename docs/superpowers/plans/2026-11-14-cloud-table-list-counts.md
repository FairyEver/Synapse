# 云表列表记录数实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在当前会话实施；用户已要求直接修改和部署，保留当前目录、main 分支与他人未提交改动。

**Goal:** 云表目录显示精确未删除记录数，读取成本不随记录规模增长。

**Architecture:** 独立统计表、事务触发器和一次性历史回填。目录只读取本页元数据并按现有 read 权限决定返回数字或 null。

**Tech Stack:** PostgreSQL、Prisma、NestJS、React、HeroUI v3。

**Spec:** `docs/superpowers/specs/2026-11-14-cloud-table-list-counts-design.md`

## 约束与重点

- 不逐表 COUNT，不扩大权限，不更新 CloudTable 的共享锁行，不新增依赖。
- 覆盖空表、仅本人可读/仅写/缺少 read scope、整数溢出、事务回滚、幂等及并发。
- 覆盖历史回填和维护硬删除；普通内容修改不得写统计行。
- 只提交本任务改动；部署同步现有工作区，未提交的其他云表修复须明确说明。

## 实施

- [x] 新建列表单测和独立 PostgreSQL 计数集成测试，先确认未实现时失败。
- [x] 添加 Prisma 统计模型、事务迁移及触发器，生成客户端；列表附带受权限约束的 recordCount。
- [x] 增加 Console 记录数列和显示回归，先红后绿。
- [x] 同步类型、OpenAPI、文档、系统指南、模块边界和待发说明。
- [x] 跑云表专项、真实 PostgreSQL 集成测试、类型检查、构建、UI 检查，审查本任务 diff 并本地提交。
- [x] 执行 bash deploy.sh，等候部署结束，核对生产迁移、计数、列表读取计划及在线资源。

## 验证与审查记录

- 列表6项、Dashboard显示3项和最初3项数据库集成回归均先观察到缺少功能导致的失败，再通过实现验证。
- PostgreSQL 16.15 隔离库：最终47项集成测试通过，含361次真实HTTP请求；云表及迁移风险单测106项通过，Dashboard云表单测36项通过。
- 服务端类型检查、服务端构建、Dashboard生产构建（含类型和check:ui）通过。Dashboard既有非module脚本和大chunk提示仍存在；没有启动浏览器或执行视觉验收。
- 整套集成测试最初因旧登录夹具缺少Origin返回403；测试入口固定本地APP_PUBLIC_URL并补齐合法Origin后全套通过，生产来源校验保持原样。
- 独立只读审查发现混合批次与单条删除可能反向等待统计/记录锁。新增受控真实数据库回归，先复现55P03，再通过统一“统计行→记录行”顺序修复并重跑全套47项通过。普通内容更新仍不加统计锁。
- 只读审查未发现其他具体问题；记录移动、TRUNCATE不属于现有产品API，同表计数行仍有少量写入竞争，已有公开count端点不在本次性能改动范围。
- 本地测试和构建日志位于 `/tmp/synapse-counts-pg.aNuGxr/`，尚无在线链接。

## 生产部署结果

- 2026-11-14 执行 `bash deploy.sh` 成功（退出码0，805秒），部署标识 `20261114_093610`。服务端与PDF镜像均为 `deploy-20261114_093610`，容器健康；实际Node运行时分别为22.23.4、24.22.1。
- 来源为 `/Users/liyang/Documents/code/github/Synapse` 当前 `main` 工作区。本次部署包含原有已提交的云表多值筛选修复 `eb0e604d4`，未推送Git或发布桌面/iOS版本。
- 临时库迁移预演及最终备份恢复验证均成功；生产数据库 `synapse` 已完成 `20261114120000_cloud_table_record_counts`，三个统计触发器启用。
- 通过当前登录账号的生产MCP读取表列表，12张表均返回非负安全整数 `recordCount`；统计读取计划使用 `CloudTableStats_pkey`，不读取记录表。没有在生产创建测试数据或再次扫描业务记录计数。
- [表列表](https://synapse.d2.pub/console/tables)及线上 `tables-BKwtRqjx.js` 均返回200，后者包含recordCount及“记录数”。服务端、PDF、Console/Admin、文档、更新页及分享路由健康检查最终通过；启动过程中前两次探测短暂出现连接中断/502，第三次通过，没有回滚。
- 备份：`/www/wwwroot/synapse/backups/synapse-final-before-switch-20261114_093610.sql`；回滚镜像 `synapse-server:rollback-20261114_093610`（PDF同标识）。回退旧代码时同时评估新增触发器及统计锁顺序，按部署脚本输出的手工数据库恢复指引处理；恢复前核对切换后新写入，不能仅依赖镜像回退。
- 本机专用测试PostgreSQL已停止；部署日志位于 `/tmp/synapse-counts-pg.aNuGxr/deploy.log`，尚无在线链接。
