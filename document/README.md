# @synapse/document

Synapse 文档站，基于 VitePress 构建并随 Server Docker 镜像发布。

线上地址：<https://synapse.d2.pub/document/>

## 本地开发

在仓库根目录执行：

```bash
pnpm dev:document
pnpm --filter @synapse/document run build
pnpm --filter @synapse/document run preview
```

本地开发地址为 <http://localhost:19773/document/>。

## 目录结构

```text
document/
├── .vitepress/
│   └── config.mts
├── open-api/
└── index.md
```
