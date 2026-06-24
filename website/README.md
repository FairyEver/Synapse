# @synapse/website

Synapse 桌面端开发者文档，基于 [VitePress](https://vitepress.dev) 构建，记录桌面公开能力、MCP 域、系统 App、内容仓库和本地开发流程。

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
├── guide/                # 内容、编辑器和设置文档
│   ├── concepts.md
│   ├── rules.md
│   ├── skills.md
│   ├── editors.md
│   └── settings.md
├── advanced/             # 桌面公开能力页面
├── developer/            # 本地开发、项目结构和能力维护
├── reference/            # FAQ、排障、术语和 MCP 能力
└── index.md              # 首页
```

## 内容定位

站点面向开发者和技术团队。正文优先说明当前桌面端已经公开的能力、边界、入口和维护规则，不写营销文案，不描述未实现功能。
