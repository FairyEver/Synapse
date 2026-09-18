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
| 2 | 按住式接通：手势、气泡、预检、松手即发送 | 能 —— 到这里短输入就完整了 |
| 3 | 锁定态：右滑锁定、录音会话栏、「确定」/「✗」 | 能 |
| 4 | 失败与边界：断网、中断、长时间输入、按下即松 | 与阶段 3 一起发 |
| 5 | 真机验收与装机 | — |

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
    static let slideThreshold: CGFloat = 70    // 唯一的阈值定义处
    enum Outcome { case speaking, cancelling, locking }
    static func outcome(translationX: CGFloat) -> Outcome
}
```

- 左移 → `translationX` 为负，`<= -slideThreshold` 即 `cancelling`；
- 右移 → `>= slideThreshold` 即 `locking`；
- 其余 `speaking`。**方向只看符号，不引入第二个阈值。**
- 阈值取 70pt = 1.6 × `Metrics.minimumTapTarget`（44）。**视图里不许有第二份数字。**

注意这是**水平**轴（原稿写的上滑取消，已改，见设计文档 §3.5）。

**新文件 `SynapseMobile/SynapseMobile/Features/Voice/HoldToTalkPresentation.swift`**（或就地替换 `VoiceInputBar.swift` 里的 `VoiceInputPresentation`）：按住式下输入栏与气泡各显示什么。

输入是 `VoiceInputController.Phase` 与 `AsrTranscript`，输出至少这几个字段：

| 字段 | 用途 |
|---|---|
| `barIsVoice` | 输入栏是不是语音态（决定四格怎么画） |
| `fieldPressed` | 按住说话那一格是否画成按压态 |
| `controlsEnabled` | 切换键 / ＋ / 发送是否可用（录音中为否） |
| `bubbleVisible` | 气泡是否显示（**锁定之后不显示**） |
| `bubbleText` | 气泡主体（走 `AsrTranscript.stable` / `.unstable` 两级） |
| `hint` | 气泡下方那行：`松开 转文字` / `松开 取消` / `松开 锁定` / `转文字中` |
| `bubbleTone` | 气泡配色：普通 / 取消（红）/ 锁定（深色） |
| `locked` | 是否处于锁定态（§4.9）——决定输入栏画成录音会话栏 |
| `lockTranscript` | 锁定态中间那三行转写的内容 |

判定顺序照旧是规格的一部分，**不要重排**：失败优先于聆听、收尾中不认取消也不认锁定、就绪态覆盖默认提示。

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
- 偏移 −70 / −200 → `cancelling`；+70 / +200 → `locking`；
- 从 −90 回到 −5 → `speaking`；从 +90 回到 +5 → `speaking`（滑回来要能撤销，这一条最容易漏）。

呈现规则测试改写 `VoiceInputPresentationTests.swift`（设计文档 §8 的第 27、28 条），至少覆盖：聆听中无字、聆听中有未定稿字、收尾中、取消就绪、锁定就绪与锁定中、失败三种原因。

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
   - `onEnded` → 按设计文档 §4.6 分四种走法：左区取消、右区**锁定**（阶段 3 接通）、中间发送、无内容不动。
   - `DragGesture` 一步到位地给了按下、拖动、松开，**不要自己写 UIKit 手势识别器**。

2. **气泡层**：`barwrap` 上方一个浮层。
   - 位置：输入栏正上方，居中，最多两行；
   - 有一个朝下的尖指向按住的位置（微信那个尾巴的同一个意思）；
   - 内容永远滚到最新：`ScrollViewReader` + `scrollTo` 到底，或把它做成不可滚动的两行截尾 —— **实施者选哪个都行，但"最新那句永远可见"必须成立**（设计文档 §8 第 8 条）。
   - 气泡与输入栏同宽约束下不许把输入栏顶下去：它必须是 `overlay` / `ZStack`，**不能进 `VStack` 的布局流**（进了就会改变终端可视高度，进而让 `reportGridToDesktop` 报一个错的格子数）。

3. **松手 → 收尾 → 发送**。走 `voice.confirm()`，拿到文本之后按设计文档 §4.7 分流：

   - `draft` **为空** → 直接发出去（终端走既有的 `sendCommand`）。这是"说一句就是发一句"，**不要**再落进输入框等一次点击。
   - `draft` **非空** → 沿用 `TerminalScreen.swift:743` 现有 `finishVoice()` 的追加逻辑（原内容 + 一个空格 + 转写），**这段逻辑直接复用，不要重写**。
   - 文本为空 → 什么都不发、什么都不落（§5.3）。

   `Haptics.commit()` 照旧给一次。

4. **预检**（设计文档 §3.8）：切换键按下时先查两件 —— `AudioCapture.requestPermission()`（`:83`）与 `model.connectivity`（`SynapseAppModel.swift:1185`，`.noServer` 即断网）。查不过就停在键盘态，并 `model.raiseTerminalMessage(...)` 报原因（`:254` 那条路径，权限那条要带跳设置的动作）。

### 关键约束

- **失败与中断都由视图调 `confirm()` 收尾，不要给控制器加新方法。** 核对过 `VoiceInputController`：
  - `.failed` 时 `capture` / `session` 还在，`confirm()` 会走完收尾并返回已识别到的文本（空则返回 `nil`）；
  - `.interrupted` 时 `capture` / `session` 已被 `teardown()` 置空，`confirm()` 会跳过等待、直接把 `finalText` 交出来。
  - 也就是说"已识别的字一个字不丢"这条**已经成立**，视图只需要在拿到结果后回键盘态并按原因浮提示条。
  - 唯一要分支的：识别未配置（`Failure.notConfigured`）时文本必然为空，此时**不要**再显示「没有听到声音」占位（已经报了原因，两句话打架）。
- **`voice.notice` 那条路（`:254`）继续用**，麦克风权限被拒时它已经在做"带设置动作的提示条"。
- **发送与追加走同一个函数**（设计文档 §4.7），松手那条与锁定态「确定」那条都调它。写两份分流必然漂开。

### 验证

```bash
xcodebuild test -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileTests -parallel-testing-enabled NO
```

真机（模拟器没有可用的麦克风，只能验手势与几何）：

1. 按住 → 气泡出，那一格显示 `取消 ← 聆听中 → 锁定`；
2. 左滑 70pt → 变红「松开 取消」，滑回 → 复原；左滑松手 → 输入框内容与按住之前完全一致，且**仍在语音态**；
3. 右滑 70pt → 变深「松开 锁定」（阶段 3 才接通，这里只验配色与提示）；
4. 正常松手 → 提示先「转文字中」，随后这句话**出现在终端的输出里**（不是留在输入框），回键盘态；
5. 先在 `draft` 里打几个字再录 → **不发**，转写追加在后面；
6. 一句话不说就松手 → 什么都不发，输入框占位「没有听到声音」。

---

## 阶段 3 · 锁定态

### 产物

1. **锁定**：手势判定出 `locking` 时松手 → **不结束录音**，把状态置成锁定，输入栏换成录音会话栏（设计文档 §4.9）。

2. **录音会话栏**：`[✗] [录音中 + 转写，最多三行] [确定]`
   - 中间那块的转写与气泡共用同一个渲染（`AsrTranscript` 的 stable / unstable 两级 + 光标）；
   - 永远滚到最新；
   - 左端 ✗ 给一次 `Haptics.select()`。

3. **两个出口**：
   - 「确定」→ `voice.confirm()` → 按 §4.7 发送或追加 → 回键盘态（与松手那条走**同一个函数**，不要写第二份分流）。
   - 「✗ 放弃」→ `voice.cancel()` → 整段丢弃 → 回键盘态。

### 关键约束

- **不要向桌面报新的网格。** 输入栏变高会让 `store.visibleRows` 变小，`TerminalScreen` 的 `onChange` 会走到 `reportGridToDesktop`（`:114`）。按系统键盘那条既有规则，锁定期间与退出锁定之后都**不上报** —— 报的话桌面 PTY 会为一次语音输入 resize 两次。**给这个窗口加一个守卫并在测试里钉住**（设计文档 §4.9）。
- 锁定态**不加计时**、不因时长自动收尾（§5.6）。
- 「✗ 放弃」回键盘态，「左滑取消」留在语音态 —— 两者不同，别合并。

### 验证

真机：

1. 右滑锁定 → 气泡消失、输入栏变高、转写继续长；
2. 手完全松开、去翻终端、回来说话 → 文字照常追加；
3. 点「确定」→ 发出去了（空 `draft` 时），或追加进输入框（有草稿时）；
4. 点「✗ 放弃」→ 什么都没发、回键盘态；
5. **锁定期间桌面端不重排**：让电脑上的终端持续输出，进入/退出锁定各一次，桌面上不应看到两次 resize。

---

## 阶段 4 · 失败与边界

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

## 阶段 5 · 真机验收与装机

1. `pnpm --filter @synapse/desktop run test` 与本改动无关，**不用跑**；本次不碰仓库其它部分。
2. 真机跑一遍设计文档 §8 的 28 条行为（第 27、28 条是单测），其中**第 24 条要按住说满 3 分钟**再松手。
3. **装到李杨的 iPhone**：

```bash
pnpm mobile:install
```

手机需要数据线连着并解锁。装上去的是开发包，**收不到推送**是已知且接受的代价，不要为此去动推送网关。

4. **更新 `RELEASE_NOTES_PENDING.md`**：这次是用户可感知的变化（输入栏换了结构、手机端语音改成按住说话），按"得到什么、什么变了"写，不写代码路径。

---

## 完成标准

> 2026-09-18 记：每一条都标了它当时是**怎么**被确认的。能在模拟器上自动跑的都跑了；
> 需要对着麦克风说话的那几条留给人手，清单在最后一节。

- [x] `SynapseMobileTests` 全绿（233 条 / 34 个 suite），新增的手势判定、呈现规则与
      「锁定不报网格」的用例都在；
- [x] 点击式那套在 iOS 端删干净：`VoiceInputPresentation` 与它的 `RightKey` 删了，输入栏
      里的转写函数与右槽函数一起去掉，没有留下走不到的分支；
- [x] `VoiceInputController` 一个字都没改 —— 唯一动过的是它上面那段文件头注释（它提的是
      已经删掉的旧类型名）；
- [x] 锁定态进出的那两次**没有**向桌面报新网格 —— `VoiceGridHold` 纯值 + 5 条单测；
- [x] `InputBarUITests` 6 条在模拟器上对着 mock desktop 全过：四格不搬家、进语音态收
      键盘面板、左滑取消留在语音态、右滑锁定出现录音会话栏、「放弃」与「确定」各自
      回键盘态；
- [x] 已装到李杨的 iPhone：`pnpm mobile:install` → **SynapseMobile 1.0.2 (1)**；
- [x] `RELEASE_NOTES_PENDING.md` 已更新；
- [ ] 设计文档 §8 的 28 条逐条成立 —— 结构与几何、切换、锁定态里能自动验的部分成立（见
      上）；**剩下要真机的见下一节**；
- [ ] 真机上按住 / 左滑取消 / 右滑锁定 / 「确定」/「✗ 放弃」/ 松手即发送 六条亲手验过；
- [ ] 真机上按住说满 3 分钟验过：连接不断、文字持续长、屏幕上没有任何计时或上限提示；
      实测结论回写设计文档 §5.6。

## 还差什么：真机上要人做的一遍

两件事挡在自动验收前面，都不是实现的问题：

- **模拟器没有麦克风输入**，所以凡是「说出话来才算数」的验收（松手即发送、追加、空识别、
  锁定期间转写增长、时长）在模拟器上根本走不到；
- **`press(forDuration:thenDragTo:)` 是一次全程阻塞的调用**，而 XCUITest 的查询必须在主
  线程上跑 —— 所以「按住不放、同时在旁边断言」没有写法。按住**期间**的画面只留在了录屏里
  （气泡一开始落在输入栏下方、一路顶着屏幕底边跑出去，就是这么逐帧看出来的）。

`pnpm mobile:install` 的包已经在这台手机上，下面一遍大约两分钟：

1. 按住「按住 说话」说一句短的再松手 → 这句话**出现在终端里**（不是留在输入框）；
2. 先在输入框里打几个字，再按住说话 → **不发**，转写接在那几个字后面；
3. 按住、左滑 70pt、松手 → 输入框与按住之前**一模一样**，且**仍在语音态**；
4. 按住、右滑 70pt、松手 → 输入栏变成 `[✗] [录音中 + 转写] [确定]`，手可以拿开、继续说、
   文字继续长；
5. 在 4 那个状态下点「确定」→ 发出去（或按第 2 条的规则追加）；点「✗ 放弃」→ 什么都没发；
6. 按住**说满 3 分钟**再松手 → 连接不断、文字持续长、屏幕上没有任何计时或上限提示。
   这一条的实测结论回写设计文档 §5.6。

---

## 提交切分

| 提交 | 内容 |
|---|---|
| 1 | 阶段 0：两个纯值 + 单测 |
| 2 | 阶段 1：inputBar 四格重排 + 语音态占位 |
| 3 | 阶段 2：手势、气泡、预检、松手即发送 |
| 4 | 阶段 3：锁定态 |
| 5 | 阶段 4：失败与边界 |
| 6 | `RELEASE_NOTES_PENDING.md` |

提交信息用中文写清楚做了什么、关键行为变化是什么，不要写"更新代码""优化"这类泛化描述。
