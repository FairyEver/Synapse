# Synapse Content Store 设计文档

日期: 2026-06-09

主题: 新增在线版 Skill / Rule / Prompt 内容商店

## 背景

Synapse 目前的 Skill、Rule、Prompt 主要由用户在本地内容仓库中维护。这个模式保留了本地可控性，但对普通用户并不友好: 需要维护仓库、处理同步和冲突、理解本地文件结构，也不适合高频发布和社区分发。

新的 Content Store 是一套在线集中内容发布库。它像软件商店一样在 Dashboard 中提供 Skill、Rule、Prompt 三个内容入口，用户可以浏览公开内容、安装 Skill / Rule、复制 Prompt 文本，也可以管理自己的草稿、私有内容和公开内容。

旧本地仓库功能保留不动。第一版只新增云端内容来源和云端发布链路，不移除已有本地能力。

## 目标

- 在 Dashboard 中新增在线内容商店和我的内容两个入口。
- 支持 Skill、Rule、Prompt 三类内容的云端创建、草稿保存、发布版本、公开、取消公开和复制到我的内容。
- Skill / Rule 从 Dashboard 点击安装后，通过私有协议唤醒本机 Synapse Desktop，并在独立安装窗口中复用现有安装流程。
- Prompt 不安装，只提供文本复制。
- 支持管理员在 Dashboard 后台对公开内容设置精选、取消精选、下架和恢复。
- 使用 PostgreSQL 保存业务数据、版本快照、草稿元数据和审计记录。
- 使用独立 Content Store 对象存储桶保存草稿文件和发布后的不可变安装 package。
- 保留每个发布版本，但第一版不在 UI 展示历史版本。
- 不依赖 Git 作为云端内容存储或协作模型。

## 非目标

- 不移除或替换旧本地内容仓库。
- 不在 Desktop 主窗口新增商店浏览页。
- 不做 GitHub 式 fork、同步、merge、PR。
- 不做 star、评论、评分、作者主页、认证作者或内容认证。
- 不做分类、标签、图标、summary、release notes。
- 不做未登录公开浏览。商店放在现有 Dashboard 登录态下。
- 不做 Prompt 安装。
- 不做自动更新提示。
- 不做版本列表、旧版本安装、版本 diff 或回滚 UI。
- 不做举报处理入口。
- 不做管理员代替作者发布或编辑正文。
- 不做 Skill 在线终端、运行环境、压缩包导入或完整 Web IDE。
- 不做 COS 预签名直传。第一版上传走后端 API。

## 总体产品形态

Dashboard 有两个入口:

- 内容商店: 浏览公开内容、精选内容、详情、Skill / Rule 安装、Prompt 复制文本、复制到我的内容。
- 我的内容: 管理当前用户的草稿、私有、公开、已下架内容，支持编辑、保存草稿、发布、公开、取消公开和删除未公开内容。

Desktop 第一版只负责安装:

- 接收私有协议唤醒。
- 打开独立安装窗口。
- 拉取安装会话。
- 下载并校验 Skill / Rule package。
- 复用现有 Skill / Rule 安装流程。

## 内容类型

三类内容统一生命周期，但能力不同:

| 类型 | 编辑方式 | 安装能力 | 复制能力 |
| --- | --- | --- | --- |
| Skill | 文件树 + Monaco 编辑器 | 支持安装 | 支持复制到我的内容 |
| Rule | 普通多行文本框 | 支持安装 | 支持复制到我的内容 |
| Prompt | 普通多行文本框 | 不支持安装 | 支持复制文本和复制到我的内容 |

Skill 必须包含 `SKILL.md`:

- 网页端新建 Skill 时自动创建 `SKILL.md`。
- `SKILL.md` 是必需入口文件。
- 发布前必须存在且内容非空。
- 不允许删除最后一个 `SKILL.md`。
- 客户端上传本地 Skill 草稿时也必须校验 `SKILL.md` 存在。

Rule 安装 package 的主文件固定为 `content/RULE.md`。

## 内容元信息

第一版只保留必要元信息:

- `title`: 标题，必填。
- `description`: 说明。草稿和私有内容可为空，公开前必填。
- `type`: `skill`、`rule` 或 `prompt`。
- `ownerUserId`: 作者。
- `visibility`: `private` 或 `public`。
- `moderationStatus`: `normal` 或 `removed`。
- `featured`: 是否精选，资源级。
- `createdAt`、`updatedAt`。

不要 `summary`、分类、标签、图标或 release notes。

云端 Content Store 数据模型不存内容级 icon。展示层根据内容类型在代码中选择图标或视觉标识。若 Desktop 旧安装流程内部需要 icon 字段，客户端适配层可以临时填内部默认值，但它不是云端产品字段，也不暴露给用户。

URL 不做 slug，只使用资源 id。标题可以随时修改，不影响 URL。

作者展示使用用户 `displayName`，没有时使用现有账号展示兜底。不做作者主页，不展示邮箱。

## 生命周期

### 草稿

- 每个资源只保留一个当前草稿。
- 草稿可以手动保存，但不保留编辑历史。
- 草稿保存使用 `revision` 乐观锁。
- 多标签页或客户端上传导致 revision 不一致时，保存失败并提示刷新。
- 不做自动合并。
- 不做自动保存。
- 离开编辑页时如果有未保存变更，需要提示确认。

新建内容先进入草稿。已发布内容点击编辑时，从最新版生成或继续使用当前草稿。

### 发布版本

- 三类内容都有发布版本。
- 用户不能填写版本号。
- 系统自动生成 `v1`、`v2`、`v3`。
- 发布版本不可变。
- 发布时先保存当前草稿，再生成新版本。
- 发布成功后清空草稿。
- 发布后默认仍是私有，不自动公开。
- 不需要发布说明。

Prompt 有版本快照，但不生成安装 package。

### 公开

- 发布和公开是两个独立动作。
- 新建和发布后的内容默认私有。
- 用户手动公开后进入内容商店。
- 公开前必须有 `description`。
- 公开是资源级状态，不是版本级状态。
- 作者发布新版本后，公开状态保持不变。
- 作者可以取消公开。
- 公开内容不能硬删除，只能取消公开。
- 私有内容和未公开内容可以由作者删除。

### 下架

- 第一版只做内容级下架。
- 管理员可以下架整个内容。
- 下架后不进商店列表。
- 下架后不允许新安装。
- 下架后不允许复制到我的内容。
- 已安装用户本地不受影响。
- 作者仍能在我的内容中看到。
- 作者可继续编辑和发布新版本，但不能自行恢复公开。
- 管理员可以恢复。
- 版本级下架可在数据结构中预留，但第一版 UI 不做。

### 精选

- 精选是资源级。
- 管理员可以设置或取消精选。
- 精选不绑定具体版本。
- 商店展示该资源最新可用版本。
- 内容取消公开或被下架后，不出现在精选列表。
- 重新公开或恢复后，如果精选状态仍在，可以重新出现在精选列表。

## 复制到我的内容

第一版不叫 fork，不做 GitHub 式 fork 语义。

- 操作名为复制到我的内容。
- Skill、Rule、Prompt 都支持。
- 复制的是某个具体发布版本，默认最新版。
- 复制后生成当前用户名下的新私有资源。
- 标题保持原样，不追加副本，不弹命名框。
- 复制后不公开、不继承精选、不继承安装量。
- 记录 `copiedFromContentId` 和 `copiedFromVersionId`，仅用于溯源。
- 原作者后续更新不影响复制内容。

Prompt 额外提供复制文本。

## 搜索和排序

第一版搜索范围:

- 标题。
- 作者显示名。
- `description`。
- Skill 的 `SKILL.md` 内容。
- Rule / Prompt 正文。

Skill 其它附件不参与全文搜索。二进制不参与搜索。

第一版排序可用:

- 精选优先。
- 最近更新。
- 安装量。

不做分类或标签筛选。

## 安装链路

Skill / Rule 都通过 Dashboard 唤醒 Desktop 安装。Prompt 不安装。

流程:

1. 用户在 Dashboard 内容详情点击安装。
2. Dashboard 调后端创建短期 `installSessionId`。
3. Dashboard 打开私有协议 `synapse://content-install?session=...`。
4. Dashboard 显示正在打开 Synapse 的 fallback 页面。
5. Desktop 被唤醒后打开独立安装窗口。
6. 安装窗口初始显示 loading。
7. Desktop 使用登录态向后端拉取安装会话。
8. 后端校验 session、用户、权限、内容状态和版本状态。
9. Desktop 下载 package 到本地临时目录。
10. Desktop 校验 package hash、manifest schema、文件 hash 和路径安全。
11. 校验通过后映射成现有安装流程需要的结构。
12. 进入现有 Skill / Rule 安装流程，第一步仍然是选择编辑器，后续行为完全复刻现有流程。

安装会话规则:

- 绑定发起用户。
- Desktop 当前登录用户必须和 Dashboard 发起用户一致。
- session 短 TTL。
- session 不携带内容明文。
- session 可一次性消费，或短时间重复拉取，但安装统计去重。
- 公开内容和作者自己的私有已发布内容都可创建安装 session。
- 草稿不能安装。
- 下架内容不能安装。

登录状态处理:

- 安装窗口不负责登录。
- 未登录时提示先登录客户端并提供重试。
- 账号不一致时提示切换到发起安装的账号并提供重试。
- 不内嵌网页登录。
- 不自动切账号。

窗口规则:

- 安装窗口是独立窗口。
- 同一个 `installSessionId` 已有窗口时聚焦旧窗口。
- 不同 session 可以同时打开不同安装窗口。
- 主窗口不参与安装 UI。
- 安装完成后显示完成状态，用户手动关闭窗口。

Dashboard fallback:

- 点击安装后显示正在打开 Synapse。
- 几秒后显示 fallback。
- 提供复制打开链接、下载 Synapse 客户端入口、返回内容详情。
- 不在网页端下载 package。
- 不在网页端选择编辑器。

## Package 格式

Skill / Rule 使用统一 zip package + manifest。Prompt 不生成安装 package。

Skill package:

```text
manifest.json
content/SKILL.md
content/...
```

Rule package:

```text
manifest.json
content/RULE.md
```

manifest 至少包含:

- package schema version。
- `contentId`。
- `versionId`。
- `type`。
- `title`。
- `mainFile`。
- 文件清单。
- 每个文件的路径、大小、sha256、kind。
- package hash 或外部版本记录中的 package hash。

客户端校验:

- session 指向的 content、version、type 和 manifest 一致。
- zip hash 一致。
- 文件 hash 一致。
- 路径安全。
- 解压到临时目录后再进入现有安装流程。

服务端在发布 Skill / Rule 版本时生成 package:

- 发布版本时生成，不在安装时临时生成。
- package 不可变。
- package hash 写入版本记录。
- 如果 package 生成失败，发布失败，草稿保留。
- DB 成功但 package 失败不能产生可安装版本。

展示和搜索以数据库版本快照为准。安装以 package 为准。发布时从同一份草稿生成 DB 快照和 package，并保证一致。若后续发现 DB 与 package 不一致，该版本应标记为不可安装。

## Skill 编辑器

Dashboard Skill 编辑器使用 Monaco + 文件树。允许新增 Monaco 相关依赖，但不引入完整 IDE 框架。

能力:

- 左侧文件树，右侧 Monaco 编辑器。
- 新建 Skill 自动创建 `SKILL.md`。
- 支持新建文件、编辑文本文件、删除文件、上传文件、替换文件。
- 支持任意文件类型，包括二进制。
- 文本文件可编辑。
- 二进制文件只显示文件名和大小，不预览、不编辑。
- 保存草稿时整包提交当前文件树。
- 服务端用新的文件集合覆盖草稿，草稿 revision 增加。
- 旧草稿文件进入后台清理。

不支持:

- 终端。
- 运行环境。
- 压缩包导入。
- 图标编辑。
- 自动保存。
- 单文件保存。
- 增量 patch。

复杂 Skill 的推荐路径是从 Desktop 本地扫描/上传为草稿，再到 Dashboard 编辑和发布。

文本/二进制判断:

- UTF-8 可解码且没有明显二进制控制字符，视为文本。
- 常见文本扩展优先按文本处理。
- 明显二进制扩展按二进制处理。
- 判断失败按二进制。
- 不因脚本扩展而禁止，`.sh` 等可以作为文本编辑。
- 服务端保存文件时记录 `kind: text | binary`、`mimeType?`、`size`、`sha256`。

## Rule / Prompt 编辑器

Rule 和 Prompt 使用普通多行文本框。

- 不用 Monaco。
- 不做语法高亮。
- 生命周期与 Skill 一致。
- Rule 详情提供安装。
- Prompt 详情提供复制文本。

## Desktop 上传 Skill 草稿

第一版只有 Skill 支持从 Desktop 上传为云端草稿。Rule 和 Prompt 只在 Dashboard 创建和编辑。

流程:

1. 用户在 Desktop 本地 Skill 扫描或相关入口点击发布到商店。
2. Desktop 读取本地 Skill 文件夹。
3. Desktop 校验 `SKILL.md` 存在、路径合法、数量和大小限制。
4. Desktop 通过后端 API 上传文件集合。
5. 后端为当前用户生成或覆盖同来源未发布 Skill 草稿。
6. 上传成功后 Desktop 提示草稿已保存。
7. 用户确认后打开 Dashboard 草稿编辑页。
8. 用户在 Dashboard 补充标题、description、保存、发布和公开。

同来源草稿覆盖:

- Desktop 为本地 Skill 生成 `localSourceFingerprint`。
- 如果当前用户已有同 fingerprint 的未发布 Skill 草稿，直接覆盖。
- 如果没有，创建新草稿。
- 已发布内容不自动覆盖。

上传走后端 API，不做 COS 预签名直传。客户端可以内部打传输包发给后端，但这不是用户可见的压缩包导入能力。

## 对象存储

Content Store 使用独立对象存储桶，不复用 Drive bucket。

后续实现需要在 `server/.env` 和 `server/.env.example` 增加独立配置组。示例文件必须按项目规则添加中文注释，且不得包含真实 secret。

建议变量:

```text
CONTENT_STORE_COS_SECRET_ID
CONTENT_STORE_COS_SECRET_KEY
CONTENT_STORE_COS_BUCKET
CONTENT_STORE_COS_REGION
```

建议抽象:

- `ContentStoreStoragePort`。
- 本地开发走 local storage。
- 生产走 COS。
- 参考现有 Drive storage 模式，但不复用 Drive 配置。

草稿附件也进入 Content Store 对象存储:

- 草稿和正式 package 分前缀管理。
- 草稿删除、发布成功后，旧草稿文件进入后台清理。
- 第一版不强制做 blob 去重。

建议前缀:

```text
content-store/drafts/<userId>/<draftId>/...
content-store/packages/<contentId>/<versionId>.zip
```

## 配额和容器安全

Skill 文件类型不限制，但容器边界必须限制:

- 路径必须是相对路径。
- 禁止 `..` 和绝对路径。
- 不跟随软链接。
- package 解压必须防 zip-slip。
- 服务端不执行、不解析、不运行上传文件。
- 客户端安装只写入目标目录，不自动执行文件。

大小限制:

- Skill 草稿和发布包总大小: 50MB。
- Skill 单文件大小: 20MB。
- Skill 文件数量: 200。
- Rule / Prompt 正文: 1MB。
- 发布 package 不得超过 50MB。

## 安装量

第一版记录安装量，但不做更新提示。

- 只在安装成功后记录。
- 按 `contentId + versionId + userId + clientInstanceId` 去重。
- 同一个用户同一设备重复安装同一版本不重复增加安装量。
- 安装新版本可以计一次新版本安装。
- 资源总安装量可以聚合所有版本。
- 私有内容安装记录只用于作者或用户自己，不进入公开热度排序。
- 第一版列表可以不显眼展示安装量，但排序可使用。

## 管理员后台

管理员后台第一版只做治理，不做创作。

能力:

- 内容列表。
- 内容详情查看。
- 设置和取消精选。
- 下架和恢复。
- 查看审计日志。

不做:

- 编辑正文。
- 改作者。
- 代替作者发布。
- 版本管理。
- 认证作者。
- 举报处理。

管理员不发布内容。所有内容必须属于普通用户账号。管理员操作只写入 audit log。

## 数据模型草案

建议核心表:

- `content_store_items`: 资源壳，记录类型、标题、description、owner、visibility、moderationStatus、featured、时间字段。
- `content_store_drafts`: 当前草稿，记录 item、owner、baseVersion、revision、草稿正文或文件集合引用。
- `content_store_versions`: 发布版本，记录自动版本序号、版本快照、package key、package hash、发布时间。
- `content_store_files`: Skill 版本或草稿的文件清单，记录路径、大小、sha256、kind、对象存储 key。
- `content_store_copies`: 复制来源，记录 copiedFrom item/version。
- `content_store_install_sessions`: 安装会话，记录 user、content、version、type、过期时间、状态。
- `content_store_install_events`: 安装成功事件，用于安装量去重和统计。
- `content_store_admin_audit_logs`: 管理员精选、下架、恢复等审计记录，或复用现有 AuditLog。

Prompt 和 Rule 的正文可以直接存在草稿和版本快照中。Skill 文件正文和二进制通过文件清单及对象存储引用管理，`SKILL.md` 内容需要额外进入搜索索引。

## 边界条件

安装:

- 客户端未安装时 Dashboard fallback 提示下载。
- 客户端未登录或账号不一致时安装窗口阻断。
- session 过期时安装窗口停止并提示。
- 内容取消公开、下架或权限不满足时后端拒绝拉取安装会话。
- package 下载失败或 hash 不一致时停止安装并清理临时目录。
- 用户取消安装时清理临时目录。

编辑:

- 草稿 revision 冲突时拒绝保存。
- 发布 package 失败时不创建可安装版本。
- 公开前 description 必填。
- 下架内容作者可编辑和发布，但不能恢复公开。

上传:

- 超过总大小、单文件大小或文件数量限制时拒绝。
- 非法路径、绝对路径、`..`、软链接拒绝。
- 服务端不执行上传内容。

## 验收标准

- Dashboard 有内容商店和我的内容两个入口。
- 三类内容可创建草稿、保存、发布版本。
- 发布后默认私有，公开是独立操作。
- 公开前必须填写 description。
- Skill 网页编辑器支持文件树、Monaco 文本编辑、任意文件上传、二进制元信息展示。
- Rule / Prompt 使用普通多行文本框。
- Skill / Rule 从 Dashboard 点击安装后唤醒 Desktop 独立安装窗口。
- 安装窗口 loading 后拉取 session，下载并校验 package，进入现有安装流程。
- Prompt 详情可复制文本，不提供安装。
- 复制到我的内容生成私有新资源。
- 管理员可设置精选、取消精选、下架、恢复。
- 安装成功后记录去重安装事件。
- Content Store 使用独立对象存储配置，不复用 Drive bucket。
- 旧本地仓库能力保持不变。
