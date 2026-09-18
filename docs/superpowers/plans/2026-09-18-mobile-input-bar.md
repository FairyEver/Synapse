# 手机端输入栏重构 · 实施计划

> 权威设计见 `docs/superpowers/specs/2026-09-18-mobile-input-bar-design.md`。**决策、非目标、验收基线都以它为准**，本文件只回答"分几步做、每步改哪、怎么验"。
> 界面原型：`docs/prototypes/2026-09-18-mobile-input-bar.html`（仓库内路径）。
> 代码锚点已在 2026-09-18 逐个核过（行号为当日 `main`）。

---

## 总览

| 阶段 | 内容 | 能不能单独上线 |
|---|---|---|
| 0 | 纯值：手势判定 + 按住式的呈现规则 + 单测 | 不能（还没有视图用它） |
| 1 | 结构：四格重排（切换键 + ＋ 右移），语音态占位 | 能，但此时按切换键只是换个样子 |
| 2 | 按住式接通：手势、气泡、预检、落地 | 能 —— 到这里功能就完整了 |
| 3 | 失败与边界：断网、中断、长时间输入、按下即松 | 与阶段 2 一起发 |
| 4 | 真机验收与装机 | — |

**本次不涉及服务端、桌面端、协议与权限**，没有跨端升级顺序，不需要服务端先发。

每个阶段独立验证、独立提交。**不要攒到最后一次提交。**

---

## 先定一件事：点击式在 iOS 端删掉

设计文档 §3.1 选定 iOS 用按住说话。那么现在这套点击式的录音呈现就没有产品路径了：

- `VoiceInputPresentation`（`VoiceInputBar.swift:300`）的 `RightKey.confirm / confirmDisabled / retry / retryDisabled`；
- `TerminalScreen.swift` 里的 `transcription(_:)`（`:654`）、`rightKey`（`:682`）的 confirm/retry 分支；
- 无障碍标识 `voice-cancel` / `voice-confirm` / `voice-retry` / `voice-start`。

**建议删干净**，连同 `SynapseMobileTests/VoiceInputPresentationTests.swift` 一起改写成按住式的呈现规则测试。理由：两个入口做同一件事，正是设计文档 §3.2 里反对的东西；留着就是死代码。

**唯一要保留的是 `VoiceInputController` 本身** —— 它的 `start` / `retry` / `cancel` / `confirm` 三个入口正好就是按住式要的动作，只是调用时机从"两次点击"变成"按下 / 松开"。**控制器尽量一个字不改。**

> 原型里那个「微信式 / 现状」开关是给你评审用的对照，**不进产品**。

---

## 阶段 0 · 纯值

### 产物

**新文件 `SynapseMobile/SynapseMobile/Features/Voice/HoldToTalkGesture.swift`**：判定一次按住属于哪一态。

形状照 `VoiceInputPresentation`（不认识视图、不认识控制器，输入是数，输出是枚举）：

```
enum HoldToTalkGesture {
    static let cancelThreshold: CGFloat = 70   // 唯一的阈值定义处
    enum Outcome { case speaking, cancelling }
    static func outcome(translationY: CGFloat) -> Outcome
}
```

- 手往上移 → `translationY` 为负；`-translationY >= cancelThreshold` 即 `cancelling`。
- 阈值取 70pt = 1.6 × `Metrics.minimumTapTarget`（44）。**视图里不许有第二份数字。**

**新文件 `SynapseMobile/SynapseMobile/Features/Voice/HoldToTalkPresentation.swift`**（或就地替换 `VoiceInputBar.swift` 里的 `VoiceInputPresentation`）：按住式下输入栏与气泡各显示什么。

输入是 `VoiceInputController.Phase` 与 `AsrTranscript`，输出至少这几个字段：

| 字段 | 用途 |
|---|---|
| `barIsVoice` | 输入栏是不是语音态（决定四格怎么画） |
| `fieldPressed` | 按住说话那一格是否画成按压态 |
| `controlsEnabled` | 切换键 / ＋ / 发送是否可用（录音中为否） |
| `bubbleVisible` | 气泡是否显示 |
| `bubbleText` | 气泡主体（走 `AsrTranscript.stable` / `.unstable` 两级） |
| `hint` | 气泡下方那行：`松开 转文字` / `松开 取消` / `转文字中` |
| `cancelling` | 气泡是否转成取消配色 |

判定顺序照旧是规格的一部分，**不要重排**：失败优先于聆听、收尾中不给取消、取消就绪覆盖默认提示。

### 关键约束

- 两个类型都不 `import SwiftUI`（最多 `import CoreGraphics`），否则就测不动了。
- 阈值、文案全部只在这两个文件里出现一次。视图里出现字符串字面量即为走样。

### 涉及文件

- 新增 `SynapseMobile/SynapseMobile/Features/Voice/HoldToTalkGesture.swift`
- 新增 `SynapseMobile/SynapseMobile/Features/Voice/HoldToTalkPresentation.swift`

### 验证

```bash
xcodebuild test -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileTests -parallel-testing-enabled NO
```

新增 `SynapseMobile/SynapseMobileTests/HoldToTalkGestureTests.swift`，逐条钉：

- 偏移 0 / −10 / −69 → `speaking`；
- 偏移 −70 / −200 → `cancelling`；
- 从 −90 回到 −5 → `speaking`（滑回来要能撤销，这一条最容易漏）。

呈现规则测试改写 `VoiceInputPresentationTests.swift`（设计文档 §8 的第 20、21 条），至少覆盖：聆听中无字、聆听中有未定稿字、收尾中、取消就绪、失败三种原因。

---

## 阶段 1 · 结构

### 产物

`TerminalScreen.swift` 的 `inputBar`（`:538`）：四格重排。

**键盘态**：`[切换] [输入框] [＋] [发送]`
- 最左新增切换键（`mic` / `keyboard` 两个图标按状态切，`Theme.ink`，44pt 点击区）；
- ＋ 从最左移到输入框右侧 —— 现有的 `Menu`（`:562`）整块搬家即可，菜单内容一行不改；
- 去掉输入框右侧那个 `voice-start` 麦克风键（`:618`）。

**语音态**：`[切换] [按住 说话] [＋] [发送(淡出)]`
- 输入框位置换成 `Button` 外观的块（不是 `TextField`），底色 `Color(uiColor: .secondarySystemBackground)`、`RoundedRectangle` 圆角 9、居中文字「按住 说话」；
- **宽度与位置与键盘态逐格一致** —— 高度、水平 padding、spacing 都不许动（设计文档 §8 第 2 条要靠这个过）。

### 关键约束

- **不要顺手改 accessoryBar（`:452`）与键盘面板（`:515`）。** 这一阶段只动 `inputBar` 里面的四格。
- 语音态要在进入时调 `dismissKeyboards()`（`:133`），系统键盘与自绘面板都必须收起。
- 新增无障碍标识：`voice-mode-toggle`（切换键）、`voice-hold`（按住说话那一格）、`voice-mode`（值 `keyboard` / `voice`）。原有的 `attach` / `send` / `toolbar-*` **不许改名**，有测试在用。

### 验证

```bash
xcodebuild -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

模拟器里手点一遍：两态来回切，四格不搬家；＋ 菜单四个入口都还在；发送键在键盘态按 `draft` 启用/禁用照旧。

---

## 阶段 2 · 按住式接通

### 产物

1. **手势**：在「按住 说话」那一格挂 `DragGesture(minimumDistance: 0)`，`.contentShape(Rectangle())`。
   - `onChanged` 第一次回调即 `voice.start { await model.requestAsrSignature() }`（`:624` 现有那行的同一个入口）；
   - 之后每次回调把 `value.translation.height` 喂给 `HoldToTalkGesture`，变化时才写状态；
   - `onEnded` → 按 §设计文档 4.6 分三种走法。
   - `DragGesture` 一步到位地给了按下、拖动、松开，**不要自己写 UIKit 手势识别器**。

2. **气泡层**：`barwrap` 上方一个浮层。
   - 位置：输入栏正上方，居中，最多两行；
   - 有一个朝下的尖指向按住的位置（微信那个尾巴的同一个意思）；
   - 内容永远滚到最新：`ScrollViewReader` + `scrollTo` 到底，或把它做成不可滚动的两行截尾 —— **实施者选哪个都行，但"最新那句永远可见"必须成立**（设计文档 §8 第 8 条）。
   - 气泡与输入栏同宽约束下不许把输入栏顶下去：它必须是 `overlay` / `ZStack`，**不能进 `VStack` 的布局流**（进了就会改变终端可视高度，进而让 `reportGridToDesktop` 报一个错的格子数）。

3. **收尾**：松手后走 `voice.confirm()`。它返回的就是"要落进输入框的文本"，落字规则沿用 `TerminalScreen.swift:743` 现有 `finishVoice()` 的追加逻辑（**这段逻辑直接复用，不要重写**）。

4. **预检**（设计文档 §3.7）：切换键按下时先查两件 —— `AudioCapture.requestPermission()`（`:83`）与 `model.connectivity`（`SynapseAppModel.swift:1185`，`.noServer` 即断网）。查不过就停在键盘态，并 `model.raiseTerminalMessage(...)` 报原因（`:254` 那条路径，权限那条要带跳设置的动作）。

### 关键约束

- **失败与中断都由视图调 `confirm()` 收尾，不要给控制器加新方法。** 核对过 `VoiceInputController`：
  - `.failed` 时 `capture` / `session` 还在，`confirm()` 会走完收尾并返回已识别到的文本（空则返回 `nil`）；
  - `.interrupted` 时 `capture` / `session` 已被 `teardown()` 置空，`confirm()` 会跳过等待、直接把 `finalText` 交出来。
  - 也就是说"已识别的字一个字不丢"这条**已经成立**，视图只需要在拿到结果后回键盘态并按原因浮提示条。
  - 唯一要分支的：识别未配置（`Failure.notConfigured`）时文本必然为空，此时**不要**再显示「没有听到声音」占位（已经报了原因，两句话打架）。
- **`voice.notice` 那条路（`:254`）继续用**，麦克风权限被拒时它已经在做"带设置动作的提示条"。
- 落地**不发送、不回车**：`draft` 写完就停，终端的发送仍只由发送键与 accessoryBar 触发。

### 验证

```bash
xcodebuild test -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileTests -parallel-testing-enabled NO
```

真机（模拟器没有可用的麦克风，只能验手势与几何）：

1. 按住 → 气泡出；上滑 70pt → 变红「松开 取消」；滑回 → 复原；
2. 取消松手 → 输入框内容与按住之前完全一致；
3. 正常松手 → 提示先「转文字中」，随后文字进输入框、回键盘态、发送键亮；
4. `draft` 有内容时再录一句 → 原内容 + 空格 + 转写；
5. 转文字落地后终端**没有任何新输出**（不回车那条）。

---

## 阶段 3 · 失败与边界

### 产物

| 场景 | 规格（详见设计文档 §5） | 落点 |
|---|---|---|
| 录音中失败（断网） | 立即结束、回键盘态、已识别的字照落、浮「网络已断开」 | `handleSocketFailure`（`VoiceInputBar.swift:261`）之后由视图收尾 |
| 来电 / 切后台 | 立即结束、已识别的字照落、回键盘态、浮「录音被打断」 | `handleInterruption`（`:269`）之后由视图收尾；**「录音被打断」是本次新增的唯一一条文案** |
| 识别为空 | 回键盘态 + 输入框占位「没有听到声音」，**不浮提示条** | `confirm()` 返回 `nil` 时 |
| 静音 3 秒 | 气泡内文案变「没有听到声音」，**录音继续** | 现有 `silenceHint`（`:234`）语义不变 |
| 按下即松 | 松手时 `phase == .idle` → 什么都不发生 | 手势 `onEnded` |

**时长这一条已经不需要写了。** 设计文档 §5.6 有个**更正**：`max_speak_time` 是强制断句参数，不是单次识别的长度上限 —— 引擎不会因为说得久把连接掐掉，服务端签名（`server/src/voice/asr-signature.ts`）也没设它。所以：

- **`VoiceInputController` 一个字都不用改。** `sendOneChunk`（`:225`）一直发到用户松手，这就是正确行为。
- 不要加计时、不要加上限提示、不要做自动收尾。**初稿里那个 `reachedLimit` 已经作废**，谁看到旧版本就丢掉。
- 唯一要实测的是网关有没有长连接寿命（官方文档没写）。阶段 4 按住 3 分钟说满一次确认；**就算会断，兜底也已经安全**（断开走上面那行"录音中失败"，字不丢）。

### 验证

断网可以这样造：按住说话的同时在电脑上断掉网络，或把手机切飞行模式（切飞行会走 `handleSocketFailure`）。来电图便宜：拨一个电话进来。

**长时间输入只能在真机上跑**，且要有人对着麦克风持续说话 —— 排进阶段 4 的验收清单。

---

## 阶段 4 · 真机验收与装机

1. `pnpm --filter @synapse/desktop run test` 与本改动无关，**不用跑**；本次不碰仓库其它部分。
2. 真机跑一遍设计文档 §8 的 19 条行为（第 20、21 条是单测），其中**第 17 条要按住说满 3 分钟**再松手。
3. **装到李杨的 iPhone**：

```bash
pnpm mobile:install
```

手机需要数据线连着并解锁。装上去的是开发包，**收不到推送**是已知且接受的代价，不要为此去动推送网关。

4. **更新 `RELEASE_NOTES_PENDING.md`**：这次是用户可感知的变化（输入栏换了结构、手机端语音改成按住说话），按"得到什么、什么变了"写，不写代码路径。

---

## 完成标准

- [ ] 设计文档 §8 的 21 条验收基线逐条成立；
- [ ] `SynapseMobileTests` 全绿，新增的手势判定与呈现规则用例都在；
- [ ] 点击式那套在 iOS 端删干净，没有留下走不到的分支；
- [ ] `VoiceInputController` **一个字都没改**；
- [ ] 真机上按住 / 上滑取消 / 转文字落地 / 不回车四条亲手验过；
- [ ] 真机上按住说满 3 分钟验过：连接不断、文字持续长、屏幕上没有任何计时或上限提示；实测结论回写了设计文档 §5.6；
- [ ] 已装到李杨的 iPhone 上（`pnpm mobile:install`），装机输出里的版本号与构建号记在提交信息里；
- [ ] `RELEASE_NOTES_PENDING.md` 已更新。

---

## 提交切分

| 提交 | 内容 |
|---|---|
| 1 | 阶段 0：两个纯值 + 单测 |
| 2 | 阶段 1：inputBar 四格重排 + 语音态占位 |
| 3 | 阶段 2：手势、气泡、预检、落地 |
| 4 | 阶段 3：失败与边界 |
| 5 | `RELEASE_NOTES_PENDING.md` |

提交信息用中文写清楚做了什么、关键行为变化是什么，不要写"更新代码""优化"这类泛化描述。
