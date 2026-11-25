# 开放 SDK 与版本发现

Synapse 提供免 npm 安装、零第三方运行时依赖的轻量官方 SDK。SDK 产物直接由 Synapse 服务端静态托管与分发，支持浏览器全局脚本、原生 ESM 模块、Node.js 22+ 零包安装以及完整 TypeScript 类型定义。

---

## 统一清单发现（Discovery Schema）

服务端提供机器可读的 JSON 清单，用于客户端版本自省、动态导入、自动化脚手架与持续集成。

### 1. 全局清单

```text
{{APP_PUBLIC_URL}}/sdk/manifest.json
```

全局清单汇总所有已发布的官方 SDK 及其最新版本、主要版本别名、全局变量名与文件哈希：

```json
{
  "schemaVersion": 1,
  "sdks": {
    "state-sync": {
      "name": "state-sync",
      "title": "Synapse State Sync SDK",
      "manifestUrl": "/sdk/state-sync/manifest.json",
      "latest": "1.0.0",
      "major": "v1",
      "globalName": "SynapseStateSync",
      "docsUrl": "/document/open-api/api/state-sync",
      "nodeDownloadCommand": "curl -fsSL https://synapse.d2.pub/sdk/state-sync/v1/state-sync.esm.min.js -o ./synapse-state-sync.mjs",
      "files": {
        "browserGlobal": {
          "url": "/sdk/state-sync/1.0.0/state-sync.global.min.js",
          "latestUrl": "/sdk/state-sync/v1/state-sync.global.min.js",
          "integrity": "sha256-MK+5ztAuQlLD3lhZwHshAQG7KBuvSFDBGXc4KKySdUg=",
          "bytes": 25489
        },
        "esm": {
          "url": "/sdk/state-sync/1.0.0/state-sync.esm.min.js",
          "latestUrl": "/sdk/state-sync/v1/state-sync.esm.min.js",
          "integrity": "sha256-L9fxNyfXPDpYJlOSU3KyMs81M+/WmlyO3JbjK37Vvws=",
          "bytes": 25022
        },
        "cjs": {
          "url": "/sdk/state-sync/1.0.0/state-sync.cjs",
          "latestUrl": "/sdk/state-sync/v1/state-sync.cjs",
          "integrity": "sha256-OUv0t/QKrFCLSrYjnRRKESvZVvTDaB9CdxayRzN3qOM=",
          "bytes": 25465
        },
        "types": {
          "url": "/sdk/state-sync/1.0.0/index.d.ts",
          "latestUrl": "/sdk/state-sync/v1/index.d.ts",
          "integrity": "sha256-KrOYO4A2NKsl87NzHlk+cUUSCjTNgGe5SDOT2wVXnM0=",
          "bytes": 7889
        }
      },
      "versions": ["1.0.0"]
    }
  }
}
```

### 2. 单 SDK 清单

```text
{{APP_PUBLIC_URL}}/sdk/<name>/manifest.json
```

例如 `{{APP_PUBLIC_URL}}/sdk/state-sync/manifest.json`，返回特定 SDK 的完整规格与全部已归档版本列表。

---

## 版本策略：浮动大版本与不可变 SemVer

Synapse SDK 采用双层 URL 路由设计：

| 路由形式 | 示例 | 适用场景 | 缓存与更新策略 |
|---|---|---|---|
| **浮动大版本别名** | `/sdk/state-sync/v1/...` | 快速原型、在线演练、内部控制台 | 自动指向该大版本下的最新稳定版本（例如 1.0.0 -> 1.0.1 自动生效）；服务端设置较短缓存，客户端无需手动更新脚本地址。 |
| **精确语义化版本** | `/sdk/state-sync/1.0.0/...` | 生产环境发布、长期稳定系统 | 文件内容强哈希固定且永不变更；服务端配置长效静态缓存。 |

### SRI 子资源完整性校验（Subresource Integrity）

生产网页在引入固定版本时，可结合清单中提供的 `integrity`（SHA-256）配置浏览器校验，防范 CDN 或链路层篡改：

```html
<script
  src="https://synapse.d2.pub/sdk/state-sync/1.0.0/state-sync.global.min.js"
  integrity="sha256-MK+5ztAuQlLD3lhZwHshAQG7KBuvSFDBGXc4KKySdUg="
  crossorigin="anonymous">
</script>
```

---

## 多运行时零依赖嵌入

### 1. 浏览器普通脚本（Global）

适合传统 HTML、大屏展示、低代码平台或无构建工具的网页：

```html
<script src="https://synapse.d2.pub/sdk/state-sync/v1/state-sync.global.min.js"></script>
<script>
  const { StateSyncClient } = window.SynapseStateSync;
  const client = new StateSyncClient({
    baseUrl: "https://synapse.d2.pub",
    spaceId: "SPACE_ID",
    token: "sys_TOKEN",
  });
</script>
```

### 2. 浏览器原生 ESM

直接在现代浏览器中利用 `type="module"` 导入，无需 Webpack、Vite 或 Rollup：

```html
<script type="module">
  import { StateSyncClient } from "https://synapse.d2.pub/sdk/state-sync/v1/state-sync.esm.min.js";

  const client = new StateSyncClient({
    baseUrl: "https://synapse.d2.pub",
    spaceId: "SPACE_ID",
    token: "sys_TOKEN",
  });
</script>
```

### 3. Node.js 22+ 零安装（Zero-npm）

无需执行 `npm install`、`pnpm add` 或在服务端安装构建依赖，使用系统自带的 `curl` 将单文件 ESM 产物保存到本地：

```bash
curl -fsSL https://synapse.d2.pub/sdk/state-sync/v1/state-sync.esm.min.js -o ./synapse-state-sync.mjs
```

在 Node.js 脚本中直接引用（Node.js 22+ 内置全局 `WebSocket` 与 `fetch`，完全零第三方依赖）：

```javascript
import { StateSyncClient } from "./synapse-state-sync.mjs";

const client = new StateSyncClient({
  baseUrl: process.env.SYNAPSE_BASE_URL || "https://synapse.d2.pub",
  spaceId: process.env.SYNAPSE_SPACE_ID,
  token: process.env.SYNAPSE_SPACE_TOKEN,
});
```

CommonJS 格式支持：

```bash
curl -fsSL https://synapse.d2.pub/sdk/state-sync/v1/state-sync.cjs -o ./synapse-state-sync.cjs
```

```javascript
const { StateSyncClient } = require("./synapse-state-sync.cjs");
```

### 4. TypeScript 类型支持

下载类型定义文件供本地项目或 IDE 代码提示使用：

```bash
curl -fsSL https://synapse.d2.pub/sdk/state-sync/v1/index.d.ts -o ./synapse-state-sync.d.ts
```

---

## 官方 SDK 目录

| SDK 名称 | 当前版本 | 状态 | 运行时 | 文档指引 |
|---|---|---|---|---|
| **state-sync** | `1.0.0`（别名 `v1`） | **正式可用 (GA)** | 浏览器 / Node.js 22+ | [状态同步文档](/open-api/api/state-sync) |
| **channels** | 规划中（Roadmap） | 设计阶段 | 浏览器 / Node.js 22+ | [频道文档](/open-api/api/channels) |
| **cloud-tables** | 规划中（Roadmap） | 设计阶段 | 浏览器 / Node.js / CLI | [云端数据表文档](/open-api/api/cloud-tables) |
