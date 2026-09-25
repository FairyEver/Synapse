# 手机端云盘实施计划

Spec：`docs/prototypes/2026-09-25-mobile-drive-design.html`（设计规格与可交互原型）。
Spec 是权威；本计划是它的论证。冲突以 Spec 为准，并在 ledger 里记 `Ruling:`。

服务端**不改动**：本计划只用已经存在的接口。上线时不需要跑 `deploy.sh`。

## Global Constraints

以下约束绑定每一个任务，实现者与审查者都要按它检查。

1. **不新增服务端接口、不改服务端代码。**
2. **只用系统组件与系统色。** 颜色写 `Color(uiColor: .systemBlue)` 这类系统色，或现有的
   `Theme` 语义色。禁止新增 hex / rgb / hsl、禁止装饰性渐变、glow、卡片套卡片、
   普通场景的内联样式。用原生 `List` / `NavigationSplitView` / `NavigationStack` /
   `Menu` / `sheet` / `alert` / `contextMenu` / `swipeActions` / `PhotosPicker` /
   `fileImporter` / `QuickLook`。
3. **iPhone 与 iPadOS 共用同一份数据、网络与操作。** 只允许呈现容器随空间变化。
   宽窄判据只用 `@Environment(\.horizontalSizeClass)` 与 `NavigationSplitView` 的折叠——
   禁止 `UIDevice.userInterfaceIdiom`、`UIScreen.main.bounds`、固定 iPad 型号。
4. **命中区 ≥ 44pt**（`DesignSystem/Metrics.swift` 的 `minimumTapTarget`）。
5. **底栏仍是三格。** 云盘进「主页 → 功能」，不新增 tab。
6. **生产代码禁止裸 `print`。** 错误显式处理：面向用户走 `model.notice(...)`，
   内部诊断走 `Core/AppLog.swift` 的 `os.Logger`（需要时给 `AppLog` 加一个 `drive` category）。
7. **新文件直接放进 `SynapseMobile/SynapseMobile/` 对应目录即被工程收录**
   （Xcode 16+ 同步目录），不要碰 `project.pbxproj`。测试同理放进 `SynapseMobileTests/`。
8. **注释与文案用中文**，风格照现有文件：说明「为什么」而不是复述「是什么」。
   面向用户的文案不写功能介绍、不写实现解释、不写状态复述。
9. **每个任务结束提交一次**，提交信息用中文说清做了什么与关键行为变化。
10. 每个任务结束必须能过：`xcodebuild build` 与它自己新加的测试。

### 线上契约（已核实，实现时以这些为准）

- 浏览用 **owner 浏览器快照**，不是 `/drive/items`：
  - 根：`GET /api/drive/browser/owner/root?childrenOffset&childrenLimit`
  - 文件夹：`GET /api/drive/browser/owner/items/:itemId?surface=console&childrenOffset&childrenLimit`
  - 响应 `DriveBrowserSnapshotDto`（`shared/src/drive.ts:855-868`）：
    `current`、`breadcrumbs`、`children`、`childrenPage{offset,limit,hasMore,nextOffset}`、
    `preview`、`canDownload`、`canZip`。
  - 每个子项 `DriveBrowserItemDto`（`shared/src/drive.ts:716-726`）：
    `id,name,type,size,mimeType,updatedAt,previewKind,browserUrl,downloadUrl,shareUrl?`。
  - `previewKind` ∈ `image|text|markdown|html-source|download-only`。
  - **根是服务端合成的**：`current.id == "root"`（`server/src/drive/drive-browser.ts:21`），
    `current.name` 是「网盘」，`downloadUrl` 为 `null`，`breadcrumbs` 第一项也是这一条。
    手机端显示的产品名是**「云盘」**，所以要按 `id == "root"` 判定根，
    标题用本地的「云盘」，并丢掉服务端那条根面包屑。
- 下载：`GET {origin}/drive/items/:itemId/download`，**不在 `/api` 前缀下**，
  需要 `Authorization: Bearer`。传文件夹时服务端自动打包成 zip 返回。
  是否提供文件夹下载看快照的 `canZip`。
- 上传：`POST /api/drive/uploads/prepare`（body `parentId?,name,size,mimeType?,expectedItemId?,expectedVersionId?`）
  → `PUT upload.url`（带 `upload.headers`）→ `POST /api/drive/uploads/:sessionId/complete`；
  放弃走 `POST /api/drive/uploads/:sessionId/cancel`。
  prepare 的响应里 `overwrite` 是 `{itemId,name,currentVersionId,documentText}` 或 `null`，
  **字段可能整体缺失**（旧服务端）：缺失 = 未知，不弹覆盖确认、不阻断。
  `size` 是十进制字符串。
- 文本读取：`GET /api/drive/browser/owner/items/:itemId/content/inspect`
  → `{itemId,name,kind,sizeBytes,versionId,editable}`
  （`shared/src/drive.ts:796-803`）；
  再 `GET .../content/chunk?versionId&cursor` → `{text,startByte,endByte,totalBytes,nextCursor,endOfFile}`。
- 其余路由逐条写在 Spec §6 的表里，照抄，不要自己拼路径。

### 复用现有实现（不要重写）

- `Core/Networking/FileUploader.swift` —— 预签名 PUT + 进度。上传字节必须走它。
- `Features/Terminal/TerminalFilePicker.swift` 的三个 picker，它们**不依赖**终端接力：
  - `PhotoLibraryPicker(selectionLimit:onPicked:onCancelled:)` → `[PHPickerResult]`
  - `DocumentPicker(onPicked:onCancelled:)` → `[URL]`（`asCopy`，已支持多选）
  - `CameraPicker(onPicked:onCancelled:)` → `CameraCapture`（`.photo(UIImage)` / `.video(URL)`）
  直接用它们。`CameraPicker` 的 `videoMaximumDuration` 取自 `relayCameraVideoSeconds`，
  而云盘的单文件上限同样是 100 MB，所以那个时长在云盘这里也是对的，不要改。
- `APIClient` 现有的 `send(path:method:body:)` / `send(path:method:)` / `EmptyResponse` /
  `escaped(_:)`。不要新建第二条 HTTP 通路。

### 明确不要复用的东西（会出错）

- **`TerminalFileIntake` 与 `PickedFile.relayName` / `sanitizedFileName` 一律不用。**
  `sanitizedFileName`（`TerminalRelay.swift:274`）只保留 ASCII 字母、数字与 `._-`，
  其余每一个标量都塌成一个 `-`。拿它给云盘上传命名，`需求规格.md` 会变成 `-.md`。
  那是终端接力要的（名字会被敲进 shell），云盘不是。
  云盘自己定义一个轻量候选类型（`url` / `name` / `size` / `mimeType` 四个字段），
  `name` 取原始文件名（`url.lastPathComponent`；相册来的用
  `NSItemProvider.suggestedName`，为空时用 UTType 推扩展名 + 时间戳），
  只剥掉路径分隔符，不做别的净化。
- **`screenPickedFiles` 不用。** 它按 `relayMaxFileCount = 9` 截断，那是接力一次打字的上限。
  云盘的文件数上限只有服务端每个文件 100 MB 这一条。
- `Features/Settings/DiagnosticLogView.swift:152` 的 `ActivityView` 是 `private`，**拿不到**。
  分享面板自己写一个十来行的 `UIViewControllerRepresentable` 包 `UIActivityViewController`。

### 已确认的实现细节

- `AppConfiguration` 里加 `apiOrigin`：由 `apiBaseURL` 去掉尾部 `/api` 路径段得到，
  照 `liveMobileURL` 的既有做法（同样要处理自定义基址与尾斜杠）。
- 文件图标：文件夹用 `Image(systemName: "folder.fill")` 配 `Color(uiColor: .systemBlue)`；
  文件用「一页纸 + 扩展名角标」自绘（Spec §4.3 的表给了每种扩展名的系统色与角标文字）。
  这是内容不是系统控件，用系统色即可。
- 排序是**本地视图偏好**（Spec §2.3）：`UserDefaults` 键
  `SynapseDriveSortKey`（`name|date|size|kind`，默认 `name`）、
  `SynapseDriveSortAscending`（默认 `true`）。文件夹永远排在文件前面。
- 每页 50 项。并发上传上限 2。

## Task 1 — 网络通道

**Files**
- `SynapseMobile/SynapseMobile/Core/AppConfiguration.swift`（加 `apiOrigin`）
- `SynapseMobile/SynapseMobile/Core/Networking/APIClient.swift`（加一个 `// MARK: - Drive` 段）
- `SynapseMobile/SynapseMobileTests/AppConfigurationTests.swift`（补 `apiOrigin` 用例）
- `SynapseMobile/SynapseMobileTests/DriveAPIContractTests.swift`（新建）

**Deliverables**

`AppConfiguration.apiOrigin: URL` —— `apiBaseURL` 去掉尾部 `/api`。
`https://synapse.d2.pub/api` → `https://synapse.d2.pub`；
`http://localhost:3000/api` → `http://localhost:3000`；
没有 `/api` 段时原样返回；尾斜杠不影响结果。

`APIClient` 新增（全部 `async throws`，返回值是可解码类型，DTO 由 Task 2 定义；
本任务可以先只加方法骨架与路径，但**不要**写假实现）：

| 方法 | 路由 |
|---|---|
| `driveRootSnapshot(childrenOffset:childrenLimit:)` | `GET /drive/browser/owner/root` |
| `driveItemSnapshot(itemId:childrenOffset:childrenLimit:)` | `GET /drive/browser/owner/items/:id?surface=console` |
| `driveCreateFolder(parentId:name:)` | `POST /drive/folders` |
| `driveRenameItem(itemId:name:)` | `PATCH /drive/items/:id` body `{name}` |
| `driveMoveItem(itemId:parentId:)` | `PATCH /drive/items/:id` body `{parentId}`（`parentId` 可为 nil） |
| `driveTrashItem(itemId:)` | `DELETE /drive/items/:id` |
| `driveTrash(offset:limit:search:)` | `GET /drive/trash` |
| `driveRestoreItem(itemId:)` | `POST /drive/items/:id/restore` |
| `driveHideTrashItem(id:)` | `DELETE /drive/trash/:id` |
| `driveRestorePublicAsset(assetId:)` | `POST /drive/public-assets/:assetId/restore` |
| `driveCreateShare(itemId:settings:)` | `POST /drive/items/:id/share` |
| `driveShares(offset:limit:)` | `GET /drive/shares` |
| `driveDisableShare(id:)` | `DELETE /drive/shares/:id` |
| `driveUsage()` | `GET /drive/usage` |
| `drivePublicAssets(offset:limit:search:)` | `GET /drive/public-assets` |
| `drivePreparePublicAssetUpload(name:size:mimeType:)` | `POST /drive/public-assets/uploads/prepare` |
| `driveCompletePublicAssetUpload(sessionId:)` | `POST /drive/public-assets/uploads/:sessionId/complete` |
| `driveRenamePublicAsset(assetId:name:)` | `PATCH /drive/public-assets/:assetId` |
| `driveTrashPublicAsset(assetId:)` | `DELETE /drive/public-assets/:assetId` |
| `driveContentInspect(itemId:)` | `GET /drive/browser/owner/items/:id/content/inspect` |
| `driveContentChunk(itemId:versionId:cursor:)` | `GET /drive/browser/owner/items/:id/content/chunk` |
| `driveDownloadURL(itemId:)` | `{apiOrigin}/drive/items/:id/download`（只拼 URL，不发请求） |
| `downloadDriveItem(itemId:to:onProgress:)` | 同上路径，`URLSession.download` + `Authorization` 头 |

`downloadDriveItem` 的取 token 与放头这两步照 `APIClient.downloadMeetingAudio(from:to:)`
的既有写法（`APIClient.swift:466-477`）：先取一个可用的 access token（复用现有的
token/refresh 通路），把它放进 `Authorization` 头，**不要**放进 URL 查询串。
下载到调用方给的临时文件 URL。

**但会话不要照抄它。** `downloadMeetingAudio` 走的是共享 REST 会话，而那个会话的
`timeoutIntervalForResource` 是 30 秒（`APIClient.swift:76`）——那是给一次请求-响应定的。
单个文件上限 100 MB（`DRIVE_MAX_FILE_BYTES`），共用这个上限等于任何真实文件在移动网络上
都必然失败。字节传输要自己一个会话，照 `Core/Networking/FileUploader.swift:19-24` 的既有形状
（它已经这么做了，`timeoutIntervalForResource = 600`）。
于是 `APIClient.swift` 里会出现**两条下载路径、两套上限**：`downloadMeetingAudio` 仍是
30 秒，`downloadDriveItem` 是 600 秒。后续任务不要把两者当成可以互换的。

`drivePrepareUpload` 现有的 `DriveUploadTicket.DriveItem` 只有 `id/name/size`；
给它加 `overwrite` 字段（`DriveUploadOverwriteTarget?`），不要新建平行的类型。
`prepareDriveUpload` 也补 `parentId` / `expectedItemId` 参数（带默认值，别破坏终端接力那个调用点）。

**Tests**
- `AppConfigurationTests`：`apiOrigin` 四种输入（标准、localhost、无 `/api`、带尾斜杠）。
- `DriveAPIContractTests`：本次新增的每个路径都断言一次拼出来的字符串
  （用 `AppConfiguration` 的默认基址）。这是纯字符串断言，不需要网络。
  至少覆盖：带 `/api` 前缀的、不在 `/api` 下的下载路由、`parentId: nil` 的移动。

**Commit**：`feat: 手机端云盘接上服务端通道，并补上不在 API 前缀下的下载路由`

## Task 2 — DTO 与纯函数文案

**Files**
- `SynapseMobile/SynapseMobile/Features/Drive/DriveModels.swift`（新建）
- `SynapseMobile/SynapseMobile/Features/Drive/DriveText.swift`（新建）
- `SynapseMobile/SynapseMobileTests/DriveModelsTests.swift`（新建）
- `SynapseMobile/SynapseMobileTests/DriveTextTests.swift`（新建）

**Deliverables**

`DriveModels.swift`：镜像服务端 DTO 子集的 `Decodable` 结构体，
字段名与 `shared/src/drive.ts` 对齐（用 `CodingKeys` 或 `convertFromSnakeCase` 都行，
但要和 `APIClient` 现有的解码策略一致——先读它怎么配的）。

必有的类型：
`DriveItemKind`（`file|folder`）、`DrivePreviewKind`（`image|text|markdown|html-source|download-only`）、
`DriveBrowserItem`（`Identifiable`、`Hashable`）、`DriveBreadcrumb`、`DriveChildrenPage`、
`DriveBrowserSnapshot`、`DrivePreview`、`DriveTrashEntry`、`DriveTrashPage`、
`DriveShare`、`DriveShareListItem`、`DriveSharePage`、`DriveAccessMode`、`DriveExpiry`、
`DriveUsage`、`DrivePublicAsset`、`DrivePublicAssetPage`、
`DriveContentInspect`、`DriveContentChunk`、`DriveUploadOverwriteTarget`。

规格要求（Spec §4.3、§7.3）：
- `size` 一律是 `String`（服务端大整数），解析成 `Int64` 的地方要有失败回落。
- `DriveShareListItemDto` 的确切字段读 `shared/src/drive.ts:598-613`，不要猜。
- 根判定：`DriveBrowserItem.isRoot` 等价于 `id == "root"`。

`DriveText.swift`：无副作用的纯函数，全部 `static`。
- `bytes(_ string: String) -> String` —— **十进制**单位（1000 进制，与 iOS 与文件 App 一致）。
  `0` → `0 字节`；小于 1000 → `N 字节`；`1000` → `1 KB`；`1_048_576` → `1.05 MB`；
  `220_200_960` → `220 MB`。**注意**：只在有小数点时剥尾零，
  `220.2` 取整成 `220` 之后不能再剥（这是原型里踩过的坑）。
- `date(_ iso: String) -> String` —— `今天 HH:mm` / `昨天 HH:mm` / `前天 HH:mm` /
  `M月D日` / `YYYY年M月D日`。判断「今天」用当前日历，不是写死的日期。
- `kind(of name: String) -> DriveFileKind` —— 扩展名 → 种类的映射表，覆盖 Spec §4.3 那张表的每一行，
  未知扩展名回落 `unknown`。无扩展名也回落 `unknown`。
- `badge(of name: String) -> String` —— 角标文字，最长 4 个字符，超长截断。
- `kindColor(DriveFileKind) -> Color` —— Spec §4.3 的系统色。
- `errorMessage(_ error: Error) -> String` —— 中文兜底；
  `APIError` 用服务端的 `message`，`isTransport` 时给「网络不可用，稍后重试」类文案。
- `shareModeLabel(DriveAccessMode) -> String`、`expiryLabel(DriveExpiry) -> String`。

**Tests**：上面每一条各一组用例，边界必须覆盖
（`bytes` 的 0/999/1000/1_048_576/220_200_960/134_217_728；`kind` 的表逐行；
`badge` 的超长截断；`errorMessage` 的 401/超时/未知）。

**Commit**：`feat: 手机端云盘的模型与文案纯函数`

## Task 3 — DriveStore（浏览）

**Files**
- `SynapseMobile/SynapseMobile/Features/Drive/DriveStore.swift`（新建）
- `SynapseMobile/SynapseMobileTests/DriveStoreTests.swift`（新建）
- `SynapseMobile/SynapseMobile/App/SynapseAppModel.swift`（加 `let drive = DriveStore()`）

`SynapseAppModel` 那一行放在这里而不是 Task 10：视图层从 Task 6 起就要通过
`model.drive` 拿到它，晚加会让 Task 6~9 编不过。Task 10 只做主页与根视图的接线。

**模板**：`Features/Meeting/MeetingStore.swift`。`@MainActor @Observable final class`，
每个网络方法显式收 `using client: APIClient`。这样它能被单测直接驱动，不需要网络。

**Deliverables**
- 状态：`path: [DriveBrowserItem]`（从根到当前文件夹）、`current: DriveBrowserSnapshot?`、
  `loading`、`errorMessage`、`sortKey`、`sortAscending`。
- `open(itemId:using:)` 下钻、`up()` 回上一级、`jump(to index:)` 面包屑跳转、
  `reload(using:)` 刷新当前层、`loadMore(using:)` 续页（`childrenPage.hasMore`）。
- `visibleChildren` —— 排好序的当前层：**文件夹永远在前**，然后按 `sortKey` 排，
  中文用 `localizedStandardCompare`（这样「第 2 章」排在「第 10 章」前面）。
- 排序偏好读写 `UserDefaults` 的 `SynapseDriveSortKey` / `SynapseDriveSortAscending`。
- `createFolder(name:using:)`、`rename(item:to:using:)`、`move(items:to:using:)`、
  `trash(items:using:)` —— 每个都返回「成功几项 / 失败几项」的汇总，
  **逐项报告**而不是全成功才生效（Spec §5.2）。失败项的名与原因要能拼出一句话。
- 根标题：`path.isEmpty` 时标题是「云盘」；下钻后是当前文件夹名。
  面包屑丢掉服务端那条根项，自己补一条「云盘」。

**分层（照 `MeetingStore` 的既有做法）**：`DriveStore` 的网络方法收
`using client: APIClient`，它本身是薄薄一层透传，**不**为它造协议、也不为它写单测
（`MeetingStore` 同样没有单测）。可测的东西抽成纯的：
- 排序：`DriveSort`（自由函数或值类型），输入项数组 + 排序键 + 升降序，输出排好的数组。
- 批量结果汇总：一个 `DriveBatchOutcome` 值类型（成功几项、失败项的名与原因），
  「逐项报告而不是全成功才生效」的语义靠它落地。
- 路径栈：面包屑（丢掉服务端那条根项、补本地「云盘」）与
  「把文件夹移进它自己的子孙要拒绝」的判定，都做成纯函数。

**Tests**（`DriveStoreTests`）测上面这些纯的部分：
下钻与返回后路径栈正确、面包屑跳转、排序（文件夹在前 / 四种键 / 升降序 / 中文数字序）、
`move` 里「把文件夹移进它自己的子孙」被拒绝、批量删除里一项失败时其他项仍成功且汇总正确。

**Commit**：`feat: 手机端云盘的浏览状态与文件夹操作`

## Task 4 — DriveStore（回收站、分享、直链、用量）

**Files**：`DriveStore.swift`、`DriveStoreTests.swift`（都在 Task 3 的基础上追加）

**Deliverables**
- 回收站：`trash: [DriveTrashEntry]`、`loadTrash(using:)`(带 `search`)、
  `restoreTrashEntry(_:using:)`（`kind == "public_asset"` 时走 `restorePublicAsset`）、
  `purgeTrashEntry(_:using:)`。
- 分享：`shares: [DriveShareListItem]`、`loadShares(using:)`、
  `share(item:settings:using:) -> DriveShare`、`disableShare(_:using:)`。
  已存在活跃分享时直接返回它，不重复创建。
- 直链：`assets: [DrivePublicAsset]`、`loadAssets(using:)`、`renameAsset`、`trashAsset`。
- 用量：`usage: DriveUsage?`、`loadUsage(using:)`。

**Tests**：回收站恢复分流（普通项 vs 公开素材走不同接口）、
已有分享时不重复创建、分享结果里的链接可直接拷贝。

**Commit**：`feat: 手机端云盘的回收站、分享、直链与用量`

## Task 5 — 上传

**Files**
- `SynapseMobile/SynapseMobile/Features/Drive/DriveUploader.swift`（新建）
- `SynapseMobile/SynapseMobile/Features/Drive/DriveFileIntake.swift`（新建）
- `SynapseMobile/SynapseMobileTests/DriveUploaderTests.swift`（新建）

`DriveFileIntake` 负责「三个 picker 交回来的东西 → 磁盘上一份可上传的文件」：
`PHPickerResult` 走 `NSItemProvider` 落地，`CameraCapture` 的图像写临时文件、
视频直接用它的 URL，`[URL]` 直接用。它**必须保留原始文件名**——
不要用终端接力那套 `TerminalFileIntake` / `PickedFile.relayName` / `sanitizedFileName`
（`sanitizedFileName` 只保留 ASCII，`需求规格.md` 会被压成 `-.md`）。
输出一个四字段的轻量类型（`url` / `name` / `size` / `mimeType`）。

**模板**：`Features/Meeting/MeetingUploader.swift`（`@MainActor final class`，
`send`/`abort` 闭包注入以利单测，带重试）。

**Deliverables**
- `enqueue(files: [PickedFile], parentId: String?, using: APIClient)`：
  预签名 PUT → complete，进度回报，并发上限 2。
- `prepare` 响应带 `overwrite` 非空时，先**暂停**该项并把它标成「待确认覆盖」；
  调用方 `confirmOverwrite(_:)` 后带 `expectedItemId` 重新 prepare 再传。
  `overwrite` 缺失 = 未知 → 不确认，直接传。
- PUT 收到 401/403 → 重新 prepare 一次再传，只重试一次。
- 失败项留在列表里可单独 `retry(_:)`；`cancel(_:)` 调 cancel 释放配额。
- 进入后台导致的失败：文案要说清是「离开 App 导致」，不是网络错误。

**Tests**：进度合并、并发上限、一项失败不影响其他项、取消调 cancel、
PUT 403 后只重 prepare 一次、`overwrite` 缺失时不弹确认。

**Commit**：`feat: 手机端云盘的上传队列与同名覆盖确认`

## Task 6 — 浏览界面

**Files**
- `SynapseMobile/SynapseMobile/Features/Drive/DriveBrowserView.swift`（新建）
- `SynapseMobile/SynapseMobile/Features/Drive/DriveBrowserList.swift`（新建）
- `SynapseMobile/SynapseMobile/Features/Drive/DriveFileIcon.swift`（新建，图标自绘）

**Deliverables**（Spec §4.2、§5.1、§5.2）

外壳 `DriveBrowserView`：
- 自带 `NavigationSplitView`：浏览列 + 预览列。预览列一律用 `DrivePreviewPane`
  （Task 7 已建好，含它自己的空态）。紧凑窗折叠为单列。
  **不要**把它推入任何 `NavigationStack`（Spec §3 的说明）。
- 浏览列自带 `NavigationStack(path:)` 做文件夹下钻。
- 左上「返回主页」按钮一枚（回调交给调用方），与「···」同一行。
- 「···」菜单：新建文件夹 / 上传文件 / 排序方式 / 选择 / 分享管理。
- 大标题 = 当前文件夹名，副标题「N 项 · 按X升序/降序」。
- 面包屑：深度 ≥ 2 时出现，横向可滚，点任意一级跳过去。
- **三个列表屏（回收站 / 公开素材 / 分享管理）自带到齐的东西**：
  `DriveTrashView`、`DrivePublicAssetsView`、`DriveShareListView` 都从环境取 model、
  自带 `.noticeOverlay` 与页面结构，接收方只管把它们推进自己那条 `NavigationStack` 并带上
  `.environment(model)`。**不要**在外面再套一层 `NavigationStack`，
  也**不要**再挂一个 `.noticeOverlay`——它们自带的那份是给 sheet 盖住宿主那层准备的。
- 列表底部（仅根层）：回收站一行（副标题「N 项」，0 时不显示值）、公开素材一行。
  列表最底部一行用量「已用 X / Y」，次要色，不可点。
- 上传中的项作为独立分组显示在列表顶部，带进度条与取消。
- **选中之后、起飞之前，先在调用方按 `file.size > AppConfiguration.relayMaxFileBytes`
  拦一道**，超限就 `model.notice(...)` 说明原因，不要交给服务端拒。
  这**不能**放在 intake 里：`PHPickerResult` / `NSItemProvider` 不暴露字节数
  （要拿得走 `assetIdentifier` → `PHAsset`，那需要相册权限，而 PHPicker 这条路的设计
  恰恰是不申请权限）；文件 App 那条的系统拷贝在 intake 看到 URL 之前就已经发生了。
  `AppConfiguration.relayMaxFileBytes` 的注释写的正是这个理由，
  而云盘的单文件上限与接力是同一个 100 MB。

列表 `DriveBrowserList`：
- 行：图标 29pt、名称一行、副标题一行（文件 `大小 · 修改时间`；文件夹 `修改时间`）、
  文件夹带 chevron、已分享（`shareUrl != nil`）带一个 `link` 符号。
- **副标题里的大小要先看 `DriveBrowserItem.sizeBytes`**（`Int64?`）：
  为 `nil` 时显示 `—`，不要直接调 `DriveText.bytes(_:)`——
  那个函数把「读不出的大小」和「0 字节」都渲染成 `0 字节`，一个超出 `Int64` 的
  `size` 字符串会因此读成「0 字节」。
- 图标角标：`DriveText.badge(of:)` 在没有扩展名时返回空串，就让它空着
  （系统「文件」App 的通用文档图标也不带扩展名文字），不要填一个假的 `FILE`。
- 轻点文件夹下钻；轻点文件在宽窗选中、紧凑窗推入预览页。
  **实测结论（2026-09-25，模拟器探针）**：紧凑窗侧栏里那条 `NavigationStack` 本身是好的
  （`nav bars = 1`、下钻两层标题正确、返回落到上一层；常规宽度 2 条导航栏）。
  坏的是「把详情列推上来」那一步——`preferredCompactColumn` 弹栈回来时不回写绑定、
  详情列的 `onDisappear` 不触发，再点第二个文件会静默无反应。
  所以**不要**用 `preferredCompactColumn` 做紧凑窗的预览，就按上面那行做：
  紧凑窗把预览当成栈上的一页推入。原计划 §11 里那条「回退成 sheet」的方案是多余的。
  **注意**：store 的 `open(itemId:using:)` 是**只给文件夹**用的（它拉的是子层快照）。
  文件的预览要用行自己带的那份 `DriveBrowserItem`（它有 `previewKind` / `browserUrl` /
  `downloadUrl`），不要拿 itemId 去 store 里反查。
- `.contextMenu`：预览/打开、分享、重命名、移动到、导出、显示简介、删除。
  不可用的项置灰而不是隐藏。
- `.swipeActions`：`allowsFullSwipe` 的删除（系统红）+ 前置的分享。
- `.refreshable` 下拉刷新；滚到底自动 `loadMore`。
- 多选：`EditButton` 风格的编辑模式，行左侧选择圈，底部工具条
  「已选 N 项」+ 移动/导出/删除（未选时置灰），导航栏右上「全选/取消全选」。
- **分享状态变了要重取当前层。** 建分享与停用分享都不改浏览器快照，所以行尾那个
  `shareUrl` 角标不会自己更新。分享 sheet / 分享结果页收起时调一次
  `reload(using:)`，否则用户刚建完分享、回到列表却看不到标记。
- 空态 `ContentUnavailableView("文件夹为空", systemImage: "folder")`；
  加载态用 `.redacted` 占位，不要整屏转圈；错误态带重试按钮。

`DriveFileIcon`：文件夹 `Image(systemName: "folder.fill")` + `Color(uiColor: .systemBlue)`；
文件是「一页纸 + 折叠角 + 扩展名角标」，颜色取 `DriveText.kindColor`。

**验收**：`xcodebuild build` 通过；iPhone 与 iPad 两种宽度下都能编译并进得去
（行为验证放 Task 10，这里只要结构成立）。

**Commit**：`feat: 手机端云盘的浏览界面与文件列表`

## Task 7 — 预览

**Files**
- `SynapseMobile/SynapseMobile/Features/Drive/DrivePreviewPane.swift`（新建，整份）
- `SynapseMobile/SynapseMobile/Features/Drive/DriveQuickLook.swift`（新建）
- `SynapseMobile/SynapseMobile/Features/Drive/DriveFileExport.swift`（新建）

`DrivePreviewPane` 由本任务整体建立（含空态），Task 6 只是使用它——
执行顺序上本任务先于 Task 6，所以不存在「先建空壳再填」。

**Deliverables**（Spec §4.4、§5.4）

按服务端的 `previewKind` 分流：
- `image` → 下到临时文件后用 `Image` 渲染，支持缩放。
- `text` / `markdown` → `content/inspect` 拿 `versionId`，`content/chunk` 读；
  Markdown 用 `AttributedString(markdown:)`。超过 64 KiB 只读开头，
  底部一行说明已显示的范围。
- `html-source` → 当纯文本显示源码（不执行、不渲染网页）。
- `download-only` → **不要用一张手写的扩展名表来判能不能预览，也不要照规格 §4.4 那句
  「其余显示『此格式无法预览』」字面执行。** 那一行写窄了：服务端的 `download-only`
  不是一个「PDF/Office 加几个怪东西」的小桶，而是**一切没被归成 image/text/markdown/html
  的东西**（`server/src/drive/drive-browser.ts` 的 `resolveDriveBrowserPreviewKind`），
  也就是 PDF、Office、视频、音频、压缩包、磁盘映像、未知全在里面。
  照字面执行会让 App 对用户的 mp4 说「这个格式无法预览」，而 iOS 的 QuickLook 明明能放。

  正确的形状：**先按大类粗筛该不该为预览花流量**（媒体 / PDF / Office / 文本类值得下，
  压缩包 / 磁盘映像 / 未知不值得），下载之后再问系统
  ——`QLPreviewController` 的类方法 `canPreviewItem:`——**以系统的回答为准**。
  它能答对比任何表都准：一个其实是被改名的压缩包的 `.pdf`、一个扩展名写错的 `.xlsx`、
  `.csv` / `.rtf` / `.key`、以及苹果以后新增的格式，表都覆盖不了。系统说不能，
  才落回「无法预览 + 导出」。
  若实测证明 `canPreviewItem:` 对**尚不存在**的 URL 也答得对（它按扩展名/UTI 推类型），
  那就把粗筛也去掉，只留它一个判据。

三个文件各管一件事：
- `DriveQuickLook` —— `QLPreviewController` 的 `UIViewControllerRepresentable`。
- `DriveFileExport` —— 下载到临时目录 + 系统分享面板。面板**自己写**
  （`UIViewControllerRepresentable` 包 `UIActivityViewController`），
  因为 `DiagnosticLogView.swift` 里那个是 `private`。
  「存储到文件」就在面板里，**不要**再单独做一个导出按钮。
  单个文件与多选走同一条路：先把字节下到临时目录，再把文件 URL 交给面板。
- `DrivePreviewPane` —— 上面那套的分流 UI，底部动作栏：分享 / 导出 / 简介。

下载前如果文件超过 50 MB，先问一句；下载中显示进度可取消。

**Commit**：`feat: 手机端云盘的预览与导出`

## Task 8 — 对话框族

**Files**
- `SynapseMobile/SynapseMobile/Features/Drive/DriveShareSheet.swift`（新建）
- `SynapseMobile/SynapseMobile/Features/Drive/DriveMoveTargetPicker.swift`（新建）
- `SynapseMobile/SynapseMobile/Features/Drive/DriveItemInfoView.swift`（新建）
- `SynapseMobile/SynapseMobile/Features/Drive/DriveRenameSheet.swift`（新建）

**Deliverables**（Spec §4.5、§4.8、§5.1）

- `DriveRenameSheet` —— 一个输入框，新建文件夹与重命名共用；空名字时确认键置灰。
- `DriveMoveTargetPicker` —— 可下钻的文件夹树选择器，一层层走下去，
  底部「移到这一层」确认当前层。**排除**被移动项自己与它的子孙。
- `DriveShareSheet` —— 三段：有效期（3 天/7 天/30 天/1 年/永久，默认永久）、
  访问权限（**仅阅读 / 登录后可编辑 / 指定邮箱可编辑**，默认仅阅读）、密码开关。
  **第三档要带那个邮箱名单输入框**（规格 §4.5：「指定邮箱可编辑是唯一需要输入的地方，
  用一个逗号分隔的多行输入框，提交前按逗号 / 空格 / 换行切分并去重」）。
  切分去重的边界按服务端 `server/src/drive/drive-share-access.ts:44-61` 的实际规则对齐：
  它先 trim、再转小写、再去重，然后用 `^[^\s@]+@[^\s@]+\.[^\s@]+$` 校验，
  空名单抛「请至少添加一个可编辑用户。」，非法邮箱抛「可编辑用户邮箱无效。」。
  注意 **`，`（全角逗号）既不是 `\s` 也不是 `@`，所以 `a@x.com，b@x.com` 会通过服务端那条正则
  被当成一个畸形邮箱存下来**——分享建成了、模式写着「指定邮箱可编辑」、两个人谁也编辑不了，
  而且没有任何报错。所以本地切分必须同时认 `,` `，` `、` 与空白（含 `　`）与换行。
  另：`　` 会**通不过**服务端正则，不归一化就整单失败且不说是哪个 token 有问题，
  所以本地先校验并点名。
  这一档之前被漏掉的原因是 `task-2-report.md` 里断言它是「桌面端的」，
  而规格 §4.5 的正文与它矛盾——计划继承了这个错误，不是实施者的判断问题。
  创建成功后换成结果页：链接、带密码链接、密码各一行带「拷贝」；
  已有活跃分享时不重复创建，直接进结果页并说明链接未变。
- `DriveItemInfoView` —— 名称、种类（带扩展名）、大小、修改时间、位置（完整路径），
  有活跃分享时追加一行进入分享结果页。

密码与链接只在这张 sheet 里出现，**不要**写进日志或 `AppLog`。

**Commit**：`feat: 手机端云盘的重命名、移动、分享与简介`

## Task 9 — 回收站与公开素材界面

**Files**
- `SynapseMobile/SynapseMobile/Features/Drive/DriveTrashView.swift`（新建）
- `SynapseMobile/SynapseMobile/Features/Drive/DrivePublicAssetsView.swift`（新建）
- `SynapseMobile/SynapseMobile/Features/Drive/DriveShareListView.swift`（新建）

`DriveShareListView` 是「分享管理」那一屏——规格 §3 与 §4.2 的工具栏菜单都引用了它，
但前面的任务清单漏了它，数据层（`DriveStore.shares` / `loadShares` / `disableShare`）已经就绪。
它在这里而不是在 Task 6，是因为它与回收站、公开素材是同一类「列表 + 行操作」的屏。

**Deliverables**（Spec §4.6、§4.7）

- `DriveTrashView`：按移入时间倒序，行副标题「原路径 · 移入时间」；
  两个动作——恢复到原路径、从回收站移除（红色，二次确认）。
  `.searchable` 走服务端的 `search` 参数。空态「回收站是空的」。
- `DrivePublicAssetsView`：扁平列表，副标题「访问 N 次 · 最近访问时间」；
  工具栏 ＋ 走与云盘同一套上传通道（prepare 换成 public-assets 那一条），
  上传完直接给出 `/files/<assetId>` 直链；行菜单：拷贝直链、重命名、删除。
  空态「还没有公开素材」。
- `DriveShareListView`：**进屏时自己拉一次 `model.driveLoadShares()`**——
  那是 `DriveStore.shares` 唯一该被加载的地方（分享 sheet 里那次探测已改成单条真读），
  不拉它的话 `DriveSharePlan.useExisting` 快路与 `DriveItemInfoView` 的本机列表分支
  都不可达。行副标题把访问权限、有效期、有没有密码写全；
  点一行进分享结果页（拷贝链接 / 停止分享）；停用后刷新列表。
  **从分享结果页返回时也刷新一次**：`share()` 成功后会就地删掉本机那一行
  （见 `DriveStore.forgetShare(forItemId:)`），不重取的话它会从列表里消失
  直到用户下次进来。

**三个列表都只取首页，这是本期的已知上限，写清楚而不是留成暗坑。**
服务端的默认 `limit` 是 20、上限 100，所以 store 里这三处要**显式传 `limit: 100`**，
并在这里写明：超过 100 条时手机端只看得到前 100 条，桌面端可以看全。
分类工具（`AppLog` 之外）不分页，不做「加载更多」。

**Commit**：`feat: 手机端云盘的回收站与公开素材`

## Task 10 — 接线、文档与验收

**Files**
- `SynapseMobile/SynapseMobile/Features/Root/HomeRoute.swift`
- `SynapseMobile/SynapseMobile/Features/Root/RootView.swift`
- `SynapseMobile/SynapseMobile/Features/Home/HomeView.swift`
- `SynapseMobile/SynapseMobile/App/SynapseAppModel.swift`
- `RELEASE_NOTES_PENDING.md`
- `docs/agents/mobile-adaptive-layout.md`
- `SynapseMobile/README.md`

**Deliverables**（Spec §4.1、§7.4）

- `HomeRoute` 加 `case drive`；`HomeView` 加一行「云盘 / 服务端上的文件 / 恒可用」，
  排在「录音」之下、「新建会话」之上。
- `RootView.homeTab` 收敛成一个「这一格当前该显示哪一页」的 switch：
  `homePath.last` 是 `.recordings` 显示录音页、是 `.drive` 显示云盘页、其余走栈。
  云盘页与录音页同构：整格归它所有，自带返回主页键调 `popToRoot(.home)`。
  切页动画的触发量要从单个布尔量改成「当前是不是功能页」，
  否则推入剪贴板历史那一下会被它接管。
- `SynapseAppModel` 加 `let drive = DriveStore()` 与必要的透传。
- **从被推入的页面返回时，浏览层要重取一次。** 回收站里恢复或彻底删除、以及分享管理里
  停用分享，都会改变浏览层要显示的东西（前者是行本身，后者是行尾的分享角标），
  而那几个页面是**推入**的、不是 sheet，所以 Task 6 那套「sheet 收起时 reload」覆盖不到它们。
  不补的话用户恢复一个文件、返回、看不见它，要下拉一次才出现——看起来像没生效。
- `RELEASE_NOTES_PENDING.md`：云盘上线是用户可感知变化，必须记。
  写「得到什么、什么变了」，不写代码路径。
- `docs/agents/mobile-adaptive-layout.md`：功能清单那句补上云盘。
- `SynapseMobile/README.md`：导航结构表里「主页 · 功能清单」那一格补云盘。

**验收（这一任务的核心）**
- `xcodebuild build` 通过。
- 全量单测通过。
- 模拟器上手工走一遍 Spec §10.2 的九条（至少 1、2、3、4、5、6、7、9），
  **重点量 Spec §10.3 那一条**：`NavigationSplitView` 的 sidebar 里带一层
  `NavigationStack`，在 iPhone 紧凑窗与 iPadOS 半窗下会不会出现两条导航栏、
  返回手势会不会把人带回错误的层级。成立就保留；不成立按 Spec 的回退方案
  （紧凑窗不叠 `NavigationSplitView`，改单列 `NavigationStack` + 预览 sheet，
  并排只在 regular 宽度启用）修掉。
- `iPhone 竖 / 横`、`iPadOS 全屏横 / 竖`、`半窗`、`1/3 窗` 各走一遍，
  确认折叠与展开不重置当前文件夹与多选。
- 大字号与深色外观各看一眼。
- **移动目标选择器上，「进入被移动项的子孙」应当是不可达的。** 被排除的那个文件夹
  根本不会被渲染成行，所以进不去；`chain` 只通过 `enter` 在已渲染的行上增长。
  这一条在组件层断言不了（`DriveMoveTargets.selectable` 只拿到一层子项、没有祖先信息），
  所以放在这里人工确认一次。
- **在设备上确认 `UIDocumentPickerViewController(asCopy: true)` 交回来的文件落在哪。**
  `DriveUploader.discard` 只在文件位于临时目录时才删它（不可逆操作，方向是对的），
  而「文件 App 那条也落在临时目录」这个前提来自 `asCopy` 的语义，不是实测。
  工程既有的 `TerminalFileIntake.prepare(documentURL:)` 是**先拷进 `temporaryDirectory`
  再交给上层**的，说明这个工程原本并不打算依赖 `asCopy` 的落点。
  若确认落在别处：取消/移除上传项时文件永远不会被删，拷贝会在容器里累积，
  落在 Documents 时用户在「文件」App 里还能看见它们——那就升为要修的问题，
  修法是在 intake 里照接力那样主动拷进临时目录。

**Commit**：`feat: 云盘接进主页功能清单，并补齐文档与发布说明`
