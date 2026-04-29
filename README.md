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

### 4. 启动桌面端开发环境

```bash
pnpm desktop:dev
```

该命令会转发到 `@synapse/desktop`，并行启动渲染端 Vite dev server、编译 Electron 主进程，并打开 Electron 窗口。

### 常用脚本

所有脚本都在仓库根目录执行：

```bash
pnpm desktop:dev             # 启动本地开发环境
pnpm desktop:typecheck       # 类型检查
pnpm desktop:build           # 构建渲染端 + 主进程 + data-store
pnpm desktop:package:mac     # 打包 macOS（dmg + zip）
pnpm desktop:package:win     # 打包 Windows（nsis）
pnpm server:docker:up        # 启动授权服务 + PostgreSQL
pnpm server:build            # 构建授权服务和管理后台
```

更完整的开发、打包、发布、编辑器集成说明见 [`desktop/README.md`](./desktop/README.md)。
授权服务说明见 [`server/README.md`](./server/README.md)。

## 下载

- 官网：<https://usesynapse.netlify.app>
- GitHub Releases：<https://github.com/FairyEver/SynapseAppRelease/releases>
