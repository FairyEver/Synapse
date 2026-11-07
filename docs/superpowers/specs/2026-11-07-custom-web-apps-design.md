# 用户自定义网页应用设计

## 意图

允许用户在 Synapse 桌面端把任意 HTTP(S) 网页添加为一个应用。自定义应用与内置应用一样出现在应用中心和 Dock，并可选择应用内嵌或独立窗口两种打开方式。

应用定义与 Dock 布局属于同一个 Synapse 账号并跨设备同步。独立窗口模式共用本机的一套浏览器登录状态；iframe 模式使用不透明来源的沙箱页面，不继承 Synapse renderer 的登录和存储访问。

## 已确认的产品决策

- 首版只支持网页类型，但数据与导航模型必须为后续其他用户应用类型保留扩展位置。
- 支持任意 HTTP(S) 网页，不维护站点白名单。
- 用户可以设置名称、起始 URL、图标和打开方式。
- 图标默认尝试网站 favicon，也允许用户选择本机图片覆盖。
- 应用在应用中心和 Dock 中以普通应用出现，可固定、取消固定和排序。
- 打开方式必须显式选择：`iframe` 在主窗口内嵌显示；`window` 只能打开专用应用窗口。
- 同一账号的应用定义与完整 Dock 布局跨设备同步；不同账号互不可见。
- 所有 `window` 模式应用共用一套本机持久网页会话。切换 Synapse 账号不会清除或隔离网页 Cookie；同一台电脑上的不同 Synapse 账号可以看到之前保存的网站登录状态。
- `iframe` 模式不使用共享网页 session；跨源页面启用 `allow-same-origin` 和存储访问以获得更好的站点兼容性，但摄像头、麦克风、定位、屏幕捕获、剪贴板读取和设备权限继续拒绝。
- 每次全新打开应用或打开独立应用窗口都从配置的起始 URL 开始；同一次 `window` 运行中切走再回来保留当前页面和前进后退历史。
- 应用顶栏不显示地址栏。`window` 模式保留后退、前进、刷新和在系统浏览器打开；`iframe` 模式只能刷新和在浏览器打开。
- 网页自己发起的新窗口、`target="_blank"` 和 OAuth 弹窗留在 Synapse 内，共用网页会话。
- 首版支持普通浏览、登录、文件上传和下载；摄像头、麦克风、定位、系统通知、剪贴板读取等敏感权限统一拒绝。
- 断线时可以使用缓存中的应用和 Dock，但新建、编辑、删除、固定、取消固定和排序全部禁用。首版不允许离线写入或排队。
- 远端更新、远端删除、多设备并发、非法云端数据、登录失效和网络中断都不得造成崩溃或阻断内置应用使用。

## 目标

- 提供从应用中心新建、编辑和删除自定义网页应用的完整路径。
- 按打开方式隔离承载网页：`window` 使用原生网页视图，`iframe` 使用不透明来源的 sandbox；两种模式都不得向网页暴露 Synapse preload、bridge、Node 或本机能力。
- 让自定义应用与内置应用共享现有应用壳层、Dock、窗口和键盘焦点约定。
- 用账号级云端快照作为配置权威来源，并提供稳定的本地缓存、实时更新和冲突恢复。
- 把 Dock 从仅存在于本机配置的固定系统应用列表，扩展为可同步内置应用和用户应用的账号级布局。
- 对远端删除与孤儿引用做幂等清理，正常情况下不出现用户可见错误。

## 非目标

- 不修改 `SynapseMobile/`，首版只做桌面端。
- 不注册 MCP capability、MCP tool、Workflow Node、Automation Action 或 Deep Link。
- 不增加站点权限授权界面；首版不能用于必须使用摄像头、麦克风、定位、通知或剪贴板的网页。
- 不支持同一网站多账号隔离、多浏览器 profile 或临时无痕空间。
- 不提供网页数据清理、Cookie 管理或站点权限管理 UI。
- 不提供地址栏、标签页、书签导入、扩展、代理、自定义 User-Agent、自定义 CSS/JS 或开发者工具入口。
- 不自动把网页标题当作应用名称；名称由用户确认。
- 不允许离线编辑配置，也不在首版实现离线操作队列。
- 不新增通用 HTTP capability，不允许 Agent 通过 MCP 创建或读取自定义应用配置。

## 失败条件

- 允许 iframe 导航到 Synapse renderer 自身 origin 后继续保留 `allow-same-origin`，或把 iframe 失败伪装成承诺必定可用的加载方式。
- 把任意网页加载进 Synapse 自己的 renderer，或给网页注入 Synapse preload/bridge。
- 远端删除一个已固定应用后，Dock 抛错、显示幽灵图标或应用启动失败。
- 云端配置短暂不可用就清空本地应用列表或 Dock。
- 多设备更新时用旧快照整包覆盖新快照，复活已删除应用或丢失无关布局修改。
- 原生网页视图遮挡 Synapse 弹窗、菜单或账号切换入口。

## 术语与身份

- **System App**：现有静态注册的内置应用，ID 仍来自 `SYSTEM_APP_IDS`。
- **自定义应用 / Custom App**：用户创建的动态应用。首版 `kind = "web"`。
- **打开方式 / openMode**：`iframe` 表示主窗口内嵌；`window` 表示只能打开专用窗口。缺失该字段的旧数据归一化为 `window`。
- **自定义网页会话**：所有 `window` 模式应用共用、按电脑持久化的 Chromium session。
- **应用配置快照**：同一账号的应用列表、Dock 布局、迁移标记和同步 revision。

自定义应用 ID 使用客户端生成且稳定的 `cwa_<uuid-v4>`，避免与内置应用 ID 冲突。应用记录删除后保留墓碑，防止旧设备重放创建请求把数据复活。

导航层的有效应用 ID 扩展为：

```text
SynapseNavigationAppId =
  | SynapseSystemAppId
  | CustomWebAppId
```

`SYSTEM_APP_IDS`、`SynapseSystemAppDefinition` 和 `SystemAppContent` 的内部 switch 不加入动态 ID。应用中心、Dock 和主窗口导航增加一层面向 UI 的应用描述适配器，把内置应用与自定义应用投影为同一列表。

## 现状与约束

- `desktop/src/modules/apps/types.ts` 只允许固定 System App ID。
- 应用中心、Dock 和图标展示依赖静态 `systemAppPresentation`。
- `global.dockAppIds` 目前属于本机 `core.config`，只存 System App ID。
- 主窗口和独立应用窗口都要求 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- 现有桌面实时连接已经支持按账号向所有桌面端广播事件，可作为配置变更的失效通知。
- 现有账号服务已经提供带 Bearer Token 的认证请求、账号代次检查和迟到响应丢弃。
- DataRepository 是本机存储，不自动按账号分区；账号相关缓存必须显式携带 `accountId`。
- 浏览器登录数据属于 Electron session 数据目录，不进入 DataRepository、配置备份或云端。

## 方案选择

### 选定方案

采用“双打开方式 + 账号级云端快照 + 本机只读缓存”。

`window` 模式的网页由专用主进程服务创建和控制，所有该模式应用使用同一个持久 partition；权限、下载、弹窗、外部协议和导航由主进程统一约束。`iframe` 模式由主窗口 renderer 直接渲染 sandbox，不注册 WebContentsView、不进入共享网页 session，也不提供网页导航状态。

云端采用“应用记录 + 单账号布局快照 + 聚合 revision + 幂等操作”的混合模型。应用记录支持按稳定 ID 独立创建、修改和删除；Dock 布局保存完整顺序；每次提交递增账号聚合 revision，并通过实时连接通知其他设备刷新。

### 未选方案

**Renderer `<webview>` + 单个云端 JSON 文档**

- 优点：DOM 布局和现有 React 壳层最容易整合。
- 不选原因：Electron 对 `<webview>` 有安全与稳定性警告；弹窗、下载和权限仍需主进程补第二套控制；单 JSON 文档难以表达并发操作和删除墓碑。

**所有自定义应用只开独立 BrowserWindow，直接加载远程 URL**

- 优点：实现最简单，网页行为最接近普通浏览器。
- 不选原因：无法满足 `iframe` 模式在主窗口和 Dock 内运行的产品要求。

**浏览器登录状态按 Synapse 账号隔离**

- 不选原因：用户明确要求把 Synapse 当作整台电脑上的浏览器，网页登录状态只按电脑归属。

## 用户流程

### 新建应用

入口位于应用中心，文案为“新建自定义应用”。表单只有以下内容：

- 图标
- 名称
- 起始 URL
- 打开方式
- 取消、创建

交互规则：

- 用户输入有效 HTTP(S) URL 并离开输入框后，主进程尝试解析页面 favicon；成功后更新图标预览。
- 用户可以从本机选择图片覆盖 favicon。选择后显示“使用网站图标”动作，用于清除自定义图标并重新尝试 favicon。
- favicon 获取失败、超时或页面拒绝访问不阻断创建，使用内置地球图标。
- 名称必填，去掉首尾空白后 1 到 64 个字符。
- URL 只允许绝对 `http:` 和 `https:`，最长 2048 个字符，不允许 URL 内嵌用户名或密码。
- 新建时必须显式选择“应用内嵌”或“独立窗口”；未选择时不可提交。
- “应用内嵌”的选项直接说明可能受网站嵌入策略、登录、弹窗、下载和跨站 Cookie 限制。
- 创建期间禁用重复提交。成功后关闭表单、刷新应用中心，不自动固定到 Dock。
- 创建失败保留表单字段并显示具体、简短错误。
- 未登录或配置处于离线只读状态时不允许打开可提交的创建流程。

### 编辑应用

- 从应用行的右键菜单或更多菜单进入编辑。
- 可修改名称、URL、图标和打开方式。
- URL 修改后，若图标来源仍是 favicon，则重新尝试获取网站图标；自定义图标不自动覆盖。
- 保存后更新应用中心、Dock 和所有窗口中的名称与图标。
- 正在运行的应用不因 URL 修改而跳转；当前页面和前进后退历史保持不变，下一次全新打开或新窗口使用新的起始 URL。
- 打开方式改为 `window` 时退出主窗口内嵌视图；改为 `iframe` 时关闭该应用的专用窗口。
- 删除使用独立确认弹窗。

### 删除应用

- 本地删除和远端删除都必须同时移除应用记录、应用中心和 Dock 引用。
- 关闭该应用的独立窗口。
- 若该应用正在主窗口中显示，切回应用中心。
- 删除确认只在发起删除的设备上出现；远端删除不弹阻断错误。
- 删除后网页 Cookie 和缓存不清除。

### 打开应用

- 从应用中心、Dock、通知式内部导航或已打开的独立窗口入口打开。
- `iframe` 模式在主窗口内运行；每次进入或点击刷新时重新加载起始 URL，不提供可读取的网页导航历史。
- `window` 模式不占用主窗口内容区。从应用中心或 Dock 打开时只创建或聚焦专用窗口，当前主窗口应用保持不变。
- 应用独立窗口沿用现有系统应用的“同 ID 单窗口、重复打开聚焦已有窗口”行为。
- 新建独立应用窗口时始终加载起始 URL。切到其他主窗口应用不影响已打开的独立窗口。
- 页面内部跳转不改变应用 ID、名称、图标或起始 URL。

### 应用顶栏

顶栏沿用现有 System App 顶栏结构，按打开方式展示不同动作：

- `iframe` 主窗口内嵌：左侧应用名称和“应用内嵌”标识；右侧只显示刷新和在浏览器打开。
- `window` 独立窗口：左侧应用名称；右侧显示后退、前进、刷新和在浏览器打开，关闭由系统窗口按钮负责。

应用动作固定为：

1. 后退
2. 前进
3. 刷新
4. 在浏览器打开

规则：

- 不显示当前 URL 或地址栏。
- `iframe` 模式的后退和前进始终不可用，因为跨源父页面无法读取 iframe 历史。
- `window` 模式的后退和前进根据 WebContents 的实际历史是否可用决定禁用状态。
- `iframe` 刷新重新加载起始 URL；`window` 刷新保留当前页面，不回到起始 URL。
- “在浏览器打开”在 `iframe` 模式只打开配置的起始 URL，在 `window` 模式打开当前主框架 URL，并由系统默认浏览器处理。
- 顶栏按钮使用 `SystemAppTopBarActionButton` 图标形态，必须有 aria-label 和 tooltip。
- 加载中可在刷新动作位置显示进度，但不得新增第二行工具栏。
- 页面标题不能替换 Synapse 窗口标题或应用顶栏名称。

### 网页新窗口

- `window.open`、`target="_blank"`、OAuth 登录弹窗留在 Synapse 内。
- 网页弹窗是带系统原生窗口边框的远程网页窗口，不渲染自定义应用顶栏。
- 弹窗使用同一个持久网页 partition，并保留 Chromium 的 `window.opener` 与 `postMessage` 行为。
- 弹窗只允许 HTTP(S)。禁止 `file:`、`data:`、`javascript:`、自定义协议和其他本机协议。
- 每个网页应用同时存在的网页弹窗设为有界数量；超限时拒绝新弹窗并记录脱敏原因。
- 应用窗口关闭时，由该网页创建的弹窗按 Electron opener 生命周期一起关闭；OAuth 不需要跨 opener 存活。

## 云端数据模型

新增 Prisma 模型。所有表均为新表，不向现有大表增加不可空字段。

### UserCustomApp

```text
id           cwa_<uuid-v4>，客户端生成
userId       User 外键，onDelete Cascade
kind         "web"
name         VarChar(64)
startUrl     VarChar(2048)
openMode     "iframe" | "window"，默认 "window"
iconId       可选，指向 UserCustomAppIconAsset
iconSource   "favicon" | "custom"
version      Int，默认 1
createdAt
updatedAt
```

索引：

- `(userId, createdAt, id)`
- `(kind, userId)`

### UserCustomAppTombstone

删除应用时硬删除业务行，只保留最小墓碑：

```text
userId      User 外键，onDelete Cascade
appId       cwa_<uuid-v4>
deletedAt
```

唯一约束：`(userId, appId)`。墓碑不保留名称、URL、图标引用或网页数据，账号存续期间保留，用于阻止旧设备重放创建请求或把已删除应用重新带回。账号删除时随账号级联删除。

### UserCustomAppIconAsset

```text
id            随机 UUID
userId        User 外键，onDelete Cascade
storageKey    Platform Media 对象键，唯一
mimeType      固定 image/png
byteSize      Int
status        pending | active | delete_pending | deleted
deletePending Boolean
deletedAt
createdAt
updatedAt
```

图标在上传前由桌面主进程归一化为 128×128 PNG，最大 128 KiB。服务端再次校验 PNG 内容和大小。不接收 SVG。

应用删除或替换图标后，旧图标立即进入 `delete_pending`，公开读取入口随即返回 404；对象存储删除失败由后台清理继续重试。墓碑不引用旧图标。

图标通过不可猜测的公开只读 URL 提供：

```text
GET|HEAD /api/custom-apps/icons/:iconId
```

响应使用 `image/png`、`nosniff`、不可变长缓存和跨源资源策略。公开 URL 只暴露随机 icon ID，不暴露应用、账号或业务配置。

### UserCustomAppSettings

```text
userId            主键，User 外键，onDelete Cascade
dockAppIds        Json，内置和自定义应用 ID 的完整有序列表
dockMigrationIds  Json，已完成的产品迁移 ID
dockCatalogVersion Int，服务端当前识别的 Dock 目录版本
revision          Int，每次账号应用配置提交后递增
initializedAt     Dock 是否已从旧本机配置完成首次初始化
createdAt
updatedAt
```

`revision` 是账号应用配置的聚合版本，不替代应用行自身的 `version`。客户端用它忽略旧快照和旧实时事件。

### UserCustomAppOperation

用于操作幂等和响应丢失后的安全重试：

```text
id
userId
operationId       客户端生成
operationHash     规范化请求摘要
resultRevision
expiresAt
createdAt
```

唯一约束：`(userId, operationId)`。记录默认保留 7 天并有定时清理。相同 operationId 与相同摘要返回当前快照；相同 operationId 与不同摘要返回冲突。

## 云端 API

所有账号数据接口使用 `UserAuthGuard`，只读取当前认证用户，不接受 `userId` 参数。

```text
GET    /api/custom-apps/snapshot
POST   /api/custom-apps/bootstrap
POST   /api/custom-apps/apps
PATCH  /api/custom-apps/apps/:id
DELETE /api/custom-apps/apps/:id
POST   /api/custom-apps/dock/operations
GET    /api/custom-apps/icons/:iconId
HEAD   /api/custom-apps/icons/:iconId
```

### 快照 DTO

```ts
type CustomAppSnapshotDto = {
  schemaVersion: 1
  revision: number
  initialized: boolean
dockCatalogVersion: number
  apps: CustomAppDto[]
  dockAppIds: string[]
  dockMigrationIds: string[]
}

type CustomAppDto = {
  id: `cwa_${string}`
  kind: "web"
  schemaVersion: 1
  name: string
  startUrl: string
  openMode: "iframe" | "window"
  iconUrl: string | null
  iconSource: "favicon" | "custom"
  version: number
  createdAt: string
  updatedAt: string
}
```

服务端只返回仍存在的应用。Dock 中指向已删除或未知应用的行不会让快照请求失败；服务端主动清理已知已删除自定义应用和墓碑对应 ID，客户端仍须对未知 ID 做防御性过滤。

### 首次 Dock 初始化

`POST /bootstrap` 接收：

```ts
{
  operationId: string
  dockAppIds: string[]
  dockMigrationIds: string[]
}
```

行为：

- 仅当当前账号的 `initializedAt` 为空时写入客户端传来的旧本机 Dock。
- 已完成初始化时按幂等成功处理，直接返回当前快照。
- 服务端归一化、去重并补回不可移除的 `launcher`。
- 两台设备同时首次登录时由数据库原子条件保证只有一份布局生效，另一台获取已生效快照。

### 创建与修改

- 创建请求包含客户端生成的 `cwa_` ID、`operationId`、名称、URL、打开方式、图标来源和可选 PNG 图标。旧客户端缺少打开方式时按 `window` 处理。
- 同一账号重复创建相同 ID：
  - 记录仍有效且字段一致：幂等成功。
  - 记录已删除：按删除墓碑优先，不复活；客户端刷新快照。
  - 字段不一致：409，返回当前快照。
- 修改使用部分更新语义，只提交发生变化的字段，避免名称、URL、图标的无关并发修改互相覆盖。
- 同一字段多设备并发修改时以服务端最后提交值为准。
- 删除优先于修改。墓碑存在后，旧设备提交修改返回“应用不存在”，客户端移除本地引用而不是显示持久错误。
- 每个账号最多 100 个有效自定义应用；达到上限时创建返回明确业务错误。

### Dock 操作

Dock 不使用旧设备上的完整数组覆盖云端。客户端提交操作意图：

```ts
type CustomAppDockOperation =
  | { type: "pin"; appId: string }
  | { type: "unpin"; appId: string }
  | { type: "move"; appId: string; beforeAppId: string | null }
  | { type: "restore-default" }
  | {
      type: "apply-migrations"
      migrations: Array<{
        id: string
        operations: Array<
          | { kind: "move-to-end"; appId: string }
          | { kind: "insert-before"; appId: string; targetAppId: string }
        >
      }>
    }
```

- 操作在服务端最新布局上执行，不读取客户端旧布局。
- `launcher` 不可移除，缺失时补回。
- 新固定应用插入在 `launcher` 前。
- 移动操作按稳定 app ID 重放；目标锚点不存在时保留应用并放到 `launcher` 前，不失败。
- `restore-default` 由服务端根据 shared app catalog 中当前发布版的默认 Dock 生成，不接收旧客户端自带的完整列表；旧客户端不认识的新 System App ID 保留在快照中但暂时不渲染。
- `apply-migrations` 只在服务端最新布局上执行尚未记录的 migration ID，并在同一事务更新 `dockAppIds`、`dockMigrationIds` 和 revision；同一 migration 被多台设备同时提交时只生效一次。
- 操作 ID 保证网络超时后重试不会重复移动。

## 实时同步

共享 live protocol 增加：

```text
customAppsChanged: "custom-apps.changed"
payload: { revision: number }
```

- 每次应用或 Dock 变更提交后，服务端向该账号所有已连接桌面端广播新 revision。
- 广播失败不影响已提交配置；桌面端在重连、窗口重新聚焦和进入相关页面时补充刷新。
- 桌面主进程收到 revision 且大于本地 revision 时拉取快照；并发事件使用 debounce 合并。
- 拉取失败不丢弃已有缓存，只把同步状态标记为 stale，并退避重试。
- 账号切换或认证代次变化后，所有旧请求结果丢弃。

## 本机缓存与离线

新增本地 DataRepository namespace：

```text
app.custom-apps.snapshots
```

使用 local-only 传输策略，按 `accountId` 保存每个账号最后一份通过 schema 校验的快照。缓存不得进入配置备份或跨账号恢复。

启动与账号变化：

1. 已认证且存在该账号缓存：立即显示缓存，配置只读，等待云端刷新。
2. 云端刷新成功：原子替换缓存，进入可编辑状态。
3. 无缓存且网络失败：内置应用正常工作，自定义应用显示暂不可用，不生成空配置覆盖缓存。
4. 登出：关闭所有自定义应用视图和窗口，隐藏自定义应用入口；保留按账号隔离的本地缓存和按电脑共享的网页 Cookie。
5. 切换到另一个账号：加载该账号自己的缓存和云端配置，不复用上一个账号的应用列表；网页会话仍沿用本机共享 partition。

离线状态：

- 应用中心仍显示缓存应用。
- Dock 仍按缓存布局显示。
- 打开、后退、前进、刷新和在浏览器打开仍可用。
- 新建、编辑、删除、固定、取消固定、移动和恢复默认全部禁用。
- 禁用状态通过按钮可用性和简短 tooltip 表达，不显示常驻说明段落。

未登录与认证失效状态：

- 未登录时继续可以打开内置应用，但自定义应用入口隐藏，所有自定义应用视图和窗口关闭。
- 内置 Dock 使用本机遗留 `core.config.dockAppIds`，过滤掉自定义 ID 后显示。
- 未登录时 Dock 只读；固定、取消固定、排序、恢复默认和新增应用都要求登录，避免产生无法同步、随后又被云端覆盖的本地修改。
- `401/403` 先交给现有 AccountService 刷新一次。刷新成功且仍是同一账号时无用户可见变化。
- 刷新失败或确认账号已失效时，等效于未登录：关闭自定义应用视图和窗口，隐藏自定义应用，Dock 退回过滤后的本机遗留布局并只读。
- 自定义应用 API 返回 404（服务端尚未升级或已回滚）但账号仍有效时，如有缓存则继续显示并使用缓存应用，配置只读；如无缓存则只显示内置应用。
- 上述状态都保留账号级缓存和共享网页 Cookie。重新登录同一账号并同步成功后恢复云端应用与 Dock。

## 多设备与异常状态

| 情况 | 行为 |
|---|---|
| 云端删除已固定应用 | 服务端事务移除应用和 Dock ID；客户端归一化后不再显示；若正在运行则关闭视图并回到应用中心 |
| 云端删除正在编辑的应用 | 刷新快照，关闭编辑表单，显示“应用已在其他设备删除” |
| 云端修改名称或图标 | 应用中心、Dock 和窗口立即更新；当前网页及历史不变 |
| 云端修改 URL | 当前网页及历史不变；下一次新打开或新窗口使用新 URL |
| 云端把打开方式改为 `window` | 主窗口退出 iframe，后续点击只创建或聚焦专用窗口 |
| 云端把打开方式改为 `iframe` | 关闭对应专用窗口，后续点击在主窗口内嵌打开 |
| 两台设备同时修改不同字段 | 部分更新合并，都保留 |
| 两台设备同时修改同一字段 | 最后成功提交值生效，另一端由实时事件刷新 |
| 旧设备尝试修改已删除应用 | 视为删除优先，不复活，不阻塞其他操作 |
| Dock 含已删除或未知 ID | 显示时过滤；不得抛错；非本地发起的异常布局不回写云端 |
| Dock 缺 `launcher` 或含重复 ID | 客户端归一化补回并去重；合法用户操作提交后服务端同样归一化 |
| 网络超时但服务端可能已提交 | 使用相同 operationId 重试；成功返回当前快照，不重复创建或移动 |
| 云快照 schema 不合法 | 不使用该快照覆盖缓存，记录结构化错误，继续使用最后有效缓存 |
| 账号在请求中切换 | 账号代次检查拒绝迟到响应，不把 A 的配置应用到 B |
| 登录失效且刷新失败 | 关闭自定义应用视图和窗口，隐藏自定义应用；Dock 退回过滤后的本机遗留布局并只读 |
| 旧服务端没有自定义应用 API | 有缓存时继续显示缓存应用但只读；无缓存时隐藏；内置应用继续工作 |
| 网页导航到非 HTTP(S) | 主进程阻止并保持当前页面 |
| 网页申请敏感权限 | 主进程立即拒绝并返回标准拒绝结果，不弹 Synapse 错误 |
| 网页弹窗超限或使用非法协议 | 拒绝新窗口，记录不含 URL 的脱敏日志 |
| 网页视图加载失败或证书失败 | 内容区显示错误与重试，不关闭窗口，不绕过证书校验 |
| 应用数量达到上限 | 创建按钮禁用并显示上限原因，已有应用不受影响 |

## Dock 迁移与权威来源

功能上线后，账号级云端布局是 Dock 的权威来源，但必须无损接管现有本机布局。

首次登录流程：

1. 拉取云端快照。
2. 如果 `initialized = false`，把本机 `global.dockAppIds` 和 `global.dockMigrationIds` 经当前应用注册表归一化后提交 bootstrap。
3. bootstrap 成功后使用返回的云端布局。
4. 如果云端已初始化，忽略本机旧布局，直接使用云端。

兼容规则：

- 保留 `core.config` 中的 `dockAppIds` 和 `dockMigrationIds`，但同步完成后不再作为权威来源，也不由新的 Dock 编辑路径写入。
- 保留它们是为了旧版本回退、首次无缓存启动和现有配置备份兼容。
- 未登录时仍可使用这份遗留布局，但 Dock 管理入口只读；不写回旧字段，避免出现尚未同步就被云端配置覆盖的本地状态。
- 新建账号在本机已有默认 Dock 时，以第一台登录设备的本机布局初始化云端。
- 后续内置应用 introduction 继续使用稳定 migration ID，但完成记录移入账号级快照；客户端检测缺失迁移后提交 `apply-migrations`，由服务端在最新布局上原子执行并记录 migration ID。
- shared app catalog 同时声明默认 Dock 顺序与 `dockCatalogVersion`。`restore-default` 由服务端据此生成，避免旧客户端删除较新版本发布的 System App。
- 默认 Dock 仍为 9 项；System App 数量不变。自定义应用不默认固定。

## 桌面架构

### 共享契约

新增 `shared/src/custom-apps.ts`：

- 自定义应用 ID schema 和类型。
- 快照、应用、图标和 Dock 操作 schema。
- API 路径常量。
- DTO 类型。
- `isCustomAppId`、`normalizeCustomAppDockIds` 等服务端与客户端共用的纯函数。
- 当前 `SYSTEM_APP_IDS`、默认 Dock 顺序、稳定 Dock migration ID 和 `dockCatalogVersion`。

把稳定的 `SYSTEM_APP_IDS` 放入 shared app contract，桌面现有 module 从 shared 重导出，避免服务端维护第二份列表。

### 主进程

新增 `desktop/electron/services/custom-apps/`：

- `catalog-service.ts`：快照拉取、校验、缓存、bootstrap、revision 与同步状态。
- `mutation-service.ts`：创建、修改、删除、Dock 操作、幂等重试和账号代次检查。
- `runtime-service.ts`：WebContentsView 生命周期、bounds、可见性、导航状态和外部打开。
- `web-session.ts`：共享持久 partition、权限拒绝、协议过滤、下载和弹窗策略。
- `window-service.ts`：自定义应用独立窗口和网页弹窗。
- `favicon-service.ts`：HTTP(S) 页面 favicon 发现、受限下载和 PNG 归一化。

新增 `desktop/electron/modules/custom-apps/ipc.ts`，所有 handler 只做 schema 校验和 service 调度。使用 `IpcRegistry`、`ServiceRegistry`、`EventBus`、`PermissionGuard` 和 `AuditSink`，遵守 Phase 0 硬约束。

新增 DataRepository schema：

```text
desktop/electron/runtime/data-repo/schemas/custom-apps.ts
```

快照缓存写入前必须通过完整 schema 校验。缓存失败不得阻止应用启动。

### Renderer

新增 `desktop/src/modules/custom-apps/`：

- `context.tsx`：订阅主进程快照和同步状态。
- `app-adapter.ts`：把 System App manifest 和 Custom App DTO 投影为应用中心与 Dock 条目。
- `create-edit-dialog.tsx`
- `icon-picker.tsx`
- `delete-dialog.tsx`
- `web-app-content.tsx`
- `web-app-viewport.tsx`
- `web-app-toolbar-actions.tsx`
- `custom-app-window-app.tsx`

现有代码调整：

- `desktop/src/modules/apps/index.tsx` 和 `components/system-app-content.tsx` 的主窗口导航接受内置与自定义应用联合类型。
- `AppLauncherList` 接受统一应用条目，渲染自定义应用分类、创建入口和编辑/删除菜单。
- `AppShellDock` 接受统一应用条目和可渲染图标，不再只读取静态 `systemAppPresentation`。
- `DockAppMenuItems` 接受通用应用 ID；自定义应用额外显示编辑和删除。
- `desktop/src/main.tsx` 增加 `window=custom-app&appId=...` 的独立窗口入口。
- `SystemAppWindowShell`、`EmbeddedSystemAppShell` 和 `SystemAppTopBarActionButton` 作为唯一顶栏实现复用，不新增另一套应用顶栏。

### 应用中心

- 分类栏新增“自定义应用”，使用现有 Lucide 地球类图标。
- 应用中心显示“新建自定义应用”主操作；自定义分类为空时显示一个简洁空状态和同一创建入口。
- 自定义应用按 `createdAt, id` 稳定排序，首版不提供应用中心内手动排序。
- 自定义应用行主操作是打开应用。
- 右键或更多菜单提供：打开、固定到 Dock/从 Dock 移除、编辑、删除、管理 Dock。
- 图标加载失败时使用地球图标，不显示破图。

### 应用图标

- 应用中心、Dock 和编辑表单显示同一图标。
- 有云端图标时渲染服务端返回的不可变 icon URL。
- 没有图标、下载失败或 URL 暂时不可达时使用内置地球图标。
- 图标资源只允许 `image/png`；不通过 CSS 背景、内联 SVG、远程任意 URL 或 HTML 注入。

### Bridge

Preload 只暴露窄类型化 API，renderer 不接触 WebContents、session、Cookie、文件路径或认证 token。

建议命名：

```text
customApps.snapshot.get()
customApps.snapshot.onChanged(listener)
customApps.sync.retry()
customApps.app.create(input)
customApps.app.update(input)
customApps.app.delete(input)
customApps.dock.apply(operation)
customApps.icon.choose()
customApps.icon.fetchFavicon(url)
customApps.window.open(appId)
customApps.view.attach(input)
customApps.view.setBounds(input)
customApps.view.detach()
customApps.view.setOccluded(input)
customApps.navigation.perform(input)
customApps.navigation.onStateChanged(listener)
customApps.external.openCurrent()
```

具体 operation ID 使用 `app.custom_apps.<resource>.<action>`。这些是 UI 私有 IPC，不注册 MCP。

## 网页运行模型

### 共享 session

固定 partition：

```text
persist:synapse-custom-web
```

- 所有 `window` 模式自定义应用和网页弹窗共用。
- 跨应用重启持久化 Cookie、localStorage、IndexedDB、Cache Storage 和站点权限拒绝记录。
- 不随 Synapse 账号切换、登出或删除应用清除。
- 不与 Synapse 自己的 renderer、登录 Cookie 或网络 session 共享。

以上共享 session 只适用于 `window` 模式。`iframe` 模式不使用该 partition。

### iframe

- `iframe` 模式只出现在主窗口应用内容区，不创建 BrowserWindow 或 WebContentsView。
- iframe 的 sandbox 默认包含表单、脚本、模态框、方向锁定、指针锁定、演示和存储访问；与 renderer 跨源时再加入 `allow-same-origin`。
- 与 renderer 同源的起始 URL 不授予 `allow-same-origin`。主进程监听所有子框架导航，阻止目标 origin 等于 renderer origin 的导航，覆盖跨源页面后续自行跳回 Synapse origin 的情况。
- 不授予 `allow-top-navigation`、弹出窗口或下载。网页弹窗和下载应引导使用独立窗口模式。
- iframe 的 Permissions Policy 委托自动播放、加密媒体、全屏、画中画、屏幕唤醒、Web Share、传感器、游戏手柄、WebAuthn、FedCM、Storage Access 和剪贴板写入；固定拒绝摄像头、麦克风、定位、屏幕捕获、剪贴板读取、支付、广告主题、本地字体和 USB/串口/HID/MIDI 等敏感能力。
- iframe 使用 `strict-origin-when-cross-origin` referrer、`loading="eager"` 和全屏能力。
- iframe 不加载 Synapse preload、bridge 或 Node。父页面不读取其 URL、DOM 或导航历史。
- 后退和前进始终禁用。
- 刷新通过销毁并重建 iframe 回到起始 URL。
- “在浏览器打开”只打开配置的起始 URL，并复用受权限保护的 shell external-open 入口。
- 网站自身的 `X-Frame-Options`、CSP、frame-busting、登录、弹窗或下载限制属于产品已提示的 iframe 限制，不尝试通过修改响应头、关闭 web security 或注入脚本绕过。

### WebContentsView（window 模式）

- 每个已打开的 `window` 应用在本次运行中拥有一个 WebContents。
- 专用窗口关闭前切到其他应用不重建 WebContents；独立窗口关闭或应用被删除时销毁。
- 独立应用窗口拥有自己的 WebContents，首次打开加载起始 URL。
- 窗口关闭或应用被删除时销毁对应 WebContents。
- 页面标题更新不得改变应用名称或窗口标题。
- 网页主框架 URL 变化、加载状态和历史可用性通过受控事件同步给 renderer；renderer 不直接读取 WebContents。

### 视口尺寸（window 模式）

- Renderer 在内容区渲染只用于测量的占位元素。
- `ResizeObserver` 把相对窗口内容区的 CSS 像素 bounds 发送给主进程。
- 主进程校验 sender、有限数值、非负宽高和窗口边界，再为 WebContentsView 设置 bounds。
- 窗口缩放、Dock 展开/隐藏、顶栏状态变化和内容重排都必须更新 bounds。
- 视图 bounds 不得覆盖应用顶栏、左侧 Dock 或底部壳层区域。

### 浮层与原生视图（window 模式）

WebContentsView 位于 renderer DOM 之上，因此任何可能覆盖网页区域的应用内浮层都必须让网页视图暂时不可见，关闭后恢复：

- Dialog / AlertDialog / Sheet
- DropdownMenu / ContextMenu / Menubar
- Select / Popover / HoverCard / Command

实现使用应用级 Native Surface Occlusion Context/lease：

- 浮层打开时获取 lease，主进程隐藏当前自定义应用视图。
- 浮层关闭时释放 lease；计数为 0 后恢复视图。
- 不销毁或 reload WebContents，因此页面状态和播放中的网页不丢失。
- 没有自定义应用视图时所有 hook 为 no-op。
- 覆盖独立应用窗口宿主。
- 展开菜单与弹窗的实际视觉验收不能只检查关闭状态或源码。

### 导航与安全

WebContents 设置：

```text
contextIsolation: true
nodeIntegration: false
sandbox: true
webSecurity: true
allowRunningInsecureContent: false
preload: none
```

- 顶层导航和弹窗只允许 `http:` / `https:`。
- 阻止 `file:`、`data:`、`javascript:`、`about:`、`synapse:` 和自定义协议。
- 不绕过证书错误、HTTP 认证提示或混合内容限制。
- 不向网页注入 Synapse 脚本、token、Cookie 或 bridge。
- `iframe` 模式只通过 sandbox 隔离；`window` 模式通过 WebContents 设置和共享 session 策略约束。
- 页面标题、favicon、下载文件名和错误文本都按不可信外部数据处理，不写入包含 URL 的远程日志。

### 权限

以下 session 权限策略只适用于 `window` 模式。`iframe` 模式由 sandbox、Permissions Policy 和主进程子框架导航守卫约束。

采用显式 allowlist。所有 permission request/check 和设备权限默认拒绝，只允许：

- `mediaKeySystem`：仅用于受保护媒体播放，不授予摄像头、麦克风、屏幕捕获或设备访问。

明确拒绝：

- `media`、`display-capture`、`geolocation`、`notifications`
- `clipboard-read`、`clipboard-sanitized-write`
- `storage-access`、`top-level-storage-access`：首版没有站点权限确认 UI；顶层 OAuth 跳转和同站 Cookie 不依赖该权限，第三方 iframe 的存储访问会失败
- `pointerLock`、`keyboardLock`、HTML fullscreen、window management
- local fonts、idle detection、speaker selection、open external、unknown
- USB、HID、串口、MIDI Sysex 及其他设备权限

普通第一方 Cookie、localStorage、IndexedDB 和 Cache Storage 不属于需要授权的站点权限，保持可用。WebAuthn 不额外开放 Synapse 权限 UI；平台 passkey 是否可用取决于 Chromium 与操作系统，USB/NFC 硬件安全密钥因设备权限拒绝在首版不可用。

拒绝由 session permission request/check handler 与 device permission handler 实现，返回标准拒绝结果。拒绝不是 Synapse 异常，不弹 toast。

### 上传与下载

- 文件上传使用 Chromium 原生文件选择行为，网页只获得用户选中的文件，不获得 Synapse 文件系统能力。
- 下载由 `will-download` 统一处理，使用系统保存对话框确认落点；取消不报错。
- 保存成功后只记录不含文件名和 URL 的结果元数据。
- 不默认静默下载到已知目录。

### 外部打开

- 只允许当前主框架的 HTTP(S) URL。
- 通过现有受权限与审计保护的 shell external-open 入口交给系统默认浏览器。
- 输入不是 HTTP(S)、无当前 URL或 sender 无对应自定义应用时禁用或拒绝。
- 日志和审计不记录完整 URL。

## 状态与错误处理

Renderer 只显示三类用户可见状态：

- 快照同步中：继续显示上次有效内容，不弹 toast。
- 离线/同步失败：内容可读，配置操作禁用；可通过重新联网或重新聚焦自动恢复。
- 明确的业务失败：创建上限、URL 无效、应用已删除或服务器不支持该功能；使用字段错误或简短 toast。

不得：

- 因 favicon 获取失败阻止创建。
- 因远端删除显示未处理异常或错误堆栈。
- 因 Dock 包含孤儿 ID 让整个 Dock 消失。
- 因一次同步失败清空本地缓存。
- 因账号切换把 A 的快照或迟到响应显示给 B。

## 服务端实现边界

新增 Nest module `server/src/custom-apps/`：

- controller
- service
- auth-scoped repository/query helpers
- icon service
- dock normalization and operation reducer
- live event publisher

服务端要求：

- 所有写操作在事务中更新应用记录和 `UserCustomAppSettings.revision`。
- 删除应用、写入最小墓碑与移除 Dock 引用在同一事务完成。
- 图标对象存储可能失败，因此使用 pending/active/delete_pending 状态和后台清理，不把外部对象存储写入包进数据库事务。
- 相同 operationId 的幂等重试返回已提交结果。
- 服务端日志不得记录完整起始 URL、Cookie 或图标二进制。
- 不新增公开 MCP 或 OpenAPI 业务入口。

## 发布与兼容

- 先发布服务端迁移和 API，再发布桌面端。
- Prisma migration 只新增表、索引、关系与可空/默认字段；不在大表增加不可空列。
- 旧桌面端不识别自定义应用，继续按旧本机 Dock 工作。
- 新桌面端连接旧服务端时，有缓存则只读显示并允许打开缓存应用，无缓存则隐藏自定义应用；内置应用不受影响。
- 服务端回滚时保留新表；桌面端回退后继续使用本机旧 Dock 字段。
- 自定义应用 Cookie 存于 Electron session 数据目录，不进入服务端备份、客户端配置备份或 DataRepository 导出。

## 文档与注册表面

实现时必须同步：

- `docs/agents/capability-registry.md`：说明自定义应用不是 System App、不增加 MCP、Workflow、Automation 或 Deep Link；System App 21、默认 Dock 9、既有 MCP 数量不变，但 Dock 布局改为账号级。
- `docs/agents/module-boundaries.md`：新增自定义网页应用边界、共享 session、权限拒绝、远端删除和 Dock 同步规则。
- `RELEASE_NOTES_PENDING.md`：面向用户说明可添加网页应用、共享登录、Dock 同步和离线只读行为。

不修改 MCP capability catalog、MCP tool 索引、Workflow node registry 或 Automation action registry。

## 测试

### Shared contract

- 自定义 ID、应用、快照、图标和 Dock operation schema。
- Dock 归一化：未知 ID、重复 ID、缺 launcher、恶意超长列表。
- 未来 `kind` 或未知可选字段不会让客户端崩溃。

### Server

- 未登录拒绝所有账号接口。
- 两个账号的应用、图标、Dock、revision 和 operationId 完全隔离。
- 创建、部分修改、删除、墓碑和 100 个应用上限。
- 删除、墓碑写入与 Dock 清理同事务。
- 并发创建、同一 operationId 重试、响应丢失、同字段和不同字段并发。
- bootstrap 只生效一次，多设备竞争不互相覆盖。
- `restore-default` 使用服务端 shared catalog，旧客户端请求不会删除较新版本 System App。
- `apply-migrations` 在最新布局上原子执行，多设备重复提交同一 migration 只生效一次。
- snapshot 中不返回已删除应用；异常 Dock 不会导致请求失败。
- 图标上传、PNG 校验、公开读取、immutable cache、HEAD、替换、删除后 404 和后台清理。
- live revision 在提交后广播，广播失败不回滚配置。

### Desktop 主进程

- 账号级缓存读取、校验、原子替换和损坏快照回退。
- 登录、登出、账号切换、认证代次和迟到响应。
- 401 刷新成功保持现状；刷新失败关闭自定义应用并退回过滤后的本机 Dock 只读状态。
- live revision 去重、debounce、断线重连和补拉。
- 离线只读状态，在线恢复后重新允许编辑。
- bootstrap 首次执行和云端已初始化时不再写旧本机布局。
- 未登录时内置 Dock 可打开但不可编辑，旧配置不被新路径写回。
- 旧服务端 404 时缓存应用可打开但配置只读。
- 创建、修改、删除、幂等重试、网络超时和 409 恢复。
- WebContentsView 创建、bounds、隐藏、恢复、切应用保留历史、关闭销毁。
- `window` 模式创建独立窗口；`iframe` 模式拒绝 WebContentsView 和独立窗口入口。
- iframe sandbox 不包含 `allow-same-origin`，刷新重建页面，外部打开只使用起始 URL。
- 远端删除关闭视图、移除 Dock 且不抛未处理异常。
- 共享 partition 跨 WebContents 和重启持久化，且不与非自定义应用 session 混用。
- 顶层导航协议、弹窗协议、opener、共享 Cookie、弹窗数量上限。
- 权限 allowlist：仅 `mediaKeySystem` 放行，其余请求与设备权限全部拒绝。
- 上传、下载确认、取消、失败和外部打开。
- 无 preload、Node integration 关闭、sandbox、context isolation、webSecurity 和证书错误。
- 浮层 occlusion lease 的嵌套打开/关闭与视图恢复。

### Renderer

- 应用中心显示自定义分类、新建入口、固定状态和上下文菜单。
- 创建表单校验、favicon 成功/失败、本地上传覆盖、URL 错误和提交中禁用。
- 新建必须选择打开方式，iframe 限制文案可见；编辑名称、URL、图标和打开方式。
- 删除确认、删除当前应用和远端删除后的焦点与导航。
- iframe 顶栏只有刷新和在浏览器打开；window 顶栏包含后退、前进、刷新和在浏览器打开。
- 从应用中心或 Dock 打开 `window` 应用不占用主窗口；iframe 应用在主窗口内显示。
- 内嵌启动台、Dock 和独立窗口三种宿主均只有一条应用顶栏。
- 离线时所有配置编辑入口禁用。
- 未登录或认证失效时自定义应用隐藏，内置 Dock 可用且管理入口只读。
- 菜单、弹窗、账号菜单展开时网页视图不遮挡浮层。

### 验证命令

实现完成后至少运行：

```bash
pnpm --filter @synapse/shared test
pnpm --filter @synapse/server test
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
```

涉及新增打包资源或桌面打包结构时再运行：

```bash
pnpm --filter @synapse/desktop run check:packaged-asar
```

真实菜单展开、弹窗遮挡、窗口缩放、下载、上传和 OAuth 只能在取得启动应用与浏览器验收授权后记录；组件测试或构建通过不能替代视觉和实机验收。

## 实施拆分

1. 建立 shared 契约、Prisma 新表、服务端 API、图标存储和 live revision。
2. 建立桌面主进程 catalog、缓存、同步、幂等 mutation 和账号生命周期处理。
3. 扩展应用中心、Dock、主窗口和独立窗口的统一应用描述与打开方式导航。
4. 实现 iframe sandbox 与 window 模式的 WebContentsView 运行服务、共享 session、安全策略、上传下载和网页弹窗。
5. 实现应用中心创建/编辑/删除 UI、图标获取与预览。
6. 接管 Dock 的账号级布局与首次 bootstrap，保留旧本机配置作为回退。
7. 补齐 occlusion、错误态、文档、发布说明和专项验收。

## 构建者裁量

以下不改变产品行为，留给构建计划阶段决定：

- 服务端文件名、Prisma model 的物理命名和内部 helper 拆分。
- favicon HTML 解析器与回退顺序的具体实现。
- operationId 清理任务的执行频率。
- DataRepository 快照使用 JSON collection 还是显式 SQLite schema，只要保持 accountId 隔离和 local-only。
- 浮层 occlusion 使用 React context 还是等价的应用级 lease registry，只要覆盖清单中的所有浮层且不重建 WebContents。

