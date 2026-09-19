# 录音 · 两栏重构 实施计划

配套文档：

- 设计（权威）：本目录 `产品设计文档.md`
- 原型（可点）：本目录 `原型.html`
- 被修订的旧设计：`docs/superpowers/specs/2026-09-19-meeting-recording-design.md`

**冲突时以设计文档为准。**

---

## 总览

这是对**已经上线**的「会议记录」做重构（本次改名为「录音」，见设计文档 §3.9），不是从零做。所以每一步都带着"顺手把不要的东西清干净"的责任——不留死代码、不留没人调的接口、不留两端不一致的中间态。

工作顺序（内部顺序，不是交付阶段）：

```
0 服务端：整条删除        ← 先把删除这条数据路径打通
1 服务端：下线无用写入接口
2 主进程：异常退出的静默收尾
3 桌面端：两栏 + 两个视图   ← 界面主体
4 桌面端：清理死代码与类型
5 手机端：详情简化
6 文档与发布说明
7 端到端验收
```

**步骤 0–2 都在后端，可以连着做完再动界面。** 界面那一步（3）风险最高，前面通了再做。

---

## 步骤 0 · 服务端：整条删除

### 产物

新增 `DELETE /meetings/:meetingId`（`server/src/meeting/meeting.controller.ts`），语义是**删掉这条录音的全部**：录音、逐字稿、发言人、纪要。

服务端实现（`server/src/meeting/meeting.service.ts`）：

1. `requireMeeting(userId, meetingId)` 确认归属，别人的录音不能删。
2. **中止未完成的分块上传**（如果还有 `uploadId`）。
3. **删 COS 里的音频对象**（`meeting-recordings/<recordingId>`，走 `MeetingStoragePort.deleteObject`）。
4. `meeting.delete({ where: { id } })`——5 张子表全是 `onDelete: Cascade`，级联清完。

桌面端把它接出来：`desktop/electron/modules/meeting/service.ts` 新增 `deleteMeeting()`，`ipc.ts` 新增 `deleteMeeting`，preload bridge 暴露成 `meeting.entry.remove()`。

### 关键约束

- **可以直接抄 `cancelRecording`（`meeting.service.ts:410-420`），但它有一个缺陷不要抄**：录音已经完成（`uploadId` 已置 null）时它**不删对象**，会留一个孤儿 COS 对象。整条删除必须把"已完成的音频对象"和"未完成的分块上传"两条路都覆盖到。
- **对象删不掉不能让接口失败。** 参考现有 `deleteRecording` 的做法：删对象失败就记日志、留一个可重试的标记，对用户来说这次删除已经完成。别让用户卡在一个删不掉的记录上。
- **幂等**：不存在的 meetingId 返回 204，不要 500。
- **腾讯云侧不用管**：ASR 没有删除任务的 API，任务靠 `expiresAt` 自然过期。
- 旧的 `DELETE /:meetingId/recording`（只删音频）**保留**——历史数据里有 `status=deleted` 的记录，"录音被删"这个状态还要继续显示。桌面端不再调用它。

### 涉及文件

- `server/src/meeting/meeting.controller.ts`
- `server/src/meeting/meeting.service.ts`
- `server/src/meeting/meeting.service.spec.ts`
- `desktop/electron/modules/meeting/service.ts`、`ipc.ts`
- `desktop/electron/preload.ts`、`desktop/src/types/bridge.ts`

### 这一段做完要确认

- 删掉一条记录后，数据库里 5 张子表**都没有残留行**。
- COS 对象真的没了（不是只改了状态）。
- 录到一半就删的记录，留在桶里的分片被中止了（对比取消录音的行为）。
- 删别人的录音会被拒。

---

## 步骤 1 · 服务端：下线无用的写入接口

### 产物

这两条 HTTP 接口在重构后**没有任何调用方**，删掉：

| 接口 | 位置 |
|---|---|
| `PUT /:meetingId/speakers/:speakerId` | `meeting.controller.ts:174` |
| `PUT /:meetingId/minutes` | `meeting.controller.ts:199` |

对应的桌面端 IPC / bridge 一起删：

- IPC：`nameSpeaker`、`saveMinutes`、`generateMinutes`、`findPendingRecording`、`readSpooledParts`
- bridge：`entry.speakerName`、`entry.saveMinutes`、`entry.generateMinutes`、`recording.pending`、`recording.spooledParts`、`recording.remove`

### 关键约束

- **`GET /recordings/pending` 这条 HTTP 接口保留。** 主进程的静默收尾要用它（步骤 2），删掉的只是暴露给渲染进程的 IPC。
- **DTO 字段一个都不要删。** `speakers`、`minutes`、`segments` 里的 `speakerId` / `startMs`，服务端继续照常返回，只是两端界面不再渲染。原因见设计文档 §6.4：手机端 `MeetingDetail.speakers` / `segments` 是**非可选数组**，服务端一停返回，没升级的 App 详情页直接解码失败。
- `MeetingFinalizeInput.speakerCount` 不再上报（列表不显示发言人数了），但对应的 DTO 字段保留。
- `desktop/electron/generated/ipc-channels.generated.ts` 是生成物，跑生成脚本，不要手改。
- 改完同步更新 `docs/agents/capability-registry.md` 第 99 行的 IPC 数量和描述——那里写着"用于录音起止、分片上报、会议读写、**发言人与纪要保存**"（"会议读写"这个说法也要一并换成"录音读写"），数量也要从 16 重数一遍。

### 涉及文件

- `server/src/meeting/meeting.controller.ts`、`meeting.service.ts`
- `desktop/electron/modules/meeting/ipc.ts`、`service.ts`
- `desktop/electron/preload.ts`、`desktop/src/types/bridge.ts`
- `desktop/src/types/meeting.ts`、`hooks/use-meetings.ts`
- `docs/agents/capability-registry.md`

### 这一段做完要确认

- `desktop/electron/__tests__/preload.test.ts` 和 `electron/bootstrap/__tests__/descriptors.test.ts` 都跟着改了，不是被跳过。
- `electron/modules/meeting/__tests__/minutes.test.ts` 已删除（它 20 处引用纪要/发言人）。
- 服务端 `meeting.service.spec.ts`、`meeting-transcript-parser.spec.ts` 里引用被删接口的用例同步处理干净。

---

## 步骤 2 · 主进程：异常退出的静默收尾

### 产物

**行为**：录音过程中进程被杀、强退、更新重启，已经录到的部分按正常录音处理——自动收尾、进列表、照常转写。**界面上不出现任何询问。**

**现状**（这是"发现一段未完成的录音"那个询问的来源）：`spool.ts` 的 `sweepStaleSpools`（`spool.ts:95-119`）在启动时只删 24 小时以上的旧分片目录，**不通知服务端收尾**，所以服务端那条任务一直停在 `pending`，`GET /recordings/pending` 才查得出来，前端才有询问。

**做法**：`desktop/electron/modules/meeting/service.ts` 新增 `finalizePendingRecording()`：

```
findPendingRecording()
  → 逐片 uploadPart（读本机 spool 里未确认的 *.part）
  → completeRecording()
```

时长用 `pending.receivedBytes / (64_000/8) * 1000` 估算，`peaks` 传空串。这段逻辑**就是现在 `desktop/src/modules/meeting/index.tsx:118-144` 的 `resumePending`**，从渲染进程搬到主进程。

在 `desktop/electron/bootstrap/descriptors.ts` 的启动流程里调用它（挨着现有的 `sweepStaleSpools` 调用，`descriptors.ts:719-722`）。

**不新增任何 IPC。** 前端彻底不知道这件事存在，`index.tsx` 里的 `loadPending` / `resumePending` / `discardPending` 全部删掉。

### 关键约束

- **失败不能影响启动。** 收尾失败就记日志，应用照常起来。这一步在后台跑，不阻塞主窗口。
- **只跑一次**，注意并发保护。
- **`sweepStaleSpools` 保留**，它的职责（清 24 小时以上的旧目录）和收尾不冲突。
- 顺手摘掉 `minutesGenerator` 这个依赖（`service.ts:35`、`descriptors.ts:694-716`），纪要已经不要了。
- 已经认下的代价：这段录音会照常送去做转写，**0.8 元/时照算**，这是产品上明确要的。
- 已知缺陷：恢复回来的录音**没有波形**（波形只在内存里），语音视图会是一条平的线。这一版接受，不做特殊界面。

### 涉及文件

- `desktop/electron/modules/meeting/service.ts`、`spool.ts`
- `desktop/electron/bootstrap/descriptors.ts`
- `desktop/electron/modules/meeting/__tests__/service.test.ts`
- `desktop/src/modules/meeting/index.tsx`（删三件事）

### 这一段做完要确认

- 拿一次真实录音跑到一半强杀进程，重新打开：**没有任何询问**，那条记录已经出现在列表里，并且在转写或已转写完成。
- 收尾失败（比如断网）时应用能正常启动。

---

## 步骤 3 · 桌面端：两栏 + 两个视图

### 产物

`desktop/src/modules/meeting/index.tsx` 从"三个视图共用、按状态切换"改成**列表 + 详情同时在场**：

- 左栏永远是列表，右栏永远是选中那条的详情。**没有「返回」**。
- 打开模块时默认选中第一条。
- 录音页仍然接管整个内容区（录音时不给选列表）。

`meeting-list-view.tsx`：

- 整行可点，行内「⋯」是次要操作（点击**不能**触发选中）。
- 副标题只剩时间 · 时长，加状态（转写中 / 转写失败）。
- 去掉：`pendingNotice`（83-96）、`onResumePending` / `onDiscardPending`、发言人计数（40）。
- 左栏**没有任何标题、搜索、按钮、提示条**。

详情（重写 `meeting-detail-view.tsx`）：

- 头部：标题（可点就地重命名，回车提交 Esc 取消）+ 时间 · 时长 + 右侧「⋯」（重命名 / 删除）。
- 「语音」「文字」两个平级视图。**切换是粘性的**——切了第二条记录还停在原视图。唯一例外：转写失败的记录默认落到文字。
- 删除：行内和头部共用同一个菜单，确认框文案见设计文档 §4.8。删掉当前选中那条后自动选中剩下的第一条。

`meeting-playback.tsx`：

- 保留整段铺满的波形 + 播放头 + 点波形定位（这仍是**有意**和录音页那条滚动窗口不同）。
- **新增 ±15 秒**（原来刻意不做，现在放开）。
- 删掉 `seekToMs`（23、73-81）和 `onSeekHandled`——时间戳跳转的入口没了，这个参数没有意义了。
- **不加**倍速、不加刻度尺、不加"当前这句"浮条（原型里做过，用户明确说不要）。

文字视图：把 `segments` 的文本按句子并成自然段（约 110 字一段）渲染。**没有**搜索、发言人、时间戳、纪要。

`globals.css` 新增列表选中色 token：当前主题里 `--muted` 同时用作 hover 和选中，区分不开（`--accent` / `--secondary` / `--sidebar-accent` 都是同一个值）。按 `.claude/rules/design.md` 的口径加一个正式 token（原型里暂用 `--selected`，浅色 `oklch(0.945 0 0)`、深色 `oklch(0.3 0 0)`），不要在页面里写死。

**改名（桌面端这一半）**：全站不再叫「会议」，统一叫「录音」，对照表在设计文档 §3.9。桌面端要改的是：

| 文件 | 现在 | 改成 |
|---|---|---|
| `app-definition.ts:7-8` | `name` / `windowTitle` = 会议记录 | 录音 |
| `index.tsx:175,211` | 模块页标题 = 会议记录 | 录音 |
| `meeting-list-view.tsx:74,106` | 读不到会议记录 / 还没有会议记录 | 读不到录音 / 还没有录音 |
| `hooks/use-meetings.ts:39,72` | 读取会议列表失败 / 读取会议失败 | 读取录音列表失败 / 读取录音失败 |

**代码内部命名不动**（表名 `Meeting`、接口 `/meetings`、模块目录 `modules/meeting/`），理由见设计文档 §3.9，别顺手改。

### 关键约束

- **录音页完全不动。** 波形密度固定、贴右边缘从右往左长、5 秒窗口，这些是返工过一次的坑。
- **界面任何位置都不出现**「云盘」「上传」「云端」「服务器」。
- 用 shadcn 现有组件和主题 token，不引入自定义颜色。
- 转写失败要就地给出原因 +「重试」，重试不重新上传。

### 涉及文件

- `desktop/src/modules/meeting/index.tsx`、`meeting-list-view.tsx`、`meeting-detail-view.tsx`、`meeting-playback.tsx`
- `desktop/src/styles/globals.css`
- `desktop/src/modules/meeting/hooks/use-meetings.ts`

### 这一段做完要确认

对照设计文档 §7 的验收基线逐条过，重点是 1–9 条和 15–17 条。

---

## 步骤 4 · 桌面端：清理死代码与类型

### 产物

- **整文件删除**：`desktop/src/modules/meeting/meeting-minutes-view.tsx`（270 行）。
- `desktop/src/types/meeting.ts`：清掉桌面端不再用的类型。
- `desktop/src/modules/meeting/hooks/use-meetings.ts`：删 `nameSpeaker`（101-103）、`removeRecording`（录音不再单独删）。
- `shared/src/meeting.ts`：**只删确实没人用的**。`MeetingMinutesDto` / `MeetingSpeakerDto` 等要留着——服务端还在返回，手机端还在解码（见设计文档 §6.4）。
- `formatMeetingClock` 如果两端都不再用可以删，删之前全仓搜一遍。

### 关键约束

- **删之前先搜调用方。** 这一层最容易删多：共享类型被服务端和 iOS 一起用，桌面端不用不等于没人用。
- 桌面端 `meeting` 模块内部没有视图测试，删完靠 typecheck + 手动验收兜底。

### 这一段做完要确认

```bash
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/server run test
```

---

## 步骤 5 · 手机端：详情简化

### 产物

`SynapseMobile/SynapseMobile/Features/Meeting/MeetingDetailView.swift`：

- 删掉「纪要 / 逐字稿」分栏（72-149），只留**一段文字**。
- 去掉发言人标签、时间戳、搜索（127、151-155）。
- 保留失败原因展示。

`SynapseMobile/SynapseMobile/Features/Meeting/MeetingListView.swift`：副标题去掉发言人数（同目录 `MeetingModels.swift:117-123`）。

**改名（手机端这一半）**：底部 Tab 的 `Label("会议", systemImage: "waveform")` 改成 `Label("录音", ...)`（`Features/Root/RootView.swift:77`）；`MeetingListView` 的 `navigationTitle("会议记录")` → 「录音」、空状态「还没有会议记录」→「还没有录音」；`MeetingDetailView:25` 的标题兜底「会议」→「录音」；`MeetingStore:34,54` 的两条错误提示改成「读取录音失败。／读取录音详情失败。」。**`Tab.meetings`、`meetingPath` 这些内部名字不动。**

**保留不动**：列表、状态徽标、转写中每 5 秒自动刷新（39-43）、转写完成推送。

**不做播放**（沿用现状，详情页注释里写明了不做）。

### 关键约束

- **不要动 `MeetingModels.swift` 里的 DTO 字段和可选性。** 详情页的 `speakers` / `segments` 是非可选数组，这是旧版本 App 能不能解码的关键（设计文档 §6.4）。只动视图层。
- 文字分段规则和桌面端保持一致（按句并成自然段），两端看起来才是同一份东西。

### 涉及文件

- `SynapseMobile/SynapseMobile/Features/Meeting/MeetingDetailView.swift`、`MeetingListView.swift`

### 这一段做完要确认

```bash
xcodebuild test -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileTests -parallel-testing-enabled NO
```

跑模拟器前先 `open -a Simulator` 并保持窗口开着。源码级"找不到类型"的红是 SourceKit 噪声，只信 `xcodebuild`。

---

## 步骤 6 · 文档与发布说明

### 产物

- `docs/agents/capability-registry.md` 第 99 行：meeting 的 IPC 数量（16 要重数）和描述——里面"发言人与纪要保存"这半句要删。
- `RELEASE_NOTES_PENDING.md`：**改写录音那一段**（现在开头就叫「会议记录」，名字也要换）。现在那段（第 5 行起）写的是"按发言人分段""一键把纪要整理成议题、结论和待办""删除后列表里会写明录音已删除"——全部作废，要按新形态重写。面向用户说"得到什么、什么变了"，不写代码路径和提交号。
- 四件套**已经落到仓库**了，不用再搬：
  - `docs/prototypes/2026-09-19-meeting-recording-redesign.html`
  - `docs/superpowers/specs/2026-09-19-meeting-recording-redesign-design.md`
  - `docs/superpowers/plans/2026-09-19-meeting-recording-redesign.md`

### 关键约束

- `RELEASE_NOTES_PENDING.md` 里「Synapse 不会把声音存下来」那句**不动**（它的适用范围是手机端语音输入面板）。
- 发布说明要如实写出"纪要没了"这件事——把已经上线的能力删掉，必须在给用户的说明里讲清楚，不能悄悄消失。

---

## 步骤 7 · 端到端验收

### 验证

1. 设计文档 §7 的**每一条**逐条过，不要只跑测试就收工。
2. 一次真实录音走完：录 → 完成 → 转写 → 在列表和两个视图里看 → 删除。
3. 异常退出演练：录音中途强杀进程，重开确认静默收尾；断网情况下确认不影响启动。
4. 手机端连生产/测试服务端，确认录音 Tab 的列表和一段文字都对。
5. **拿旧版本的 App 连改过之后的服务端**，确认详情页还能打开（设计文档 §7 第 21 条）。

---

## 交付前必须成立

- `pnpm --filter @synapse/desktop run typecheck / test / check:hard-constraints` 全绿。
- `pnpm --filter @synapse/server run test` 全绿。
- iOS 测试全绿。
- 全仓搜 `minutes`、`speaker`、`纪要`、`发言人`，**桌面端和手机端不应再有渲染它们的地方**；服务端搜出来的只剩 DTO 字段和数据表（那是**故意保留**的，见设计文档 §6.4）。
- **全仓搜「会议」**：桌面端和手机端**一处都不该剩**（用户可见文案、注释、文档都要干净）；`server/src/meeting/`、`desktop/electron/modules/meeting/` 这些内部目录名和表名除外。
- **手机底部 Tab 是「终端 / 录音 / 需要我 / 我的」**，四个字宽一致，没有换行或截断。
- `check:packaged-asar` 如果打包边界有变化要跑。
- `RELEASE_NOTES_PENDING.md` 已改写，`docs/agents/capability-registry.md` 已更新。
- **装到李杨的 iPhone 上**：`pnpm mobile:install`（手机连数据线并解锁）。装的是开发包，收不到推送是已知且接受的代价，不要为此动推送网关。

---

## 提交怎么切

一次重构切成**六个提交**，每个都能独立站住：

1. `feat(meeting): 删除整条录音的服务端接口`
2. `refactor(meeting): 下线发言人与纪要的写入接口`
3. `fix(meeting): 录音异常退出后自动收尾，不再询问用户`
4. `refactor(meeting): 录音改为列表加详情的两栏布局，并去掉「会议」叫法`
5. `refactor(mobile): 录音详情简化为一段转写文字，底部 Tab 改名`
6. `docs(meeting): 两栏重构的设计、计划与发布说明`

**不要一个巨大的提交。** 步骤 1 和 4 的"删除"要单独成提交，将来要回滚哪一层看得清。

**改名不单独成提交**，跟着它改到的文件走：桌面端那半进第 4 个，手机端那半进第 5 个。为一个词条拆一次提交不值得，而且改的是同一批文件。
