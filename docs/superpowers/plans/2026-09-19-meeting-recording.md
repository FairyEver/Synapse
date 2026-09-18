# 会议记录 · 实施计划

> 设计（权威）：`~/Desktop/会议记录功能设计/产品设计文档.md`；仓库副本 `docs/superpowers/specs/2026-09-19-meeting-recording-design.md`
> 原型（可点）：`~/Desktop/会议记录功能设计/原型.html`；仓库副本 `docs/prototypes/2026-09-19-meeting-recording.html`
> **冲突时以设计文档为准。**

**这是一次连续执行的任务，不是分阶段交付。** 下面的「步骤」是同一次执行内部的工作顺序，用来划分范围和验收点，**不是七个可独立交付的阶段**。任何一步做完都不停下来，全部做完再一次性交付。

---

## 总览

| 步骤 | 做什么 | 涉及包 | 这一段的验收点 |
|---|---|---|---|
| 0 | 数据模型：会议、录音、转写任务、上传分片、逐字稿段落、说话人 | `server` | 迁移可跑、风险扫描通过 |
| 1 | 存储：分片接收、分块上传、中止、下载签名 | `server` | 分片能拼成完整对象、中止后不留碎片 |
| 2 | 腾讯云：提交任务、轮询取结果、落库 | `server` | 真实录音能出逐字稿 |
| 3 | 桌面端录音链路：编码切片 + 振幅 + 边录边传 | `desktop` | 波形行为对、取消不留残留 |
| 4 | 桌面端界面：列表、录音页、详情、回放 | `desktop` | 26 条验收基线里的界面部分成立 |
| 5 | 纪要生成：接 Agent | `desktop` + `server` | 能一键出议题/结论/待办 |
| 6 | 通知与手机端查看 | `server` + `SynapseMobile` | 手机能收到并看到逐字稿 |
| 7 | 端到端验收 | — | 26 条逐条成立 |

四件事先说清楚：

1. **步骤 0–2 是一个整体，中间不要停。** 没有表就存不下任务，没有存储就提交不了任务，不提交任务就没有结果收。三段可以挨着提交，但别做一段就停手。
2. **步骤 1 是唯一没有先例的部分。** 全仓没有分块上传的先例，SDK 也签不了分片地址（设计文档 §6.1）。风险最高，先把它跑通再动界面。
3. **步骤 3 的波形先用原生画布把行为做对**（密度固定、右对齐、5 秒窗口），行为验过再进步骤 4 接界面。行为没对就接界面，出了偏差分不清是谁的问题。
4. **每个检查点提交一次**，防止工作丢失——**但提交不是停下的理由**，提交完继续往下做，不要回来汇报。

---

## 步骤 0 · 数据模型

### 产物

`server/prisma/schema.prisma` 新增六张表，迁移放 `server/prisma/migrations/<timestamp>_meeting/migration.sql`：

- `Meeting`：标题、开始时间、时长毫秒、状态（`transcribing` / `done` / `failed`）、用户。
- `MeetingRecording`：对象路径、格式、字节数、时长、删除状态。形状对齐现有的 `DocumentHostedImage`。
- `MeetingTranscriptionJob`：任务号、引擎、参数快照、重试次数、提交与完成时间、失败原因、分块上传 ID。
- `MeetingUploadPart`：`jobId + partNumber + etag + size`。
- `MeetingTranscriptSegment`：说话人编号、起止毫秒、文本、词级时间戳。
- `MeetingSpeaker`：说话人编号到真名的映射，一场会议一条。

`shared/src/meeting.ts` 新增桌面端与手机端共用的 DTO 与状态枚举。

### 关键约束

- **新列一律可空或带默认值。** `server/src/deploy-migration-risk.spec.ts` 会把新增的 NOT NULL 列判为高风险，现有 `pushToken` 全 nullable 就是这个原因。
- 表名用 Prisma 默认的 PascalCase，**不加前缀**——仓库没有表前缀约定。
- `MeetingTranscriptionJob` 单独建表而不是把状态塞进 `Meeting`，是为了让重试、并发控制和失败排查有地方落。形状照抄 `SkillRepositoryObjectCleanupTask`（建表当队列 + `@Cron` 消费）。
- 分片清单用独立表而不是 Json 列，便于与 etag 校验、精确中止对齐。
- **任务号不能当业务唯一 ID**：腾讯云明确不同日期可能重复 `TaskId`。

### 涉及文件

- `server/prisma/schema.prisma`
- `server/prisma/migrations/<timestamp>_meeting/migration.sql`
- `shared/src/meeting.ts`

### 这一段做完要确认

```bash
pnpm --filter @synapse/server run test          # 含 deploy-migration-risk 扫描
```

---

## 步骤 1 · 存储：分片接收与分块上传

### 产物

`server/src/meeting/meeting-storage.service.ts` 新增：

- `initUpload(recordingId)`：在对象存储上开启一次分块上传，拿回 `uploadId`，写进任务记录。
- `acceptPart(recordingId, partNumber, stream)`：接收一个分片并写进对象存储的对应区间；校验字节数与累计偏移。
- `completeUpload(recordingId)`：合并成单文件；回查对象大小与文件头。
- `abortUpload(recordingId)`：**中止**这次分块上传，丢弃已传分片。
- `createDownloadUrl(key, ttl)`：给腾讯云用的下载签名地址。

对应的 HTTP 路由加在 `server/src/meeting/meeting.controller.ts`。桌面端的调用经 `desktop/electron/modules/meeting/ipc.ts` 过桥。

### 关键约束

- **必须走服务端代理分片。** 当前 SDK 的 `getObjectUrl` 签名动作写死成整文件的读或写，签不了 UploadPart；不要在这上面绕。
- **`abortUpload` 是新写的，不能拿 `deleteObject` 顶替。** 未完成的分块上传留在桶里的分片，`deleteObject` 删不掉，会一直按量计费。这是本次最容易漏的一条。
- 对象路径必须是 `meeting-recordings/${recordingId}`，与 `document-images/` 平级。
- 未配 COS 时会回退本地盘。**本地回退的 token 表是纯内存 Map，重启即丢**，续传场景要先补持久化，参照 `server/src/drive/drive-storage.ts` 的 `.tokens/uploads/*.json` 做法。
- `createDownloadUrl` 是新增能力：现有平台媒体存储只有上传签名和「经服务端流式转发」两条路。
- 音频字节过一次服务端是可以接受的（28 MB/小时），**不要为了省这点带宽去自建客户端直传签名**。
- **不要引入 ffmpeg**：仓库里没有，分片合并由对象存储自己完成。

### 涉及文件

- `server/src/meeting/meeting-storage.service.ts`
- `server/src/meeting/meeting.controller.ts`
- `server/src/meeting/meeting.module.ts` + 在 `server/src/app.module.ts` 注册
- `server/src/meeting/meeting-storage.spec.ts`（分片乱序被拒；中途 abort 后对象不存在；完整上传后对象大小等于各分片之和）
- `desktop/electron/modules/meeting/ipc.ts`
- `desktop/electron/preload.ts`、`desktop/src/types/bridge.ts`、`desktop/electron/generated/ipc-channels.generated.ts`（跑 `pnpm --filter @synapse/desktop run generate:ipc` 重新生成）

### 这一段做完要确认

```bash
pnpm --filter @synapse/server run test
pnpm --filter @synapse/desktop run typecheck
```

---

## 步骤 2 · 腾讯云提交与轮询

### 产物

`server/src/meeting/meeting-transcription.service.ts`：

- `submit(meetingId)`：调 `CreateRecTask`，参数见设计文档 §4.6。
- `poll()`：`@Cron` 定时扫 `pending` 且未超期的任务，调 `DescribeTaskStatus` 取结果。
- 结果解析：按段落落 `MeetingTranscriptSegment`，`speakerId` 落 `MeetingSpeaker`。

### 关键约束

- 参数一个都不能省：`ChannelNum=1`（16k 传 2 会被直接拒绝）、`SourceType=0`、`SpeakerDiarization=1`、`SpeakerNumber=0`（16k 引擎不支持指定人数）、`ResTextFormat=1`。
- **不要传 `ResTextFormat=4` 或 `5`**：语义分段和口语转书面语只支持 `8k_zh`/`16k_zh`，我们的引擎不支持，传了会失败或静默降级。
- **不要传 `SpeakerDiarization=3`**：角色分离需要声纹且只支持另两款引擎。
- `TaskId` 有效期 24 小时，结果一旦取回立即落库；超期未取回的重试一次。
- 轮询是主用路径，**不依赖回调**：回调需要服务端有公网地址，且丢失后没有兜底。
- 腾讯云的密钥不落桌面端，签名与调用全在服务端。
- 提交前检查时长上限 5 小时，超过要切分。
- **缺凭据时的处理**：把配置项加进 `server/.env.example` 占位，代码照常写完，在最终汇报里列出「需要配置但未配置」的清单。不要因为没配 key 就停下来。

### 涉及文件

- `server/src/meeting/meeting-transcription.service.ts`
- `server/src/meeting/meeting-transcription.worker.ts`
- `server/src/meeting/meeting-transcription.spec.ts`（提交参数快照；结果解析；失败重试；超期不重试）
- `server/.env.example` 补配置项（若与现有 `TENCENT_ASR_*` 不共用）

### 这一段做完要确认

```bash
pnpm --filter @synapse/server run test
```

再拿一段真实录音端到端跑一次，确认能拿到逐字稿、说话人编号和词级时间戳。

---

## 步骤 3 · 桌面端录音链路

### 产物

`desktop/src/modules/meeting/` 新增：

- `recorder.ts`：`getUserMedia` → 编码器每 2 秒切片 + `AnalyserNode` 每 28 毫秒取振幅。
- `chunk-uploader.ts`：字节攒到 1 MB 传一片；结束时补尾片；取消时调中止。
- `peak-store.ts`：振幅数组的持有与切片。
- `waveform.ts`：波形渲染，行为照设计文档 §3.6。

### 关键约束

- **不要改 `desktop/src/modules/voice/` 的任何文件。** 那是实时语音输入的链路，和本功能无关，动它会连带影响按住说话。
- **不要用 AudioWorklet**：`file://` 下 `addModule` 会失败，且开发环境看不出来（设计文档 §6.3）。
- 同一路麦流要同时喂给编码器和分析节点，**不要开两次 `getUserMedia`**。
- 临时分片落盘沿用既有约定：`os.tmpdir()` 下的 `synapse-<用途>-` 前缀目录，参照 `drive-sync-staging` 的「userData 下持久 staging + stale sweep」做法。**不要直接裸用 `fs.writeFile`**，走现有的临时目录工具，创建即登记、失败即回滚。
- 自动清理本机临时文件：上传确认后删本机分片；进程退出后由 stale sweep 兜底。
- **波形密度固定**，一个采样占固定宽度；不要按画布宽度拉伸（这是返工过一次的坑）。
- **纯原生画布，不新增依赖。**
- **界面不出现任何上传相关状态**（设计文档 §3.10）。

### 涉及文件

- `desktop/src/modules/meeting/recorder.ts`
- `desktop/src/modules/meeting/chunk-uploader.ts`
- `desktop/src/modules/meeting/peak-store.ts`
- `desktop/src/modules/meeting/waveform.ts`
- `desktop/src/modules/meeting/__tests__/`（分片边界；取消后不中止的反证；振幅归一化；上传进度与录音时长无关）

### 这一段做完要确认

```bash
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
```

手点：对着麦克风说话，波形有反应；录久了密度不变、旧的从左边滚出去。

---

## 步骤 4 · 桌面端界面

### 产物

- `desktop/src/modules/meeting/`：`app-definition.ts`、`app-manifest.ts`、`index.tsx`、列表页、录音页、详情页。

### 关键约束

- 注册要动四个文件，缺一个的表现是入口不出现：
  1. `desktop/src/modules/apps/types.ts` — `SYSTEM_APP_IDS` 与 `SynapseSystemAppNamespace` 各加一项
  2. `desktop/src/modules/apps/registry.ts` — `systemApps` 加 manifest
  3. `desktop/src/modules/apps/definitions.ts` — `systemAppDefinitions` 加 definition
  4. `desktop/src/modules/apps/components/system-app-content.tsx` — if 链加一支
- 样板照 `desktop/src/modules/drive/app-definition.ts`（11 行）。
- **配色只用主题 token，不引入自定义颜色**。波形、播放头、播放图标全部用 `--foreground`。
- 回放那条波形是整段铺满宽度，**与录音中那条滚动窗口不同**，这是有意的，不要顺手统一。
- 新增入口后同步维护 `docs/agents/capability-registry.md` 的表格、数量和例外说明。
- 文案严格照设计文档 §4.5 的文案表，**不出现云盘、上传、云端、服务器**。

### 涉及文件

上面列的四个注册文件 + `desktop/src/modules/meeting/**` + `docs/agents/capability-registry.md`

### 这一段做完要确认

```bash
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
```

---

## 步骤 5 · 纪要生成

### 产物

转写完成后，详情页可一键生成纪要，走现有 Agent 能力。结果落库并在详情页编辑。

### 关键约束

- **不要买腾讯云的「口语转书面语」增值服务**：那项只支持通用引擎，用不了我们选的会议引擎。
- 复用现有 Agent 会话能力，不要为纪要新写一套模型调用。

### 这一段做完要确认

拿一段真实转写跑一次，确认纪要有议题 / 结论 / 待办三段且可编辑。

---

## 步骤 6 · 通知与手机端查看

### 产物

- 服务端：转写完成后 `LiveDesktopGateway.broadcastToUser` 通知桌面端；不在线时 `MobilePushService` 发手机推送（新增一个 category）。
- 手机端：`SynapseMobile/SynapseMobile/Features/Meeting/`，加进 `RootView.swift` 的 tab，store 挂 `App/SynapseAppModel.swift`。

### 关键约束

- **手机端直连服务端拉数据**，不经过现有的终端中继链路——转写发生在云端，不依赖桌面端在线。这是本功能与手机端既有「电脑的远程视图」定位最大的不同。
- 推送 category 要新增，现在只有终端审批一个。
- 手机端本轮**只做查看，不做录音**。
- Xcode 工程用 `PBXFileSystemSynchronizedRootGroup`，**新增 .swift 文件丢进目录即自动进 target**，不需要改工程文件。

### 涉及文件

- `server/src/mobile-live/mobile-push.service.ts`（新增 category 与 payload）
- `SynapseMobile/SynapseMobile/Features/Meeting/**`
- `SynapseMobile/SynapseMobile/Features/Root/RootView.swift`
- `SynapseMobile/SynapseMobile/App/SynapseAppModel.swift`

### 这一段做完要确认

```bash
pnpm --filter @synapse/server run test

xcodebuild test -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileTests -parallel-testing-enabled NO
```

---

## 步骤 7 · 端到端验收

### 验证

按设计文档 §8 的 26 条**逐条验**，不要只跑测试就收工。

必须真机跑的：

- 录一场真实会议（至少 10 分钟），确认波形密度不随时长变化、旧的从左边滚出去；
- 录完点「完成」，确认瞬间回到列表、没有上传页；
- 关掉电脑再打开，确认转写仍在推进、结果还在；
- 转写完成后手机端能收到推送并看到逐字稿；
- 删除录音后重新打开，确认逐字稿和纪要还在、播放区显示已删除。

---

## 交付前必须成立

- 设计文档 §8 的 26 条逐条成立；
- 新增的测试能在坏的时候变红——至少对「取消后不中止分块上传」「波形改回按宽度拉伸」「删掉 16k 引擎的 `ChannelNum=1`」各反证一次；
- `RELEASE_NOTES_PENDING.md` 已更新（用户可感知的变化，按「得到什么、什么变了」写，不写代码路径和提交号）；
- `docs/agents/capability-registry.md` 已更新；
- 设计文档里的三条已定口径（不改「不存声音」原句、不显示「可以关闭电脑」、波形不加依赖）与实现一致；
- 装机：`pnpm mobile:install`，安装到用户的 iPhone。

## 提交怎么切

每个检查点提交一次，防止工作丢失。**提交不是停下的理由**，提交完继续做下一步。

| 提交 | 内容 |
|---|---|
| 1 | 步骤 0 + 1：数据模型与存储，含中止分块上传 |
| 2 | 步骤 2：腾讯云提交与轮询 |
| 3 | 步骤 3：桌面端录音链路与波形 |
| 4 | 步骤 4：桌面端界面 |
| 5 | 步骤 5：纪要生成 |
| 6 | 步骤 6：通知与手机端 |
| 7 | 步骤 7 的回归测试补充与文档同步 |
