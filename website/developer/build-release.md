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

构建先生成 definitions registry，再执行 renderer、Electron 和 database 构建。`build:renderer` 使用 Vite 构建 renderer。`build:electron` 生成 IPC 代码并编译 Electron TypeScript。`build:database` 使用 esbuild 打包 database 的 CLI 和 MCP 入口。

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

## 发布流程

`.github/workflows/release.yml` 在 `main` 分支 push 时运行。Workflow 使用 pnpm 10.22.0 和 Node.js 22，安装依赖后分别构建 renderer、Electron 进程和 database bundle。

发布 Workflow 在 macOS runner 执行 `package:mac`，在 Windows runner 执行 `package:win`，收集 `desktop/release/` 下的 `.dmg`、`.zip`、`.exe`、`.blockmap` 和 `latest*.yml`。

随后 Workflow 读取 `desktop/package.json` 的版本号，使用 `v<version>` 作为 tag，在 `FairyEver/SynapseAppRelease` 创建或更新 GitHub Release，并上传打包产物。
