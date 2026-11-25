# 状态同步（State Sync）与统一开放 SDK 分发 v1 设计文档

日期：2026-11-25  
状态：已确认  
适用范围：`server/`、`sdk/`、`dashboard/`、`document/`、`desktop/`（MCP 与系统 Skill）

---

## 1. 背景与设计意图

Synapse 已提供两块平行的云端开放基础能力：
- **云端数据表（Cloud Tables）**：面向持久化结构化数据、筛选查询与记录治理，刻意不做实时订阅；
- **频道（Channels）**：面向固定频道的低延迟实时事件流与遥控信号，刻意不做多房间动态 JSON 状态树。

用户希望在 Synapse 服务端补齐第三块平级能力——**状态同步（State Sync）**（对标野狗云 Wilddog Sync 的实用版体验），并在同一期打通 Synapse 的**统一开放 SDK 构建与静态分发底座（`/sdk/...`）**：

1. **零后端的多人实时互动 / 在线小游戏网页**：AI 可以直接生成一个纯静态网页（配合 Drive 网页分享发布），玩家 A 打开网页点击「开一局」即可动态创建一个状态同步房间并拿到房间 ID 分享给玩家 B，多端通过一棵实时同步的 JSON 树完成联机对战、状态协同或跨端面板同步，省去自建实时后端的成本。
2. **统一、可扩展的开放 SDK 分发通路（无需 npm）**：将状态同步客户端封装为零依赖、浏览器与 Node.js 共用同一源码的轻量 SDK，随主仓库构建并由服务端 Nginx 静态暴露在 `/sdk/...`，提供公开的 `manifest.json` 供 AI 查询最新版本、获取直链与嵌入模板。该通路跑通后，后续「频道」「云表」等能力也可按同一规范接入 SDK 分发。

三块开放能力分工明确：
- **云端数据表**：持久化结构化业务记录与查询；
- **频道**：无共享状态树的事件广播、远程命令与信号流转；
- **状态同步**：以“空间 → 动态房间（独立 JSON 树）”为核心的多端共享状态实时同步。

---

## 2. 目标、非目标与反目标

### 2.1 目标（Goals）
- **两层资源隔离模型**：提供与云表、频道平级的「同步空间（Space）」及空间下可动态创建的「房间/文档（Doc）」，每个房间是一棵彼此隔离的 JSON 对象树，支持空闲 TTL 自动清理。
- **野狗式实用同步原语**：支持按路径 `set` / `patch` / `delete`、可选 `expectedRev` 乐观锁（防同时落子/抢占覆盖）、路径前缀实时订阅（含祖先节点覆写自动重算快照）、短窗口断线增量补发、`onDisconnect` 掉线自动写入钩子及轻量在线成员感知（Presence）。
- **最小权限免登录接入**：沿用 `UserApiKey`（新增 `state_sync.*` scope 与空间范围）以及「空间专属客户端凭证（`sys_...`）」；纯静态网页仅需持有单空间凭证即可动态开房与同步，无需暴露账号级密钥，且无法列举空间内他人的房间。
- **统一开放 SDK 分发底座**：新增顶层工作区包 `sdk/`（`@synapse/sdk`），一套零依赖 TypeScript 源码产出浏览器全局脚本、ESM、Node CommonJS 与 `.d.ts`，随 `server/Dockerfile` 构建并由 Nginx 托管于 `/sdk/...`，通过 `/sdk/manifest.json` 暴露最新版本与文件清单，保留冻结历史精确版本快照防老网页 404。
- **与频道对齐的三大产品入口**：Dashboard Console「状态同步」管理页（含房间实时 JSON 树调试台与 API Key 范围配置）、可整页复制给 AI 的开放文档（含 SDK 发现与接入指南）、桌面端 `state_sync` MCP 工具域与系统 Skill。

### 2.2 非目标（Non-Goals）
- **不做跨房间查询、二级索引或全文检索**：结构化查询需求归属「云端数据表」。
- **不做 Firebase/Wilddog 式声明式安全规则 DSL**：权限边界通过“空间隔离 + 凭证角色 + 房间高熵 ID 不可列举”保障，避免引入复杂规则引擎。
- **不做富文本/数组级 CRDT 离线冲突合并**：并发列表推荐采用对象 Map（`{ [id]: item }`）替代数组下标写入；同字段并发写通过服务端到达顺序（LWW）或 `expectedRev` 乐观锁（SDK 封装 `transaction` 自动重试）解决。
- **不做完整修改历史审计库或长时离线写队列**：仅保留内存中短窗口变更缓冲供断线补齐，不落盘操作流水表。
- **不发布到公开 npm 仓库、不新建公有读 COS 桶或独立 CDN 运维链路**：SDK 随容器镜像构建由 Nginx 静态托管（未来需要加速时可在域名前直接挂 CDN 回源 `/sdk/`）。
- **不做多副本分布式集群协调**：v1 延续单实例 NestJS + PostgreSQL + `ws` 架构，代码中保持内存 `StateSyncHub` 接口边界清晰。
- **不新增桌面 System App、默认 Dock、Workflow Node、Automation Action、Deep Link 或移动端原生页面**。

### 2.3 反目标（Anti-Goals，出现即视为设计失败）
- **逼迫用户把账号级个人 API Key（`syk_...`）写进公开小游戏网页**才能动态创建房间。
- **持有空间客户端凭证的前端可以枚举或窥探他人的房间**。
- **长效凭证出现在 URL Query 中**（防止进入代理日志、Referer 与浏览器历史）。
- **高频小游戏写入打满 Synapse 单机 PostgreSQL 连接池，或慢消费者拖垮桌面/移动端/频道现有 WebSocket 网关与主业务**。
- **SDK 升级后导致已发布的旧静态网页失效（404 或破坏性 API 变更）**。

---

## 3. 备选方案与选型结论

### 3.1 状态同步服务端架构选型

| 方案 | 核心思路 | 主要优点 | 主要代价 / 取舍 |
|---|---|---|---|
| **方案一：独立模块 `server/src/state-sync/` + 内存权威状态树（热路径串行，防抖异步刷盘）+ `sdk/` 静态构建（已选定）** | 新建与 `channels`、`cloud-tables` 平级的服务端模块；活跃房间 JSON 树驻留内存并按 `docId` 串行写与毫秒级广播；创建/删除房间与 HTTP 写立即同步落 PG，WS 实时写按 500ms 防抖（上限 2000ms）+ 末连断开刷盘 + 优雅停机全量刷盘。 | 小游戏/互动页高频 `patch` 延迟极低；保护单实例主 PostgreSQL 不被高频行锁拖垮；与 `channels` 彻底隔离零回归；正常重启/空闲退房可从 PG 完整恢复。 | 极端断电或 `kill -9` 强杀时，最近 ≤2 秒内未刷盘的 WS 内存变更可能丢失（定位为实时共享状态而非强账本存储，完全可接受）。 |
| **方案二：独立模块 + 每次 WS 写入强制同步落 PostgreSQL（Write-Through）** | 模块边界和 SDK 同方案一，但每条 WS `set/patch/delete` 必须先提交 PG `UPDATE` 事务成功后再广播。 | 强持久保证，服务端无需维护脏房间定时刷盘与停机刷盘逻辑。 | 高频路径小改都要整棵 JSONB 写盘并持有行锁，延迟显著升高，易挤占 Synapse 主库连接池影响云盘/云表/主站业务。 |
| **方案三：复用 `channels` 在客户端 SDK 模拟状态树（排除）** | 不新建服务端模块，在现有频道 `publish/retain` 之上由客户端拼接 JSON 状态。 | 服务端改动极小。 | 无两层空间→动态房间隔离与 TTL 自动清理，无服务端权威路径合并、乐观锁与 `onDisconnect`，双端并发写极易整包覆盖，无法满足目标。 |

### 3.2 SDK 分发托管选型

| 方案 | 核心思路 | 主要优点 | 主要代价 / 取舍 |
|---|---|---|---|
| **方案 A：仓库 `sdk/` 源码随 `server/Dockerfile` 构建，Nginx 托管 `/sdk/`（已选定）** | 新增 `@synapse/sdk` 工作区包，构建产物 + 冻结历史版本 + `manifest.json` 打包进镜像 `/app/sdk`，由容器内 Nginx 直接强缓存静态返回。 | 复用现有 `deploy.sh`，零新增云桶/CDN/证书运维；SDK 与服务端协议版本天然同步；Drive 网页分享同源加载天然过 CSP 且省握手。 | 静态流量经当前服务器 Nginx（单个 SDK 仅 ~6–10 KB 且强缓存 1 年，负载极低；未来可无缝前置 CDN 回源）。 |
| **方案 B：腾讯云 COS 独立公有读桶 + 自定义域名/CDN** | 新建独立公开读 COS 桶（不与现有 5 个私有 COS 桶混用），发版时额外运行脚本上传产物。 | 静态流量完全脱离业务服务器，适合未来托管超大二进制/媒体资产。 | 需新增并维护公有读桶、CORS、HTTPS 域名/CDN、独立上传凭证与双步发版回滚流程，首期过重。 |

**选型结论**：采用 **状态同步方案一 + SDK 分发方案 A**。

---

## 4. 核心领域模型与数据边界

### 4.1 持久化数据（PostgreSQL / Prisma）

1. **`StateSyncSpace`（同步空间）**
   - `id`: `String @id`（格式 `ss_<cuid>`，设计者拍板）
   - `ownerId`: `String`（关联 `User.id`，`onDelete: Cascade`）
   - `name`: `String @db.VarChar(100)`（必填显示名）
   - `description`: `String @default("") @db.VarChar(500)`（可选用途说明）
   - `defaultDocTtlSeconds`: `Int? @default(86400)`（房间默认滑动过期秒数；`null` 表示永不过期，非空允许范围 `60` ~ `2592000` 即 1 分钟～30 天；**设计者拍板**）
   - `maxDocs`: `Int @default(100)`（该空间允许并存的最大未过期房间数，范围 `1` ~ `500`，防止客户端凭证被滥用刷爆空间；**设计者拍板**）
   - `createdAt` / `updatedAt`: `DateTime`
   - `@@index([ownerId, createdAt])`
   - **设计者拍板**：v1 删除空间采用**直接删除**（立即以 `4003` 断开该空间下所有房间的活跃 WS 连接，级联删除其全部 Token 与 Doc，不做 30 天回收站 UI）。

2. **`StateSyncToken`（空间专属客户端凭证）**
   - `id`: `String @id`（格式 `sst_<cuid>`）
   - `spaceId`: `String`（外键 `StateSyncSpace`，`onDelete: Cascade`）
   - `name`: `String @db.VarChar(80)`（用途备注，如“双人井字棋网页凭证”、“观战只读凭证”）
   - `role`: `String @db.VarChar(24)`，枚举三值：
     - `read`：凭已知 `docId` 读取和订阅房间 JSON 状态、查看 Presence；**禁止**创建房间、写入状态或注册 `onDisconnect`。
     - `write`：凭已知 `docId` 读写房间 JSON 状态、注册 `onDisconnect`、查看 Presence；**禁止**创建或删除房间（适合由自有后端/AI 提前开房后分发 `docId`）。
     - `create_write`：具备 `write` 全部能力，且**允许通过运行态接口动态创建新房间**（服务端自动生成高熵随机 `docId`）；**禁止**列举空间内其他房间、**禁止**删除房间（房间清理交由 TTL 自动过期或管理端显式删除；**设计者拍板**）。
   - `tokenHash`: `String @unique @db.VarChar(64)`（SHA-256；明文前缀 `sys_`，仅创建时返回一次，永不落盘明文）
   - `tokenPrefix`: `String @db.VarChar(24)`（如 `sys_xxxxxxxx`）
   - `lastUsedAt`: `DateTime?`（内存节流异步刷新）
   - `revokedAt`: `DateTime?`
   - `createdAt`: `DateTime`
   - `@@index([spaceId, revokedAt, createdAt])`
   - **设计者拍板**：每空间默认最多 **20 个**有效凭证；撤销凭证立即以 `4003` 断开使用该 `tokenId` 的所有活跃 WS 连接。

3. **`StateSyncDoc`（房间 / 同步实例）**
   - `id`: `String`（**设计者拍板**：由 `create_write` 动态创建时，服务端强制生成高熵不可预测 ID `ssd_<22位Base64URL>`（≥128 bit 熵）；通过 Console / MCP / `state_sync.manage` API Key 创建时，可选传入自定义 ID 匹配 `^[a-zA-Z0-9._:-]{3,64}$`，留空则自动生成高熵 ID）
   - `spaceId`: `String`（外键 `StateSyncSpace`，`onDelete: Cascade`）
   - `data`: `Json @default("{}")`（根节点强制为 JSON Object `{}`，UTF-8 序列化上限 **256 KiB**）
   - `rev`: `BigInt @default(0)`（每房间严格单调递增版本号）
   - `ttlSeconds`: `Int?`（房间实际采用的滑动 TTL；创建时可传小于等于空间默认值的 TTL，若空间默认非空则客户端不可通过传 `null` 绕过过期限制）
   - `expiresAt`: `DateTime?`（非空时，写入或连接活跃时按 `now + ttlSeconds` 滑动续期，并节流回写）
   - `createdAt` / `updatedAt`: `DateTime`
   - 复合主键：`@@id([spaceId, id])`（不同空间的自定义房间名互不冲突）
   - 索引：`@@index([spaceId, updatedAt])`、`@@index([expiresAt])`

4. **`UserApiKey` 扩展（对齐 `channels` 与 `cloud-tables`）**
   - 在 `server/src/api-keys/api-key-capabilities.ts` 新增 3 个 Scope：
     - `state_sync.manage`：管理同步空间、空间凭证与房间（含列举、自定义 ID 创建与删除房间）。
     - `state_sync.read`：读取与订阅授权空间下的房间状态与 Presence。
     - `state_sync.write`：写入授权空间下的房间状态、动态创建房间与注册 `onDisconnect`。
   - `UserApiKey` 新增字段：
     - `stateSyncAccessMode`: `String? @default("selected") @db.VarChar(16)`（`"selected"` | `"all_owned"`）
     - `stateSyncSpaceIds`: `String[] @default([])`
   - 扩展 `ApiKeyChangeNotifier` 的 `updated` 事件，携带 `stateSyncAccessMode` 与 `stateSyncSpaceIds`。
   - 安全不变量：已有 API Key 默认无任何 `state_sync.*` scope、`stateSyncAccessMode = "selected"`、`stateSyncSpaceIds = []`；仅同时拥有 `all_owned` 与 `state_sync.manage` 的 API Key 允许通过 Open API 创建新空间。

### 4.2 内存运行时态（单实例 `StateSyncHub`）

- **懒加载与闲置淘汰**：活跃房间以 `Map<"${spaceId}:${docId}", ActiveDocState>` 驻留内存。首次建连或读写时从 PostgreSQL 加载；当房间无活跃连接、无待刷盘脏数据且闲置超过 **5 分钟**时自动从内存淘汰（数据保留在 PostgreSQL 直至过期）。
- **单房间串行写队列**：每个 `ActiveDocState` 维护严格串行的写队列（Promise 链），所有 WS `mutate`、HTTP `PATCH`、`onDisconnect` 执行与房间删除都经该队列顺序处理，确保内存 JSON 树、`rev` 递增与广播顺序完全一致。
- **路径前缀树订阅表（Subscription Trie）**：每房间内存维护按路径段切分的 Trie，支持：
  - 连接动态 `subscribe` / `unsubscribe` 多个路径；
  - 写入路径 `W` 时，沿根到 `W` 收集祖先/自身订阅者推送增量 `mutation`，向下遍历 `W` 子树收集子路径订阅者并从更新后的树重算该路径快照推送 `snapshot`（同一次写入对同一连接去重）。
- **短窗口变更环形缓冲**：每活跃房间维护最近 **100 条**（且不超过 **5 分钟**）`mutation` 记录及 `evictedUpToRev`。重连携带 `sinceRev` 且满足 `sinceRev >= evictedUpToRev && sinceRev <= currentRev` 时按 `rev` 升序补发增量（带 `replayed: true`），否则返回 `replayTruncated: true` 并附带订阅路径的最新 `snapshot`。服务重启后，首次加载房间初始化 `evictedUpToRev = doc.rev`，保证重启前游标一定触发安全快照对齐。
- **`onDisconnect` 掉线钩子**：每条非观察者连接最多注册 **8 条**掉线写入动作（如 `delete("/players/p1")` 或 `patch("/players/p1", { online: false })`）。连接正常关闭（`1000`）、网络断开或心跳超时（`4008`）时，按注册顺序投递到房间串行队列执行并广播给剩余成员。以下三种情况**明确跳过且丢弃待决 `onDisconnect`（设计者拍板）**：
  1. 凭证被撤销、移出空间或房间/空间删除（`4003`）；
  2. API Key 失去写权限（如移除 `state_sync.write` 触发 `4004` 重连协商）；
  3. 服务端优雅停机重启（`1001`）——避免 `deploy.sh` 滚动重启瞬间把在线玩家的房间状态全部清空，客户端按 `1001` 退避重连后继续无缝接管状态。
- **Presence 在线列表**：与 `channels` 一致，仅投影非观察者连接（`connectionId`、`clientId`、`clientName`、`role`、`meta`、`connectedAt`）。Console 实时调试台使用一次性 `debug-ticket` 作为隐身观察者（`isObserver: true`），不计入 Presence、不占生产连接配额（单房间另留最多 5 条调试台连接）。
- **刷盘与过期清理**：
  - WS 写入后标记 `dirty = true`，触发 **500ms 防抖刷盘**，并设置 **2000ms 最大刷盘延迟**（持续高频写入期间至少每 2 秒落盘一次，同时顺带刷新 `expiresAt`）；
  - 房间最后一条生产连接离开时立即强制刷盘；
  - 服务优雅停机时向所有活跃 WS 发送 `1001`，停止接收新写，并在停机截止期限内（上限 5 秒）并行刷盘所有 `dirty` 房间；
  - 后台定时清理任务（每 5 分钟）：删除 `expiresAt < now` 且内存中无活跃连接的过期房间。

---

## 5. 路径规范与写入语义

- **路径格式与 JSON 载荷校验边界（设计者拍板）**：
  - **`path` 参数校验**（适用于 `subscribe`/`unsubscribe`/`set`/`patch`/`delete`/`GET ?path=...`）：统一以 `/` 开头（根路径为 `"/"`，子路径形如 `"/board/0"`、`"/players/p1/hp"`）；除根路径外禁止尾部 `/`、禁止空段 `//`；每段匹配 `^[a-zA-Z0-9._:-]{1,64}$`；禁止 `__proto__`、`constructor`、`prototype`；最大路径深度 **16 层**。
  - **JSON 值载荷校验**（适用于 `initialData`、`set` 的 `value`、`patch` 的 `partialObj`）：允许任意合法 JSON 对象键名（支持中文、空格等业务展示键，不强制套用 `path` 段正则），但**递归禁止**所有层级的 `__proto__`、`constructor`、`prototype` 键，且递归嵌套深度上限 **32 层**（防递归解析栈溢出 DoS）。若业务需要直接按子路径单独读写/订阅某个键，则该键应满足 `path` 段格式规范。
- **根节点不变量**：文档根 `/` 必须始终是 JSON Object（`Record<string, unknown>`）。禁止对 `/` 写入数组或基础类型，禁止 `delete("/")`（清空整个房间状态应使用 `set("/", {})`）。
- **三种写入原语**：
  1. `set(path, value)`：覆写目标路径。若路径中间节点不存在，自动补建空对象 `{}`；若中间节点已存在但不是普通 JSON Object（如是数字、字符串、`null` 或数组），明确返回 `PATH_CONFLICT` 拒绝，不做静默覆写。
  2. `patch(path, partialObj)`：`partialObj` 必须是普通 JSON Object；目标路径不存在时视为空对象并创建，目标已存在且非普通 Object 时返回 `PATH_CONFLICT`。对 `partialObj` 的顶层键执行浅合并（显式传入 `null` 即写入 `null`，删除键请使用 `delete`）。
  3. `delete(path)`：删除非根路径键。若目标键本来就不存在，视作幂等无变化（不递增 `rev`，不广播，返回 `ack { changed: false, rev }`）。
- **乐观锁 `expectedRev`（CAS）**：任意 `set` / `patch` / `delete` 均可携带非负整数/数字字符串 `expectedRev`。若当前房间 `rev !== expectedRev`，拒绝本次写入并返回错误码 `REV_CONFLICT`（响应中携带 `currentRev`），不推进版本号。
- **体积与合法性校验**：每次变更应用后（写前预演或变更后回滚校验）检查整个房间 JSON 序列化 UTF-8 字节数不超过 **256 KiB**，超限拒绝并返回 `DOC_TOO_LARGE` 且不污染内存状态。

---

## 6. 鉴权、安全与通信协议

### 6.1 鉴权与通道隔离
- **Open HTTP（`/api/open/v1/state-sync/...`）与 Open WS（`/api/open/v1/state-sync/spaces/:spaceId/docs/:docId/ws`）**：
  - **严格忽略 Cookie 和普通 SY 登录 JWT**，仅接受空间专属凭证（`sys_...`）、个人 API Key（`syk_...`）或 Console 一次性调试票据。
  - 严禁通过 URL Query 传递长效凭证（`?token=...` 一律拒绝）。
- **实时权限联动**：
  - 空间删除、房间删除、空间凭证撤销、API Key 撤销、空间移出 `stateSyncSpaceIds`、用户停用 → 立即以 **`4003`** 断开受影响活跃 WS（客户端停止盲目重连）。
  - API Key 仍可访问该空间，但 `state_sync.read` / `state_sync.write` scope 变化 → 立即以 **`4004`** 断开受影响连接（客户端重连一次协商最新角色）。
- **CORS 规则**：`/api/open/v1/state-sync/...` 与 `/api/open/v1/channels/...` 完全一致（`Access-Control-Allow-Origin: *`、`Access-Control-Allow-Credentials: false`、`Authorization, Content-Type`、`X-Request-Id, Retry-After`）。WS Upgrade 不校验 `Origin` 白名单。
- **Console API（`/api/console/state-sync/...`）**：使用现有 `UserAuthGuard`，仅空间所有者可操作。

### 6.2 WebSocket 线协议（`/api/open/v1/state-sync/spaces/:spaceId/docs/:docId/ws`）

所有帧均为 UTF-8 JSON 对象，顶层必含 `type`。

#### 客户端 → 服务端
1. **`auth`**（未通过 Upgrade Header 认证时，须在连接打开后 5 秒内作为首帧发送）
   ```json
   {
     "type": "auth",
     "token": "sys_...",
     "clientId": "player-1",
     "clientName": "玩家A",
     "meta": { "seat": "black" },
     "paths": ["/"],
     "sinceRev": 12
   }
   ```
   - `paths`：可选字符串数组（最多 32 条，省略默认 `["/"]`）。
   - 非浏览器端同样支持在 Upgrade 请求头携带 `Authorization: Bearer <token>`（认证通过后服务端直接下发默认订阅 `["/"]` 的 `ready`）。
2. **`subscribe` / `unsubscribe`**（运行中动态增减监听路径）
   ```json
   { "type": "subscribe", "id": "req-s1", "paths": ["/players", "/board"] }
   { "type": "unsubscribe", "id": "req-u1", "paths": ["/board"] }
   ```
3. **`mutate`**（需要 `write` / `create_write` 凭证或 `state_sync.write` API Key）
   ```json
   {
     "type": "mutate",
     "id": "req-1",
     "op": "patch",
     "path": "/players/p1",
     "value": { "x": 10, "y": 20 },
     "expectedRev": 12,
     "echo": false
   }
   ```
   - `echo`：默认 `false`（同一条 `connectionId` 收到 `ack` 即可确认，不重复下发 `mutation`；设为 `true` 时同时回推 `mutation`）。
4. **`onDisconnect.set` / `onDisconnect.clear`**（需要写权限；每连接最多 8 条）
   ```json
   {
     "type": "onDisconnect.set",
     "id": "req-d1",
     "actions": [
       { "op": "patch", "path": "/players/p1", "value": { "online": false } }
     ]
   }
   { "type": "onDisconnect.clear", "id": "req-d2" }
   ```
   - `onDisconnect.set` 整体替换当前连接的掉线动作列表（简化幂等与重连恢复，避免重复追加）。
5. **`presence.update`** / **`ping`**（语义与 `channels` 一致）。

#### 服务端 → 客户端
1. **`ready`**（认证成功立即下发）
   ```json
   {
     "type": "ready",
     "spaceId": "ss_...",
     "docId": "ssd_...",
     "connectionId": "conn_...",
     "clientId": "player-1",
     "role": "create_write",
     "rev": 15,
     "expiresAt": "2026-11-26T15:00:00.000Z",
     "replayTruncated": false,
     "presence": [ ... ],
     "snapshots": [
       { "path": "/", "exists": true, "value": { "board": {} } }
     ]
   }
   ```
   - 当客户端传了有效的 `sinceRev` 且未截断时，`snapshots` 可为空数组，紧接着按 `rev` 升序推送漏掉的 `mutation`（带 `"replayed": true`）；否则 `snapshots` 包含所有已订阅路径的最新完整值。
2. **`mutation`**（增量变更或补发变更）
   ```json
   {
     "type": "mutation",
     "rev": 16,
     "op": "patch",
     "path": "/players/p1",
     "value": { "x": 10, "y": 20 },
     "replayed": false,
     "actor": { "connectionId": "conn_...", "clientId": "player-1", "clientName": "玩家A" },
     "ts": "2026-11-25T15:01:00.000Z"
   }
   ```
3. **`snapshot`**（祖先路径被覆写/删除时为子路径订阅者重算的新值，或响应动态 `subscribe` 的首次初始值）
   ```json
   { "type": "snapshot", "rev": 17, "path": "/players/p1", "exists": true, "value": { "x": 0, "y": 0 } }
   ```
4. **`ack`**（响应带 `id` 的请求，含 `rev`、`changed?`）
5. **`presence.join` / `presence.leave` / `presence.update`**、**`pong`**、**`error`**（含 `id?`、`code`、`message`、`currentRev?`）。
6. **Close Codes**：完全沿用 `channels`（`1000` 正常、`1001` 停机、`4001` 认证失败/超时、`4003` 撤权/删空间/删房、`4004` scope 变更重连、`4008` 心跳超时/慢消费者、`4029` 限额/持续限流）。

### 6.3 Open HTTP REST API（`/api/open/v1/state-sync`）

所有响应遵循既有 Open API 规范（`X-Request-Id`、`Cache-Control: no-store`、统一错误包 `{ requestId, error: { code, message } }`），通过 `Authorization: Bearer <token>` 认证：

- **运行态接口（接受 `sys_...` 或 `syk_...`）**：
  - `POST /api/open/v1/state-sync/spaces/:spaceId/docs`（需 `create_write` 凭证或 `state_sync.write`/`state_sync.manage` API Key）
    - 请求体：`{ docId?, initialData?, ttlSeconds? }`（`docId` 仅 `state_sync.manage` 可自定义，普通写凭证传自定义 `docId` 直接返回 `403` 防抢注）
    - 响应 `201`：`{ spaceId, docId, rev, expiresAt, wsPath }`（同步落库）
  - `GET /api/open/v1/state-sync/spaces/:spaceId/docs/:docId`（需任意有效空间凭证或 `state_sync.read`/`state_sync.write` API Key；可选 `?path=/...`）
    - 响应 `200`：`{ spaceId, docId, path, exists, value, rev, expiresAt }`
  - `PATCH /api/open/v1/state-sync/spaces/:spaceId/docs/:docId`（需 `write`/`create_write` 凭证或 `state_sync.write` API Key）
    - 请求体：`{ op: "set" | "patch" | "delete", path, value?, expectedRev?, actorClientId?, actorName? }`
    - 立即同步落库并向在线 WS 广播；响应 `200`：`{ rev, changed, expiresAt }`（冲突返回 `409 REV_CONFLICT` 附 `currentRev`）
  - `GET /api/open/v1/state-sync/spaces/:spaceId/docs/:docId/presence`（需任意有效空间凭证或 `state_sync.read`/`state_sync.write` API Key）
    - 响应 `200`：`{ spaceId, docId, count, members: [...] }`
- **管理态接口（仅接受带 `state_sync.manage` 的 `syk_...` API Key，拒绝 `sys_...`）**：
  - `GET /api/open/v1/state-sync/spaces`、`POST /api/open/v1/state-sync/spaces`（仅 `all_owned + state_sync.manage` 可建）
  - `GET / PATCH / DELETE /api/open/v1/state-sync/spaces/:spaceId`
  - `GET / POST /api/open/v1/state-sync/spaces/:spaceId/tokens`、`DELETE .../tokens/:tokenId`
  - `GET /api/open/v1/state-sync/spaces/:spaceId/docs`（分页/游标列出当前空间未过期房间摘要，含 `docId`、`rev`、`onlineCount`、`expiresAt`、`updatedAt`）
  - `DELETE /api/open/v1/state-sync/spaces/:spaceId/docs/:docId`（立即 `4003` 踢断在线连接并删除房间）

---

## 7. 统一开放 SDK 构建与静态分发底座（`sdk/` + `/sdk/`）

### 7.1 仓库与构建结构
- 新增顶层工作区包 `sdk/`（包名 `@synapse/sdk`，加入 `pnpm-workspace.yaml`）：
  ```text
  sdk/
  ├── package.json              # build / test / typecheck 脚本，零运行时依赖
  ├── tsconfig.json
  ├── scripts/
  │   └── build.mjs             # 使用仓库既有 esbuild 编译 + 合并 releases/ + 生成 manifest.json
  ├── src/
  │   ├── shared/               # 通用零依赖 WS 重连、心跳、HTTP 请求、路径工具（供未来 channels/cloud-tables 复用）
  │   └── state-sync/           # 状态同步 SDK 源码与 Vitest 单测
  └── releases/                 # 冻结历史精确版本产物快照（单版本 ~20 KiB），防老网页固定版本 URL 404
      └── state-sync/
  ```
- **打包产物（同一 TS 源码一次编出）**：
  - `state-sync.global.min.js`（IIFE，挂全局 `window.SynapseStateSync`，供纯静态 HTML `<script src="...">` 直引）
  - `state-sync.esm.min.js`（ESM，供浏览器 `<script type="module">` 与 Node.js ESM）
  - `state-sync.cjs`（CommonJS，供 Node.js `require()`）
  - `index.d.ts`（完整 TypeScript 类型定义）
- **零依赖跨端兼容**：运行时只使用标准 `WebSocket`、`fetch`、`globalThis.crypto`（现代浏览器与 Node.js 22+ 均原生内置）；`createClient` 接受可选 `WebSocket` 与 `fetch` 覆盖参数，兼容 Node 18/20 传入 `ws` 包。

### 7.2 公开路径、清单发现与缓存策略
Nginx 直接静态托管 `/app/sdk` 到 `/sdk/`（**严禁**走 Node.js 业务进程；本地开发模式由 `server` 进程在 `NODE_ENV !== "production"` 时以静态中间件映射同一 `/sdk/` 路径）：

```text
https://synapse.d2.pub/sdk/
├── manifest.json                                # 全站 SDK 总索引（max-age=60, must-revalidate）
└── state-sync/                                  # 未来平级扩展 channels/、cloud-tables/
    ├── manifest.json                            # 单 SDK 元信息（最新版本、兼容大版本、文件直链、SRI sha256、文档地址）
    ├── v1/                                      # 大版本浮点别名，始终指向最新 1.x（max-age=300, must-revalidate）
    │   ├── state-sync.global.min.js
    │   ├── state-sync.esm.min.js
    │   ├── state-sync.cjs
    │   └── index.d.ts
    └── 1.0.0/                                   # 精确不可变版本（max-age=31536000, immutable）
        ├── state-sync.global.min.js
        ├── state-sync.esm.min.js
        ├── state-sync.cjs
        └── index.d.ts
```

- 所有 `/sdk/` 响应统一附带：
  - `Access-Control-Allow-Origin: *`
  - `Cross-Origin-Resource-Policy: cross-origin`
  - `X-Content-Type-Options: nosniff`
- `manifest.json` 包含每个 SDK 的 `name`、`title`、`latest`、`major`、`globalName`、`files`（`browserGlobal` / `esm` / `cjs` / `types`，每项均给出精确版本 `url`、大版本 `latestUrl`、`integrity: "sha256-..."` 与 `bytes`）、`docsUrl`、`nodeDownloadCommand` 及历史 `versions` 列表。
- **Node.js 免 npm 接入范式**：文档与 `manifest.json` 直接提供一条 `curl -fsSL <esm或cjs直链> -o ./synapse-state-sync.mjs` 命令，下载单文件后直接 `import` / `require`，零外部依赖。
- **部署同步**：
  - `server/Dockerfile` 的 `deps` / `build` 阶段纳入 `sdk/`，执行 `pnpm --filter @synapse/sdk build` 并将 `sdk/dist` 复制到生产镜像 `/app/sdk`；
  - `deploy.sh` 的 `sync_remote_code` 白名单加入 `/sdk/***`（排除 `sdk/node_modules` 与 `sdk/dist`），并在远端健康检查中校验 `http://127.0.0.1:3000/sdk/manifest.json` 返回 200 且含 `state-sync`。

### 7.3 State Sync SDK 客户端核心 API
```ts
const client = createClient({
  baseUrl: "https://synapse.d2.pub",
  spaceId: "ss_...",
  token: "sys_...",
  // 可选：WebSocket, fetch（老版本 Node 兼容）
})

// 1) 开新局（需 create_write 凭证）
const { docId, room } = await client.createRoom({
  initialData: { status: "waiting", board: {}, turn: "p1" },
  ttlSeconds: 3600,
  clientId: "p1",
  clientName: "黑方",
})

// 2) 加入已有房间（凭分享出去的 docId）
const room2 = await client.join(docId, { clientId: "p2", clientName: "白方" })

// 3) 路径监听（立即回调一次当前值，子树变更或祖先覆写自动同步）
const off = room.on("/board", (board, meta) => renderBoard(board, meta.rev))

// 4) 路径读写 & 并发安全事务（基于 expectedRev 自动重试最多 5 次）
await room.patch("/players/p1", { ready: true })
const move = await room.transaction("/board/4", (current, { abort, remove }) => {
  if (current != null) return abort() // 已被占格：主动放弃写入，不发请求
  return "X"                          // 返回任意 JSON 值（含 null）则写入；返回 remove() 则删除该键
})
// move: { committed: boolean, rev: number, value: unknown }

// 5) 掉线自动清理（断线重连后 SDK 自动重新注册）
await room.onDisconnect([
  { op: "patch", path: "/players/p1", value: { online: false } },
])

// 6) 在线成员与连接状态
room.onPresence((members) => renderPlayers(members))
room.onStatus((status) => updateConnectionBadge(status))
```

- **客户端一致性模型与 `transaction` 精确契约（设计者拍板）**：
  - SDK 维护**服务端权威本地镜像**——收到 `ready` / `snapshot` / `mutation`（或自身 `mutate` 成功 `ack` 后应用本地副本）再派发 `on(path)` 回调，保证本地状态与服务端 `rev` 严格一致；断线重连自动带 `sinceRev` 追平并在重连后自动重新订阅所有活跃路径与 `onDisconnect` 动作。
  - `room.transaction(path, updater, { maxRetries = 5 })` 契约：
    - 要求 `path` 被当前连接已订阅路径覆盖（默认 `["/"]` 全覆盖）；若连接显式只订阅了部分不覆盖 `path` 的子路径，直接 fail-fast 抛出 `StateSyncError("PATH_NOT_SUBSCRIBED")`，不隐式改订阅或发额外 HTTP 请求。
    - `updater(current, { abort, remove })`：`current` 为当前本地镜像该路径深拷贝（不存在时为 `undefined`）；返回 `abort()` 或 `undefined` 表示**主动放弃写入**，不发网络请求并直接 resolve `{ committed: false, rev, value: current }`；返回 `remove()` 表示发送带 `expectedRev` 的 `delete(path)`；返回其他任意 JSON 值（含 `null`）表示发送带 `expectedRev` 的 `set(path, nextValue)`。
    - 成功提交时 resolve `{ committed: true, rev, value }`；遇 `REV_CONFLICT` 自动等待服务端更新本地状态并重试（最多 `maxRetries` 次）；重试耗尽仍冲突时 **reject `StateSyncError("REV_CONFLICT", { currentRev })`**，便于业务清晰区分“业务主动放弃”与“高并发竞争失败”。

---

## 8. 资源治理、限额与 Nginx / 服务端集成

### 8.1 默认限额（设计者拍板，集中于 `server/src/state-sync/state-sync-config.ts`）
- 单房间完整 JSON 树上限：**256 KiB**；单次写入载荷：**64 KiB**；WS 单帧：**128 KiB**；HTTP 请求体：**256 KiB**。
- 路径最大深度：**16 层**；单连接最多订阅 **32 条**路径；单连接最多 **8 条** `onDisconnect` 动作。
- 空间配额：每空间默认最多 **100** 个未过期房间（可配上限 **500**）、最多 **20** 个有效凭证。
- 并发连接：单房间最多 **50** 条生产连接（另留最多 **5** 条 Console 隐身调试连接）、单空间最多 **200** 条、单账号最多 **300** 条、全局最多 **2000** 条。
- 速率限制：单连接写入持续 **20 次/秒**（突发桶 **60**）；单房间总写入 **60 次/秒**（突发 **120**）；房间创建按空间 **10 次/分钟**（突发 **30**，防前端死循环刷爆房间配额）；超限返回 `RATE_LIMITED` / HTTP `429` + `Retry-After`，WS 持续违规断连 `4029`。
- 慢消费者保护：`ws.bufferedAmount > 512 KiB` 时立即以 `4008` 断开；心跳 25 秒、连续错过 2 次断开。
- 刷盘参数：WS 脏房间防抖 **500ms**、最长间隔 **2000ms**；无连接空闲房间内存淘汰 **5 分钟**；过期房间定时清理周期 **5 分钟**。

### 8.2 服务端与 Nginx 集成
- `server/src/main.ts`：注册 `stateSyncCors`、body 限制/错误处理，将 `StateSyncGateway` 挂到共享 HTTP Server `upgrade`（严格按路径 `/api/open/v1/state-sync/spaces/:spaceId/docs/:docId/ws` 认领），并接入优雅停机钩子（发 `1001` + 刷盘）。
- `server/nginx.conf`（同步补充 `server/src/deploy-config.spec.ts` 回归测试）：
  - WS 块 `location ~* ^/api/open/v1/state-sync/spaces/[^/]+/docs/[^/]+/ws/?$`：`access_log off`、WS Upgrade、`proxy_read_timeout 3600s`、`proxy_send_timeout 3600s`、`proxy_buffering off`。
  - HTTP 块 `location ~* ^/api/(?:open/v1|console)/state-sync(?:/|$)`：`access_log off`、`client_max_body_size 256k`、禁止 Upgrade。
  - SDK 静态块：`/sdk/manifest.json`、`/sdk/<name>/manifest.json`（60s 缓存）、`/sdk/<name>/v<N>/`（300s 缓存）、`/sdk/<name>/<semver>/`（1 年 `immutable` 缓存），均指向 `/app/sdk` 并加跨域头与 `gzip`。

---

## 9. 三大产品入口设计（与频道完全对齐）

### 9.1 Dashboard Console 管理页（`dashboard/src/features/state-sync/`）
- **导航与路由**：主导航项与页面标题统一为 **「状态同步」**，路由 `/_authenticated/state-sync/`，遵循 `dashboard/CLAUDE.md` 与 `dashboard/DESIGN.md`（HeroUI v3、共享 Header/Main、ServerDataTable、无自定义字面色与卡片套卡片，桌面与窄屏展开态均验收）。
- **页面结构**：
  - 空间目录列表（空间名称、Space ID 一键复制、活跃房间数、当前在线连接数、有效凭证数、默认 TTL、新建/删除）。
  - 空间详情页签：
    1. **房间与实时调试（默认页签）**：活跃房间列表（房间 ID、当前 `rev`、在线人数、剩余有效期、新建测试房间/删除房间）；选中房间后通过一次性隐身调试票据实时连入，展示**实时刷新 JSON 树视图、在线成员列表、路径写入调试面板**（路径、`set/patch/delete`、JSON 载荷、可选 `expectedRev`、提交）以及滚动变更日志。
    2. **接入凭证**：按角色（`read` / `write` / `create_write`）创建空间凭证，明文弹窗仅创建时展示一次并提供一键复制；列表支持查看前缀/最近使用时间与「撤销」确认（提示将立即踢断活跃连接）。
    3. **接入与 SDK 示例**：实时读取当前服务地址与 `/sdk/manifest.json` 最新版本，自动填入 `spaceId`，给出**浏览器 `<script>`、浏览器 ESM、Node.js（含 `curl` 下载单文件命令）与 `curl` HTTP PATCH** 示例，支持一键复制。
    4. **设置**：修改名称、说明、默认房间 TTL、最大房间数与删除空间（二次确认）。
- **API Key 设置页联动**：在现有个人 API Key 创建/编辑弹窗中，复用频道与云表的资源选择器交互，新增「状态同步」分组下的 3 个 `state_sync.*` scope 与空间范围选择（指定空间 / 全部自有空间）。

### 9.2 开放接口文档（`document/open-api/api/state-sync.md` + `document/open-api/sdk.md`）
- 将 Open HTTP API 纳入 `server/src/open-api/open-api-contract.ts`（自动暴露在 `/api/open/openapi.json`）。
- 文档站新增：
  1. `document/open-api/api/state-sync.md`（标题「状态同步」，支持一键整页复制给 AI）：说明与云表/频道的分工、空间→房间模型、凭证角色矩阵、SDK 快速上手与完整 API、底层 WS/HTTP 协议、错误码与 Close Codes，并附两个完整可运行场景模板（① 纯静态双人对战小游戏：开房→分享链接→`transaction` 落子+`onDisconnect`；② Node.js 后端与网页共享实时状态）。
  2. `document/open-api/sdk.md`（标题「开放 SDK 与版本发现」）：介绍 `/sdk/manifest.json` 规范、大版本 `v1` 与精确版本选择建议、浏览器与 Node.js 免 npm 接入方式，为后续「频道」「云表」SDK 预留统一索引位置。

### 9.3 桌面端 MCP 工具与系统 Skill（`desktop/app-capabilities/state-sync/`）
- 新增独立 `state_sync` MCP domain（参考 `desktop/app-capabilities/channels/`），不注册 System App、Dock、Workflow Node、Automation Action 或 Deep Link，仅经现有 MCP `search` / `invoke` 路由暴露。
- 认证沿用桌面当前登录账号（`AccountService.fetchAuthenticated`）访问 `/api/console/state-sync/...`，全量经过 `PermissionGuard` / `AuditSink`，绝不向用户索要个人 API Key。
- **规划工具清单（共 14 项 capability / MCP 索引）**：
  1. `app_state_sync_publish_preflight_get`：返回当前账号、公网 HTTP/WS 基址、状态同步就绪状态，以及当前最新 SDK 清单地址与 `state-sync` SDK 版本/直链，供 AI 生成可直连网页。
  2. `app_state_sync_space_list`：列出当前账号同步空间及房间数/在线数/凭证数摘要。
  3. `app_state_sync_space_get`：查看单个空间详情。
  4. `app_state_sync_space_create`：创建同步空间（可配默认 TTL 与房间上限）。
  5. `app_state_sync_space_update`：修改空间名称、说明、默认 TTL 或房间上限。
  6. `app_state_sync_space_delete`：删除空间并断开其下全部连接。
  7. `app_state_sync_token_list`：列出空间凭证（不含明文）。
  8. `app_state_sync_token_create`：按角色（`read`/`write`/`create_write`）签发空间凭证，返回一次性明文供 AI 写入网页或后端配置。
  9. `app_state_sync_token_revoke`：撤销空间凭证并踢断对应连接。
  10. `app_state_sync_doc_list`：列出空间内当前活跃/未过期房间摘要。
  11. `app_state_sync_doc_create`：在空间内创建房间（支持可选自定义 `docId`、`initialData`、`ttlSeconds`）。
  12. `app_state_sync_doc_get`：读取房间指定路径（默认 `/`）当前 JSON、`rev`、过期时间与在线 Presence 列表。
  13. `app_state_sync_doc_mutate`：向房间指定路径执行一次 `set`/`patch`/`delete`（可选 `expectedRev`），便于 AI 初始化或验收。
  14. `app_state_sync_doc_delete`：删除房间并断开在线连接。
- **同步文档与路由更新**：
  - 在 `desktop/app-capabilities/synapse-skill/skill-package/` 新增 `state-sync/index.md` 及场景配方（如「一句话做多人联机小游戏网页」），更新 `SKILL.md` 路由表（清晰区分云表、频道与状态同步的选用标准，并教 AI 如何读取 `/sdk/manifest.json` 获取最新 SDK）；
  - 更新 `desktop/electron/services/agent-runtime/synapse-tool-router` 关键词（“状态同步”“联机小游戏”“多人对战”“共享 JSON”“野狗”“SDK 地址”等）；
  - 更新 `docs/agents/capability-registry.md`（全局 capability 由 382 增至 396、MCP 索引由 378 增至 392）与根目录 `RELEASE_NOTES_PENDING.md`。

---

## 10. 验收标准与测试策略

- **服务端单测与集成测试（隔离本地 PostgreSQL）**：
  - 凭证与权限矩阵：`read` 禁止写与 `onDisconnect`、`write` 禁止建房、`create_write` 可建随机房但禁止自定义 `docId` / 枚举他人房间 / 删房；Cookie 不在 Open API/WS 提权；`UserApiKey` 的 `selected`/`all_owned` 与已有密钥不扩权；撤销凭证/移出空间/删房立即 `4003`（且撤权不触发 `onDisconnect`），仅 scope 变更立即 `4004`。
  - JSON 树与并发语义：路径校验（非法段、超深、`__proto__` 拦截、根节点非 Object 拒绝）、`set/patch/delete`、`PATH_CONFLICT`、`expectedRev` 乐观锁成功与 `REV_CONFLICT`、房间超 256 KiB 拒绝、串行队列乱序防护。
  - 订阅与实时同步：子路径写入通知父订阅、祖先节点覆写为子订阅重算 `snapshot` 并去重、`sinceRev` 增量补发与超窗口 `replayTruncated`、正常断连/心跳超时触发 `onDisconnect`、Console 调试台隐身观察者不占配额不进 Presence。
  - 持久化与生命周期：防抖刷盘、末连断开立即刷盘、HTTP `PATCH` 同步落库并广播、重启后从 PG 恢复未过期房间并正确初始化 `evictedUpToRev`、优雅停机发 `1001` 并完成刷盘、过期房间定时清理与活跃续期、房间数/连接数/速率/慢消费者限额。
  - 契约与部署：`open-api-contract.spec.ts`、`deploy-config.spec.ts`（覆盖 `nginx.conf` 的 state-sync 与 `/sdk/` 规则及 `Dockerfile`/`deploy.sh` 校验）。
- **SDK 自动化测试（`sdk/`）**：
  - 浏览器与 Node.js（Vitest + 本地测试 WS Server）端到端测试：`createRoom`、`join`、路径订阅（含祖先覆写）、`transaction` 并发冲突重试、`onDisconnect` 断线触发与重连自动重新注册、断线补发与快照回退；
  - 构建产物验证：核验 `global.min.js`、`esm.min.js`、`cjs`、`index.d.ts`、`manifest.json` 完整性、SRI 哈希一致性及历史 `releases/` 合并无遗漏。
- **Dashboard UI 测试**：组件单测 + 桌面/窄屏自动化浏览验收（含下拉/弹窗展开态、实时 JSON 树视图与调试提交、API Key 弹窗状态同步范围配置）。
- **Desktop MCP 测试**：dispatcher 权限/审计/切号隔离单测、`synapse-tool-router` 发现单测、`check:hard-constraints`、`synapse-skill` 包完整性测试。

---

## 11. 留给实现者决定的事项（What's Left to the Builder）

以下细节无需回访产品决策，实现者按仓库既有约定自行处理：
- Prisma 物理表/索引精确命名与 migration SQL 组织方式。
- `StateSyncHub` 内部路径 Trie 与深拷贝/结构化克隆的具体实现细节。
- `sdk/scripts/build.mjs` 中 `esbuild` 打包参数与声明文件生成细节（确保产物零外部依赖、压缩后体积紧凑）。
- Console 实时 JSON 树查看器的展示组件实现（优先复用现有 JSON 展示/折叠组件或简洁等宽树形视图，遵循 `dashboard/DESIGN.md`）。
- 文档站侧边栏排序与多端示例的具体组织方式。

---

## 12. 设计者拍板项汇总（供审阅时重点核对）

以下默认决策已写入正文，如与你的预期有出入请直接指出：

1. **房间 ID 与防枚举规则**：`create_write` 前端凭证动态建房时，服务端强制生成 128-bit 高熵随机 ID（`ssd_...`）且禁止前端列举房间、禁止删除房间；自定义人类可读 `docId` 与显式删房仅对 Console / MCP / `state_sync.manage` API Key 开放。
2. **房间 TTL 语义**：空间默认 `defaultDocTtlSeconds = 86400`（24 小时滑动续期，活跃读写自动延长），允许设为 `null`（永不过期，适合长期看板/配置）；当空间设置了非空 TTL 时，前端凭证建房不可通过传 `null` 绕过过期限制。
3. **`onDisconnect` 执行边界**：正常断连（`1000`）和心跳超时（`4008`）触发已注册的 `onDisconnect`；被撤销凭证/删房（`4003`）、API Key 失去写权限（`4004`）以及服务端优雅停机重启（`1001`）均跳过并丢弃待决 `onDisconnect`，既保证撤权后零写入，又避免 `deploy.sh` 重启把在线房间状态清空。
4. **路径与 JSON 载荷校验边界**：`^[a-zA-Z0-9._:-]{1,64}$` 与 16 层深度限制只作用于 `path` 参数；`initialData` / `set` / `patch` 的 JSON 值允许中文/空格等业务键名，同时全局递归拦截 `__proto__` / `constructor` / `prototype` 并限制值嵌套深度 ≤ 32 层。
5. **SDK 本地镜像与 `transaction` 契约**：SDK 维护服务端权威本地镜像；`room.transaction(path, updater)` 支持 `abort()`/`undefined` 放弃、`remove()` 删除、返回 `{ committed, rev, value }`，5 次冲突重试耗尽抛出 `REV_CONFLICT`，且要求 `path` 在当前订阅覆盖范围内。
6. **版本防失效策略**：`/sdk/state-sync/v1/...` 指向最新 `1.x`（5 分钟缓存），`/sdk/state-sync/<semver>/...` 为永久不可变版本（1 年强缓存）；后续发布新小版本时将旧版本冻结产物保留在 `sdk/releases/` 随镜像打包，保证已发布网页永不 404。
7. **默认资源上限**：单房间 JSON 256 KiB、单写 64 KiB、路径深 16 层、每空间默认 100 房间（上限 500）/ 20 凭证、单房间 50 生产连接 + 5 调试台连接、单账号 300 连接、全局 2000 连接、单连接写 20 次/秒（突发 60）、防抖刷盘 500ms（最大 2000ms）。
