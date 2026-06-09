# 云盘拖拽上传与本地上传管线设计

日期：2026-06-09
范围：`desktop/src/modules/drive/`、`desktop/electron/modules/account/`、`desktop/electron/services/account-service.ts`、`desktop/src/types/bridge.ts`、`desktop/electron/preload.ts`

## 目标

云盘文件列表区域支持把用户电脑上的文件或文件夹拖入当前目录上传。同时调整现有“上传文件”和“上传文件夹”按钮，使点击选择与拖拽上传共用同一条本地上传管线，避免 renderer 读取大文件或复制大块 `ArrayBuffer` 导致界面卡顿和内存压力。

## 当前问题

现有云盘上传是混合实现：

- renderer 在 `desktop/src/modules/drive/index.tsx` 中编排上传流程，负责 prepare、读取 `file.arrayBuffer()`、complete 和 toast。
- 主进程 `AccountService.uploadDrivePreparedFile()` 收到 `ArrayBuffer` 后执行 PUT。

这条链路是异步的，但大文件或多文件上传时，renderer 仍会读完整文件并通过 IPC 传输完整内容，容易增加 UI 卡顿和内存占用。新增拖拽上传不能继续复制这套逻辑。

## Hard Rules

- 上传编排只能有一份。点击上传文件、点击上传文件夹、拖拽文件、拖拽文件夹、混合拖拽都必须归一化为同一个本地上传请求，再交给同一个主进程上传管线。
- renderer 只负责收集用户选择或拖入的项目、传递当前 `parentId`、展示轻量上传状态；不得执行 prepare/upload/complete 主流程。
- renderer 不得读取完整文件内容后通过 IPC 传给主进程；禁止继续依赖 `file.arrayBuffer()` 作为云盘上传正文来源。
- 文件读取和 PUT 上传在主进程执行，使用不会阻塞 renderer 的异步队列。实现应优先使用文件流或等价的分块友好方式，避免一次性把大文件读进 renderer。
- 上传目标永远是当前面包屑所在目录的 `parentId`，不受搜索框筛选影响。
- 拖拽文件夹语义必须与“上传文件夹”按钮一致：保留最外层文件夹名和内部结构。
- 多入口、单个、多选、文件夹和混合拖拽都必须走相同失败统计与 toast 汇总规则。
- 不新增依赖，除非后续实现阶段用户明确批准。

## 非目标

- 不做完整上传管理器、逐文件进度面板、暂停、恢复或失败重试队列。
- 不改变服务端云盘上传协议、分享协议、配额规则或 COS object key 规则。
- 不在云盘 UI 增加常驻说明文案。
- 不把本地绝对路径传给服务端。

## 交互设计

文件列表区域成为拖拽上传目标。用户把文件或文件夹拖入时，列表区域显示全区域覆盖层，覆盖层文案绑定当前目录：

```text
松开上传到 <当前目录名>
```

示例：当前在“根目录 / 1”时显示“松开上传到 1”，不是固定显示根目录。

拖拽释放后的语义：

- 散文件上传到当前目录。
- 文件夹保留最外层文件夹名，内部文件按原结构上传。
- 一次拖入多个文件、多个文件夹或文件和文件夹混合时，全部上传。
- 未登录、加载中、列表错误态不触发上传。
- 上传期间文件列表不进入整页 loading；用户仍可浏览目录、搜索、分享、删除或新建文件夹。

工具栏显示轻量上传状态，例如：

```text
正在上传 3 项
```

上传结束后用 toast 汇总结果，并刷新当前目录。失败文案保持短句，显示成功和失败数量。

## 架构设计

### renderer

`DriveModule` 保留页面状态和用户交互：

- 当前目录 `parentId` 和当前目录名称。
- 文件选择和文件夹选择入口。
- 文件列表区域 drag enter、drag over、drag leave、drop 状态。
- 上传中轻量状态。
- 上传完成后的目录刷新和 toast。

renderer 需要把所有入口归一化为同一种请求形态，再调用一个 bridge 方法。请求表达用户选中的散文件和文件夹文件组，不表达上传流程：

```ts
type DriveLocalUploadRequest = {
  parentId: string | null
  items: DriveLocalUploadItem[]
}

type DriveLocalUploadItem =
  | {
      kind: "file"
      path: string
      name: string
      mimeType?: string | null
    }
  | {
      kind: "folder"
      folderName: string
      files: Array<{
        path: string
        relativePath: string
        mimeType?: string | null
      }>
    }
```

点击“上传文件夹”和拖拽文件夹都归一化为 `kind: "folder"`。renderer 可以使用 `webkitRelativePath` 或拖拽 entry 的相对路径构建文件夹文件组，但不得读取文件正文。主进程根据 `path` 做 stat、读取和上传。

### preload 和 IPC

新增云盘专用 bridge 方法，例如：

```ts
window.synapse.account.uploadDriveLocalItems(input)
```

IPC 请求只包含当前目录和本地项目清单。主进程 IPC schema 必须校验：

- `parentId` 为 string 或 null。
- `items` 非空。
- 每个 item 的 kind 只能是 file 或 folder。
- 文件 item 必须有本地路径、文件名和可选 mime type。
- 文件夹 item 必须有 `folderName` 和非空文件列表，列表里的每个文件必须有本地路径、文件夹内相对路径和可选 mime type。
- 本地路径和相对路径是字符串；相对路径不得为空、绝对路径或包含不安全路径段。

本地路径读取属于敏感操作，实现阶段需要沿用现有 PermissionGuard/AuditSink 模式处理读本地路径和写云盘两类操作，不静默扩大权限。

### 主进程上传管线

`AccountService` 或其内部辅助服务拥有唯一上传编排函数：

```ts
uploadDriveLocalItems(input): Promise<DriveLocalUploadResult>
```

职责：

1. 校验并 stat 每个本地文件。
2. 将散文件和文件夹文件组展开为统一任务列表。
3. 文件夹上传按 `folderName` 组织 manifest，调用现有 `prepareDriveFolderUpload`。
4. 散文件调用现有 `prepareDriveUpload`。
5. 对每个 prepared entry 从本地文件异步读取并 PUT。
6. 每个成功 PUT 后调用 `completeDriveUpload`。
7. 单个文件失败不阻断其它文件，结果汇总成功和失败数量。
8. 需要取消未完成 session 时，调用现有 `cancelDriveUpload`；取消失败只记录结构化 warn，不覆盖原始上传失败。

主进程 PUT 上传应避免一次性经 renderer IPC 接收文件正文。实现可以使用 Node 文件流、Web ReadableStream 或当前运行时支持的等价方式；如果某个上传目标要求固定 `Content-Length`，主进程从 stat 结果提供。

### 统一结果

返回结果只给 UI 展示必要摘要：

```ts
type DriveLocalUploadResult = {
  completed: number
  failed: number
  skipped: number
  message?: string
}
```

不返回本地绝对路径列表，不把路径写入 toast。结构化日志可以记录计数、失败原因类别和操作来源，避免泄露用户完整路径。

## 数据流

点击“上传文件”：

1. renderer 调用文件选择入口收集文件名、mime type 和本地 file path。
2. renderer 构造 `DriveLocalUploadRequest`。
3. 主进程 `uploadDriveLocalItems()` 处理上传。
4. renderer 展示轻量状态，完成后 toast 并刷新当前目录。

点击“上传文件夹”：

1. renderer 收集所选文件夹内的文件 path 和 `webkitRelativePath`。
2. 同样调用 `uploadDriveLocalItems()`。
3. 主进程按 `folderName` 和相对路径 manifest 保留最外层文件夹语义。

拖拽上传：

1. renderer 在文件列表区域识别外部拖拽。
2. drop 时把拖入的文件归一化为散文件，把拖入的文件夹递归归一化为文件夹文件组。
3. 同样调用 `uploadDriveLocalItems()`。

## 错误处理

- 未登录、权限不足、列表错误态：不启动上传。
- 无法读取拖拽项目：toast 提示跳过数量。
- 空文件夹或无可上传文件：toast 提示没有可上传文件。
- 部分失败：toast 显示成功和失败数量。
- 全部失败：toast 显示上传失败摘要。
- 主进程日志必须结构化记录错误类别和计数；不要在普通日志、toast 或 UI 中暴露完整本地路径。

## 测试计划

renderer 测试：

- “上传文件”按钮调用统一本地上传 bridge，不再调用 renderer `file.arrayBuffer()` 上传正文。
- “上传文件夹”按钮调用同一个 bridge。
- 拖拽散文件时目标 parentId 是当前目录。
- 拖拽文件夹时覆盖层显示当前目录名。
- 混合拖拽多个文件和文件夹时只调用一次统一上传入口。
- drag leave 到子元素时覆盖层不闪烁。
- 未登录、加载中、错误态不触发上传。
- 上传中显示轻量队列状态，列表不进入整页 loading。

主进程测试：

- `uploadDriveLocalItems()` 对散文件调用 `prepareDriveUpload`、本地读取、PUT、complete。
- 文件夹展开后调用 `prepareDriveFolderUpload`，`folderName` 为最外层文件夹名，文件 manifest 保留内部相对路径。
- 不安全相对路径被拒绝或跳过，不进入 prepare 请求。
- 混合项目共享同一上传编排路径。
- 单个文件失败后继续处理其它文件，并汇总部分失败。
- 上传失败时尝试 cancel session，cancel 失败结构化 warn。
- 日志和返回结果不包含用户完整本地路径。

回归测试：

- 现有分享、删除、重命名、移动和目录进入行为不变。
- 现有云盘列表加载失败和未登录状态不泄露 IPC channel。

## 验收标准

- 用户可以把文件或文件夹拖入云盘文件列表区域上传到当前目录。
- 点击上传和拖拽上传行为一致，且上传逻辑只存在于统一主进程管线。
- renderer 不再读取完整文件正文并通过 IPC 传输。
- 上传期间界面仍可操作，只显示轻量上传状态。
- 所有新增 UI 使用现有 shadcn/Radix 组件和 Tailwind token，不新增自定义颜色、渐变、卡片套卡片或冗余说明文案。
