# @synapse/website

Synapse 产品介绍站，基于 [VitePress](https://vitepress.dev) 构建，面向普通用户介绍 Synapse 能做什么、如何使用。

## 本地开发

推荐在仓库根目录执行：

```bash
pnpm install          # 安装工作区依赖
pnpm website:dev      # 启动文档开发服务器
pnpm website:build    # 构建静态站点到 website/.vitepress/dist/
pnpm website:preview  # 本地预览构建产物
```

也可以直接在 `website/` 下运行：

```bash
cd website
pnpm dev
pnpm build
pnpm preview
```

## 目录结构

```text
website/
├── .vitepress/
│   └── config.mts        # 站点配置（标题、导航、侧边栏等）
├── public/               # 静态资源（图片、favicon 等）
├── guide/                # 用户指南页面
│   ├── introduction.md
│   ├── concepts.md
│   ├── features.md
│   ├── download.md
│   └── faq.md
└── index.md              # 首页
```

## 内容定位

站点面向**普通用户**，介绍 Synapse 产品能力与使用方式。不包含开发者视角的实现细节（Electron、React、Git 工作流等）。开发文档见仓库根目录的 `desktop/README.md` 与 `document/`。
