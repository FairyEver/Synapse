---
name: ios-release
description: SynapseMobile 的 iOS 发版与装机。打包上传 TestFlight、查构建处理状态与内部群组挂载、设备安装、APNs 网关切换与推送验证。Use when 发 TestFlight、发版、打 iOS 包、mobile:release、构建传到哪了、装机、推送收不到、testflight release。
---

# iOS Release — 发版与装机

## 目标

把 SynapseMobile 从「改完代码」送到「手机上能跑、推送能到」这条路上容易踩的坑固化下来。这里的知识有一半不在代码里，而在几个**只存在于脑子里的前提**上——最典型的是：`APNS_USE_SANDBOX` 该设 `true` 还是 `false`，完全取决于「我手机上现在装的是哪个包」。设反了不会有任何报错。

**功能块相互独立，按用户当次命令执行，不自动串成流水线。** 「发个 TestFlight」不意味着要顺手重启生产。

## 前置条件

- 凭证文件 `SynapseMobile/.env.asc`（gitignored）。没有就从 `SynapseMobile/env.asc.example` 复制。**这个仓库是公开的，真实值永远不要提交。**
- 自检：`node SynapseMobile/scripts/asc.mjs app` 应列出 `Synapse Remote (com.liy.SynapseMobile)`。
- 想装机则需要真机连着：`xcrun devicectl list devices`。

## 功能块

| 想做什么 | 怎么做 | 性质 |
|---|---|---|
| 凭证自检 | `node SynapseMobile/scripts/asc.mjs app` | 只读 |
| 看构建状态 | `node SynapseMobile/scripts/asc.mjs builds` | 只读 |
| 看已用构建号 | `node SynapseMobile/scripts/asc.mjs next-build` | 只读 |
| 打包 + 上传 | `pnpm mobile:release` | 对外 |
| 只出 ipa | `pnpm mobile:build` | 本地 |
| 装开发包 | `xcrun devicectl device install app --device <id> <app>` | 本地写 |
| 装 TestFlight 包 | 手机上手动点 | 人工 |
| 切推送网关 | 改 `server/.env.server` 后 `./deploy.sh` | 生产 |

`asc.mjs` **只读**是刻意的：写操作各自有完整的脚本（`release-ios.sh` / `deploy.sh`），可以整体审阅，其中一个还会重启生产；这个脚本只是让 agent 能**看见** App Store Connect 的状态，而不是等失败之后从报错里反推。

## 两条装机路径，要求正好相反

| 包怎么装的 | APNs 网关 | `APNS_USE_SANDBOX` |
|---|---|---|
| 数据线装（Xcode / devicectl） | sandbox | `true` |
| TestFlight / App Store | 生产 | `false` |

device token 分环境，一个开关只能伺候一边。**设反的后果不是报错，是静默失败**：苹果回 `BadDeviceToken`，服务端把它当死号**永久删除且不重试**（`server/src/mobile-live/mobile-push.service.ts:93-95`），日志里只有一句 `Mobile push token rejected`，不会提示「你网关配错了」。修好配置后，**手机还得重开一次 App 才会重新注册 token**。

另外两条路径不能混：`devicectl` **装不了 TestFlight 的包**（App Store 签名，不是开发签名），那个只能在手机上点。

## 构建号

`release-ios.sh` 用 `SynapseMobile/build/last-build-number` 本地计数，每次归档前先认领（所以中途失败也不会把同一个号留给下一次），撞号时从苹果报错里读出已用号自动重试。`asc.mjs next-build` 是**独立于本地计数器的第二意见**——两边不一致时以 App Store Connect 上的最大值为准。

## 安全边界

- 只读块随时可跑；写块（上传、装机、部署）只按用户当次明确命令执行，**不要因为「发版流程通常是这几步」就自行串联**。
- 切网关要跑 `deploy.sh`，它会**重启生产容器、跑数据库迁移，且回滚不回滚数据库**。执行前先说清楚将改哪一行、会跑什么命令。
- 凭证、`.p8` 内容、原始 API 报错，不要贴进提交、issue、PR 或聊天记录。

## 故障排查

**`The bundle version must be higher than the previously uploaded version`**
撞号。`release-ios.sh` 已内置自愈（读报错里的数字 +1 重打），正常会自己过去。如果反复出现，跑 `asc.mjs next-build` 看苹果那边到底到几号了。

**推送收不到（最常见，且没有任何报错）**
1. 先确认手机装的是哪种包 → 决定网关该是哪个值（见上表）。
2. 查服务端当前值：`ssh root@120.53.17.64 "grep '^APNS_USE_SANDBOX' /www/wwwroot/synapse/server/.env"`。
3. 不匹配就改 `server/.env.server` 再 `./deploy.sh`。
4. 改完**让手机重开一次 App**——旧 token 已经被服务端删掉了，不会自己回来。

**TestFlight 里显示「无可用构建版本」**
跑 `asc.mjs builds`，确认构建是 `VALID` 且 `群组=[wdbc]`。两边都对还不行，多半是测试员本人没在设备上登录过 TestFlight。

**`No profiles for 'com.liy.SynapseMobile' were found`**
签名问题，不是配置问题。见 `SynapseMobile/scripts/release-ios.sh` 里 `-allowProvisioningUpdates` 那段注释。

**构建传上去了但 TestFlight 里找不到**
ASC 要处理 10–30 分钟。`asc.mjs builds` 看 `processingState`，`PROCESSING` 就是还没好，等着。

## 边界

本 skill **只管**：打包上传、构建状态、群组挂载、设备安装、APNs 网关、推送验证。

**不管**：元数据、截图、价格、IAP/订阅、提审上架、崩溃分诊。将来真要做上架，那时候再评估要不要引入现成工具（`rorkai/App-Store-Connect-CLI` ★7.3k 是当时看下来最靠谱的一支），不必现在提前装。

验证能力也有上限：公开 API 的测试员只有 `state`（`INSTALLED` 等），**查不到装的是哪个 build**——`installedCfBundleVersion` 只在网页版 `/iris/v1` 里有。所以「装没装成」最终还得靠真机实测一次推送。
