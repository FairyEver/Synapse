# @synapse/website

Synapse 产品介绍站，基于 [VitePress](https://vitepress.dev) 构建，面向普通用户介绍 Synapse 的功能范围与使用方式。

线上地址：<https://usesynapse.netlify.app>（由 Netlify 自动部署，构建配置见仓库根目录的 `netlify.toml`）。

## 本地开发

推荐在仓库根目录执行：

```bash
pnpm install                                 # 安装工作区依赖
pnpm --filter @synapse/website run dev      # 启动文档开发服务器
pnpm --filter @synapse/website run build    # 构建静态站点到 website/.vitepress/dist/
pnpm --filter @synapse/website run preview  # 本地预览构建产物
```

也可在 `website/` 目录下运行：

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

站点面向**普通用户**，介绍 Synapse 产品能力与使用方式。用户页面不包含开发者视角的实现细节（Electron、React、Git 工作流等）。开发文档参见仓库根目录的 `desktop/README.md` 与 `docs/`。
