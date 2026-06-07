# 构建与发布

<!-- Sources: desktop/package.json; desktop/README.md; .github/workflows/release.yml; README.md -->

## 桌面端构建

桌面端完整构建命令：

```bash
pnpm --filter @synapse/desktop run build
```

该脚本依次执行：

```bash
pnpm --filter @synapse/desktop run generate:definitions-registry
pnpm --filter @synapse/desktop run build:renderer
pnpm --filter @synapse/desktop run build:electron
pnpm --filter @synapse/desktop run build:database
```

构建先生成 definitions registry，再执行 renderer、Electron 和 database 构建。`build:renderer` 使用 Vite 构建 renderer。`build:electron` 生成 IPC 代码并编译 Electron TypeScript。`build:database` 使用 esbuild 打包 database 的 MCP bridge 入口。

桌面端会在构建前生成部署配置。未设置环境变量时，本地开发默认使用 `http://localhost:3000`，CI 打包测试默认使用不可误用的 `.invalid` 地址；正式发布前必须设置公开根地址：

```bash
SYNAPSE_DESKTOP_PUBLIC_APP_URL=https://synapse.d2.pub pnpm --filter @synapse/desktop run package:mac
```

## 本地打包

macOS 打包命令：

```bash
pnpm --filter @synapse/desktop run package:mac
```

该脚本通过 electron-builder 生成 macOS `dmg` 和 `zip`，目标架构为 `arm64`。

Windows 打包命令：

```bash
pnpm --filter @synapse/desktop run package:win
```

该脚本通过 electron-builder 生成 Windows `nsis` 安装包，目标架构为 `x64`。

打包产物输出到 `desktop/release/`。

## 版本号

版本号记录在 `desktop/package.json`。桌面端 README 提供 patch 版本号递增、提交并推送的脚本：

```bash
pnpm --filter @synapse/desktop run bump:commit:push
```

本机 macOS 发版命令会在递增版本号前检查 `SYNAPSE_DESKTOP_PUBLIC_APP_URL`。变量值是不带 `/api` 的公开根地址，可以写在仓库根目录 `.env.release.local`。

## 发布流程

`.github/workflows/release.yml` 在 `main` 分支 push 时运行。Workflow 使用 pnpm 10.22.0 和 Node.js 22，安装依赖后分别构建 renderer、Electron 进程和 database bundle。

发布 Workflow 在 macOS runner 执行 `package:mac`，在 Windows runner 执行 `package:win`，收集 `desktop/release/` 下的 `.dmg`、`.zip`、`.exe`、`.blockmap` 和 `latest*.yml`。

Release Workflow 的安装包构建 job 会设置 `SYNAPSE_DESKTOP_PUBLIC_APP_URL=https://synapse.d2.pub` 和 `SYNAPSE_DESKTOP_REQUIRE_PUBLIC_APP_URL=1`，正式包不会使用 CI `.invalid` 兜底地址。

随后 Workflow 读取 `desktop/package.json` 的版本号，使用 `v<version>` 作为 tag，在 `FairyEver/SynapseAppRelease` 创建或更新 GitHub Release，并上传打包产物。
