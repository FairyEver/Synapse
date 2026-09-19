# 手机端录音 · 实施计划

> 配套文档：`产品设计文档.md`（口径与验收基线）、`原型.html`（可点）
> 目标：手机端「录音」Tab 具备真实录音能力，与电脑端对齐，并接进 iOS 系统。
> **一次性做完**，但每个阶段结束都要能独立验证，不要攒到最后一起测。

---

## 总览

| 阶段 | 内容 | 动到的包 | 是否可单独砍掉 |
|---|---|---|---|
| 0 | 开工前的核对，含最高风险项（Xcode 工程） | — | 否 |
| 1 | 采集与上传（无界面，可单测） | SynapseMobile | 否 |
| 2 | 录音页 | SynapseMobile | 否 |
| 3 | 列表：加号、滚动行为、长按菜单、左滑删除 | SynapseMobile | 否 |
| 4 | 详情页：语音 / 文字两个视图 | SynapseMobile | **是**（决策一，砍掉就只剩文字） |
| 5 | 系统集成：实时活动、灵动岛、控制中心、快捷操作 | SynapseMobile + 新扩展 | **是** |
| 6 | **跨端收尾归属**（不改就会出 bug） | server + desktop + SynapseMobile | **否** |
| 7 | 文案、文档与收尾 | server + docs + 根目录 | 否 |

阶段 4 和阶段 5 都可以整块砍掉而不影响其余部分。砍之前问一次用户。

**先做阶段 0，尤其 0.3。** 扩展 target 能不能建出来，决定阶段 5 的形态；它建不出来不影响阶段 1–4，但越早知道越好。

---

## 阶段 0：开工前的核对

### 0.1 读文档

按仓库 `CLAUDE.md` 的必读路由，本任务至少要读：

- `docs/agents/repository-guide.md`（仓库结构、命令、打包）
- `docs/agents/execution-rules.md`（设计文档发现与验证方式）
- `docs/superpowers/specs/2026-09-19-meeting-recording-redesign-design.md`（**电脑端的口径，冲突时以它为准**）
- `docs/superpowers/specs/2026-09-19-meeting-recording-design.md`（旧设计，§3.5 / §3.6 / §4.6 仍然有效）
- `SynapseMobile/README.md`

### 0.2 核对现状

跑一遍 `产品设计文档.md` 第 2 节的表格，逐条对照代码确认，**不要凭印象**。特别确认：

- `Features/Meeting/` 的四个文件和它们的职责
- `Features/Voice/` 是**另一件事**（终端输入栏的按住说话），不要复用不要改
- 服务端那 11 个接口的真实形状（`server/src/meeting/meeting.controller.ts`）
- `Theme.swift` 里有哪些语义色可用

### 0.3 建 Widget 扩展 target（最高风险）

灵动岛、实时活动、控制中心控件只能放在 WidgetKit 扩展里。`SynapseMobile.xcodeproj` 是**手维护的**，仓库里没有 XcodeGen / Tuist。

按这个顺序试：

1. **`gem list xcodeproj`** —— 有的话写一个一次性脚本用 `xcodeproj` gem 加 target 和 embed phase，这是最可控的一条路。
2. **在 Xcode 里手动建** target（File → New → Target → Widget Extension，**不要勾 "Include Live Activity"** 之外的东西，不要勾 Configuration Intent）。建完 `git diff` 看 pbxproj 变了什么，记下来。
3. **手改 project.pbxproj** —— 只有前两条都不通才走。改完必须 `xcodebuild -list -project SynapseMobile.xcodeproj` 和一次完整 build 都过。

**无论走哪条路，建完先跑一次 `pnpm mobile:build` 确认打包没坏**，再往下做。扩展的 bundle id 必须是主 App bundle id 的前缀，`ExportOptions.plist` 可能要跟着改。

**如果三条路都不通**：停下来，告诉用户阶段 5 做不了，把其余阶段做完。不要为了建 target 反复折腾把工程弄坏。

### 0.4 确认签名

免费开发者账号下，多一个扩展会多消耗一个 App ID。确认用户的账号能不能承受；不能的话同样停下来问。

---

## 阶段 1：采集与上传（无界面，可单测）

这一阶段**不出任何界面**，全部逻辑可单测。

### 新增文件

| 文件 | 职责 |
|---|---|
| `SynapseMobile/SynapseMobile/Features/Meeting/MeetingRecorder.swift` | `AVAudioRecorder` 采 AAC/m4a。**64 kbps、单声道、16 kHz**（腾讯云引擎要求 `ChannelNum=1`）。暴露音频电平给界面画波形 |
| `SynapseMobile/SynapseMobile/Features/Meeting/MeetingRecordingBlocks.swift` | **纯逻辑、不认识 View、可单测**：分片切分、时长估算、`peaks` 计算与 base64 编码、文件名与路径规则 |
| `SynapseMobile/SynapseMobile/Features/Meeting/MeetingUploader.swift` | 分片上传。三条不变量：按编号顺序传、同一时刻只有一次在传、取消走**中止**而不是删除 |
| `SynapseMobile/SynapseMobile/Features/Meeting/MeetingPermission.swift` | 麦克风权限申请与三态（未决 / 已授权 / 被拒） |

### 改动的文件

**`SynapseMobile/SynapseMobile/Core/Networking/APIClient.swift`** —— 加四个方法，路径见 `产品设计文档.md` 第 2 节的接口表：

- `startMeetingRecording(title:startedAt:)` → `POST /meetings/recordings`
- `uploadMeetingPart(recordingId:partNumber:bytes:)` → `PUT /meetings/recordings/:recordingId/parts/:partNumber`，**裸字节，不套 multipart**
- `completeMeetingRecording(recordingId:durationMs:peaks:)` → `POST /meetings/recordings/:recordingId/complete`
- `cancelMeetingRecording(recordingId:)` → `DELETE /meetings/recordings/:recordingId`

`APIClient` 是 `actor`，出口只有 `send(path:method:)` 和 `send(path:method:body:)`。分片那条要发裸 `Data`，可能需要给 `perform` 加一个接受原始 body 的入口——**如果现有的两个出口装不下，加一个窄的、类型化的方法，不要绕开 `APIClient` 自己拼 URLSession**。

**`SynapseMobile/SynapseMobile/Info.plist`** —— 两处：

1. 加 `UIBackgroundModes: [audio]`，并**改写第 72 行那段注释**。它现在写着 "No UIBackgroundModes on purpose"，理由是「声称一个没人用的后台能力，App Review 会问」。新的理由要写成「录音在后台继续」，不要留一条自相矛盾的注释。
2. `NSMicrophoneUsageDescription` 现在是「用于把说的话转成文字填进终端输入框，以及录像时收录声音。」——**没提录音**，补上。

### 本地文件

录音落 `Application Support/` 下，**设置 `isExcludedFromBackup = true`**：音频是中间产物，服务端已有副本，不该占用户的 iCloud 备份。

`complete` 成功后删除本地文件；`cancel` 后也删。异常退出时文件留着，下次启动用来重算波形（见设计文档 6.4）。

### 测试

`SynapseMobileTests/MeetingRecordingBlocksTests.swift`、`SynapseMobileTests/MeetingUploaderTests.swift`。

**测试必须在坏的时候会红。** 至少覆盖：

- 分片在边界上的切分（正好 1 MB、1 MB + 1 字节、空）
- 上传中断后重传，已确认写入的区间不重传
- 取消走的是中止路径
- `peaks` 为空、全 0、全 255 三种极端

```bash
cd SynapseMobile
xcodebuild test -project SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileTests -parallel-testing-enabled NO
```

---

## 阶段 2：录音页

### 新增

`SynapseMobile/SynapseMobile/Features/Meeting/MeetingRecordingView.swift`

### 规格

见 `产品设计文档.md` §5.2。要点：

- **波形与电脑端同一套口径**：真数据、密度固定、贴右边缘从右往左长、只回看最近 5 秒、主题前景色。电脑端这份口径在旧设计 §3.6，明确继续有效，**不要自己发明一种波形**。
- 计时、提示行、取消 / 完成。**没有暂停按钮。**
- 提示行高度固定，不因为文案长短跳。
- 界面**任何位置都不体现上传**；只有分片上传失败才在提示行显示红色文案。
- 未取得麦克风权限时不阻断录音，走示意波形并明说。

### 中断处理（决策二）

监听 `AVAudioSession.interruptionNotification`：

- `.began` → 暂停采集，提示行写「录音已暂停，麦克风被其他应用占用」
- `.ended` 且 `shouldResume` → **自动继续录同一条**，提示行清空

用户不做任何操作，界面**不出现询问**。

### 最小化（决策四）

录音页可以下滑收起。收起后录音继续，App 内顶部出现一枚玻璃胶囊（计时 + 完成）。

---

## 阶段 3：列表

### 改动 `Features/Meeting/MeetingListView.swift`

- 导航栏右上角加号（`ToolbarItem(placement: .topBarTrailing)`，`Image(systemName: "plus")`）。**和终端一致**，见 `Features/Sessions/SessionListView.swift:65-78`。**不要做成悬浮按钮。**
- **这个加号没有禁用条件**，不要照抄终端的 `.disabled(...)`（终端依赖电脑在线，录音不依赖）。
- 点加号**直接进录音页**，不先起名字。
- 滚动时导航栏收起（`navigationBarTitleDisplayMode` / `.toolbar` 的默认行为即可，不要手写）。

### 手势

- 长按行 → **iOS 上下文菜单**（整行抬起 + 其余模糊 + 玻璃圆按钮浮在下方），用 `.contextMenu` 实现。里面三项：重命名 / 复制全文 / 删除。**不要做成底部动作表。**
- 左滑 → 删除（`swipeActions`）。
- 下拉刷新已有。

### `MeetingStore.swift`

加 `rename(_:to:)`、`delete(_:)`、`copyTranscript(_:)`。

---

## 阶段 4：详情页（可整块砍掉）

### 重写 `Features/Meeting/MeetingDetailView.swift`

现在的文件头注释写着「不做播放、不做编辑」——**这条注释要改掉**，它描述的是被推翻的旧结论。

两个平级视图，分段控件切换，切换**粘性**（切到别的录音仍保持当前视图）。转写失败时默认落在文字视图。

### 新增 `Features/Meeting/MeetingPlayback.swift`

`AVPlayer` + `GET /meetings/:meetingId/audio-url` 拿到的签名地址。整段铺满宽度的波形 + 播放头 + 播放键 + ±15 秒 + 当前/总时长。点波形跳转。

**没有**倍速、时间刻度、缩略图、当前句高亮。

波形数据来自 `GET /meetings/:meetingId/peaks`，是 **0–255 字节数组**，画之前要归一化到 0–1。电脑端在这里踩过坑：把字节当振幅画，整条被裁成实心方块（提交 `02797ce7a`）。**不要重犯。**

### 音频会话

播放和录音共用 `AVAudioSession`。播放时不要把 category 设成会掐掉录音的那个；从录音页进播放、从播放回录音都要能正常工作。

### 文字视图

一张卡片 + 自然段（`MeetingText.paragraphs` 已有，约 110 字一段）。底部悬浮「复制全文」玻璃胶囊，**没有文字时置灰而不是隐藏**。

---

## 阶段 5：系统集成（可整块砍掉）

### 5.1 扩展 target（阶段 0.3 的产物）

新增目录 `SynapseMobile/SynapseMobileLiveActivity/`：

| 文件 | 职责 |
|---|---|
| `RecordingActivityAttributes.swift` | `ActivityAttributes`，主 App 与扩展共用。**这份文件要同时加进两个 target 的 membership** |
| `RecordingLiveActivityWidget.swift` | 锁屏实时活动 + 灵动岛三态 |
| `RecordingControlWidget.swift` | 控制中心控件（iOS 18+） |

主 App 的 `Info.plist` 加 `NSSupportsLiveActivities`。

### 5.2 灵动岛三态

| 态 | 内容 |
|---|---|
| 紧凑 | 左：波形图标（`variableColor` 符效，跟着声音动）；右：计时 |
| 最小 | 一个圆点 |
| 展开 | 上排：App 图标 / 传感器挖孔 / 计时；中间：滚动波形；下面：取消、完成 |

### 5.3 锁屏实时活动

录音名 + 计时 + 波形 + 取消 / 完成。**按钮不解锁就能用**（`Button(intent:)`）。

### 5.4 App Intent（共用一份）

`SynapseMobile/SynapseMobile/Features/Meeting/MeetingIntents.swift`：

- `StartRecordingIntent` —— 控制中心控件、主屏快捷操作、Siri 都走它
- `StopRecordingIntent` / `CancelRecordingIntent` —— 实时活动上的按钮走它

### 5.5 主屏快捷操作

`UIApplicationShortcutItem`，「开始录音」排第一。挂在 App 的启动路径上（`SynapseMobileApp.swift` 或 AppDelegate）。

### 5.6 生命周期串联

新增 `Features/Meeting/MeetingLiveActivityController.swift`：开始录音时 `Activity.request`，暂停 / 恢复 / 结束录音时 update，收尾时 `end`。

---

## 阶段 6：跨端收尾归属（桌面端 + 服务端）

**这一阶段不能砍，也不是可选的。** 不做的话，手机和电脑会互相把对方正在录的那条强行收尾。完整机制见 `产品设计文档.md` §6.7 与决策七。

现状的两个事实：

- `GET /meetings/recordings/pending` 只按 `userId` 过滤，且 `findFirst({ orderBy: { updatedAt: "desc" } })` **只返回最新一条**（`server/src/meeting/meeting.service.ts:323-324`）
- 桌面端 `desktop/electron/bootstrap/descriptors.ts:697` 启动时**无条件**收尾；`runFinalize` 读不到本地残片也照样走到 `completeRecording`，带一个**空的 `peaks`**（`desktop/electron/modules/meeting/service.ts:189-198`）

### 6.1 规则

**只有本机还留着这次录音残片的那一端，才有权收尾它。**

- 桌面：本地 spool 目录里有这个 `recordingId` 的分片
- 手机：本地还有那次的 m4a 文件

### 6.2 服务端

`findPendingRecording` 现在只返回最新一条，必须改成能**按 `recordingId` 定位**（或返回全部）。否则桌面即便加了本地残片判断，只要手机那条更新，桌面就永远看不到自己那条，自己那条反而没人收尾。

`GET /recordings/pending` 跟着改。**线上还有旧版桌面端在调这个接口**——不能直接把返回类型从对象换成数组，那会让旧版桌面崩溃或静默失效。用加可选查询参数的方式扩展，保持无参调用的行为不变。

### 6.3 桌面端

`desktop/electron/modules/meeting/service.ts` 的 `runFinalize`：拿到 pending 后先看本地 spool，**没有残片就直接返回，不要走到 `complete`**。

这是本次**唯一的桌面端改动**，除此之外 `desktop/` 一行都不要动。

### 6.4 手机端

对称的一条：手机启动时的收尾逻辑，只处理本地还有 m4a 文件的那条。

### 6.5 已知代价

手机录到一半崩了、之后用户只开电脑，那条会一直是 pending、不会转写。服务端的 `cleanupStaleUploads` cron（每天 4:37）会兜底清掉碎片，但**不转写**。用户下次打开手机 App 就会正常收尾。

**接受这个代价，不要试图消灭它**——为了它加一套超时强制收尾，等于把刚修掉的「抢别人录音」又请回来。

### 6.6 验证

`产品设计文档.md` §9 的 38–41 条。这四条必须**两条链路都真跑一遍**，不能只看单测：

1. 手机开始录音，在电脑上打开 Synapse，手机那条不受影响
2. 桌面开始录音，在手机上打开 App，桌面那条不受影响
3. 两端各有一条未收尾的录音，各自启动后各自收尾自己那条，不串
4. 只有一端有残片时，另一端启动不会把它收尾

```bash
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/server run test
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run check:hard-constraints
```

---

## 阶段 7：文案、文档与收尾

### 7.1 服务端推送文案

`server/src/meeting/meeting-transcription.service.ts:346`：

```
转写已完成，逐字稿可以看了。   →   转写完成，文字可以看了。
```

「逐字稿」正是这次重构文案表里「一律不出现」的词，界面都改成「文字」了，只有这条推送漏在外面。**如果用户对这条文案另有选择，以用户为准。**

### 7.2 把设计资料落进仓库

按仓库既有惯例（`docs/superpowers/specs/` 放设计、`docs/superpowers/plans/` 放计划、`docs/prototypes/` 放原型）：

- `docs/superpowers/specs/2026-09-19-mobile-recording-design.md`
- `docs/superpowers/plans/2026-09-19-mobile-recording.md`
- `docs/prototypes/2026-09-19-mobile-recording.html`

### 7.3 更新被推翻的旧文档

这是 `CLAUDE.md` 的硬要求：「改变长期产品边界……必须同步更新对应规则文档；不要让规则与代码脱节。」

- `docs/superpowers/specs/2026-09-19-meeting-recording-design.md` §9 非目标里的「**手机端录音**」——删掉，注明 2026-09-19 被手机端录音那一版推翻
- `docs/superpowers/specs/2026-09-19-meeting-recording-redesign-design.md` §8 非目标里的「手机端录音（沿用旧 §9）」——同样处理；§4.7 里「手机端不做播放」也要改

### 7.4 `RELEASE_NOTES_PENDING.md`

面向用户写「得到什么、什么变了、修了什么」。不写代码路径、提交号、实现流水账。

三件事值得写：手机能录音了；录音进了锁屏和灵动岛；转写完成的推送文案从「逐字稿」改成「文字」。

### 7.5 检查清单

- `docs/agents/capability-registry.md` —— 本次**没有**动 System App / Dock / Workflow / Automation / MCP / Deep Link / `desktop/app-capabilities/`，确认一遍即可，不需要改
- `RELEASE_NOTES_PENDING.md` 里「Synapse 不会把声音存下来」那句**不要动**——它说的是手机端语音输入面板，与录音无关
- `APNS_USE_SANDBOX` **不要动**，固定 `false`

---

## 已知陷阱

这几条会让验证结果骗人，先看再动手。

**手机端单测会假红。** `AppConfigurationTests` 和 `SessionRestoreTests` 抢同一个全局，同一份代码可能一红一绿。**不要去改产品代码迁就测试。**

**SourceKit 单文件假红。** 编辑器里报 "Cannot find type X in scope" 是噪声。**只信 `xcodebuild` 的结果。**

**裸 `npx vitest` 会解析到缓存副本、静默少跑文件。** 服务端测试一律用 `pnpm --filter @synapse/server run test`。

**dev 的 tsc --watch 会静默卡死。** `dist-electron` 陈旧会让服务启动崩溃、看着像数据丢了。阶段 6 动了桌面端，改完如果行为不对，先按这条查一遍再怀疑逻辑。

**不要用 `chrome-devtools` MCP 调试手机端。** 那是 Electron 的东西，连不上。

---

## 验证命令

```bash
# 手机端编译
cd SynapseMobile
xcodebuild -project SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build

# 手机端单测（先跑后面那半，确认方案覆盖 SynapseMobileTests）
xcodebuild test -project SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileTests -parallel-testing-enabled NO

# 服务端（阶段 6 改了收尾查询，阶段 7 改了文案）
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/server run test

# 桌面端（阶段 6 改了 runFinalize，这是本次唯一动桌面端的地方）
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run check:hard-constraints

# 装到手机上验收（用户要求每单必含这一步）
pnpm mobile:install
```

**结尾一定要跑 `pnpm mobile:install` 装到用户的 iPhone 上。** 不要手拼 `xcodebuild` + `devicectl`，`install-ios.sh` 会打印这次装上去的版本号和构建号，用那个报数。

装的是开发包，**代价是收不到推送**——这是已知且接受的，不要为此去动网关。

---

## 交付物清单

- [ ] 阶段 0：扩展 target 建成，`pnpm mobile:build` 通过
- [ ] 阶段 1：采集、上传、权限，单测过
- [ ] 阶段 2：录音页可用
- [ ] 阶段 3：列表加号、长按菜单、左滑删除
- [ ] 阶段 4：详情两个视图，波形不是实心方块
- [ ] 阶段 5：灵动岛三态、锁屏实时活动、控制中心、快捷操作
- [ ] 阶段 6：**跨端收尾归属**——服务端能按 recordingId 定位、桌面只在本地有残片时收尾、手机对称处理；四条跨端验收真跑过
- [ ] 阶段 7：推送文案、三份文档入库、旧文档更新、`RELEASE_NOTES_PENDING.md`
- [ ] `产品设计文档.md` §9 的 **42 条**验收基线逐条走查
- [ ] `pnpm mobile:install` 装到用户手机上
