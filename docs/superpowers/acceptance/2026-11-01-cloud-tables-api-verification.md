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
| 服务端全源码类型检查 | 仍被既有 `src/notifications/notification.service.spec.ts:274 TS2493` 阻塞；修复前已存在，本次未修改此文件，不能报告全源码类型检查通过 |
| `git diff --check` | 通过 |

固定负载：两个正常账号各2万条记录、40次查询；同一热点表64次100条批量请求混合匿名和多个密钥。正常账号成功率100%，基线P95 **25.97ms**，过载时P95 **30.01ms**（约1.16倍），核心连接池探针P95 **0.59ms**；热点34次成功、30次受控503。该结果仅代表本机固定负载，不能推断所有生产数据规模。

## 证据与边界

- 可复现入口：`server/test/run-cloud-tables-e2e.mjs`；新增 `server/test/cloud-tables-http.e2e.spec.ts`。
- 本地原始证据目录：`/Users/liyang/Documents/code/github/Synapse/.superpowers/cloud-tables/api-verification-20261101/`，被Git忽略，尚无在线报告链接。
- 本次未重跑浏览器交互验收；Dashboard结果为组件/逻辑单测。完整授权CRUD在隔离应用中验证，不冒充生产账号实测。
- 初始线上无写入检查：健康、V2入口、API文档、OpenAPI、开放API拒绝无效密钥、无凭据CORS均通过；全部路由探测确认Console无效Cookie返回500，已由本地回归复现。

## 修复上线验证

待部署和线上复验完成后补入实际结果。
