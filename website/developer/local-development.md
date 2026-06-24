# 本地开发

<!-- Sources: package.json; desktop/package.json; website/package.json; pnpm-workspace.yaml; AGENTS.md -->

## 环境要求

- Node.js 20+
- pnpm 10.22.0
- Git
- Docker / Docker Compose（运行 server 时需要）

## 安装依赖

在仓库根目录安装 workspace 依赖：

```bash
pnpm install
```

## 启动与停止

根目录提供按范围启动的脚本：

| 命令 | 范围 |
| --- | --- |
| `pnpm dev` | desktop 和 server |
| `pnpm dev:desktop` | 桌面端 |
| `pnpm dev:server` | server API、dashboard 和 compose 服务 |
| `pnpm dev:website` | 文档站 |
| `pnpm quit` | 停止全部开发进程 |
| `pnpm quit:desktop` | 停止桌面端 |
| `pnpm quit:server` | 停止 server 和 compose 服务 |
| `pnpm quit:website` | 停止文档站 |

只修改网站时，不需要启动桌面端或 server。

## 常用检查

桌面端类型检查：

```bash
pnpm --filter @synapse/desktop run typecheck
```

桌面端测试：

```bash
pnpm --filter @synapse/desktop run test
```

网站构建：

```bash
pnpm --filter @synapse/website run build
```
