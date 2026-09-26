# PC 页面挂载率检查工具

```bash
pnpm build
node tools/generate/pc-coverage.mjs
node tools/generate/pc-coverage.mjs --json
node tools/generate/pc-coverage.mjs --json --check
```

工具只读 Portal 源码和本 SDK 当前 `dist`，输出到 stdout，不改源码、Git 或 generated。源码路径默认固定检出，也可用 `PORTAL_REPO` 或 `--portal-repo PATH` 指定。使用前仍需按项目要求手工拉取固定前后端分支；工具不会偷偷更新检出。`--sdk-root PATH` 用于隔离构建/测试夹具，默认当前包根目录。

## 统计口径

标题固定为“人力 / 平台 / 门户 PC 页面挂载率”。分母来自真实 `menus/index.js` 在 test 环境的活跃叶子，分子是有至少一项已注册能力挂在该路径的叶子数。每个系统输出全部叶子、挂载页数、实际注册能力 ID、零能力页、真实 `catalog.describe()` 的明确 `ai.gaps` 及 AI 说明缺失项。

同一页面的多个能力不增加挂载页数。非菜单基础能力计入 `totalRegisteredCapabilities`，但不伪造菜单入口。iframe 使用其真实 permission 路径作为连接键，保留原始 frame URL；不会因 URL 中的 base64 环境地址改变而认作新业务页。

`functionalCoverage`、`actionInventory`、`browserVerification` 均保持 `unknown`。它们表示尚未证明按钮/详情/弹窗/导入导出/外壳动作穷尽，以及尚未完成浏览器与线上业务验收。无明确 AI gaps 也不能推导说明完整。

退出码：

| 退出码 | 含义 |
| --- | --- |
| 0 | 普通预览成功生成；不表示100%功能覆盖 |
| 1 | `--check` 发现零能力页、AI缺口/说明缺失，或功能/动作/浏览器验证未知 |
| 2 | 无法可靠求值、输入/构建缺失、重复能力或已注册能力无法描述等工具错误 |

即使每个菜单页都有一个无 gaps 能力，`--check` 也不会变绿，因为动作与真实验证仍是 unknown。目前没有接受人工开关把 unknown 改成 verified 的选项。

## 菜单求值方法

使用 Node 原生 `vm.SourceTextModule`，沿真实 ESM import 图求值 `menus/index.js`。没有手写菜单清单或逐行正则扫 `path`：注释、条件分支、展开运算符、命名 import 和 `PATH_TASK_MY` 等常量保留 JS 语义。实际 index 导入 `mall.v2.js` 时不会把旧 `mall.js` 另算一次。

Node 未启用 VM 模块时，自动启动同一 Node 带 `--experimental-vm-modules` 的短进程；这不是新增依赖、浏览器或开发服务器。单次模块执行有超时。测试环境 `DEV=false`，因此 DEV 工具箱排除；使用 `.env.build.test` 中真实 iframe 地址，缺失不会猜默认 host。

实际执行菜单公共辅助源文件（含 `menusAddID`、树克隆、系统常量与 iframe 链接生成）。外部库仅提供明确的无业务副作用适配：树克隆与基础 lodash 操作、base64、用于内部菜单 ID 的确定性 nanoid。cookie、权限 store、浏览器 URL 查询、qs.parse 若意外在求值阶段运行会直接抛错。未知 import、未知环境变量、路径缺失/越界及空系统分母均失败关闭。

系统范围按 `layout/index.vue` 当前的顶层 system 筛选规则计算。工具先核对该规则的源码形状；如果改为递归分组或改字段会报错，要求人工复核，不偷偷沿用旧解释。静态菜单没有按某个用户的权限进一步裁剪，不能当作该用户实时可见菜单。

输出记录源码版本（可读时）和实际读取文件的 SHA-256。内容哈希用于定位证据，未使用生成时间判断新鲜度。`sdkEntryHash` 只是构建入口文件指纹，不证明全部 dist 与 src 一致；正式使用必须先 `pnpm build`。

## 人力 139 与旧审计 140 的具体差异

在前端 `d3cf56bdc7` 上，真实选择器分组得到：人力 139、平台 177、门户 123 个叶子。

旧 `hr-pc-coverage-2026-09-22.md` 的 140 按 `hr.js` 的 `all_menus + setting_menus` 汇总，比“人力”选择器多了一页：

- “系统核算参数”：`/dashboard/setting/system-accounting-parameters/list`。
- 定义在 `app/portal/menus/hr.js:362-364` 的 `setting_menus`。
- `menus/index.js` 将它装入顶层无 system 的“系统设置”，因此在 `layout/index.vue:303-325` 的实际筛选下属于**门户**，已计入门户 123，不重复计入人力 139。

这个差异不是漏掉 `PATH_TASK_MY`：“我的流程” `/dashboard/flow/task/my/list` 已通过真实常量求值计入人力。已通知主代理修订旧报告口径，本工具任务没有越界修改他人审计文件。

本次首次运行读取当前 dist 时挂载页为人力 59/139、平台 17/177、门户 1/123。后续构建可改变挂载数，不能把这里的瞬时值写成固定门禁断言。

## 验证

`test/pc-coverage.test.ts` 使用独立临时小源码仓库验证 ESM 导入、常量、注释/DEV/旧文件排除、跨系统设置归属、iframe连接、明确AI缺口、零页、错误关闭、JSON与退出码。8 个用例通过，`pnpm typecheck` 通过。

实际改坏后分别跑红并恢复：错误启用 DEV、把其他页面能力挂到当前页、丢弃 iframe 权限连接键、仅因页面100%挂载就忽略 unknown 放行 check。恢复后 8 个用例再次通过。

没有浏览器验证、线上 API 冒烟或写入；工具和测试的通过不能成为业务功能完整的证据。
