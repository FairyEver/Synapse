# Drive Simplified Access Model Design

Date: 2026-06-12
Scope: `desktop/`, `dashboard/`, `server/`, `shared/`, `docs/`

## 2026-06-16 Current Product Baseline

Drive public access has been simplified further:

- 分享 is the only public access model. It uses `/share/...`, not `/files/...`.
- HTML files default to rendered webpage view in both owner and share contexts when a `visitUrl` is available; users can still switch to source/code view and download.
- 网页发布 and 站点发布 are removed, including `/pages/*`, `/sites/*`, `DrivePublication*` tables, redeploy, cancel publication, and delete-impact flows.
- `公开链接` now manages share links only. It still supports copy link, copy password, open, and cancel share.
- Folder shares remain file-browser shares; they do not promise static-site hosting semantics for relative assets.

The original design text below is kept as historical context. When it conflicts with this baseline, this baseline is authoritative.

## Goal

简化 Synapse Drive 的主工作流，把“管理自己的文件”和“给别人访问或发布”从同一个拥挤列表中拆开。

主网盘只负责文件管理和打开内容；文件承接页统一负责自己查看和分享查看；分享与发布的公开链接管理合并到一个入口。Markdown 作为预览能力默认渲染，不进入发布语义。

## Problem

当前 Drive 主页面同时承载四类任务：

- 文件管理：上传、新建文件夹、重命名、移动、删除。
- 内容查看：打开文件夹、预览文件、下载、HTML owner-only 访问。
- 分享访问：生成分享链接、密码、有效期、复制、取消分享。
- 发布上线：HTML 发布网页、文件夹发布站点、重新发布、取消发布。

用户感知上的主要问题不是能力不足，而是主列表动作过重，且“自己看文件”和“给别人看文件”混在一起。`查看`、`预览`、`分享`、`发布` 的边界不够稳定，尤其在 Markdown 和 HTML 文件上更容易混淆。

## Product Decisions

- 主网盘页面只承担文件管理和打开内容。
- `查看` / `预览` 在主网盘中统一收敛为 `打开`。
- 用户自己看文件不需要先创建分享。
- 文件承接页统一处理自己查看和分享查看，只通过访问上下文区分能力。
- Markdown 文件在自己查看和分享查看时都默认渲染，提供 `源码` 和 `下载`。
- HTML 文件在文件承接页默认显示源码；只有 owner 访问上下文展示 `访问`。
- 分享仍表示“给别人看文件或文件夹”，URL 使用 `/files/...`，进入文件承接页。
- 发布仍表示“把 HTML 文件或站点文件夹上线”，URL 使用 `/pages/...` 或 `/sites/...`，直出发布内容。
- `已分享` 和 `已发布` 合并为一个 `公开链接` 入口。
- `分享` 保留为主列表行内高频操作。
- `发布网页` / `发布站点` 放入 `更多`，因为它只对部分文件或文件夹成立。

## Non-Goals

- 不做完整网盘平台化能力，例如转存、协作空间、订阅、访问统计或下载统计。
- 不把 Markdown 自动发布成网页。
- 不把发布页改成文件浏览器。
- 不改变现有发布快照语义。
- 不新增自定义视觉体系、营销文案、渐变、任意色或卡片套卡片。
- 不在本设计中实现 Office、PDF、音视频的完整在线预览。

## Information Architecture

### Main Drive

主网盘是用户管理自己 Drive 文件的入口。

顶部操作：

- `上传文件`
- `上传文件夹`
- `新建文件夹`
- `公开链接`
- `刷新`

文件夹行：

- 主操作：`打开`
- 次操作：`更多`

文件行：

- 主操作：`打开`
- 高频公开操作：`分享`
- 次操作：`更多`

`更多` 菜单：

- `重命名`
- `移动`
- `删除`
- `发布网页`，仅 HTML 文件可用或展示
- `发布站点`，仅文件夹可用或展示，且需要根目录 `index.html`
- 当前项已有公开状态时，可提供对应的取消入口，但不应让主列表变成公开链接管理页

### File Browser Landing Page

文件承接页统一负责浏览、预览和下载。

Owner context：

- 路由：`/drive/items/...`
- 能力：浏览、预览、下载
- HTML 文件额外允许 `访问`
- Markdown 默认渲染

Share context：

- 路由：`/files/...`
- 能力：浏览、预览、下载
- 不允许 HTML owner-only `访问`
- Markdown 默认渲染
- 密码、有效期、启停状态必须由服务端校验

文件承接页不得出现分享、发布、重新发布、取消分享或取消发布等管理动作。

### Public Links

`公开链接` 是分享和发布的集中管理入口。

视图：

- `全部`
- `分享`
- `发布`

列表字段：

- 名称
- 类型
- 来源
- 密码
- 到期
- 状态
- 时间
- 操作

操作：

- 复制链接
- 复制密码
- 打开
- 重新发布，仅发布项可用
- 停用

分享和发布继续共用访问设置弹窗：

- `需要密码`
- `有效时长`

结果弹窗继续展示访问链接和密码。

## Preview Rules

PreviewRenderer 只负责文件类型展示，不承担分享、发布或文件管理动作。

默认行为：

- 图片：直接预览。
- Markdown：默认渲染，提供 `源码` 和 `下载`。
- HTML：默认源码预览；owner context 额外提供 `访问`。
- 文本：源码预览。
- 压缩包：不做内容预览，只提供下载。
- 未知类型：只提供下载。

Markdown 安全规则：

- 分享场景不得执行脚本。
- 不信任内联 HTML；第一版应禁用或转义 Markdown 中的 HTML。
- 相对资源必须经过当前访问上下文校验。
- 下载接口和资源读取接口必须复用同一访问校验，不能成为绕过分享密码或 owner 权限的入口。

## Concept Boundaries

### Open

`打开` 是用户查看自己文件或文件夹的入口。它不创建公开链接，不改变访问设置，不发布快照。

### Share

`分享` 是给别人访问文件或文件夹。分享 URL 进入文件承接页，保留文件浏览器壳、下载操作、密码和有效期控制。

### Publish

`发布` 是把 HTML 文件或含 `index.html` 的文件夹变成网页或站点。发布 URL 直出渲染结果，不进入文件浏览器。重新发布只更新内容快照，不应改变既有密码和有效期，除非用户显式重新设置访问保护。

## Architecture

### Access Context

文件承接页使用访问上下文驱动能力差异。

```ts
type DriveAccessContextKind = "ownerBrowser" | "sharedBrowser"

type DriveAccessCapabilities = {
  browse: true
  preview: true
  download: true
  htmlAccess: boolean
}
```

`ownerBrowser`：

- 校验登录用户和 item 所属者。
- 允许 `htmlAccess`。

`sharedBrowser`：

- 校验 shareId、启用状态、过期时间、密码或访问 cookie。
- 不允许 `htmlAccess`。

### Components

`DriveModule`：

- 负责主网盘管理状态、上传、当前目录和文件操作。
- 不实现文件内容预览。

`DriveFileBrowser`：

- 负责承接页的路径、目录列表、文件预览和下载。
- 不实现分享、发布、重命名、移动或删除。

`DrivePreviewRenderer`：

- 根据文件类型展示图片、Markdown、HTML 源码、文本或下载状态。
- 不读取管理元数据。

`DrivePublicLinksCenter`：

- 集中展示分享和发布。
- 负责复制、打开、重新发布和停用。

## Migration Strategy

第一阶段只做产品收敛和命名降噪：

- 主列表 `预览` 改为 `打开`。
- `已分享` 和 `已发布` 合并为 `公开链接`。
- 发布入口移入 `更多`。
- Markdown 在承接页默认渲染。
- 第一阶段若复用现有承接页实现，也必须保持文件承接页不承载分享或发布管理动作。

第二阶段再补齐 console / standalone / share 复用同一 FileBrowser 的结构化拆分，避免一次性重写过大。

## Testing

Renderer tests：

- 主网盘文件行显示 `打开`，不再显示 `预览`。
- 文件行保留 `分享`，发布入口在 `更多`。
- 顶部只显示 `公开链接`，不再并列显示 `已分享` 和 `已发布`。
- `公开链接` 可筛选分享和发布。
- Markdown owner preview 默认渲染，并可切换源码。
- Markdown share preview 默认渲染，并可切换源码。
- HTML share preview 不显示 owner-only `访问`。

Server and integration tests：

- Owner download、preview、Markdown resource access 都校验 owner。
- Share download、preview、Markdown resource access 都校验 share access。
- 分享过期、取消或密码错误时不返回 Markdown 内容或相对资源。
- 发布路由 `/pages/...` 和 `/sites/...` 不进入 FileBrowser。

## Acceptance Criteria

- 用户在主网盘能明确区分：打开是自己看，分享是给别人看，发布是上线网页或站点。
- 主列表的公开访问管理入口减少为一个 `公开链接`。
- Markdown 在自己查看和分享查看中都以渲染结果为默认视图。
- 文件承接页不出现分享或发布管理动作。
- 发布页仍保持直出渲染，不和文件承接页混用。
