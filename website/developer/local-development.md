# 本地开发

<!-- Sources: README.md; desktop/README.md; package.json; desktop/package.json; website/package.json -->

## 环境要求

- Node.js 20+
- pnpm 10.22.0
- Git

## 安装依赖

在仓库根目录安装整个 workspace 的依赖：

```bash
pnpm install
```

## 启动与停止

根目录提供本地开发环境入口：

```bash
pnpm dev
pnpm quit
```

`pnpm dev` 会启动文档站、桌面端、PostgreSQL、Prisma migration 和后端服务。`pnpm quit` 用于停止本地开发环境。

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
