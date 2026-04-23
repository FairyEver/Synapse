# Claude Code 项目指令

## 技术栈

- Electron + Vite + React 19 + TypeScript
- shadcn/ui + Tailwind CSS 4
- 包管理器：pnpm

## 编码风格

- 不写 `any`，宁可拆函数也不要断言
- 组件优先组合 shadcn 原语，不自造 div + class
- 错误处理：网络/文件 IO 必须 try/catch；内部纯函数不兜错
