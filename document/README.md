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

本地文档中的 Console、开放 API 和 OpenAPI 契约地址指向 <http://localhost:3000>。如需连接其它本地应用地址，设置 `SYNAPSE_DOCUMENT_APP_PUBLIC_URL` 后再启动文档站。

## 目录结构

```text
document/
├── .vitepress/
│   ├── config.mts
│   └── theme/
├── connectors/
├── open-api/
└── index.md
```
