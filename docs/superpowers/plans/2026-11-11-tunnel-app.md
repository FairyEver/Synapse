# 内网穿透应用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户只填本机端口即可申请长期固定的公网子域名，多条映射同时工作，重启后自动恢复此前开启的映射。

**Architecture:** 云端管理映射归属、唯一域名、版本和开启意图，本机通过 DataRepository 保存原设备运行授权。独立控制 WSS 通知桌面建立逐请求数据 WSS，以 Node HTTP 和二进制流代理网站、WebSocket、SSE；公网网站入口与管理 API 分离。通配符 DNS 和证书只配置一次，不随每条申请变更。

**Tech Stack:** Electron / React / TypeScript、NestJS、Prisma / PostgreSQL、Node HTTP / net / stream、现有 ws、Zod、Vitest、现有 shadcn / Radix、Caddy / Nginx；不新增依赖。

**Spec:** [已批准设计](../specs/2026-11-11-tunnel-app-design.md)，必须与本计划一起阅读。

## Global Constraints

- 工作目录 `/Users/liyang/Documents/code/github/Synapse`，当前分支 `main`；不创建或切换分支 / worktree，不 push。
- 新 App 放 `desktop/app-capabilities/tunnel/`；不新增 `desktop/src/features/` 或平行服务。
- App ID / namespace 为 `tunnel`，中文名「内网穿透」；默认不固定 Dock，不新增 Workflow / Automation / Deep Link / 手机 / Console 页面。
- 公网格式 `https://<32位小写十六进制label>.tunnel.d2.pub`；label 来自 16 个密码学随机字节，删除后永不重用。
- 只输入整数端口 `1–65535`；只连回环地址，IPv4 优先且仅在提交业务字节前回退 IPv6，不启动本机服务。
- 一账号多映射；新申请默认开启；地址固定；账号、设备、端口、revision 和本机授权一致才可运行。
- 数据不走 Live / 通知连接，不保存正文 / Cookie / query / 数据票据，不重放访问者请求。
- 每账号最多 100 条未删除映射；并发上限为单映射 16、账号 64、全局 256。
- 请求体最多 64 MiB；控制帧最多 8 KiB、数据消息最多 64 KiB、单方向待发最多 256 KiB、全局待发最多 64 MiB。
- 心跳 20 秒、失活 45 秒；本机连接 5 秒、数据建立 10 秒、响应头 30 秒；HTTP / SSE 业务空闲 5 分钟，SSE / WS 无固定总时长。
- 生产 ingress `127.0.0.1:3002` 在应用容器内；开发 `127.0.0.1:19703`；不映射新宿主机公开端口。
- Electron 特权 IO 经过 PermissionGuard / AuditSink；业务服务通过 ServiceRegistry 组装，IPC 用 IpcRegistry、通知用 EventBus、持久化用 DataRepository。
- UI 使用现有壳、组件、默认尺寸和 token；只保留必要字段、操作及状态，不显示实现介绍。
- 同步发布说明、能力清单、模块边界、开发端口、MCP schema 和系统 Skill；纯计划文档不写发布说明。
- 不运行远端 CI / Release、不进行整版部署。真实应用启动 / 浏览器验收和生产部署需届时具备相应授权；fixture 测试不冒充真实应用验收。

## Review Focus

1. POST 发送后断线：不可在 IPv6 回退或重连时重复提交；任务 4、5、9 验证实际调用次数。
2. 同一设备克隆、账号切换或控制连接换代：晚到票据与响应不可激活旧映射；任务 3、5、6 验证代次清理。
3. 百条映射恢复时夹有坏配置、未知 revision 或权限拒绝：逐项隔离，不阻塞窗口、不扩大授权；任务 5、7 验证。
4. 已发响应头后取消 / 失败、慢速上传下载：不可混入错误页、泄露连接名额或积攒正文；任务 3、4、9 验证。
5. 本地网站使用平台保留路径、多值 Cookie、编码查询串及跨同站点请求：不能进入管理面或改写错误来源；任务 4、8、9 验证。

## 文件结构与现有入口

现有路径已经读取核对；标为 Create 的路径是本计划拟新增文件。

| 单元 | 新文件 | 主要现有接入点 |
| --- | --- | --- |
| 协议 | `shared/src/tunnel-contracts.ts` | `shared/src/index.ts`、`shared/package.json`、`shared/tsconfig.json`、`shared/scripts/build-dual-contracts.mjs` |
| 云端持久化与管理 | `server/src/tunnels/tunnel.repository.ts`、`tunnel.service.ts`、`tunnel.controller.ts`、`tunnel.module.ts` | `server/prisma/schema.prisma`、`server/src/app.module.ts` |
| 云端设备与传输 | 同目录 `tunnel-device.service.ts`、`tunnel-broker.ts`、`tunnel-gateway.ts`、`tunnel-budget.ts` | `server/src/main.ts`、既有 UserAuthService |
| HTTP ingress | 同目录 `tunnel-ingress.ts`、`tunnel-http-proxy.ts`、`tunnel-http-headers.ts` | `server/src/main.ts`、既有有界退出基础设施 |
| 桌面运行 | `desktop/app-capabilities/tunnel/main/{service,cloud-client,binding-store,transport}.ts` | `desktop/electron/runtime/data-repo/schemas/{tunnel,index}.ts`、`desktop/electron/bootstrap/{descriptors,app-ready}.ts` |
| 能力与 IPC | 同包 `shared/{schema,capability,manifest,app-definition}.ts`、`main/{dispatcher,ipc}.ts` | `desktop/synapse-capabilities/shared/{tunnel-domain,registry}.ts`、`desktop/app-capabilities/manifest-registry.ts`、IPC codegen |
| UI | 同包 `renderer/{index,app-manifest,tunnel-list,tunnel-port-dialog,use-tunnels}.tsx`、`renderer/icon.svg` | `desktop/src/modules/apps/{types,definitions,registry}.ts`、`components/system-app-content.tsx` |
| 基础设施 | `server/scripts/tunnel-edge-config.mjs`、`server/scripts/tunnel-certificate-renew.sh`、`docs/agent-guides/tunnel-deployment.md` | `server/nginx.conf`、`server/src/config/env.ts`、`server/compose.yml`、`server/.env.example`、开发启动脚本 |

以上拆分按职责组织，不要求造同名抽象类。运行接口在各任务 Interfaces 中锁定；不要在后续任务另造同义类型。新增命令前查看实际 package scripts。

---

### Task 1: 固定协议、DTO、常量和双模块导出

**Files:** Create `shared/src/tunnel-contracts.ts`, `shared/src/tunnel-contracts.test.ts`; Modify `shared/src/index.ts`, `shared/package.json`, `shared/tsconfig.json`, `shared/scripts/build-dual-contracts.mjs`, `shared/src/package-entrypoint.test.ts`.

**Interfaces:** Produces `TunnelMappingDto`（id、clientInstanceId、deviceName、port、url、enabled、revision、createdAt、updatedAt、runtimeStatus、lastErrorCode）、`TunnelListInput`（offset、limit、可选 clientInstanceId 只读过滤）、`TunnelPageDto`（items、nextOffset、total）、`TunnelCreateInput`（port、requestId）、`TunnelUpdateInput`（port、expectedRevision）、`TunnelEnableInput`（enabled、expectedRevision）、`TunnelDeleteInput`（expectedRevision）；`TunnelRuntimeStatus` 使用设计第 11 节状态；runtimeStatus / lastErrorCode 是运行时派生值，不入 UserTunnel 持久字段；`TUNNEL_LIMITS` 固定全局预算。

Produces `createTunnelLabel(randomBytes?: (size: number) => Uint8Array): string`（Node 加密随机源由调用方注入，不在浏览器导出中导入 Node crypto）、`parseTunnelHost(host: string, domain: string): string | null`、`buildTunnelUrl(label: string, domain: string): string`、`parseTunnelControlMessage(value: unknown): TunnelControlMessage | null`。协议 version=1，消息含 hello / ready / auth-refresh / open / cancel / mapping-state；每种 payload 使用带判别字段的类型，额外字段严格校验，data-ready 后只允许二进制。

- [ ] **Step 1:** 先写命名和端口边界测试，以及 8 KiB 控制帧、未知版本拒绝、清晰预算断言：
  ```ts
  expect(createTunnelLabel(() => new Uint8Array(16))).toBe("0".repeat(32))
  expect(parseTunnelHost("a".repeat(32) + ".tunnel.d2.pub", "tunnel.d2.pub")).toBe("a".repeat(32))
  expect(parseTunnelHost("x." + "a".repeat(32) + ".tunnel.d2.pub", "tunnel.d2.pub")).toBeNull()
  expect(TUNNEL_LIMITS.requestBodyBytes).toBe(64 * 1024 * 1024)
  ```
- [ ] **Step 2:** Run `pnpm --filter @synapse/shared run test -- src/tunnel-contracts.test.ts`; 应因新接口缺失失败，记录失败再实现。
- [ ] **Step 3:** 实现上述类型 / 纯函数，将同一协议通过 `@synapse/shared/tunnel-contracts` 提供 ESM / CJS 类型与运行入口；复用现有 dual-contracts 构建，不手改 dist。
- [ ] **Step 4:** Run `pnpm --filter @synapse/shared run test -- src/tunnel-contracts.test.ts src/package-entrypoint.test.ts` 和 `pnpm --filter @synapse/shared run typecheck`; 两模块导入和边界均通过。
- [ ] **Step 5:** 仅暂存本任务文件，提交 `feat: 定义内网穿透映射与传输协议`。

### Task 2: 真实域名申请、设备凭据与云端管理

**Files:** Create `server/src/tunnels/{tunnel.repository,tunnel.service,tunnel-device.service,tunnel.controller,tunnel.module}.ts`, 同目录 `tunnel.service.spec.ts`, `tunnel-http.spec.ts`; Modify `server/prisma/schema.prisma`, `server/src/app.module.ts`, `server/src/config/{env.ts,env.spec.ts}`, `server/.env.example`; Create `server/prisma/migrations/20261111100000_user_tunnels/migration.sql`（实施时若同名已存在，选择下一个未用时间戳并同步计划）。

**Interfaces:** Consumes task 1 DTO。Produces `TunnelService.list(userId, input): Promise<TunnelPageDto>`、`get(userId, id): Promise<TunnelMappingDto>`、`create(actor: TunnelDeviceActor, input: TunnelCreateInput): Promise<TunnelMappingDto>`、`update(actor, id, input: TunnelUpdateInput): Promise<TunnelMappingDto>`、`setEnabled(actor, id, input: TunnelEnableInput): Promise<TunnelMappingDto>`、`delete(userId, id, input: TunnelDeleteInput): Promise<{ id: string; deleted: true }>`；`TunnelDeviceActor` 含已验证 userId / clientInstanceId，不接受普通 DTO 自报权限。`TunnelDeviceService.register(userId, clientInstanceId, key: Uint8Array): Promise<void>` / `verify(userId, clientInstanceId, key: Uint8Array): Promise<TunnelDeviceActor>`；明文仅在认证内存存在。

REST：GET/POST `/api/tunnels`，GET/PATCH/DELETE `/api/tunnels/:id`，PATCH `/api/tunnels/:id/enabled`，PUT `/api/tunnels/device`，GET `/api/tunnels/operations/:requestId`。静态子路径先于 `:id` 注册。register/create/update/enable 使用私有设备证明头，日志精确脱敏；delete 只校验本人归属，允许丢失旧电脑后退役地址。凭据不出现在 DTO/MCP。

- [ ] **Step 1:** 写 service fixture 和 HTTP 测试：同 requestId 同参数返回同 id；异参数 409；软删除后重试不复活；同设备同端口可分配不同 label；100 条之后 429；跨账号 get/delete 不泄漏记录；revision 过期 409；设备密钥覆盖被拒绝。
  ```ts
  const a = await fixture.service.create(fixture.device, { port: 3000, requestId: fixture.requestId })
  const b = await fixture.service.create(fixture.device, { port: 3000, requestId: fixture.requestId })
  expect(b.id).toBe(a.id)
  expect(a.enabled).toBe(true)
  ```
- [ ] **Step 2:** Run `pnpm --filter @synapse/server run test -- src/tunnels/tunnel.service.spec.ts src/tunnels/tunnel-http.spec.ts`; 先确认新行为失败。
- [ ] **Step 3:** 新增 UserTunnel、创建幂等操作、TunnelDeviceCredential 表；条件查询和事务 / 唯一约束保证并发安全。注册相同设备必须证明旧密钥，SHA-256 哈希入库，碰撞只重生成 label。先在集中 env 增加任务8定义的四个基础开关 / 域名 / 监听配置及校验，供任务3/4使用；生产默认关闭，fixture 显式注入开启配置。映射存储成功不伪造在线；功能未就绪时不允许对外申请。
- [ ] **Step 4:** 同命令重跑及 Server typecheck。对专用隔离库预演迁移及唯一约束；未获得隔离库执行条件时记录未执行，不连接生产库。把用户可感知的新增能力加入 `RELEASE_NOTES_PENDING.md`，措辞区分尚未发布。
- [ ] **Step 5:** 检查 migration 非破坏性、暂存本任务文件并提交 `feat: 支持固定穿透域名申请与设备归属管理`。

### Task 3: 独立控制 / 数据连接、一次性票据与预算

**Files:** Create `server/src/tunnels/{tunnel-broker,tunnel-gateway,tunnel-budget}.ts` 及各自 `.spec.ts`; Modify `server/src/tunnels/tunnel.module.ts`, `server/src/main.ts`.

**Interfaces:** Produces `TunnelBroker.open(mappingId: string, revision: number, signal: AbortSignal): Promise<Duplex>`、`invalidateMapping(id: string): void`、`disconnectDevice(userId, clientInstanceId): void`、`close(): Promise<void>`；`TunnelGateway.attach(server: HttpServer): void` / `close(): Promise<void>`。open 返回完成双端认证和本机连接确认的二进制 Duplex；不把本机连接成功冒充响应成功。`TunnelBudget.acquire(scope): Lease`，Lease.release 幂等，配额覆盖 pending 与已建立流。

- [ ] **Step 1:** 写真实 ws fixture / 可注入时钟测试：无认证拒绝；大 hello 拒绝；ticket 10 秒过期、一次消费、跨设备 / 映射 / revision / 旧代次拒绝；第 17 / 65 / 257 条流拒绝；失败、取消和退出均释放 lease。
  ```ts
  const ticket = fixture.openPending({ mappingId: "m1", revision: 1 })
  fixture.clock.advance(10_001)
  await expect(fixture.consume(ticket)).rejects.toMatchObject({ code: "TUNNEL_TICKET_EXPIRED" })
  expect(fixture.activeLeases()).toBe(0)
  ```
- [ ] **Step 2:** Run `pnpm --filter @synapse/server run test -- src/tunnels/tunnel-broker.spec.ts src/tunnels/tunnel-gateway.spec.ts src/tunnels/tunnel-budget.spec.ts`; 确认失败。
- [ ] **Step 3:** 注册 `/api/tunnels/control`、`/api/tunnels/data` 的独立 upgrade 路径；账号由现有 UserAuthService 验证，密钥证明后建立控制代次。数据票据只留哈希，绑定账号 / 设备 / revision / 请求 / 控制代次，原子消费；双端 ready 后进入 ws stream。认证更新、心跳、账号失效、连接替换终止旧流，状态推送只有摘要。
- [ ] **Step 4:** 重跑专项测试；增加慢消费与 64 KiB 消息分段测试，断言 256 KiB / 64 MiB 预算下暂停读取而非丢字节。验证原有 Live gateway 专项测试仍通过。
- [ ] **Step 5:** 提交 `feat: 增加独立穿透连接与一次性数据通道`。

### Task 4: 独立 HTTP ingress、流式代理与网站兼容

**Files:** Create `server/src/tunnels/{tunnel-ingress,tunnel-http-proxy,tunnel-http-headers}.ts` 及对应 `.spec.ts`; Modify `server/src/main.ts`, `server/src/tunnels/tunnel.module.ts`, `server/src/auth/user-auth.guard.ts`; Create `server/src/auth/tunnel-origin.spec.ts`；如需公共小 helper，放 `server/src/auth/tunnel-origin.ts`，不拷贝各业务控制器。

**Interfaces:** Produces `TunnelIngress.start({ host, port, publicDomain }): Promise<void>` / `close(deadlineMs: number): Promise<void>`；`proxyTunnelHttp(req: IncomingMessage, res: ServerResponse, mapping: TunnelMappingDto, deps): Promise<void>`、`proxyTunnelUpgrade(req, socket: Duplex, head: Buffer, mapping, deps): Promise<void>`。header helper：`buildTunnelUpstreamHeaders(rawHeaders: readonly string[], context): OutgoingHttpHeaders`、`rewriteTunnelResponseHeaders(rawHeaders, context): OutgoingHttpHeaders`。context 明确包含 loopback origin、公网 origin、可信客户端来源；不得把业务头和 Synapse 凭据混用。

- [ ] **Step 1:** 测试原始编码路径 / query、请求方法、压缩二进制、64 MiB 边界、重复 Set-Cookie、精确 localhost Location、移除上级 Cookie Domain；错误目标第三方 Location 不改写。测试 `/api/tunnels`、`/console`、Live 路径仅到 fixture 本地服务。
  ```ts
  expect(rewriteTunnelResponseHeaders(["Location", "http://localhost:3000/a?x=%2F"], context).location)
    .toBe(context.publicOrigin + "/a?x=%2F")
  expect(fixture.managementRequests()).toHaveLength(0)
  ```
- [ ] **Step 2:** Run `pnpm --filter @synapse/server run test -- src/tunnels/tunnel-ingress.spec.ts src/tunnels/tunnel-http-proxy.spec.ts src/tunnels/tunnel-http-headers.spec.ts src/auth/tunnel-origin.spec.ts`; 确认新行为失败。
- [ ] **Step 3:** 独立 Node HTTP listener，不经过 JSON / Cookie parser /平台 CSP。严格 Host 解析只查启用映射；Node HTTP parser/serializer 构建上游请求，正文及响应通过背压转发。支持 WS upgrade 的 101 / 非101 / head 字节及 SSE flush。按设计生成 404/410/429/502/503/504；发头后错误只关闭流。CONNECT / 非 WS Upgrade 拒绝。
- [ ] **Step 4:** 在平台认证边界复用现有受信 Origin 机制：Cookie 认证的非 GET/HEAD/OPTIONS 方法只接受与 `APP_PUBLIC_URL` origin 精确一致的 Origin，缺失 / null / tunnel Origin 均拒绝，Bearer 不新增该限制；安全方法不得承载变更。测试同站点但不同 origin、缺失 / null Origin、实际受信客户端；不得通过全局 `SameSite` 或 CORS 假装已解决。若发现必须更改平台 Cookie 格式或其他项目则按设计报告范围变化。
- [ ] **Step 5:** 重跑专项、现有 auth / Live / Webhook 回归及 Server typecheck。增加「POST 发出后断线只调用一次」「慢下载取消不混入错误页」「响应头后 SSE 错误释放连接」断言，再提交 `feat: 支持网站与流式接口的穿透代理`。

### Task 5: 桌面设备授权、回环连接与自动恢复

**Files:** Create `desktop/app-capabilities/tunnel/main/{service,cloud-client,binding-store,transport}.ts` 与 `__tests__/{service,cloud-client,binding-store,transport}.test.ts`; Create `desktop/electron/runtime/data-repo/schemas/tunnel.ts`; Modify `desktop/electron/runtime/data-repo/schemas/index.ts`。

**Interfaces:** Produces `TunnelCloudClient`，封装任务 2 的 REST / 认证失败 / abort；`TunnelBindingStore.prepareCreate(input): Promise<PendingTunnelCreate>`、`commitBinding(mapping): Promise<void>`、`listOwnedBindings(userId, clientInstanceId): Promise<readonly TunnelBinding[]>`、`getOrCreateDeviceKey(userId, clientInstanceId): Promise<Uint8Array>`；`TunnelTransport.start(context): Promise<void>` / `reconcile(mappings): Promise<void>` / `stop(): Promise<void>`；`TunnelAppService` 对外提供任务 1 六项业务接口和 `start(): Promise<void>` / `dispose(): Promise<void>`，状态事件类型 `tunnel.mapping.changed`、`tunnel.reset`。service 依赖注入账号、设备 ID store、DataRepository、PermissionGuard、AuditSink、EventBus、transport factory 和 clock。

- [ ] **Step 1:** 测试先持久化 requestId / key 才联网；云端成功本地提交失败仍查询原结果；同机重启恢复 enabled，不恢复 stopped；另一设备 / 账号不运行；混合坏配置不阻塞其他99条；local-only 导出 / 导入拒绝移植授权。
  ```ts
  await fixture.restartSameDevice()
  expect(fixture.connectedMappingIds()).toEqual(["enabled-mapping"])
  expect(fixture.createCalls()).toBe(0)
  ```
- [ ] **Step 2:** Run `pnpm --filter @synapse/desktop run test -- app-capabilities/tunnel/main/__tests__`; 确认失败。
- [ ] **Step 3:** 实现 `app.tunnel.bindings` sqlite 与 `app.tunnel.credentials` encrypted-json，带 schemaVersion / local-only；只用已有 namespace / Managed 存储接口。账号切换回调先增代次、abort 请求和关流，再清理内存；磁盘中其他账号凭据不用于当前网络请求。
- [ ] **Step 4:** 实现独立控制 WSS 和逐请求数据 WSS。先检查绑定 / revision / 权限再连接 `127.0.0.1`，仅明确未提交字节的连接失败可尝试 `::1`。使用 ws binary stream 背压、取消和有界关闭，不在 Electron 绑定端口；状态恢复在窗口创建后后台执行。
- [ ] **Step 5:** 重跑专项及 DataRepository schema / 导出安全测试，覆盖「POST 已写入后断线不重试」「换号后的晚到 ready 被拒绝」「权限拒绝不弹阻塞窗口的恢复流程」。通过后提交 `feat: 支持本机端口连接与穿透自动恢复`。

### Task 6: 能力、MCP、IPC、bootstrap 与系统 Skill

**Files:** Create `desktop/app-capabilities/tunnel/shared/{schema,capability,manifest}.ts`, `main/{dispatcher,ipc}.ts`, `main/__tests__/{dispatcher,ipc,contract}.test.ts`, `desktop/synapse-capabilities/shared/tunnel-domain.ts`, `desktop/synapse-capabilities/shared/__tests__/tunnel-domain.test.ts`, `desktop/app-capabilities/synapse-skill/skill-package/tunnel/{index,api-reference}.md`.

Modify `desktop/electron/bootstrap/{descriptors,ipc-registry,app-ready}.ts`, `desktop/app-capabilities/manifest-registry.ts`, `desktop/synapse-capabilities/shared/registry.ts`, `desktop/scripts/build/generate-ipc.mjs`, `desktop/src/types/bridge.ts`, `desktop/app-capabilities/synapse-skill/skill-package/SKILL.md`, `docs/agents/{capability-registry,module-boundaries}.md`。

**Interfaces:** `TUNNEL_SERVICE_ID="app.tunnel.runtime"`；`createTunnelCapabilityDispatcher(deps).dispatch(action,input,context)` 沿用既有 dispatcher 结果契约；`tunnelIpcModule` 暴露 `window.synapse.tunnel.mapping.{list,get,create,update,setEnabled,delete}`，操作 ID 严格为设计列出的六项。MCP tool 名为 operation ID 点替换下划线；列表 offset-based、默认20/max100、`nextOffset` 续页。运行订阅仅 UI，不新增 MCP 索引；不得导出设备密钥 / 数据票据。

- [ ] **Step 1:** 先测试六个 action 一一映射、requestId / expectedRevision 校验、分页实际消费、未授权拒绝、订阅无正文、MCP 输出不含密钥；bootstrap 测试确认窗口创建不等待连接恢复。
  ```ts
  expect(buildTunnelTools()).toHaveLength(6)
  expect(MCP_TOOL_ACTIONS.app_tunnel_mapping_create).toBe("app.tunnel.mapping.create")
  expect(JSON.stringify(fixture.lastToolResult())).not.toContain(fixture.deviceSecret)
  ```
- [ ] **Step 2:** Run `pnpm --filter @synapse/desktop run test -- app-capabilities/tunnel/main/__tests__ synapse-capabilities/shared/__tests__/tunnel-domain.test.ts`; 确认失败。
- [ ] **Step 3:** ServiceRegistry descriptor 装配任务5 service；IpcRegistry 接入同一 dispatcher；后台阶段调用 start，退出通过 descriptor dispose 释放，不绕开现有更新退出逻辑。调用已有账号认证客户端，不在 Renderer 构造 token。
- [ ] **Step 4:** Run `pnpm --filter @synapse/desktop run generate:ipc`、`pnpm --filter @synapse/desktop run check:ipc-codegen`、专项测试和 `check:hard-constraints`。检查生成文件变化，只提交本任务造成部分。按实际 registry 重算六项 MCP / capability 增量，记录 App 尚待任务7可见，其余表面无增量；同步 Skill 的端口 / 归属 / 恢复 / 不重放说明。
- [ ] **Step 5:** 提交 `feat: 注册穿透管理能力与后台恢复服务`。

### Task 7: 独立应用与端口申请界面

**Files:** Create `desktop/app-capabilities/tunnel/shared/app-definition.ts`, `desktop/app-capabilities/tunnel/renderer/{index,app-manifest,tunnel-list,tunnel-port-dialog,use-tunnels}.tsx`, `renderer/icon.svg`, `renderer/__tests__/tunnel-app.test.tsx`；Modify `desktop/src/modules/apps/{types,definitions,registry}.ts`, `desktop/src/modules/apps/components/system-app-content.tsx`, `desktop/src/modules/apps/__tests__/{registry,system-app-header-architecture}.test.ts`, `docs/agents/capability-registry.md`。

**Interfaces:** `TunnelModule(): ReactElement` 作为已有 System App 内容入口；`tunnelAppManifest` / `tunnelAppDefinition` 共享同一 App ID。`useTunnels()` 返回 items、pending、failure 及六项操作，在 hook / service 中处理状态，JSX 不承载网络业务；只有端口表单是必填输入。新增图标复用现有 Lucide 风格静态 SVG，不修改共享 preset。

- [ ] **Step 1:** 组件测试：填端口并申请；失败保留输入；分配成功但不可达仍展示地址；复制 / 修改端口 / 停止 / 删除；晚到刷新不覆盖新状态；默认当前电脑、其他电脑只读；100条恢复夹有待授权项可继续操作其他行。
  ```ts
  await fixture.submitPort("3000")
  expect(fixture.bridgeCreates()).toEqual([expect.objectContaining({ port: 3000 })])
  expect(fixture.requiredInputLabels()).toEqual(["本机端口"])
  ```
- [ ] **Step 2:** Run `pnpm --filter @synapse/desktop run test -- app-capabilities/tunnel/renderer/__tests__/tunnel-app.test.tsx src/modules/apps/__tests__/registry.test.ts src/modules/apps/__tests__/system-app-header-architecture.test.ts`; 确认新App断言失败。
- [ ] **Step 3:** 用 SystemAppWindowShell / 现有列表、Input、Button、Switch、DropdownMenu、Dialog 构建界面。内嵌 / 独立窗口共用一个内容组件与顶栏，不自动固定Dock。申请中禁重入；已停止、离线、不可达、待授权、失败只显示必要状态。
- [ ] **Step 4:** 重跑组件、registry、header专项和 desktop typecheck；实际 UI 展开菜单、键盘焦点、长URL、窄窗口与删除确认需真实验收。有明确启动授权后仅用根 `pnpm dev:desktop` 等相应入口；否则如实保留真实验收未执行。
- [ ] **Step 5:** 补齐 System App 数量、Dock 例外及发布说明，提交 `feat: 增加内网穿透应用与端口映射管理界面`。

### Task 8: 配置、入口隔离与证书自动续期产物

**Files:** Modify `server/src/config/{env.ts,env.spec.ts}`, `server/{compose.yml,compose.dev.yml,nginx.conf,.env.example}`, `scripts/dev/run-server-with-env.mjs`, `server/src/{deploy-config,webhook-proxy-config}.spec.ts`, `.claude/rules/workspace-dev-ports.md`, `docs/agents/repository-guide.md`; Create `server/scripts/tunnel-edge-config.mjs`, `server/scripts/tunnel-certificate-renew.sh`, `server/src/tunnels/tunnel-deployment.spec.ts`, `docs/agent-guides/tunnel-deployment.md`。

**Interfaces:** 基础 env 已在任务2声明，本任务补齐 Compose / 开发启动传递：`TUNNEL_ENABLED`（默认false）、`TUNNEL_PUBLIC_DOMAIN`（启用时必填）、`TUNNEL_INGRESS_HOST`（固定回环）、`TUNNEL_INGRESS_PORT`（生产3002 / 开发19703）；预算配置命名为 `TUNNEL_MAX_MAPPINGS_PER_USER`（100）、`TUNNEL_MAX_STREAMS_PER_MAPPING`（16）、`TUNNEL_MAX_STREAMS_PER_USER`（64）、`TUNNEL_MAX_STREAMS_GLOBAL`（256）、`TUNNEL_MAX_REQUEST_BODY_BYTES`（67108864）、`TUNNEL_MAX_BUFFERED_BYTES_GLOBAL`（67108864），正整数且有上界校验，其他时长 / 帧大小先复用任务1常量。`tunnel-edge-config.mjs --check` 只生成 / 校验候选区块并输出差异；应用必须显式 `--apply`，先备份、拒绝并发变更、validate 后 reload，失败恢复本区块。`tunnel-certificate-renew.sh --check` 做配置 / 证书预检；显式 `--renew` 才使用现有 ACME DNSPod provider，候选验证后安装并 reload。两命令均不输出凭据。

- [ ] **Step 1:** 配置 / 文件夹具测试：错误domain / 公网监听被拒；tunnel域 `/api` 不走平台路由；Nginx 无缓存 / 双向buffer且保留WS；候选证书私钥不匹配 / 过期 / SAN错误时原证书摘要不变；入口并发修改拒绝覆盖。
  ```ts
  expect(fixture.generatedConfig()).toContain("127.0.0.1:3002")
  expect(fixture.publicPortMappings()).not.toContain("3002")
  expect(await fixture.applyInvalidCandidate()).toMatchObject({ applied: false, originalPreserved: true })
  ```
- [ ] **Step 2:** Run `pnpm --filter @synapse/server run test -- src/config/env.spec.ts src/tunnels/tunnel-deployment.spec.ts src/deploy-config.spec.ts src/webhook-proxy-config.spec.ts`; 确认新断言失败。
- [ ] **Step 3:** 增加内部listener配置与严格域名分流。Caddy与容器Nginx都保留原Host /路径，关闭query访问日志、缓存、请求 /响应缓冲；使用既有公开443，不开放新宿主机端口。实现可检查的续期脚本，DNS凭据只通过受保护环境 /已有凭据机制读取，不放server普通业务env示例明文。
- [ ] **Step 4:** 补充部署指南：正式 `*.tunnel`、测试命名空间的区别；DNSPod长期验证授权前提；ACME provider实际支持的凭据格式；候选证书验证 / 热加载 / 失败保留 / 到期观测；配置标记和逐块回滚。shell语法用 `bash -n server/scripts/tunnel-certificate-renew.sh`，Node脚本用 `node --check server/scripts/tunnel-edge-config.mjs`，不执行生产写入。
- [ ] **Step 5:** 重跑专项 / typecheck，提交 `feat: 配置穿透专用入口与证书续期流程`。只有真实续期链路验证完成才能标记生产就绪；当前DNSPod授权缺失不妨碍前7项本地开发。

### Task 9: 跨端闭环、资源清理与交付证据

**Files:** Create `server/src/tunnels/tunnel-transport.integration.spec.ts`, `desktop/app-capabilities/tunnel/main/__tests__/transport.integration.test.ts`, `docs/agent-guides/tunnel-acceptance.md`；Modify 各任务所属文件的实际缺陷、`RELEASE_NOTES_PENDING.md` 与对应边界文档。

**Interfaces:** 使用任务1–8的正式接口；测试helper放各测试目录，只创建测试进程拥有的HTTP/WS fixture，不启动实际桌面 /生产服务，不新增运行时后门或测试API。验收文档按真实执行层次记录状态和证据绝对路径 /可访问在线链接。

- [ ] **Step 1:** 写完整链路用例：两个端口三个域名同跑；创建后新label即时可路由；body/stream真实跨数据WSS；重启 /休眠模拟恢复原URL；停止 /修改 /删除立即关旧流；退出清理有界。
  ```ts
  expect(await fixture.postThenDropAndReconnect()).toMatchObject({ localInvocations: 1 })
  expect(await fixture.downloadWithSlowReader()).toMatchObject({ bytesMatch: true, maxBufferedBytes: expect.any(Number) })
  expect(fixture.activeResourcesAfterShutdown()).toEqual({ sockets: 0, tickets: 0, leases: 0, timers: 0 })
  ```
- [ ] **Step 2:** 先运行对应新测试，若暴露缺陷，保留失败证据并只修所属组件。覆盖SSE首段到达、WS子协议/拒绝/head、Content-Length与chunked超限、上传取消、已发头错误、IPv6-only回环与非幂等请求不重发。
- [ ] **Step 3:** 最小充分回归：`pnpm --filter @synapse/shared run test -- src/tunnel-contracts.test.ts src/package-entrypoint.test.ts`；`pnpm --filter @synapse/server run test -- src/tunnels src/auth/tunnel-origin.spec.ts src/config/env.spec.ts src/deploy-config.spec.ts`；`pnpm --filter @synapse/desktop run test -- app-capabilities/tunnel synapse-capabilities/shared/__tests__/tunnel-domain.test.ts src/modules/apps/__tests__/registry.test.ts src/modules/apps/__tests__/system-app-header-architecture.test.ts`；Server /Desktop typecheck、desktop `check:hard-constraints`、`check:ipc-codegen`。测试失败不以扩大重试或削弱断言掩盖。
- [ ] **Step 4:** 按实际改动确认是否触发 `check:packaged-asar`；若新增启动资源影响打包则构建候选并执行。macOS实际回环和退出测试、Windows既有可用测试环境分别留证；未做平台不得写已通过。不自行启动远端CI。
- [ ] **Step 5:** 获得相应启动 /部署授权后，用根命令完成真实网站 /深路由 /Cookie /Location /Vite HMR /SSE /WS浏览器验收；生产先备份迁移预演、正式DNS/TLS与自动续期链路验证，再发布独立域分流并核对原站health、Live、Webhook。未经授权则交付已验证代码与候选配置，明确待部署，不擅自运行 `deploy.sh` 或整版发版。
- [ ] **Step 6:** 更新验收文档，分别列出单元 /集成 /真实应用 /生产 /平台结果、失败与修复、未验证项、试验资源去留和回滚点。核对registry实际数量、MCP/Skill一致、diff聚焦，提交 `feat: 完成内网穿透闭环验证与交付说明`；最终报告真实提交与剩余操作前提。

## 自查覆盖结果

- 设计1–4：任务1/2/5/6/7；设计5：保留事实，不把测试站当产品；设计6–8：任务2/3/5/6。
- 设计9–11：任务1/3/4/5/9；设计12：任务5/6/7；设计13：任务8；设计14–15：任务8/9；设计16的实现细节由各任务执行者决定。
- Review Focus五项分别映射上述任务的命名断言；没有用源码字符串检查替代网络背压、重放或身份隔离行为测试。
- 当前仅完成计划编写；所有实施checkbox保持未勾选，不宣称已开发或已上线。
