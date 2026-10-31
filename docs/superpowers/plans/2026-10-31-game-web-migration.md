# 游戏中心 Web 迁移实施计划

> **For agentic workers:** Use superpowers:executing-plans inline. 用户已批准本计划并要求立即实施，不重复请求确认。

**Goal:** 完整迁移当前游戏 UI 至独立 Web 页面，保留本机 MCP，验证后部署。
**Architecture:** dashboard 独立 HTML 入口与浏览器账号/HTTP 适配；shared 提供浏览器和 Node 双入口契约；desktop 只保留后台与兼容深链。
**Tech Stack:** React 19 / Vite 8 / TypeScript 6 / Radix / NestJS / Zod。
**Spec:** `docs/superpowers/specs/2026-10-31-game-web-migration-design.md`

## Global Constraints

main 当前目录，不创建分支/worktree，不 push，不改业务资金/控制协议，不新增数据库迁移。游戏发布内容静默。现有 UI 改动先单独提交。Web 上线不等于旧桌面客户端已更新。

## Review Focus

- Cookie 跨标签换账号不允许旧页面以新账号读取私密信息或提交动作。
- 独立 HTML 与静态资源在开发/生产深路径刷新均正确，不进入 Console Layout。
- 不因删除 UI IPC 删除本机公开 MCP/API 能力。
- 未知写入、手动接管与断线恢复维持原幂等/epoch 语义。
- Docker 与 Electron 包均不通过错误的跨包源码或 ESM/CJS 路径偶然工作。

## Tasks

- [x] 1. 验证当前游戏 UI（155 项及 desktop typecheck/hard constraints），提交独立基线，保留无关改动。
- [x] 2. 先新增 Cookie 游戏认证与来源回归测试；迁移共享契约（`shared/src/game-ui.ts`、schema 和双入口构建），实现服务端 guard、invoke 白名单、HTTPS 提醒，验证 server 测试。
- [x] 3. 先新增 Web 路由/请求边界测试；移动 `desktop/src/modules/game-hall` 至 `dashboard/src/game-center`，实现浏览器账号、存储、请求、页面壳与 URL 导航，保留既有 UI 回归。
- [x] 4. 增加 game.html、Vite/nginx 深路径处理和 Console 新标签页入口；扩展安全登录回跳，验证 Web 构建与路由测试。
- [x] 5. 移除桌面 UI 注册/IPC/preload，保留服务/MCP与旧深链受控浏览器打开；更新相关测试、能力清单、规则、Skill/指南并清除待发布说明的游戏内容。
- [x] 6. 执行类型/测试/打包检查，bsk 真实浏览器验收（隔离库写入），独立审查及必要修正，提交迁移。
- [ ] 7. 核对部署同步范围与待迁移项，运行既有 deploy.sh，部署后 HTTP/只读浏览器冒烟，记录产物与回滚点。
