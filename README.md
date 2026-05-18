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
pnpm dev
```

该命令会启动文档站、桌面端、PostgreSQL、Prisma migration 和后端服务。
本地开发环境不会自动打开浏览器，需要手动访问：

- 老站 / 文档站：<http://localhost:19773/>
- 管理后台：<http://localhost:3000/admin/>

管理后台标准地址带末尾 `/`；访问 `http://localhost:3000/admin` 时，开发服务器会重定向到 `http://localhost:3000/admin/`。
管理后台前端固定使用 `3000` 端口，接口默认代理到 `3001` 端口的后端服务；如需调整后端接口端口，可在 `server/.env` 中设置 `SYNAPSE_SERVER_API_PORT`。

### 常用脚本

所有脚本都在仓库根目录执行：

```bash
pnpm dev                     # 启动本地开发环境
pnpm quit                    # 停止本地开发环境
```

更完整的开发、打包、发布、编辑器集成说明见 [`desktop/README.md`](./desktop/README.md)。
授权服务说明见 [`server/README.md`](./server/README.md)。

## 正式环境

- 管理面板：<https://synapse.d2.pub/admin>

## 下载

- 官网：<https://usesynapse.netlify.app>
- GitHub Releases：<https://github.com/FairyEver/SynapseAppRelease/releases>
