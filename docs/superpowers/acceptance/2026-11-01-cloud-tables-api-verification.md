# 云端数据表全部 API 复验（2026-11-01）

## 环境与结论

- 仓库：`/Users/liyang/Documents/code/github/Synapse`，分支 `main`；复验起点 `d48d69cf6`。
- 使用现有专项运行器创建随机容器、随机端口与密码的本地 PostgreSQL 16 临时数据库，应用使用真实生产模块图、真实 HTTP、Console 登录 Cookie 和由 Console API 创建的密钥。未连接现有业务库执行写入、故障注入或压力测试。
- 开放 API 19/19、Console API 19/19 均完成成功调用与数据库回读；契约自动比对实际成功调用的全部方法和路径，增加或遗漏接口会导致测试失败。
- 新增 HTTP 套件 9 项、258 次请求；加上原有数据库专项 19 项，共 **28/28 通过**。HTTP 请求数不等同于独立用例数；接口覆盖不代表所有代码分支穷举。
- 测试实际发现并修复两个产品缺陷，保留失败日志后重新验证通过。生产上线验证记录见文末。

## 全部接口覆盖

以下路径统一以 `/api/open/v1` 或 `/api/console` 开头，两种入口均执行完整流程。

| 方法 | 路径 | 主要断言 |
| --- | --- | --- |
| GET | `/tables` | 所有表/指定资源列表、无权表隔离、删除后隐藏 |
| POST | `/tables` | 默认私有、10种字段、建表 scope 与 all_owned 双重要求 |
| GET | `/tables/trash` | 删除表立即出现、只有表主可管理 |
| GET | `/tables/{id}` | 结构版本、权限、跨用户拒绝 |
| PATCH | `/tables/{id}` | 改名、默认值、旧版本409、结构管理权限 |
| DELETE | `/tables/{id}` | 版本校验、普通读取404 |
| GET | `/tables/{id}/schema` | 字段发现、匿名只返回必要结构 |
| PATCH | `/tables/{id}/permissions` | 逐操作匿名权限、own/all/none、撤权立即生效 |
| POST | `/tables/{id}/restore` | 原记录保留、匿名权限关闭 |
| POST | `/tables/{id}/collaborators/resolve` | 通过真实handle解析用户、仅表主 |
| GET | `/tables/{id}/logs` | 固定诊断字段、无数据正文和原始密钥 |
| POST | `/tables/{id}/records/query` | 8种筛选、null/布尔/特殊字符、3字段排序、游标分页 |
| POST | `/tables/{id}/records/batch` | 混合增改删、原子回滚、100条边界、幂等 |
| GET | `/tables/{id}/records/trash` | 删除记录出现、协作者/匿名拒绝 |
| POST | `/tables/{id}/records` | 10种字段回读、必填/默认、最小确认、防伪造创建者 |
| GET | `/tables/{id}/records/{recordId}` | 类型完整回读、本人记录范围、跨表ID拒绝 |
| PATCH | `/tables/{id}/records/{recordId}` | 局部更新保留原值、版本冲突、防修改创建者 |
| DELETE | `/tables/{id}/records/{recordId}` | 版本校验、own/all权限、幂等确认 |
| POST | `/tables/{id}/records/{recordId}/restore` | 版本递增、原值恢复、只有表主 |

每条 Console 路由均额外验证无 Cookie、无效 Cookie 返回401。其他真实 HTTP 验证包括密钥创建、修改资源、修改scope、撤销、有效普通登录JWT不能访问开放API、有效Console Cookie不能升级开放API身份、匿名创建者为null、无效密钥不降级匿名、查询条件/身份/表/结构版本变化使游标失效、并发相同幂等键只写一次、失败事务不保存幂等凭据。

原有专项继续覆盖结构变更与写入竞态、排队后重新检查撤销密钥、实际SQL取消及锁等待超时、归档字段恢复、不兼容结构拒绝、长文本游标、过期回收和清理积压、请求1MiB/记录64KiB/元数据预算及公平调度。

## 发现与修复

1. 文本 `contains` 生成的 `position(... in ... COLLATE "C")` 在 PostgreSQL 中产生42601语法错误，HTTP返回500。为带排序规则的表达式增加括号，真实PostgreSQL验证普通文本、百分号、下划线、引号均按字面包含查询。
2. Console未登录/登录过期时，`UserAuthGuard` 抛出的401被开放API异常过滤器归为500。仅在云表Console鉴权边界将401转为 `UNAUTHENTICATED`，保留统一错误格式；不改变开放API密钥认证或其他模块行为。

修复前记录：`e2e-first-filter-failure.log`、`e2e-red.log`、`e2e-diagnostic.log`。修复后记录：`e2e-green.log`。

## 本次运行结果

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @synapse/server test:cloud-tables:e2e` | 2文件、28项通过；运行器最终删除本次临时容器及其数据库 |
| `pnpm --filter @synapse/server test` | 191文件、2268项通过；24文件/137项按原有配置跳过 |
| Dashboard V2单测 | 143文件、1148项通过；实际运行了完整单测集 |
| `pnpm --filter @synapse/server exec tsc -p tsconfig.build.json --noEmit` | 生产源码类型检查通过 |
| 服务端全源码类型检查 | 云表复验当时被既有 `src/notifications/notification.service.spec.ts:274 TS2493` 阻塞；后续已专项修复并复验，见文末 |
| `git diff --check` | 通过 |

固定负载：两个正常账号各2万条记录、40次查询；同一热点表64次100条批量请求混合匿名和多个密钥。正常账号成功率100%，基线P95 **25.97ms**，过载时P95 **30.01ms**（约1.16倍），核心连接池探针P95 **0.59ms**；热点34次成功、30次受控503。该结果仅代表本机固定负载，不能推断所有生产数据规模。

## 证据与边界

- 可复现入口：`server/test/run-cloud-tables-e2e.mjs`；新增 `server/test/cloud-tables-http.e2e.spec.ts`。
- 本地原始证据目录：`/Users/liyang/Documents/code/github/Synapse/.superpowers/cloud-tables/api-verification-20261101/`，被Git忽略，尚无在线报告链接。
- 本次未重跑浏览器交互验收；Dashboard结果为组件/逻辑单测。完整授权CRUD在隔离应用中验证，不冒充生产账号实测。
- 初始线上无写入检查：健康、V2入口、API文档、OpenAPI、开放API拒绝无效密钥、无凭据CORS均通过；全部路由探测确认Console无效Cookie返回500，已由本地回归复现。

## 修复上线验证

- 修复提交：`245cbb0e6`（修复云表包含筛选与登录异常并覆盖全部API流程），本地提交，未推送。
- 沿用此前用户对后端、Dashboard V2、文档站的部署授权，执行现有 `deploy.sh` 全部19步，467秒完成；保持 `DASHBOARD_UI=v2`，未启用风险迁移或历史邮件清理开关，未执行版本发布、iOS发布或用户通知。
- 生产地址：`https://synapse.d2.pub`；服务器 `root@120.53.17.64`，部署目录 `/www/wwwroot/synapse`。
- 后端镜像：`synapse-server:deploy-20261101_180756`；ID `sha256:0918bfaf3120d5986f467e1e5ab902c98f4eba6653271ba8d56a925db66e19c7`；启动时间 `2026-11-01T10:15:30.169660296Z`（北京时间18:15:30）。后端、PDF渲染器、PostgreSQL均healthy。
- 镜像内再次核实查询括号修复和Console401转换存在，Node为22.23.4。部署构建中的后端、Dashboard V2、文档站均通过；数据库恢复预演和最终备份恢复核验成功，本轮无待执行迁移。
- `production-routes.mjs` 根据线上OpenAPI逐项执行19条开放路由（无效API密钥）和19条Console路由（无效Cookie），**38/38返回预期401**；开放路由统一 `INVALID_API_KEY`。本次探测被鉴权拒绝，不产生业务写入。
- 上线后补充11项冒烟均通过：健康、V2标记/云表入口、API文档、19操作的OpenAPI、匿名目录拒绝、Cookie不升级身份、无效密钥优先拒绝、无凭据CORS，以及已取消分发产物的预期404。生产完整授权读写和压力测试未执行。
- 入口：[云表Console](https://synapse.d2.pub/console/tables)、[API文档](https://synapse.d2.pub/document/open-api/api/cloud-tables)、[OpenAPI](https://synapse.d2.pub/api/open/openapi.json)。
- 回滚镜像：`synapse-server:rollback-20261101_180756`、`synapse-pdf-renderer:rollback-20261101_180756`；切换前备份 `/www/wwwroot/synapse/backups/synapse-final-before-switch-20261101_180756.sql`，PDF回滚状态 `/www/wwwroot/synapse/backups/pdf-renderer-rollback-20261101_180756.state`。本次无数据库结构修改，应用回滚会重新引入上述两个已修复问题。
- 原始证据增加 `deploy.log`、`candidate-runtime.log`、`production-runtime.log`、`production-routes.json`、`production-smoke-final.json`；本地证据目录同上，尚无在线报告链接。
- 交付检查时出现其他任务未提交改动，本次未修改或提交。部署继续按原有白名单并明确排除此测试研究目录，未将这些改动混入部署内容。

## 通知模块类型检查补验（2026-11-01 18:22）

- 用户要求修复上述阻塞后，先重跑 `pnpm --filter @synapse/server typecheck`，再次复现 `TS2493`。原因是测试的 `findMany` mock声明为零参数函数，导致调用参数被推断为空元组，现有断言读取 `call[0]` 时出错。
- 仅为该mock补充 `Prisma.UserNotificationFindManyArgs` 参数类型，保留原有断言及通知业务行为；无需部署或更新产品发布说明。
- 修复后 `pnpm --filter @synapse/server typecheck` 完整通过（包含共享包构建，以及服务端生产源码和单元测试源码的类型检查）。通知服务专项 `pnpm --filter @synapse/server exec vitest run src/notifications/notification.service.spec.ts` 28/28通过；`git diff --check` 通过。
- 原始证据：上述本地目录中的 `notification-typecheck-before.log`、`notification-typecheck-after.log`、`notification-tests.log`。
