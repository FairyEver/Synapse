# Synapse

Where Ideas Connect

官网：<https://usesynapse.netlify.app>

本仓库是 pnpm monorepo。桌面端源码与对应的开发、打包、集成说明位于 [`desktop/`](./desktop/README.md)（包名 `@synapse/desktop`）。

## 本地开发

首次克隆仓库后，在**仓库根目录**依次执行以下步骤即可启动本地开发环境。

### 1. 环境准备

- Node.js 20+（推荐使用当前 LTS）
- pnpm 10.22.0（与 `package.json` 的 `packageManager` 字段保持一致）
- Git

### 2. 克隆仓库

```bash
git clone https://github.com/FairyEver/Synapse.git
cd Synapse
```

### 3. 安装依赖

```bash
pnpm install
```

该命令会按 `pnpm-workspace.yaml` 安装整个 workspace 的依赖，包括 `desktop/` 子包。

### 4. 启动本地开发环境

```bash
pnpm dev:server   # 后端 API、管理后台、PostgreSQL
pnpm dev:desktop  # 桌面端
pnpm dev:website  # 官网 / 文档站
```

按当前调试目标选择一个命令启动。根目录不再提供 `pnpm dev` 命令。
本地开发环境不会自动打开浏览器，需要手动访问：

- 老站 / 文档站：<http://localhost:19773/>
- 管理后台：<http://localhost:3000/dashboard/>

管理后台标准地址带末尾 `/`；访问 `http://localhost:3000/dashboard` 时，开发服务器会重定向到 `http://localhost:3000/dashboard/`。
管理后台前端固定使用 `3000` 端口，接口默认代理到 `3001` 端口的后端服务；如需调整后端接口端口，可在 `server/.env` 中设置 `SYNAPSE_SERVER_API_PORT`。

### 常用脚本

所有脚本都在仓库根目录执行：

```bash
pnpm dev:server              # 启动后端相关服务
pnpm dev:desktop             # 启动桌面端
pnpm dev:website             # 启动官网 / 文档站
pnpm quit                    # 停止本地开发环境
```

更完整的开发、打包、发布、编辑器集成说明见 [`desktop/README.md`](./desktop/README.md)。
授权服务说明见 [`server/README.md`](./server/README.md)。

## 常见问题

### macOS 开发模式下登录无法唤起客户端

**现象**：点击客户端"登录"按钮后浏览器打开了 `/desktop-login` 页面，但 `synapse://` 协议无法唤起 Electron 客户端。

**原因**：开发模式下 Electron 使用 `node_modules` 中未签名的 `Electron.app`，其 `Info.plist` 不包含 URL scheme 声明，macOS Launch Services 无法将 `synapse://` 路由到该应用。

**解决**：在仓库根目录执行：

```bash
bash scripts/fix-dev-protocol.sh
```

该脚本会向开发模式 `Electron.app` 的 `Info.plist` 添加 `synapse://` URL scheme 并注册到 Launch Services。执行一次即可，`pnpm install` 或 Electron 版本更新后需重新执行。

## 正式环境

- 管理面板：<https://synapse.d2.pub/dashboard>

## 下载

- 官网：<https://usesynapse.netlify.app>
- GitHub Releases：<https://github.com/FairyEver/SynapseAppRelease/releases>
