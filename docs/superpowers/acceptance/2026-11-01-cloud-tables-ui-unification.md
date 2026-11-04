# 云端数据表 HeroUI 页面统一验收

日期：2026-11-01。仓库：`/Users/liyang/Documents/code/github/Synapse`，分支：`main`。

## 问题与修复范围

在线只读对照 `/console/tables` 和 `/console/settings`，确认原云表页直接渲染 section，未使用 Dashboard V2 共用 Header/Main：标题贴边、字号与留白不一致，窄屏缺少导航切换入口。表列表、字段、权限和日志采用临时行布局，只有记录列表使用共享表格；灰色页面背景上的筛选控件也固定用了适用于白色浮层的 secondary 变体。

本次仅修改云表页面与共用业务控件的展示组合：

- 使用 Header/Main，恢复统一标题、页面宽度、24px 横向留白及导航切换；长表名单行省略并保留完整 title。
- 表列表、字段、记录、回收站、权限矩阵、日志统一用现有 ServerDataTable。列菜单显示中文名称，记录排序使用共用列头；数字和耗时右对齐。
- 标签栏使用默认 HeroUI Tabs，文字不换行，窄屏在标签栏内部滚动。筛选改用响应式网格，原生 primary 变体用于页面背景，弹窗仍用 secondary。
- 游标翻页使用 HeroUI Pagination 的上一页/下一页，不新增 COUNT、不生成虚构总数。API 接入使用标准 Card 和 Link.Icon。
- 沿用原字段、记录、权限及回收站业务服务，没有新增依赖或改动服务端接口。

## 验证

- `pnpm --filter @synapse/dashboard-v2 check:ui`：通过。
- `pnpm --filter @synapse/dashboard-v2 test src/features/cloud-tables/cloud-table-forms.test.ts src/components/data-table/server-data-table.test.ts`：23项通过；随后完整V2单测 `pnpm --filter @synapse/dashboard-v2 test`：144个文件、1,153项通过。
- `pnpm --filter @synapse/dashboard-v2 test:browser src/features/cloud-tables/cloud-tables.browser.tsx src/components/data-table/server-data-table.browser.tsx`：25项通过。
- Chromium 实际渲染覆盖320px、390px及1280px：统一页面几何、导航抽屉、120字符无空格表名、标签单行与滚动、筛选输入与展开的选择菜单、列菜单、排序请求、所有管理页签、必填校验、禁用标识、焦点及弹窗正文/底部操作区间距。保留原有记录写入、字段标识、权限保存、恢复、账号切换和幂等重试回归。
- `pnpm --filter @synapse/dashboard-v2 exec vite build`：前端生产资源打包通过。此命令不替代完整 build 的类型检查。
- 完整 Dashboard V2 `tsc` / `build` 未通过：当前另一个任务的 API 契约存在类型错误。完整build首次执行时，另一任务正在创建的协作者搜索组件还曾短暂出现泛型错误，后续typecheck已不再报告该错误。没有通过排除文件或放宽类型规则掩盖阻塞，也没有修改其他任务源码。
- `git diff --check`：通过。

## 证据与交付边界

测试日志位于本地 `/Users/liyang/Documents/code/github/Synapse/.superpowers/cloud-tables/ui-unification/`；无在线报告链接。线上改动前截图为该目录 `before.png`，对照页面为 `reference.png`。

实际查看的隔离夹具截图包括：

- [桌面列表](/tmp/synapse-cloud-tables-list-1280.png)
- [320px列表](/tmp/synapse-cloud-tables-list-320.png)
- [桌面记录及筛选](/tmp/synapse-cloud-tables-records-1280.png)
- [320px记录页](/tmp/synapse-cloud-tables-records-320.png)
- [390px字段页](/tmp/synapse-cloud-tables-字段-390.png)
- [桌面权限矩阵](/tmp/synapse-cloud-tables-权限-1280.png)
- [390px日志空态](/tmp/synapse-cloud-tables-操作记录-390.png)
- [390px API接入](/tmp/synapse-cloud-tables-api-390.png)
- [390px展开字段类型菜单](/tmp/synapse-cloud-tables-field-menu-390.png)
- [390px权限弹窗](/tmp/synapse-cloud-tables-permissions-modal-390.png)
- [320px必填与禁用字段](/tmp/synapse-cloud-tables-field-states-320.png)
- [390px展开列菜单](/tmp/synapse-cloud-tables-columns-menu-390.png)

浏览器交互测试仅操作隔离的模拟接口，没有向生产表写入记录。在线页面只读对照使用 bsk，会话均已停止。未启动常驻开发服务。本次不部署、不推送，不覆盖其他任务正在开发的协作者搜索和其他模块代码。

回滚点：回退本任务提交中的云表页面、控件、浏览器回归及对应说明即可；无数据库迁移。
