import PhotosUI
import SwiftUI
import UIKit

/// One terminal, full screen.
struct TerminalScreen: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(TerminalDisplaySettings.self) private var display
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    /// 「减弱动态效果」。录音面板浮上来那一下听它的：开着就只淡入，不做位移。
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Compact height keeps the terminal controls reachable in a short window.
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    /// `verticalSizeClass` 的镜像，见 `isCompactHeight`。
    @State private var compactHeight = false

    let sessionId: String
    let onClose: () -> Void
    @State private var draft = ""
    /// Follows the density in force for this session rather than being held as view
    /// state: it is a setting, and a copy here is how the two drift apart.
    private var fontSize: CGFloat { display.density(for: sessionId).fontSize }
    @State private var showingRename = false
    @State private var showingStopConfirm = false
    @State private var keyboardPanelPresented = false
    /// 键盘槽位正在滑进或滑出。
    @State private var panelIsSettling = false
    /// 面板落位后补报网格的那一班。与 `chromeSettleTask` 同一条道理：连续收放会留下
    /// 两个睡着的任务，各自清标志、各自补报一次。
    @State private var panelSettleTask: Task<Void, Never>?
    /// 三条栏收起来了 —— 这一页现在是全屏终端。
    @State private var chromeHidden = false
    /// 到点收栏的那班岗。任何一次操作都把它重新上一次。
    @State private var chromeIdleTask: Task<Void, Never>?
    /// 收放栏正在动画里。与 `panelIsSettling` 同一条道理：滑动途中量到的行数是
    /// 用户从没选过的中间值，不进桌面。
    @State private var chromeIsSettling = false
    /// 上面那次滑动落位之后补报网格的那班岗。**存在这里而不是就地起一个不存的任务**：
    /// 连续收放会留下两个睡着的任务，各自清标志、各自补报一次。
    @State private var chromeSettleTask: Task<Void, Never>?
    /// 这一页去掉安全区之后有多高。横屏时键盘面板按它限高（见
    /// `KeyboardPanelMetrics.height(fitting:)`），别的什么都不用它。
    @State private var availableHeight: CGFloat = 0
    /// Whether the command panel is open. The bar's right-hand key owns this, and the
    /// panel that reads it is presented as a sheet at the end of the screen.
    @State private var shortcutPanelPresented = false
    @State private var resourcesPresented = false
    /// 这一页的 Git 面板。非空＝面板开着，它同时是这一个弹窗的状态机（见 `TerminalGitFlow`）。
    ///
    /// 由 `⋯` 菜单里那一行建起来，带上发 intent 与说话两件事 —— `model` 只在那一刻
    /// 拿得到（属性初始化时还读不到 environment），所以它在这里建。
    @State private var gitFlow: TerminalGitFlow?
    @FocusState private var inputFocused: Bool

    @State private var showingPhotoPicker = false
    @State private var showingDocumentPicker = false
    @State private var showingCamera = false
    /// Refreshed at the moments an image can have arrived rather than read where it
    /// is used: the pasteboard changes while the app is not looking, there is no
    /// notification for that, and the menu that asks is built before it opens.
    @State private var pasteboardHoldsImage = false
    /// 相册里最新的一张图，摆在输入栏上方（判定见 `TerminalRecentPhotoLibrary`）。
    /// nil 表示这一刻没有可提议的 —— 没授权、太旧、已经露过面，几种情况在屏幕上都是
    /// 同一件事：什么都不摆。
    @State private var recentPhoto: RecentPhoto?
    /// 到点把它收走的那班岗。没有它，这一格会一直挂着，而它是一句只在当下成立的提议。
    @State private var recentPhotoExpiry: Task<Void, Never>?
    /// 相册里的变化，一发生就把上面那一格重算一遍。建在这一页上而不是建在 App 上：
    /// 只有终端屏幕上有东西要看，而为它常驻一个监听等于每个页面都在读相册。
    @State private var recentPhotoWatcher: TerminalRecentPhotoWatcher?
    /// Files picked but not yet sent, while the user is being asked whether a
    /// terminal that is waiting for input should really receive them.
    @State private var pendingFiles: [PickedFile] = []
    @State private var showingBusyConfirm = false
    @State private var voice = VoiceInputController()
    /// 输入栏现在是哪一种模式。语音不是栏上的一个按钮，而是这条栏的一个状态
    /// （设计文档 §3.2），所以它由这一格决定 —— 四个位置在两种模式下都不搬家。
    @State private var voiceMode = false
    /// 用户**上次选定的**是哪种模式，跨终端、跨启动记着。
    ///
    /// 记的是切换键按下去那一下（`chooseVoiceMode`），不是上面那一格当下的值：说完
    /// 一句之后照旧留在语音态（§3.3），那不是一次表态，照着它写等于把用户的选择抹掉。
    /// 所以这个键只由切换键写。
    @AppStorage("terminal.inputBar.voiceMode") private var voiceModePreferred = false
    /// 手指是否还压在「按住 说话」那一格上。
    ///
    /// `DragGesture` 只给按下、拖动、松开三种回调，「按下」在这一串里就是**第一次**
    /// `onChanged` —— 没有单独的 down 事件，所以这个闩得自己记。
    @State private var holdLatched = false
    /// 手指压到了面板的哪一半。视图只负责把坐标喂进 `HoldToTalkGesture`，判定不在
    /// 这里（设计文档 §6）。
    @State private var holdZone: HoldToTalkGesture.Outcome = .speaking
    /// 录音面板**量出来的**位置，报在手势所用的那个坐标系里。
    ///
    /// 不自己按宽度算：浮层的左右内边距、内边距、以及将来可能出现的任何变化都会让算式
    /// 和实际差一点，而这一点正好决定手指停在边界上时算不算压上去了、压在哪一半。量
    /// 出来就没有第二份真相 —— 蒙层画出来的那条中线，用的也是这一块。
    @State private var voicePanelRect: CGRect = .zero
    /// 收尾只能走一次。失败可能与松手撞在一起，两个 `confirm()` 同时进来会把这段
    /// 录音提交两遍。
    @State private var settlingVoice = false
    /// 识别为空之后输入框顶上要显示的那句话（§5.3）。
    ///
    /// 它跟着输入框，而不是弹一条提示条：「没听到」不是一个需要被知道的事件，是一句
    /// 就地的说明，下一个动作就把它抹掉。
    @State private var emptyVoiceMessage: String?
    /// 锁定态：输入栏长高到三行，以及这件事对桌面网格该不该有影响。
    ///
    /// 两件事合成一个值，是因为它们本来就是一件事的两面 —— 分开写，两个地方总有
    /// 一处会忘记跟着另一边走。
    @State private var voiceGrid = VoiceGridHold()

    private var store: TerminalStore { model.store(for: sessionId) }
    private var session: MobileSummarySession? { model.session(sessionId) }

    /// Only a running terminal can be typed into, and the bar and the panel both say so
    /// by greying out together rather than each deciding for itself.
    private var isRunning: Bool { session?.isRunning == true }

    /// The computer's list no longer carries this terminal, which is the one thing
    /// that can end this screen.
    ///
    /// A terminal that is stopped is gone rather than merely idle: the computer
    /// destroys the session when its process exits, so the next list it sends simply
    /// does not mention it. What is left on this screen then is a canvas nobody is
    /// writing to and an input bar with no recipient — the user's only way out is the
    /// back button, and nothing says so.
    ///
    /// An absent list is not the same as a list that says no. With no list at all —
    /// the computer has not answered, or the user just switched computers — every
    /// terminal is missing from it, and one that is unreachable is not one that ended.
    private var sessionIsGone: Bool {
        model.summary != nil && session == nil
    }

    /// The buttons the computer under this terminal offers, or the built-in fallback
    /// when it is too old to have said. See `SynapseAppModel.activeToolbarButtons`.
    private var buttons: [MobileToolbarButton] { model.activeToolbarButtons }

    /// Files on their way to the computer from this terminal, and the ones that
    /// arrived recently enough to be worth undoing.
    private var relayAttachments: [TerminalAttachment] {
        model.relayAttachments.filter { $0.sessionId == sessionId }
    }

    /// Only this terminal's. A refusal belongs to the session it came from, so it is
    /// not carried across a switch to be shown against a different screen.
    private var terminalMessages: [TerminalMessage] {
        model.terminalMessages.filter { $0.sessionId == sessionId }
    }

    private var modeBinding: Binding<TerminalDisplayMode> {
        Binding(
            get: { display.mode(for: sessionId) },
            set: { display.setMode($0, for: sessionId) }
        )
    }

    /// Optional-tagged so "follow the system setting" is a choice the picker can
    /// show rather than an absence it cannot.
    private var sessionDensityBinding: Binding<TerminalDensity?> {
        Binding(
            get: { display.isOverridingDensity(sessionId) ? display.density(for: sessionId) : nil },
            set: { display.setDensity($0, for: sessionId) }
        )
    }

    private var displayMode: TerminalDisplayMode { display.mode(for: sessionId) }

    /// What the desktop last said its grid is. Absent until the first summary
    /// arrives, and the desktop-grid mode cannot be honoured without it.
    private var desktopGrid: DesktopGrid? {
        guard let session, session.cols > 0, session.rows > 0 else { return nil }
        return DesktopGrid(columns: session.cols, rows: session.rows)
    }

    /// Tells the desktop which grid to adopt, or that it may decide again.
    ///
    /// The view is what wraps the rows — it is the only thing that can see both the
    /// pane and the mode — so there is nothing to push into the store here.
    private func syncDisplayMode() {
        if displayMode == .phoneDriven {
            reportGridToDesktop()
        } else {
            // The desktop's own layout decides again from here, and restores the PTY to
            // its shape as part of this call. The phone has no way to name the size the
            // desktop would have chosen — all it ever heard is the size the PTY
            // currently has, which is the phone's.
            //
            // What the desktop answers decides where the mode ends up, and that rule
            // lives in `applyGridRelease` rather than here: it is about the protocol,
            // not about layout, and it has to be testable without a view.
            Task {
                let outcome = await model.releaseGrid(for: sessionId)
                applyGridRelease(outcome, for: sessionId, to: display)
            }
        }
    }

    /// Tells the desktop which grid to adopt, when the reader has asked the phone to
    /// drive the size.
    ///
    /// Skipped while a keyboard of this phone's is up — the system one, or the panel.
    /// Both shrink the pane, and reporting that shrink would resize the PTY every time
    /// someone tapped the input or opened the panel: a redraw on the computer for a
    /// keyboard it cannot see. The size that stands is the one measured before the
    /// keyboard came up, and the closing of either reports the size again.
    ///
    /// `chromeIsSettling` joins those three for the same reason and with one difference:
    /// the bars are the one thing here the computer *does* hear about. Hiding them hands
    /// the terminal two more rows on this phone, and the reader asked to see the terminal
    /// fill the screen — so the change is reported, once, after it lands. What is skipped
    /// is only the middle: on the way out the pane measures the animated heights between
    /// the two, and none of those is a size anybody chose.
    private func reportGridToDesktop() {
        guard displayMode == .phoneDriven, !inputFocused, !keyboardPanelPresented,
              !panelIsSettling, !chromeIsSettling, store.visibleRows > 0 else { return }
        let grid = DesktopGrid(columns: store.columns, rows: store.visibleRows)
        // 锁定态进出那两次高度变化都不该进桌面（§4.9）。判定在 `VoiceGridHold` 里，
        // 单测逐条走完 —— 留在这里就只能靠人盯着电脑屏幕看。
        guard voiceGrid.shouldReport(grid) else { return }
        model.setGridSize(grid, for: sessionId, deviceLabel: UIDevice.current.name)
    }

    // MARK: - Keyboards

    /// Puts away whichever keyboard this screen has up.
    ///
    /// The one entry point for it, because there is one rule: this screen has two
    /// keyboards and neither is allowed up while the other is. Tapping the canvas,
    /// tapping the input, and the keyboard button when it is already open all mean the
    /// same thing. Written out at each site instead, the copies drift, and the one that
    /// gets forgotten leaves a keyboard on screen with nothing left that closes it.
    private func dismissKeyboards() {
        inputFocused = false
        setKeyboardPanel(false)
    }

    /// 收起或放下键盘槽位，并让版面跟着滑过去。
    ///
    /// 它是**槽位**：开关它改变的是终端分到的高度，工具栏和输入栏会跟着整整移动一个
    /// 面板的高度。没有动画时那是一记瞬移 —— 系统键盘是滑的，我们自己这块是跳的，
    /// 两下一比就是用户说的「一个往上跳」。这里让它滑。
    ///
    /// 滑动期间**不向电脑报网格**：终端报的是自己量到的尺寸，而滑动途中的尺寸是用
    /// 户从没选过的中间值。落位之后补报一次，且只报一次。
    private func setKeyboardPanel(_ presented: Bool) {
        guard keyboardPanelPresented != presented else { return }
        panelSettleTask?.cancel()
        panelIsSettling = true
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.26)) { keyboardPanelPresented = presented }
        panelSettleTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 320_000_000)
            guard !Task.isCancelled else { return }
            panelIsSettling = false
            reportGridToDesktop()
        }
    }

    // MARK: - 三条栏的收放

    /// The current window's height class, including an iPad window after resizing.
    ///
    /// **读的是镜像（`compactHeight`），不是环境本身。** 环境值在**定时任务里读不出当下**：
    /// `armChromeIdle` 起的那班岗捕获的是"上表那一刻"的视图值，而 `@Environment` 在捕获的
    /// 副本里是一份快照（`@State` 不是 —— 它读的是共享的存储）。横屏那一班岗恰好在转屏
    /// 前后上表，快照里还是竖屏，到点一读，结论就成了「竖屏不收栏」—— 表现是**横屏永远
    /// 不收栏**。镜像在环境变化时跟着更新，谁读它读到的都是当下。
    private var isCompactHeight: Bool { compactHeight }

    private var usesSystemNavigationBar: Bool { horizontalSizeClass == .regular }

    /// 键盘面板把工具栏和输入栏顶掉了。
    ///
    /// 面板是一座完整的电脑键盘，它上面不该压着别的行 —— 留着那两条，键盘就只是屏幕
    /// 下方的一截，而不是「屏幕的下半部分就是键盘」。所以它一上来，两条栏整条让位，
    /// 上面只剩终端；收面板的路也只剩点键盘外侧那块画布一条（横屏时工具栏并进了顶栏，
    /// 那颗 ⌘ 还在，两条路都通）。
    ///
    /// **录着音的时候不让。** 录音浮层挂在输入栏那一组上，而手指很可能还压在「按住说话」
    /// 那一格里；把整条栏从手底下抽走，那一次录音就没有收尾的地方了。这种时候面板照旧
    /// 开在两条栏下面，退化成改造前那副样子 —— 难看，但不会丢一段录音。
    private var barsStandDown: Bool {
        keyboardPanelPresented && !voicePresentation.panelVisible
    }

    /// 工具栏（指令条那一行）此刻该不该在屏幕上。
    ///
    /// 它是一条**备用**的路：想按什么指令、想去拿自绘键盘，都从这里走。而下面三种时候
    /// 它帮不上忙，只是占着一行 —— 后面两处是产品负责人 2026-09-20 在真机上点的：
    ///
    /// - **正在打字**：手在系统键盘上，眼前是输入框。要按指令先得把键盘收掉，
    ///   而收掉之后它自己就回来了。
    /// - **正在说话**：同一格地方要留给录音面板 —— 它挂在输入区之上，工具栏一走，
    ///   它就往下落到那一行上，而不是把终端压得更矮。
    /// - **键盘面板开着**：见 `barsStandDown`，那一种连输入栏一起让。
    ///
    /// 横屏是例外：那一条栏把顶栏并了进去（返回、标题、⋯ 都在里面），收掉它收掉的
    /// 是出口，不是一行指令。所以这一条只管竖屏的自绘工具栏。
    private var toolbarStandDown: Bool {
        keyboardPanelPresented || inputFocused || voicePresentation.panelVisible
    }

    /// 这一刻三条栏可不可以收（判定本身在 `TerminalChromeConditions` 里，单测逐条走完）。
    ///
    /// 算成纯值而不是就地问某个 `@State`，是因为**它同时是计时的重启信号**：
    /// 交给 `onChange` 比一遍，任何一条从假变真再变假都会重新上表，不必在每一处
    /// 能解开禁制的地方各写一次。
    private var chromeConditions: TerminalChromeConditions {
        TerminalChromeConditions(
            isTyping: inputFocused,
            isKeyboardPanelUp: keyboardPanelPresented,
            isVoiceBusy: holdLatched || voice.phase != .idle || voiceGrid.isLocked,
            isOverlayUp: showingRename || showingStopConfirm || showingBusyConfirm
                || showingPhotoPicker || showingDocumentPicker || showingCamera
                || shortcutPanelPresented || resourcesPresented || gitFlow != nil,
            isPhotoBubbleUp: recentPhoto != nil,
            isPortrait: !isCompactHeight,
            isSettling: chromeIsSettling,
            isAssistiveTechOn: UIAccessibility.isVoiceOverRunning
                || UIAccessibility.isSwitchControlRunning
        )
    }

    /// 有人操作了：那班收栏的岗重新站一遍。
    ///
    /// 每个动作之后都要喊一声。不喊的后果不是"栏收得早了一点"，是**用户刚按下的那颗
    /// 键带着它的结果一起消失**：按键多半不改变任何一个上表里的条件（按一颗指令胶囊
    /// 就是发一串键），于是计时从上次操作起算，正好可能在这次操作之后到点。
    private func noteChromeActivity() {
        armChromeIdle()
    }

    /// 让三条栏在闲置到点之后收起来。
    ///
    /// **只有横屏会自己收**（2026-09-20 产品负责人定的）。竖屏的栏按屏幕剩下的地方算
    /// 很便宜 —— 顶栏加输入栏在竖向的屏上是一行多一点 —— 而它们自己走掉这件事在那里
    /// 只被读成「界面不见了」；要收就让人点名收，右上角菜单里的「全屏」。横屏不同：
    /// 那里两条栏压掉的分量是竖屏的两倍，而点一下画布就能把它们叫回来。
    ///
    /// 竖屏那一条判定不在这个守卫上，在 `TerminalChromeConditions.isPortrait` 里 ——
    /// 那一条要读在**到点那一下**，不能读在上表这一刻（转屏前后 `verticalSizeClass`
    /// 会飘，读早了这一班岗就白排）。
    private func armChromeIdle() {
        chromeIdleTask?.cancel()
        chromeIdleTask = nil
        // 已经收着了就没什么可等的。留着这一步，是因为**放下栏之后不该再起一班岗**：
        // 到点那次进去只会发现已经收着，白白多跑一轮。
        guard !chromeHidden else { return }
        chromeIdleTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(AppConfiguration.terminalChromeIdleSeconds))
            guard !Task.isCancelled else { return }
            // 到点这一下还要再问一次：这三秒里用户可能正好按下了说话，或者拉开了一块
            // 面板。计时问的是"闲了多久"，这一问的是"现在能不能收"，两件事。
            guard chromeConditions.mayAutoHide else { return }
            setChrome(hidden: true)
        }
    }

    /// 点一下画布：栏回来，人接着操作。
    private func revealChrome() {
        setChrome(hidden: false)
        armChromeIdle()
    }

    /// 收起或放下三条栏，并让终端跟着长长短短。
    ///
    /// 与 `setKeyboardPanel` 同一副骨架 —— 置标志、带动画改状态、落位后补报一次网格。
    /// 差别只有一条：那个补报的班次在这里**存得住**，下一次收放会先把上一班取消掉。
    private func setChrome(hidden: Bool) {
        guard chromeHidden != hidden else { return }
        chromeSettleTask?.cancel()
        chromeIsSettling = true
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.22)) { chromeHidden = hidden }
        chromeSettleTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 280_000_000)
            guard !Task.isCancelled else { return }
            chromeIsSettling = false
            reportGridToDesktop()
        }
    }

    /// 放下那块自绘的键盘面板。
    ///
    /// 面板开着的时候它自己那颗 ⌘ 是看不见的 —— 工具栏整条让位给了键盘
    /// （`barsStandDown`），所以在竖屏里这一条只剩「点画布」一条路走得到。横屏不一样：
    /// 那一行把顶栏并了进去，⌘ 就长在上面那条栏里，面板开着时它还在原处，再点一次就
    /// 把键盘收掉 —— 和系统键盘上那颗 ⌘ 一个脾气。
    private func toggleKeyboardPanel() {
        guard !keyboardPanelPresented else {
            dismissKeyboards()
            return
        }
        // Lowered before the panel rises rather than after, so that the two are never
        // both up: with both, the lower one cannot be reached.
        inputFocused = false
        setKeyboardPanel(true)
    }

    /// The toggle at the left end of the input bar: typing, or talking.
    ///
    /// Leaving is unconditional — a mode nothing is happening in has to be escapable.
    /// Coming back is where the two things that would make the mode useless get asked
    /// about, so a press that cannot record changes nothing at all (设计文档 §3.8).
    private func toggleVoiceMode() {
        guard !voiceMode else {
            chooseVoiceMode(false)
            return
        }
        Task { await enterVoiceMode() }
    }

    /// 用户对模式的一次表态：改当下，也记住。
    ///
    /// **切换键是唯一该调它的地方**（§3.3）。说完一句、滑走取消、固定态里收摊，都是
    /// 在这一轮里走到哪一步，不是用户改了自己的模式，所以那些路径一并不碰这一格。
    /// 这里多一个调用方，就等于多一条「用户没让它切、它自己切走了」的路，而症状要
    /// 等到他下次进终端才看得见。
    private func chooseVoiceMode(_ on: Bool) {
        voiceMode = on
        voiceModePreferred = on
    }

    private func enterVoiceMode() async {
        // 权限在这个动作里问，因为用户正好是要说话：首次会弹系统授权框，这是对的
        // 时候（§3.8）。按住式下「按下去才发现不可用」是白按一次。
        guard await AudioCapture.requestPermission() else {
            model.raiseTerminalMessage(
                HoldToTalkPresentation.microphoneDeniedNotice,
                sessionId: sessionId,
                id: "voice.notice",
                opensSettings: true
            )
            return
        }
        // 「语音识别未配置」不进预检：它是平台侧的配置问题，唯一能自救的人是部署方，
        // 预检它只是白搭一次网络往返（§3.8）。它留给真正去签名的那一刻。
        // 拒绝的理由说连接状态自己的话，不笼统给一句「网络已断开」：token 过期和正在
        // 重连要用户做的事完全不同（去重新登录 vs 等一会儿），而它们在这一格里长得
        // 一模一样。这条记的是状态，连接回来会自己消失（`expiresWithConnectivity`）。
        if case .noServer = model.connectivity {
            model.raiseTerminalMessage(
                model.connectivity.label,
                sessionId: sessionId,
                id: TerminalMessageId.voiceOffline
            )
            return
        }
        // 两个键盘和这个模式不能同时在：它们都会盖住手指马上要按住的那一格。
        dismissKeyboards()
        chooseVoiceMode(true)
    }

    /// 进来时把上次留下的模式摆好。
    ///
    /// 只查，不问权限：进来的时候用户还没有要说话，系统授权框该出现在他按下切换键
    /// 或按住那一格的时候（§3.8）。查不过就**静静留在键盘态** —— 提示条留给切换键
    /// 那条路，否则每进一个终端都浮一条，看多了就成了背景板，而它要说的话（去开权限）
    /// 在用户真打算说话的时候才听得进去。
    ///
    /// 查也不过就不写回偏好：记住的是用户的意图，能不能用是这一刻的事，权限补上、
    /// 网络回来之后它自己就生效了。
    private func restoreInputMode() {
        guard voiceModePreferred, !voiceMode else { return }
        guard AudioCapture.isPermissionGranted else { return }
        if case .noServer = model.connectivity { return }
        voiceMode = true
    }

    // MARK: - 说完之后

    /// 松手之后：收尾 → 落地。模式不动（§3.3）。
    ///
    /// 录音中途断网和来电打断也走这里。它们**不给控制器加方法** —— `confirm()` 本来
    /// 就返回「要落进输入框的文本」，`.failed` 和 `.interrupted` 两种状态下都会把已经
    /// 识别到的字交出来，所以视图只需要按原因浮一条提示（§5.2、§5.5）。
    private func settleVoice() async {
        guard !settlingVoice else { return }
        settlingVoice = true
        defer {
            settlingVoice = false
            // 锁到这里才放。收尾中这条栏还是高的 —— §4.6 要的是「拿到结果、文字落定」
            // 在同一个渲染里发生，早一步把栏收回去就成了两段感，而且会先闪一下语音态
            // 那条栏。失败与中断也走这里（§5.2、§5.5）。
            voiceGrid.unlock()
        }

        // 按下不足 200ms：`start()` 是异步的（要签名、起采集），松手时可能还没进录音
        // 态。这不是「没听到」，是手滑了一下（§5.7）。
        guard voice.phase != .idle else {
            voice.cancel()
            return
        }

        // 原因要在收尾之前读出来 —— `confirm()` 会把 `phase` 抹回 idle，那之后就看
        // 不出刚才是断网还是说完了。
        let notice = voiceInterruption()
        let heard = await voice.confirm()
        // 这一格**不动**。说完一句是这一轮走完了，不是用户选了别的模式：他选的语音态
        // 就是用来连着说话的，每次说完把他打回键盘态，等于每句都要再按一次切换键。
        // 模式只由切换键改（§3.3）。

        guard let heard else {
            // `confirm()` 空手而归会把控制器留在 `.failed(.noSpeech)`，而 `start()` 只
            // 在 `.idle` 时才接活 —— 不把它收回来，下一次按住将什么都不会发生。
            let heardNothing = voice.phase == .failed(.noSpeech)
            voice.cancel()
            // 「没听到」和「录不下去了」是两件事。原因已经浮在提示条上了，再补一句
            // 「没有听到声音」是两句话打架（§5.2）—— 识别未配置时文本必然为空，这条
            // 挡的主要就是它。
            if heardNothing, notice == nil {
                emptyVoiceMessage = VoiceInputController.Failure.noSpeech.message
                // 这一句只有占位符在说，而占位符就在手指底下。中断与断网那两条走
                // `raiseTerminalMessage`，由它自己震（见 `Haptics` 的「一声」）。
                Haptics.warning()
            }
            if let notice {
                model.raiseTerminalMessage(notice.text, sessionId: sessionId, id: notice.id)
            }
            return
        }

        land(VoiceLanding.resolve(transcript: heard, draft: draft))
        if let notice {
            model.raiseTerminalMessage(notice.text, sessionId: sessionId, id: notice.id)
        }
    }

    /// 要浮出来的那一条：文案 + 它认哪个 id。
    ///
    /// `id` 为 nil 表示 id 按文案走 —— 那些是对这一轮录音的回答，留到用户手动关。
    private struct VoiceInterruption {
        let text: String
        let id: String?
    }

    /// 这次录音是被什么打断的。nil 表示用户自己说完松的手。
    ///
    /// 三条原因原样复用 `VoiceInputController.Failure.message`，不新编同义句（§4.8）。
    private func voiceInterruption() -> VoiceInterruption? {
        switch voice.phase {
        case .failed(let failure):
            return VoiceInterruption(
                text: failure.message,
                // 只有「网络断了」那条认固定 id：它记的是网络通不通这个状态，连接回来
                // 就该跟着消失（`expiresWithConnectivity`）。「没有听到声音」和「语音
                // 识别未配置」说的是这一轮和平台配置，网络回来它们照样成立。
                id: failure == .network ? TerminalMessageId.voiceNetwork : nil
            )
        case .interrupted:
            return VoiceInterruption(text: HoldToTalkPresentation.interruptedNotice, id: nil)
        default:
            return nil
        }
    }

    /// 转写该往哪里落（§4.7）。
    ///
    /// 松手那条与锁定态「确定」那条都走它 —— 写两份分流必然会漂开。
    private func land(_ landing: VoiceLanding) {
        switch landing {
        case .send(let text):
            Haptics.commit()
            send(text)
        case .append(let text):
            Haptics.commit()
            draft = text
        case .nothing:
            break
        }
    }

    var body: some View {
        @Bindable var model = model

        terminalScreen
        // The bottom safe area is the input bar's surface, not the canvas's: it is
        // what shows through the keyboard's rounded top corners, and what shows under
        // the bar once the keyboard is down. Filled with the canvas colour it read as
        // two dark corners — the terminal bleeding out from under a bar that no
        // longer shares its colour.
        .background(Color(uiColor: .systemBackground).ignoresSafeArea(edges: .bottom))
        // The canvas keeps its own dark surface — its colours come from the
        // desktop's emulator and the fixed terminal palette, not from the app's
        // theme — while the bars above and below it follow the system. Nothing
        // here pins the colour scheme: a scene-level pin is inherited by the
        // screen that comes next, which is what made leaving the terminal flash
        // from dark to light.
        .navigationTitle(session?.title ?? "会话")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(!usesSystemNavigationBar)
        // Hiding the navigation bar is what disables the system's edge-swipe back
        // gesture, so restoring it takes the gesture recogniser behind the bar —
        // a different mechanism from a view's own preferences, which the status
        // bar experiment showed are not forwarded.
        .background(InteractivePopGesture())
        .toolbar(usesSystemNavigationBar ? .visible : .hidden, for: .navigationBar)
        // The phone keeps its immersive terminal, while a wide detail retains the tabs.
        .toolbar(usesSystemNavigationBar ? .visible : .hidden, for: .tabBar)
        .toolbar {
            if usesSystemNavigationBar {
                ToolbarItem(placement: .topBarTrailing) { moreMenu }
            }
        }
        .onAppear {
            model.openTerminal(sessionId)
            // 进终端这一条是后面所有终端记录的基线：没有它，那些 offset 与 inset
            // 就没有"相对于什么"可言。
            DiagnosticLog.record(.terminalEnter, terminalEnterFields())
            refreshPasteboardImage()
            // 相册往后每变一次都回来重算。截图就在这台屏幕上截下来的时候，它是唯一
            // 能接住那一下的东西 —— 入库是相册自己的事，什么时候完成只有它知道。
            if recentPhotoWatcher == nil {
                let watcher = TerminalRecentPhotoWatcher { Task { await refreshRecentPhoto() } }
                watcher.start()
                recentPhotoWatcher = watcher
            }
            Task { await refreshRecentPhoto() }
            // 摆在前两件之后、也不等任何异步：它只读已经给着的权限和当下的连接，
            // 所以进来那一帧就已经是语音态，不会先画一下键盘态再翻过去。
            restoreInputMode()
            // 方向先抄进镜像：`onChange(of:)` 要等下一次变化才轮到它，而这一帧就要用。
            compactHeight = verticalSizeClass == .compact
            // 横屏：进来那一屏是带栏的，先让人看见这一页是什么，再让栏退场。
            // 竖屏这一下什么都不做 —— 那里的栏不退场，见 `armChromeIdle`。
            armChromeIdle()
        }
        // 这一页去掉安全区之后有多高。量它只为横屏那条限高（键盘面板），不参与任何
        // 布局 —— `onGeometryChange` 就是这个形状的读取，挂在 `VStack` 上不改变它
        // 一毫。
        //
        // 量到的必然是**可用**高度：根视图拿到的提议尺寸已经把安全区去掉了，而横屏
        // 的左右安全区不算在这条高度里。
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
            availableHeight = height
        }
        // 收栏的禁制解开的那一刻重新上表。这一条同时接住了三件事：说完一句话、
        // 关掉一块面板、收起键盘 —— 它们各自都不产生触摸事件，却都是"这一摊子完了"。
        .onChange(of: chromeConditions) { _, conditions in
            if conditions.mayAutoHide { armChromeIdle() }
        }
        // 转屏。两件事都在这一个入口里做完：先把方向抄进那个镜像（`isCompactHeight`），
        // 再按新方向收拾收栏那一摊。
        //
        // - **转进横屏：上表。** 横屏会自己收栏，而这一页进来的时候多半还是竖屏，所以不
        //   在这里补一次的话，转过去之后栏会一直挂着，直到用户碰点什么才想起来要收 ——
        //   而横屏恰恰是最该收的那个方向。
        // - **转回竖屏：把带过来的"收着"清掉。** 转屏不是收栏的一条路，可横屏那条路会
        //   把状态带过界：人举着手机转过来，面对的会是一块没有栏也没有出口的屏幕，而
        //   竖屏那一条恰恰是「栏一直在」。
        .onChange(of: verticalSizeClass) { _, sizeClass in
            compactHeight = sizeClass == .compact
            if isCompactHeight {
                armChromeIdle()
            } else if chromeHidden {
                setChrome(hidden: false)
            }
        }
        // Coming back to the front is how an image copied in another app — or on the
        // computer the user is sitting at — reaches this device's pasteboard while
        // this screen is the one being looked at.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                refreshPasteboardImage()
                Task { await refreshRecentPhoto() }
                // 后台待过的那几秒不算"没人操作"：回来的时候人正看着这一屏。
                armChromeIdle()
            } else {
                chromeIdleTask?.cancel()
            }
        }
        .onDisappear {
            // Leaving the screen ends the recording with it: a microphone left open
            // behind a pushed-back list is the kind of thing that only gets noticed
            // from the status bar.
            voice.cancel()
            // 这一页走了，那班收气泡的岗就没有要收的东西了；相册那个监听也一样，
            // 注册是强引用，留着它就是一个再也没人看的页面一直在读相册。
            recentPhotoExpiry?.cancel()
            recentPhotoWatcher?.stop()
            recentPhotoWatcher = nil
            // 收栏那两班岗也一样：这一页走了，它们要收的东西已经不在了。
            chromeIdleTask?.cancel()
            chromeSettleTask?.cancel()
            panelSettleTask?.cancel()
            model.closeTerminal(sessionId)
        }
        // 终端没了，这个页面跟着走。停止、删除、在电脑上关掉、进程自己退出，最后都
        // 落在同一件事上：电脑送来的列表里不再有它。留着这一页就是把人摆在一个没有
        // 出口的空屏幕上 —— 它既不是「已结束」，也没有第二句话可说。
        //
        // 判据只能是「列表里没有」，不能是「不是运行中」：刚建出来的终端是先跳进来
        // 再等下一份列表的，那一瞬间它也「不是运行中」。
        .onChange(of: sessionIsGone) { _, gone in
            if gone { onClose() }
        }
        .onChange(of: voice.phase) { _, phase in
            // 录音中途断网、或者来电把这次录音打断：手指可能还按着，但这次已经录不
            // 下去了（§5.2、§5.5）。立刻收尾 —— 已经听到的字一个字不丢。
            //
            // `noSpeech` 不在此列：它只是把「没有听到声音」摆出来，麦克风还开着，用户
            // 接着说就能接上。
            switch phase {
            case .failed(.network), .failed(.notConfigured), .interrupted:
                Task { await settleVoice() }
            default:
                break
            }
        }
        .onChange(of: voice.notice) { _, message in
            guard let message else { return }
            // The one refusal here that cannot be acted on inside the app: the
            // microphone is a system permission, so it carries a way to go and grant
            // it. Stable id, because it is the same problem every time it appears.
            model.raiseTerminalMessage(
                message,
                sessionId: sessionId,
                id: "voice.notice",
                opensSettings: true
            )
            voice.notice = nil
        }
        .sheet(isPresented: $showingRename) {
            // 这里和列表左滑进去的是同一个面板：同一个动作在两处出现两种样子，是同一
            // 件事讲了两遍不一样的答案。
            RenameSessionSheet(title: session?.title ?? "") { newName in
                Haptics.commit()
                model.rename(sessionId, to: newName)
            }
        }
        .alert("停止这个会话？", isPresented: $showingStopConfirm) {
            Button("取消", role: .cancel) {}
            Button("停止", role: .destructive) {
                // A dialog button gets no feedback from the system, and this is the
                // one in the app that cannot be undone.
                Haptics.warning()
                model.stop(sessionId)
            }
        } message: {
            Text("该会话将被停止，未保存的进程状态会丢失。")
        }
        .alert("这个会话正在等待操作", isPresented: $showingBusyConfirm) {
            Button("取消", role: .cancel) { pendingFiles = [] }
            Button("仍然插入") {
                // Proceeding past a caution, so it is felt rather than merely done.
                Haptics.warning()
                hand(pendingFiles, confirmed: true)
            }
        } message: {
            Text("它正在等你回答一个问题或输入密码，插入路径可能被当成回答。")
        }
        .sheet(isPresented: $showingPhotoPicker) {
            PhotoLibraryPicker(
                selectionLimit: AppConfiguration.relayMaxFileCount,
                onPicked: { results in
                    showingPhotoPicker = false
                    Task { await intake(results: results) }
                },
                onCancelled: { showingPhotoPicker = false }
            )
            .ignoresSafeArea()
        }
        .sheet(isPresented: $shortcutPanelPresented) {
            TerminalShortcutPanel(
                buttons: buttons,
                // `nil` is a computer that has never described its sentences, which is
                // not the same as one that has none — see `TerminalQuickPhrasesState`.
                phrases: model.activeQuickPhrases,
                isRunning: isRunning,
                onRun: { button in
                    noteChromeActivity()
                    // 焦点不动，和工具栏上那颗胶囊同一条规则（理由见 `accessoryKeys`）。
                    shortcutPanelPresented = false
                    model.runToolbarButton(button, sessionId: sessionId)
                },
                onInsert: { phrase in
                    noteChromeActivity()
                    shortcutPanelPresented = false
                    // Into the field and nowhere else. Not sent, because a sentence is
                    // text rather than an act and the user is about to read it back
                    // before deciding; and not focused, because focusing is what raises
                    // the system keyboard — which would cover the terminal at the exact
                    // moment the reader is deciding whether to send.
                    draft = phrase.content
                },
                // The reader's own list for the computer being viewed. Empty rather
                // than optional: a computer never answers "I have no clipboard", so
                // there is no second meaning for the panel to keep apart — see
                // `ClipboardHistoryStore`.
                clipboardEntries: model.activeClipboardEntries,
                onCopyClipboard: { entry in
                    noteChromeActivity()
                    // The panel stays open, unlike the two above. Copying is usually
                    // followed by copying a second one, and the copy is already
                    // confirmed by the buzz and the notice.
                    model.copyClipboardEntry(entry)
                },
                onClearClipboard: {
                    noteChromeActivity()
                    model.clearClipboardHistory(for: model.selectedDesktopClientInstanceId)
                }
            )
            // The panel is presented *over* this screen, so the overlay this screen
            // already carries is behind it — and the clipboard segment's whole
            // confirmation is a notice, raised while the panel stays open. Without this
            // the reader copies an item and sees nothing at all.
            //
            // 这一屏盖的是**某个会话**，所以它也照那个会话筛：面板浮在上面时，拒绝另一条
            // 会话的句子照样不该出现在这里。
            .noticeOverlay(model, forSession: sessionId)
        }
        .inspector(isPresented: $resourcesPresented) {
            TerminalResourcesSheet(store: store)
                .inspectorColumnWidth(min: 280, ideal: 360, max: 440)
        }
        .sheet(item: $gitFlow) { flow in
            TerminalGitPanel(flow: flow)
                // 面板盖在这一页上，这一页自己的提示条就在它下面 —— 而面板里每个动作的
                // 结果都是一句提示。少了这一条，用户按了「推送」什么也看不到。
                .noticeOverlay(model, forSession: sessionId)
        }
        .sheet(isPresented: $showingDocumentPicker) {
            DocumentPicker(
                onPicked: { urls in
                    showingDocumentPicker = false
                    Task { await intake(urls: urls) }
                },
                onCancelled: { showingDocumentPicker = false }
            )
            .ignoresSafeArea()
        }
        .fullScreenCover(isPresented: $showingCamera) {
            CameraPicker(
                onPicked: { capture in
                    showingCamera = false
                    Task { await intake(cameraCapture: capture) }
                },
                onCancelled: { showingCamera = false }
            )
            .ignoresSafeArea()
        }
    }

    /// 这一页的本体：三条栏、画布、键盘槽位。
    ///
    /// 单独抽成一个属性，不是因为它被用了两次，是为了**让编译器喘口气**：它和 `body`
    /// 上那条长修饰链拼在同一个表达式里做类型检查，会超时（再挂一条 `.onChange` 就够了）。
    private var terminalScreen: some View {
        VStack(spacing: 0) {
            // 三条栏一起收放。判据见 `chromeConditions`：正在打字、正在说话、面板开着
            // 的时候它们走不了，所以"栏收了而录音浮层还在"这种画面构造不出来。
            if !chromeHidden {
                topChrome
            }
            TerminalTextView(
                store: store,
                fontSize: fontSize,
                displayMode: displayMode,
                desktopGrid: desktopGrid,
                revision: store.renderRevision,
                onRequestHistory: { model.requestHistory(sessionId) },
                // 点画布做两件事，顺序无关：收键盘，和把栏叫回来。栏收着的时候这两件
                // 事不可能同时有对象（键盘开着栏就收不了），所以不会互相打架。
                onTap: {
                    revealChrome()
                    dismissKeyboards()
                },
                // 拖着读历史也算操作。少了这一条，读一屏长输出读一半，栏会从手底下
                // 收走 —— 而变化的不只是栏：画布变高，电脑那边的终端跟着重排，
                // 正在读的这一屏就当着面跳了一下。
                onUserScroll: noteChromeActivity
            )
            // 横屏左右各有一条安全区（灵动岛那一侧）。栏的底色铺出去，画布的底色也要
            // 铺出去 —— 否则终端两边镶着两条系统色的边，而它们是同一块屏幕。
            //
            // 铺的是底色不是文字：文字照旧留在安全区里。HIG 的做法，而且灵动岛真的会
            // 盖住最边上那两三列。
            .background(Theme.terminalBackground.ignoresSafeArea(edges: .horizontal))
            .onAppear { syncDisplayMode() }
            .onChange(of: displayMode) { syncDisplayMode() }
            .onChange(of: session?.cols) { syncDisplayMode() }
            .onChange(of: session?.rows) { syncDisplayMode() }
            // Both are measured by the view, so they are what the desktop is asked
            // to adopt. Rotation and a dismissed keyboard both land here.
            .onChange(of: store.columns) { reportGridToDesktop() }
            .onChange(of: store.visibleRows) { reportGridToDesktop() }
            .onChange(of: inputFocused) {
                // Asking for the system keyboard is asking for the other one to go:
                // only one of the two can be up, and this is the only place either is
                // asked for by name. Tapping the field is the one thing on this screen
                // that asks for this one — no button raises a keyboard (2026-09-21).
                if inputFocused { keyboardPanelPresented = false }
                reportGridToDesktop()
                refreshPasteboardImage()
            }
            // Anchored to the canvas rather than to the screen, so the queue clears both
            // the back button above it and the input bar below it. An overlay rather than
            // an inset for a reason particular to this screen: a reserved strip would
            // change `visibleRows`, which is reported to the desktop as a grid size, and a
            // one-second notice would resize the PTY twice.
            //
            // 照样按会话筛。这一屏是这句话最危险的地方：拒绝一次打开请求说的可能是**另一个**
            // 会话（通知、消息记录、手机自己刚建的那个、等下一份列表的挂起请求带来的 id），
            // 而画在这里，读者只会读成「我正在用的这个结束了」—— 一块好好的画布上被通知
            // 一句它自己的死讯。见 `Notice.sessionId`。
            .noticeOverlay(model, forSession: sessionId)
            TerminalMessageList(
                messages: terminalMessages,
                onDismiss: { model.dismissTerminalMessage($0) }
            )
            TerminalRelayStrip(
                attachments: relayAttachments,
                onUndo: { model.undoTypedPaths($0) },
                onDismiss: { model.dismissRelay($0) },
                onRetry: { model.retryRelay($0) }
            )
            // One bar, two modes: typing, or talking. Voice is a mode of this bar rather
            // than a button on it, so the four slots hold still and only what the field
            // *is* changes. `accessoryBar` above stays live throughout — dictating and
            // pressing a command are not mutually exclusive.
            //
            // 工具栏与输入栏合成一组，语音浮层就挂在这一组上：它浮在**整条输入区之上**，
            // 也就是终端画面上。挂在这一组而不是挂输入栏，是因为按住说话时工具栏要保持
            // 可用 —— 浮层压住那一排按钮，正是产品负责人指出过的问题。
            if !chromeHidden && !barsStandDown {
                VStack(spacing: 0) {
                    if !toolbarStandDown && !store.resources.isEmpty { resourceBar }
                    // 横屏时工具栏已经并进上面那一行了，这里只剩输入栏。
                    if !isCompactHeight && !toolbarStandDown { accessoryBar }
                    inputBar
                }
                .overlay(alignment: .top) {
                    // 位置靠一个**零高度的框**而不是 `alignmentGuide` 拿到：框的顶边就是
                    // 这一组的顶边（`overlay` 的 `.top`），框自己 0 高，里面的浮层按
                    // `.bottom` 对齐 —— 于是它整个挂在框上方。`alignmentGuide(.top)`
                    // 在这里不生效：浮层会落到下方，一路顶着屏幕底边跑出去。
                    //
                    // 零高度还保证它**不参与布局**：进了 `VStack` 就会改变终端的可视高度，
                    // 进而让 `reportGridToDesktop` 往电脑上报一个错的格子数。
                    // 外面这层 `ZStack` 只是为了给 `animation` 找一个**常驻**的落脚点：
                    // 挂在条件视图自己身上是来不及的 —— 它被建出来的那一帧，动画还没人
                    // 去开。它跟原来那个 `.frame` 一样参与不了布局，面板照旧挂在框上方。
                    ZStack(alignment: .bottom) {
                        if voicePresentation.panelVisible {
                            TerminalVoiceDock(
                                presentation: voicePresentation,
                                panelRect: $voicePanelRect,
                                onCancelLocked: cancelLockedVoice
                            )
                            .fixedSize(horizontal: false, vertical: true)
                            // 从下沿弹出来：小一点、淡一点起步，过冲一下就落定。缩放的支点
                            // 放在下沿，所以它是从工具栏那一条线上长出来的，不是从自己中间
                            // 涨开的。
                            //
                            // 这一下能留着，是因为起麦克风已经不在主线程上了（见
                            // `AudioCapture.startOffMainThread`）：逐帧推进的动画最怕
                            // 主线程被占住，而这一下正好发生在按住的那一瞬间。
                            .transition(
                                reduceMotion
                                    ? .opacity
                                    : .scale(scale: 0.9, anchor: .bottom).combined(with: .opacity)
                            )
                        }

                        // 最新那张图。和录音浮层共用这一格，理由相同：它也要浮在输入区
                        // 之上而不占任何高度（占一行就会改掉报给电脑的格子数）。录音时
                        // 让位 —— 那块面板铺满整条，底下压着一张缩略图，点下去就发走了。
                        if let recentPhoto, !voicePresentation.panelVisible {
                            recentPhotoBubble(recentPhoto)
                                .frame(maxWidth: .infinity, alignment: .trailing)
                                .padding(.trailing, 12)
                                .padding(.bottom, 8)
                                .transition(
                                    reduceMotion
                                        ? .opacity
                                        : .scale(scale: 0.9, anchor: .bottomTrailing).combined(with: .opacity)
                                )
                        }
                    }
                    .frame(height: 0, alignment: .bottom)
                    // 干脆的一下：过冲只有一点点，落定得快。再弹就是玩具了。
                    .animation(
                        reduceMotion ? nil : .snappy(duration: 0.3, extraBounce: 0.1),
                        value: voicePresentation.panelVisible
                    )
                    .animation(
                        reduceMotion ? nil : .snappy(duration: 0.3, extraBounce: 0.1),
                        value: recentPhoto?.id
                    )
                }
                // 坐标系开在**最外层**，把输入栏和浮层一起圈进来。
                //
                // 挂在那两格的 `VStack` 上是不够的：`overlay` 不是它的子视图，而是套在它
                // 外面的另一层，浮层里的 `frame(in: .named(...))` 会量到零矩形 —— 而判定里
                // 「零矩形永不命中」那条正好把零矩形挡掉，于是怎么滑都是「松手发送」。
                .coordinateSpace(.named(Self.voiceSpace))
            }
            // Last, so that everything above it keeps its place and the terminal is
            // what gives up the room — the same bargain the system keyboard makes.
            //
            // 它在收放的判断之外 —— 面板不是被收放的那三条栏之一。有一个状态是两条规则
            // 的交点：面板开着的时候点菜单里的「全屏」（那颗禁制挡的是计时器，挡不住人
            // 点名）。那副样子是终端整屏、下面一块键盘，两边都还在，没有谁缺了谁。
            keyboardPanel
        }
    }

    // MARK: - 诊断

    /// 进终端时的基线。
    ///
    /// 单独一个函数而不是写成内联的数组字面量：那种写法会让类型检查器在一个
    /// 混合了可选值、枚举与三元表达式的字面量上卡住（实测直接报
    /// "unable to type-check this expression in reasonable time"）。
    private func terminalEnterFields() -> [DiagnosticEntry] {
        let mode: DiagnosticFlag = displayMode == .desktopDriven ? .desktopDriven : .phoneDriven
        let sessionValue = DiagnosticLog.alias(.session, sessionId)
        let title = SessionTitle(session?.title ?? "")
        return [
            DiagnosticEntry(.session, sessionValue),
            DiagnosticEntry(.title, .title(title)),
            DiagnosticEntry(.displayMode, .flag(mode)),
            DiagnosticEntry(.density, .flag(display.density(for: sessionId).diagnosticFlag)),
            DiagnosticEntry(.gridColumns, .int(session?.cols ?? 0)),
            DiagnosticEntry(.gridRows, .int(session?.rows ?? 0)),
            DiagnosticEntry(.rowCount, .int(store.rows.count)),
            DiagnosticEntry(.atHistoryFloor, .bool(store.reachedHistoryFloor)),
        ]
    }

    // MARK: - Bars

    /// Compact windows keep the phone bars; a wide detail uses system navigation.
    @ViewBuilder
    private var topChrome: some View {
        if !usesSystemNavigationBar {
            if isCompactHeight { compactBar } else { navigationBar }
        }
    }

    private var navigationBar: some View {
        HStack(spacing: 10) {
            backButton
            titleBlock
            moreMenu
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background { barSurface }
        .overlay(alignment: .bottom) {
            Divider().opacity(0.3)
        }
    }

    /// 横屏那一行：原来的两条栏压成一条，四颗固定键与中间那段指令挤在一起。
    ///
    /// 横屏的可用高度剩不到竖屏的一半（iPhone 15 横屏约 372pt），而栏上的零件一个都
    /// 不能缩小 —— 44pt 是点击目标的底线，缩了就是按不准。能减的只有**行数**，所以顶栏
    /// 让出自己那一行，把 ‹ 和 ⋯ 交给工具栏：`‹ 标题 ⌘ …指令… ⇧ ⋯`。
    ///
    /// 指令横滑区照旧拿走剩余的全部宽度（它是这里唯一可伸缩的一段），四颗固定键永不压缩。
    private var compactBar: some View {
        HStack(spacing: 10) {
            backButton
            compactTitleBlock
            accessoryKeys
            moreMenu
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
        .background { barSurface }
        .overlay(alignment: .bottom) {
            Divider().opacity(0.3)
        }
    }

    /// 两条顶栏共用的底色。
    ///
    /// Opaque, not a material. A material samples what is behind it, and what is behind
    /// here is the dark canvas — which is what turned this bar into a grey gradient in
    /// light appearance. `ignoresSafeArea(edges: .top)` extends it through the status
    /// bar so the bar and the status bar area are one surface.
    private var barSurface: some View {
        Rectangle()
            .fill(Color(uiColor: .systemBackground))
            .ignoresSafeArea(edges: .top)
    }

    private var backButton: some View {
        Button {
            onClose()
        } label: {
            Image(systemName: "chevron.left")
                .font(.system(size: 17, weight: .semibold))
                // This bar is one we lay out ourselves, so there is no system
                // 44pt floor behind the button: the glyph is drawn at 17 and is
                // handed its own room to be hit in — declared as the shape, or
                // the room is drawn but not hit.
                .frame(width: Metrics.minimumTapTarget, height: Metrics.minimumTapTarget)
                .contentShape(Rectangle())
        }
        .accessibilityLabel("返回")
    }

    private var titleBlock: some View {
        VStack(spacing: 1) {
                Text(session?.title ?? "会话")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                HStack(spacing: 5) {
                    // 圆点留着：它是**会话**状态（运行中 / 等确认 / 离线），与这一轮无关。
                    Circle()
                        .fill(statusColor)
                        .frame(width: 6, height: 6)
                    // 这一行现在是两种东西二选一：会话状态加版本号（现状），或者当前目录的
                    // Git 那一行。合成一句话而不是让视图各判一次，是因为「还没收到回答」与
                    // 「不是仓库」在这里必须长得一模一样、而与「是仓库」必须不同 ——
                    // 判据只有 `TerminalGitPresentation` 那一处。
                    //
                    // 版本文本是**让位**给分支的，不是被删掉：版本号是报问题时引用的号，
                    // 不是抬头要看的东西，而终端目录不是仓库时它照旧显示。
                    //
                    // One line always so a narrow phone truncates this row instead of
                    // wrapping it — a wrap would cost the terminal a row, which is the
                    // same reason the version text was put on this line in the first place.
                    Text(secondLine)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        // 这一行有两个来源（会话状态那一句，或当前目录的 Git 那一句），
                        // 而验收要看的正是「现在是哪一个」—— 给它一个稳定的地址。
                        .accessibilityIdentifier("terminal-second-line")
                }
            }
            .frame(maxWidth: .infinity)
        }

    /// 顶栏第二行那句话。Git 那一行的口径见 `TerminalGitPresentation`。
    private var secondLine: String {
        TerminalGitPresentation.secondLine(
            model.gitStatus(for: sessionId),
            otherwise: "\(statusLabel) · \(AppVersion.label)"
        )
    }

    /// 横屏那一行里的标题：一行，圆点 + 标题 + 状态。
    ///
    /// 版本文本在这里让位 —— 它本来就是"报问题时要引用的那个号"，不是抬头要看的东西，
    /// 而横屏这一行还要装下指令横滑区。宽度的上限也是为它留的：标题占得再多，中间那段
    /// 就滚不动了。
    private var compactTitleBlock: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(statusColor)
                .frame(width: 6, height: 6)
            Text(session?.title ?? "会话")
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
            Text("· \(statusLabel)")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(maxWidth: 220, alignment: .leading)
    }

    private var moreMenu: some View {
        Menu {
            Picker(selection: modeBinding) {
                ForEach(TerminalDisplayMode.allCases, id: \.self) { mode in
                    Text(mode.label).tag(mode)
                }
            } label: {
                Label("显示模式", systemImage: "rectangle.split.2x1")
            }
            // Offered only where it decides anything. The density is a choice
            // about how many columns fit across the pane, and only the
            // phone-driven mode has columns to choose: the desktop-grid mode
            // takes the computer's column count and sizes the cell to fill the
            // pane with it, so a density there would be a control wired to
            // nothing — a reader would move it, see no change, and stop
            // trusting the rest of the menu.
            //
            // The value itself is kept either way, so switching modes does not
            // throw away a choice made in the other one.
            if displayMode == .phoneDriven {
                Picker(selection: sessionDensityBinding) {
                    Text("跟随系统").tag(TerminalDensity?.none)
                    ForEach(TerminalDensity.allCases, id: \.self) { value in
                        Text(value.label).tag(TerminalDensity?.some(value))
                    }
                } label: {
                    Label("本会话显示密度", systemImage: "textformat.size")
                }
            }
            // Git：排在这几个动作的最前面，而且**不是仓库时不出现** —— 与「列表为空时
            // 入口不出现」同一条口径，不摆一个点开是空的入口。第二行显示分支用的也是
            // 同一个判据（`TerminalGitPresentation.isRepository`），两处不可能说岔。
            if TerminalGitPresentation.isRepository(model.gitStatus(for: sessionId)) {
                Button {
                    noteChromeActivity()
                    let flow = TerminalGitFlow(sessionId: sessionId)
                    flow.prepare()
                    gitFlow = flow
                } label: {
                    // 同下面几行：不带图标。上面那两组选项本来就只画文字，只有这几行各多
                    // 一个图标，摆在一起是两种样子。
                    Text("Git")
                }
                .accessibilityIdentifier("terminal-menu-git")
            }
            // 全屏。竖屏收栏只有这一条路（三条栏在那里不自己走，见 `armChromeIdle`），
            // 横屏也有 —— 两个方向都能把栏收起来，所以两处都该有这颗开关。
            //
            // 不做成「退出全屏」：菜单在顶栏上，而全屏的顶栏是没有的，所以这一行永远
            // 只可能被读到一个方向。收起来之后要回来就点一下画布，这条手势本来就在。
            Button {
                Haptics.select()
                setChrome(hidden: true)
            } label: {
                Text("全屏")
            }
            Button {
                noteChromeActivity()
                showingRename = true
            } label: {
                // 菜单里这几行操作不带图标：上面那两组选项本来就只画文字，只有
                // 这几行各多一个图标，摆在一起是两种样子。选中仍然由系统在对
                // 勾那一列画出来，不靠图标区分。
                Text("重命名")
            }
            Button {
                // Nothing copied is nothing to confirm — the same rule the send
                // key follows. A terminal opened a moment ago has no output yet.
                guard !store.plainText.isEmpty else { return }
                noteChromeActivity()
                UIPasteboard.general.string = store.plainText
                // Copying is the archetype of a result the screen does not show:
                // the text leaves for the clipboard and nothing moves here.
                Haptics.success()
                // The one message on this screen that is not a problem. It carries
                // its own id so copying twice restarts one second rather than
                // queueing a second confirmation.
                model.notice("已复制会话输出。", tone: .success, id: "terminal.copied")
            } label: {
                Text("复制全部输出")
            }
            if session?.isRunning == true {
                Button(role: .destructive) {
                    noteChromeActivity()
                    showingStopConfirm = true
                } label: {
                    Text("停止会话")
                }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 30, height: 30)
                .background(Color(uiColor: .secondarySystemBackground), in: Circle())
                // The circle is the control; this is the room around it. Applied
                // after the background so the circle keeps its own size and only
                // the tappable box grows to the minimum.
                .frame(width: Metrics.minimumTapTarget, height: Metrics.minimumTapTarget)
                .contentShape(Rectangle())
        }
        .tint(.primary)
        .accessibilityLabel("更多")
    }

    /// The computer's own toolbar, mirrored: two fixed keys with the commands between
    /// them.
    ///
    /// The commands are the desktop's — its built-ins and whatever the user added there
    /// — with its separators in the same places. The list is read-only: adding, editing
    /// and deleting a command belong to the computer, and there is deliberately no
    /// pencil here.
    ///
    /// Only the middle scrolls. The whole bar used to be one `ScrollView`, which meant
    /// the key at its leading edge slid off the screen as soon as a user had more than
    /// a few commands — so the one control that opens the keyboard panel became the
    /// one control that could not be found. The two fixed keys are outside the scroll
    /// for the same reason, and they are what gives the scroll its room: they hold
    /// their intrinsic size while the scroll view, having none, takes whatever is left.
    /// At the narrowest iPhone that remainder is still wider than a pill, so the scroll
    /// gives way before either key is ever compressed.
    ///
    /// The two fixed keys are this phone's own and are not the same thing twice:
    /// `⌘` opens the panel of keys the system keyboard cannot express, and `⇧` opens
    /// the full list of commands, which is the answer to having scrolled past the one
    /// you wanted. Neither is disabled with the terminal stopped — a stopped terminal
    /// still has an input field and still has commands worth reading.
    private var accessoryBar: some View {
        accessoryKeys
            .padding(.horizontal, 12)
            .background(Color(uiColor: .systemBackground))
    }

    private var resourceBar: some View {
        Button {
            noteChromeActivity()
            resourcesPresented = true
        } label: {
            HStack {
                Text("会话资源 ×\(store.resources.count)")
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(.secondary)
            }
            .frame(minHeight: Metrics.minimumTapTarget)
            .padding(.horizontal, 16)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(Color(uiColor: .systemBackground))
        .overlay(alignment: .bottom) { Divider() }
        .accessibilityLabel("查看 \(store.resources.count) 个会话资源")
    }

    /// 工具栏的零件，三种排布共用：竖屏的工具栏、横屏的合并栏。
    ///
    /// 抽出来是因为它就是"⌘ · 指令 · ⇧"这三块本身，横竖屏的差别只在它跟谁同行、四周留
    /// 多少白 —— 而那两件事各由一层 `padding` 说完就够了。
    private var accessoryKeys: some View {
        // 两颗固定键与中间的指令条之间不留间距。它们没有底色，那颗点击框里已经各留了
        // 十几点的空白 —— 这里再让出一道，边上就同时有了两段留白。
        //
        // 点击框的宽是 `minimumTapTarget`，和下面输入栏两端的麦克风、发送键一样：两
        // 行都是左右各 12pt 内边距加一颗这个宽的格子，所以上下两组图标的中心落在同一条
        // 竖线上。它们原本是 48pt，比下面宽 4pt，两行的图标因此差着 2pt 对不齐。
        HStack(spacing: 0) {
            // 左固定：键盘面板。图标由 ⌨ 换成 ⌘，因为它下面的输入栏左端已经是一颗
            // 键盘 —— 相邻两行同一个图形会被当成同一件事。换的只是脸：它开的还是
            // 原来那个面板，`toggleKeyboardPanel()` 一个字没改。
            Button {
                Haptics.select()
                noteChromeActivity()
                toggleKeyboardPanel()
            } label: {
                Image(systemName: "command")
                    .font(.system(size: 16))
            }
            // 没有胶囊底：它不是一条指令，是工具栏上两颗钉住的键之一 —— 中间那排有底色、
            // 这两颗没有，区别靠底色就够，不必再拿留白去说。
            .terminalKeyPill(minWidth: Metrics.minimumTapTarget, bare: true)
            // The panel's own keys have always been drawn plain, and these two were not:
            // the default button style is what put a press animation on a key that is
            // just a key. Nothing here is a link or a tinted action.
            .buttonStyle(.plain)
            .accessibilityLabel("打开键盘")
            .accessibilityIdentifier("toolbar-keyboard")

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(buttons.enumerated()), id: \.element.id) { index, button in
                        // A separator wherever the computer's own list changes kind —
                        // before the first slash command, and before the user's own —
                        // so the two bars read as the same list rather than merely
                        // similar ones. The group travels with the button precisely so
                        // this needs no rule. It scrolls with the commands because it is
                        // the command list's own structure, not the bar's.
                        if index > 0, buttons[index - 1].group != button.group {
                            divider
                        }
                        // 按一条指令**不碰输入焦点**（2026-09-21 产品负责人在真机上点的：
                        // 按「回车」把手机键盘叫起来了）。这是电脑上的一个动作，不是在这里
                        // 打字 —— 把焦点要过来就是请系统键盘上来，而键盘一上来这整条栏自己
                        // 让位（`toolbarStandDown`），于是刚按下的那颗键连同它正要读的结果
                        // 一起被盖住。短语行不给焦点是同一条理由（见 `onInsert`）。
                        Button(button.label) {
                            Haptics.select()
                            noteChromeActivity()
                            model.runToolbarButton(button, sessionId: sessionId)
                        }
                        .terminalKeyPill()
                        .buttonStyle(.plain)
                        .disabled(!isRunning)
                        .opacity(isRunning ? 1 : 0.4)
                        // Named by the button's own id, which is stable across renames
                        // — a test has to be able to press the same command after its
                        // label changed, and a label is the one thing here that is the
                        // user's.
                        .accessibilityIdentifier("toolbar-\(button.id)")
                    }
                }
                // 指令条自己不带左右内边距：它的两端挨着的是两颗固定键的框，不是
                // 屏幕边，而两边本来就已经各留了空白。
                .padding(.vertical, 2)
            }
            // Named so a test can scroll it: the commands are wider than the screen once
            // a user has a few, and a control that has been scrolled past is one a test
            // otherwise has to guess its way back to.
            .accessibilityIdentifier("toolbar-scroll")

            // 右固定：全部指令。面板开着时保持按下态，所以这颗键自己也是「面板在开
            // 着」的那条状态指示 —— 终端在面板后面继续跑，被盖住的正是它的最新几行。
            Button {
                Haptics.select()
                noteChromeActivity()
                shortcutPanelPresented.toggle()
            } label: {
                Image(systemName: "chevron.up")
                    .font(.system(size: 16))
            }
            .terminalKeyPill(
                minWidth: Metrics.minimumTapTarget,
                pressed: shortcutPanelPresented,
                bare: true
            )
            .buttonStyle(.plain)
            .accessibilityLabel("全部指令")
            .accessibilityIdentifier("toolbar-all")
        }
    }

    /// The keys the system keyboard cannot express, in the slot the system keyboard
    /// would take.
    ///
    /// A row of the screen rather than a sheet over it, which is the whole difference:
    /// a sheet floats above the layout and hides what is under it, so the toolbar and
    /// the input bar — the two things that say what this screen is doing — went behind
    /// it, and the terminal's newest lines with them. A keyboard is not something you
    /// put in front of a terminal; it is something that takes room from it. Sitting
    /// here, below the input bar, everything above is simply laid out on what is left.
    ///
    /// The panel sends a list rather than a single key because one chord needs two
    /// actions: Alt is an Escape prefix, and both halves have to travel in one intent
    /// for the terminal not to act on the bare Escape in between.
    @ViewBuilder
    private var keyboardPanel: some View {
        if keyboardPanelPresented {
            TerminalKeyboardPanel(
                isEnabled: isRunning,
                // 面板自己定高（346），这里只给上限：竖屏给满，横屏压下来。横屏那一档
                // 加上顶栏会超出屏幕，顶栏会被挤出画面 —— 而面板本身两页同高，
                // 横屏翻页也仍然不动。
                maxHeight: availableHeight
            ) { actions in
                model.sendKeys(sessionId, actions)
                // 按一颗键也是操作：面板本身让栏收不了，但按完这一下之后应当从头计时。
                noteChromeActivity()
                // The panel stays up — pressing several keys, or holding an arrow, is
                // the ordinary way to use it, and a panel that closed after each one
                // would have to be reopened for each one.
                if actions.contains(.key(.enter)) { model.commitDeliveredAttachments(for: sessionId) }
            }
        }
    }

    private var divider: some View {
        Rectangle()
            .fill(Color(uiColor: .separator))
            .frame(width: 1, height: 16)
    }

    /// The one bar under the terminal, in two modes: typing, or talking.
    ///
    /// Voice is a mode of this bar rather than a button on it (设计文档 §3.2), so both
    /// modes are the same four slots at the same four widths — the toggle, the field,
    /// ＋ and send. Only what the field *is* changes. That is what keeps the toggle
    /// under the same thumb when the mode changes back, and what makes the bar's
    /// height the same in both.
    private var inputBar: some View {
        HStack(spacing: 8) {
            modeToggle(voicePresentation)

            if voicePresentation.barIsVoice {
                holdToTalk(voicePresentation)
            } else {
                commandField
            }

            attachMenu(voicePresentation)

            sendKey(voicePresentation)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color(uiColor: .systemBackground))
        .overlay(alignment: .top) { Divider().opacity(0.3) }
    }

    /// 输入栏与气泡共用的那一份呈现值。
    ///
    /// 两处各算一次而不是存进状态：它是一个纯值，两处算出来的必然相同，而存一份就
    /// 多一个会和 `voice`、`holdZone` 漂开的地方。
    private var voicePresentation: HoldToTalkPresentation {
        HoldToTalkPresentation(
            phase: voice.phase,
            voiceMode: voiceMode,
            hasDraft: !draft.isEmpty,
            transcript: voice.transcript,
            elapsed: voice.elapsed,
            gesture: holdZone,
            locked: voiceGrid.isLocked
        )
    }

    /// 左端常驻的键盘 / 语音切换键。
    ///
    /// 它是这套结构里唯一的锚点，位置永远不变 —— 它动了整套就散了（§3.2）。
    private func modeToggle(_ presentation: HoldToTalkPresentation) -> some View {
        Button {
            Haptics.select()
            noteChromeActivity()
            toggleVoiceMode()
        } label: {
            Image(systemName: presentation.barIsVoice ? "keyboard" : "mic")
                .font(.system(size: 22))
                .foregroundStyle(Theme.ink)
                .frame(width: Metrics.minimumTapTarget, height: Metrics.minimumTapTarget)
                .contentShape(Rectangle())
        }
        .disabled(!presentation.controlsEnabled)
        .opacity(presentation.controlsEnabled ? 1 : 0.4)
        .accessibilityIdentifier("voice-mode-toggle")
        .accessibilityLabel(presentation.barIsVoice ? "切换到键盘" : "切换到语音")
        // 模式报在这一格上，而不是包着四格的 HStack 上：`accessibilityIdentifier`
        // 加在容器上会向下盖掉每一个子元素的标识 —— 那样 `attach` 和 `send` 会连同
        // 它们的测试一起消失，而屏幕上看起来什么都没变。
        .accessibilityValue(presentation.barIsVoice ? "voice" : "keyboard")
    }

    /// 语音态下顶上输入框那一格的东西：按住即录，上滑到面板选去路，松手落定。
    ///
    /// 那一格本身只是被按住的地方，也是**唯一写着「松手会发生什么」的地方** ——
    /// 两个去路画在它上方的录音面板上（见 `TerminalVoiceDock`），不在这一格里：手指正
    /// 压着这一格，写在这里的字正好被自己的手盖住，而按住期间手一定压着。
    private func holdToTalk(_ presentation: HoldToTalkPresentation) -> some View {
        // 录着就是红的（苹果给「正在录」的颜色），固定之后翻成实心那一对，其余时候
        // 是这根栏上普通的输入格。三种底都是实色，文字各自配一个在这个底上读得出来的
        // 颜色 —— 明暗两边都成立。
        //
        // 固定那一种的 `.opacity(1)` 不是多余的：`Theme.ink` 就是 `Color.primary`，当
        // **填充**用的时候按「主要前景」那一档算，不带着这个透明度就落不成实色。
        let fill: AnyShapeStyle = presentation.recording
            ? AnyShapeStyle(Color(uiColor: .systemRed))
            : presentation.locked ? AnyShapeStyle(Theme.ink.opacity(1)) : AnyShapeStyle(Color(uiColor: .secondarySystemBackground))
        return Text(presentation.barLabel)
            .font(.subheadline)
            .foregroundStyle(presentation.recording || presentation.locked ? Theme.paper : Theme.ink)
            .lineLimit(1)
            .frame(maxWidth: .infinity)
            .frame(minHeight: Metrics.minimumTapTarget)
            .background(fill, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            // 整格都是手势区，而不只是字画到的地方。
            .contentShape(Rectangle())
            .gesture(holdGesture)
            // 固定之后手指早走了，这一格上不再有手势 —— 它变成一枚「完成」，点一下就收尾。
            .onTapGesture { if presentation.locked { finishLockedVoice() } }
            .accessibilityIdentifier("voice-hold")
    }

    /// 按住说话那一格上的手势。
    ///
    /// `DragGesture(minimumDistance: 0)` 一步到位地给了按下、拖动、松开 —— 自己写
    /// UIKit 识别器只会多出一份要和 SwiftUI 布局对齐的状态。
    private var holdGesture: some Gesture {
        // 位置报在**浮层所在的那个坐标系**里。要选的东西是上面那块面板，判定就得用
        // 它真正的位置，而不是「手指往哪边滑了多少」—— 压在哪一半上是二维的事。
        DragGesture(minimumDistance: 0, coordinateSpace: .named(Self.voiceSpace))
            .onChanged { value in
                if !holdLatched { beginHold() }
                updateHold(at: value.location)
            }
            .onEnded { _ in endHold() }
    }

    /// 手指动了：它压在面板的左半还是右半，决定这一格现在说什么。
    ///
    /// 判定只有一条 ——**压到面板上了没**。没压上去就是「松手发送」，压上去就按蒙层的
    /// 左右分成取消 / 固定；所以「选左边」和「选右边」的总路程只有「输入栏到面板」这
    /// 一段，而够得着的目标又是整块面板那么大的两半。
    private func updateHold(at point: CGPoint) {
        let next = HoldToTalkGesture.outcome(at: point, panel: voicePanelRect, armed: holdZone)
        // `onChanged` 每一帧都来，写一次状态就是一次整屏重算。
        guard next != holdZone else { return }
        holdZone = next
        // 压上面板、换到另一半、掉回发送 —— 都是手指底下那层蒙层在变。手指这时候往往
        // 压着屏幕，轻震一下是最省事的一条确认。
        Haptics.select()
    }

    /// 手势与面板共用的坐标系名字。
    private static let voiceSpace = "terminalVoice"

    private func beginHold() {
        holdLatched = true
        // 按下去这一下是操作；而接下来那几秒靠 `isVoiceBusy` 顶着，不必再报。
        noteChromeActivity()
        holdZone = .speaking
        // 蒙层不是一按就盖：它由「往上滑压到面板上」请出来（`updateHold`）。一按就盖
        // 等于在用户还没表达意图之前先摆出两个选项，而多数时候他要的只是说一句就发。
        // 上一次那句「没有听到声音」到此为止（§5.3）。
        emptyVoiceMessage = nil
        Haptics.record()
        voice.start { await model.requestAsrSignature() }
    }

    /// 松手。
    private func endHold() {
        guard holdLatched else { return }
        holdLatched = false
        let zone = holdZone
        holdZone = .speaking

        switch zone {
        case .cancelling:
            // 取消之后**留在语音态**：多半是想重说一遍，让人再按一次切换键没有道理
            // （§3.3）。`draft` 一个字不改 —— 这一格从来没碰过它。
            Haptics.select()
            voice.cancel()
        case .locking:
            // 手指走了，录音继续：这一格换成录音会话栏，手可以去翻终端（§4.9）。
            // 这一下是确认，「手走了它还在录」正是屏幕要说而手指挡住的话。
            Haptics.commit()
            voiceGrid.lock(holding: DesktopGrid(columns: store.columns, rows: store.visibleRows))
        case .speaking:
            // 松手本身不震：这一句有没有落地要等收尾回来才知道，落地那一下由
            // `land(_:)` 给。在这里再给一次，就成了同一件事的两声。
            Task { await settleVoice() }
        }
    }

    /// 固定态里按下「取消」：这一段不要了，**模式不动**。
    ///
    /// 它曾经连着退回键盘态（理由是「长录之后主动收摊，接着多半要打字」）。那是个
    /// 猜测，而且猜错一次的代价不小：用户的语音态会连同偏好一起被抹掉。模式只由
    /// 切换键改这一条，没有例外 —— 要打字，切换键就在左边那一格。
    private func cancelLockedVoice() {
        Haptics.select()
        voice.cancel()
        voiceGrid.unlock()
    }

    /// 固定之后按「完成」：把这一段收掉，发出去。
    ///
    /// 与「松手发送」走同一条落定路径 —— 分流只有 `VoiceLanding` 那一处实现。
    private func finishLockedVoice() {
        Haptics.commit()
        voiceGrid.unlock()
        Task { await settleVoice() }
    }

    /// The command field. A plain field with no microphone beside it: voice moved to the
    /// left end and became a mode, and a second way in would only make people guess
    /// which one is different (设计文档 §3.2).
    private var commandField: some View {
        // 占位会被换成「没有听到声音」。识别为空是一次**就地**的说明，不是一件需要
        // 被知道的事：它落在输入框原来就写着字的地方，动一下键盘就没了（§5.3）。
        TextField(emptyVoiceMessage ?? "输入命令", text: $draft)
            .textFieldStyle(.plain)
            .font(.system(.body, design: .monospaced))
            .frame(minHeight: Metrics.minimumTapTarget)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .submitLabel(.send)
            .focused($inputFocused)
            .onSubmit(sendDraft)
            // 打字是这里最要紧的一种"人还在"。输入框有焦点时栏本来就收不了，这一句管
            // 的是另一头：手停了、键盘收起来之后，那三秒要从**最后一个字**算起。
            .onChange(of: draft) {
                emptyVoiceMessage = nil
                noteChromeActivity()
            }
    }

    private func attachMenu(_ presentation: HoldToTalkPresentation) -> some View {
        Menu {
            Button {
                noteChromeActivity()
                showingPhotoPicker = true
            } label: {
                Label("照片和视频", systemImage: "photo.on.rectangle")
            }
            // Hidden where there is no camera — the simulator, and any device
            // without one — rather than offered and then failing.
            if CameraPicker.isAvailable {
                Button {
                    noteChromeActivity()
                    showingCamera = true
                } label: {
                    Label("拍照", systemImage: "camera")
                }
            }
            Button {
                noteChromeActivity()
                showingDocumentPicker = true
            } label: {
                Label("文件", systemImage: "folder")
            }
            if pasteboardHoldsImage {
                Button {
                    noteChromeActivity()
                    sendPastedImage()
                } label: {
                    Label("粘贴图片", systemImage: "doc.on.clipboard")
                }
            }
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 22))
                .foregroundStyle(Theme.ink)
                .frame(width: Metrics.minimumTapTarget, height: Metrics.minimumTapTarget)
                .contentShape(Rectangle())
        }
        .tint(Theme.ink)
        // Dimmed while a finger is on the field, rather than taken away: the slot keeps
        // its place, so nothing has to be found again afterwards (设计文档 §4.1).
        .disabled(!presentation.controlsEnabled)
        .opacity(presentation.controlsEnabled ? 1 : 0.4)
        .accessibilityIdentifier("attach")
        .accessibilityLabel("添加附件")
    }

    /// The key at the right end. It holds its place in voice mode and fades there: the
    /// words that mode produces are sent on release without passing through this key
    /// (设计文档 §4.3). Nothing is added or moved, so switching back leaves send exactly
    /// where it was.
    private func sendKey(_ presentation: HoldToTalkPresentation) -> some View {
        let enabled = presentation.sendEnabled
        return Button(action: sendDraft) {
            Image(systemName: "arrow.up.circle.fill")
                .font(.system(size: 30))
                .foregroundStyle(enabled ? Theme.ink : Color.secondary)
                .frame(width: Metrics.minimumTapTarget, height: Metrics.minimumTapTarget)
                .contentShape(Rectangle())
        }
        .disabled(!enabled)
        .opacity(presentation.barIsVoice ? 0.4 : 1)
        .accessibilityIdentifier("send")
        .accessibilityLabel("发送")
    }

    private func sendDraft() {
        // 写在门槛之前：这一下是**发出去**还是"没东西可发"，都是人按的那一下。
        noteChromeActivity()
        let text = draft
        guard !text.isEmpty else { return }
        // After the guard: a send with nothing to send does nothing, and a tap
        // felt there would say something happened.
        Haptics.commit()
        draft = ""
        send(text)
    }

    /// 发一条给终端。发送键与语音的「松手即发送」共用它 —— 同一条消息不该因为走了
    /// 哪条路而长得不一样。
    private func send(_ text: String) {
        model.sendCommand(sessionId, text: text)
        // The path an inserted file typed goes out with this line, so the chip that
        // carried it has nothing left to undo.
        model.commitDeliveredAttachments(for: sessionId)
    }

    // MARK: - 最新那张图

    /// 相册里最新的一张，摆在输入栏上方等着被点。
    ///
    /// 只有图，没有名字也没有句子陪着：它自己就是它要说的那句话，而「你可能有张
    /// 照片要发」是在替用户念一张他自己刚拍的图。点击目标的下限它本来就够（缩略图
    /// 比 44 点大），所以不必再套一层框 —— 它浮在终端之上，多出来的每一平方点压掉的
    /// 都是用户在读的行。
    ///
    /// 一圈边框而不是投影：这个 App 的层级靠线，不靠叠阴影（见 `SurfaceCard`）。这一
    /// 圈在这里担的是最重的那件事 —— 它压在终端画布上，而画布是固定的近黑，没有它
    /// 一张截图就是一块边界不明的方块（颜色为什么是固定值，见 `Theme.canvasRing`）。
    private func recentPhotoBubble(_ photo: RecentPhoto) -> some View {
        Button {
            sendRecentPhoto(photo)
        } label: {
            Image(uiImage: photo.thumbnail)
                .resizable()
                .scaledToFill()
                .frame(width: Self.recentPhotoBubbleSide, height: Self.recentPhotoBubbleSide)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(Theme.canvasRing, lineWidth: Self.recentPhotoBubbleRing)
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("recent-photo")
        .accessibilityLabel("发送最近的照片")
    }

    private static let recentPhotoBubbleSide: CGFloat = 64
    private static let recentPhotoBubbleRing: CGFloat = 2

    /// 重算这张提议。
    ///
    /// 几个时机的判定都收在这里，而不是各自算一遍：够不够新、是不是已经露过面、有没有
    /// 授权，三件事一起决定它出不出来，分开写必然会有一处漂开。
    private func refreshRecentPhoto() async {
        showRecentPhoto(await TerminalRecentPhotoLibrary.latestOfferable())
    }

    /// 摆出来，并且只摆 `recentPhotoDisplayDuration` 那么久。
    ///
    /// 摆过就记一笔，所以同一张图只会浮一次。这既是为了不重复打扰，也是「实时检测
    /// 变化」这句话成立的前提 —— 只有新的一张才叫变化，看过的那张再浮上来只是噪声。
    private func showRecentPhoto(_ photo: RecentPhoto?) {
        recentPhotoExpiry?.cancel()
        recentPhotoExpiry = nil

        guard let photo else {
            recentPhoto = nil
            return
        }

        TerminalRecentPhotoLibrary.markShown(photo.id)
        recentPhoto = photo
        recentPhotoExpiry = Task { @MainActor in
            try? await Task.sleep(for: .seconds(recentPhotoDisplayDuration))
            guard !Task.isCancelled else { return }
            recentPhoto = nil
        }
    }

    /// 点一下气泡：把那一张发出去，和从相册里选它是同一条路。
    private func sendRecentPhoto(_ photo: RecentPhoto) {
        // 点下去就算这一张用掉了，无论它最后有没有发出去：读文件失败、或者终端在等
        // 回答时用户否掉了那个确认框，都会让同一张图再飘回来 —— 而让人对着一张自己
        // 刚点过的图再点一次，比少一次提议更糟（第二次点是会真的发出去的）。
        TerminalRecentPhotoLibrary.markShown(photo.id)
        recentPhoto = nil
        recentPhotoExpiry?.cancel()
        recentPhotoExpiry = nil

        Task {
            guard let file = await TerminalFileIntake.prepare(libraryAssetId: photo.id) else {
                model.raiseTerminalMessage("没有读取到可发送的图片。", sessionId: sessionId)
                return
            }
            hand([file])
        }
    }

    /// 用户用过一次「照片和视频」之后，才问相册权限。
    ///
    /// 时机是这一步的全部内容，所以它写在这里而不是写在一个「App 启动时」的地方。
    /// 进来就是为了一张相册里的图 —— 此刻问「能不能读你的相册」有人答得上来；换到
    /// 首次进终端时问，那是在为一个用户还不知道存在的功能索取权限。
    ///
    /// 用过的这一次本身也记一笔：他刚挑的那张可能正好就是最新的一张，不记的话授权
    /// 一给，同一张图立刻从输入栏上方又浮出来。
    private func offerRecentPhotoAccess() async {
        guard TerminalRecentPhotoLibrary.isUndetermined else {
            await refreshRecentPhoto()
            return
        }
        await TerminalRecentPhotoLibrary.requestAccess()
        await refreshRecentPhoto()
    }

    // MARK: - Sending files to the computer

    private func intake(results: [PHPickerResult]) async {
        var files: [PickedFile] = []
        for result in results {
            // 相册自己对这一张的称呼（有的话）。从「文件」里挑的、或者别的 App 导
            // 出来的没有这个名字，那些本来也不会飘上来。
            if let assetId = result.assetIdentifier {
                TerminalRecentPhotoLibrary.markShown(assetId)
            }
            if let file = await TerminalFileIntake.prepare(provider: result.itemProvider) {
                files.append(file)
            }
        }
        // 挑完这一张，就是「用过一次照片和视频」了。文件先走，授权后问：中转条先
        // 出现在屏幕上，接下来那个弹窗在问什么才有上下文。
        let picked = !files.isEmpty
        hand(files)
        // 终端在等回答时 `hand` 会先弹一个确认框，再叠一个系统授权框，用户会以为
        // 自己点错了什么。那一次就算了 —— 下次用相册时还会走到这里。
        if picked, !showingBusyConfirm { await offerRecentPhotoAccess() }
    }

    private func intake(urls: [URL]) async {
        var files: [PickedFile] = []
        for url in urls {
            if let file = await TerminalFileIntake.prepare(documentURL: url) {
                files.append(file)
            }
        }
        hand(files)
    }

    private func intake(cameraCapture: CameraCapture) async {
        let file: PickedFile?
        switch cameraCapture {
        case .photo(let image):
            file = await TerminalFileIntake.prepare(cameraImage: image)
        case .video(let url):
            file = await TerminalFileIntake.prepare(cameraVideo: url)
        }
        guard let file else {
            model.raiseTerminalMessage("没有读取到可发送的文件。", sessionId: sessionId)
            return
        }
        hand([file])
    }

    /// Whether the pasteboard holds an image, answered at the few moments the answer
    /// can have changed. `hasImages` talks to the pasteboard service, so it is not
    /// something to ask on every pass of a body that a keystroke already re-runs —
    /// and the menu it feeds cannot ask for itself, being built before it opens.
    private func refreshPasteboardImage() {
        pasteboardHoldsImage = UIPasteboard.general.hasImages
    }

    private func sendPastedImage() {
        // The offer was made from a reading taken earlier, and the pasteboard is
        // the one thing on screen that another app can change underneath it.
        guard let image = UIPasteboard.general.image else {
            model.raiseTerminalMessage("剪贴板里已经没有图片了。", sessionId: sessionId)
            pasteboardHoldsImage = false
            return
        }
        Task {
            guard let file = await TerminalFileIntake.prepare(pastedImage: image) else {
                model.raiseTerminalMessage("没有读取到可发送的图片。", sessionId: sessionId)
                return
            }
            hand([file])
        }
    }

    /// Starts the transfer, or asks first when the terminal is waiting on a person.
    ///
    /// The design's caution, narrowed to where the risk actually is. A terminal in
    /// `waiting` is one an agent has stopped at — an approval, a question, a
    /// password — and the path inserted there can be read as the answer. `unknown`,
    /// the state of every plain shell, is not evidence of anything and asking on it
    /// would put a dialog in front of the common case until the user learned to tap
    /// through it.
    private func hand(_ files: [PickedFile], confirmed: Bool = false) {
        guard !files.isEmpty else {
            model.raiseTerminalMessage("没有读取到可发送的文件。", sessionId: sessionId)
            return
        }
        if !confirmed, session?.attention.isWaiting == true {
            pendingFiles = files
            showingBusyConfirm = true
            return
        }
        pendingFiles = []
        model.sendFiles(files, to: sessionId)
    }

    private var statusLabel: String {
        guard let session else { return model.connectivity.label }
        if session.attention.isWaiting { return "等待确认" }
        return session.isRunning ? "运行中" : "已结束"
    }

    private var statusColor: Color {
        guard let session else { return .secondary }
        return Theme.statusColor(isWaiting: session.attention.isWaiting, isRunning: session.isRunning)
    }
}

/// Puts the interactive pop gesture back on a screen that hides its back button.
///
/// The bar is hidden, not absent: the gesture recogniser still exists, it is just
/// switched off with the button. Handing it a delegate of our own turns it back on
/// and lets us say when it may start.
private struct InteractivePopGesture: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController {
        Controller()
    }

    func updateUIViewController(_ controller: UIViewController, context: Context) {}

    final class Controller: UIViewController, UIGestureRecognizerDelegate {
        private weak var previousDelegate: UIGestureRecognizerDelegate?
        private weak var gesture: UIGestureRecognizer?

        override func didMove(toParent parent: UIViewController?) {
            super.didMove(toParent: parent)
            guard let gesture = navigationController?.interactivePopGestureRecognizer else { return }
            self.gesture = gesture
            previousDelegate = gesture.delegate
            gesture.delegate = self
            gesture.isEnabled = true
        }

        /// Hands the recogniser back exactly as it was found.
        ///
        /// It is one object shared by the whole navigation controller, so a
        /// delegate left behind would outlive this screen and change how the next
        /// one behaves.
        deinit {
            guard let gesture else { return }
            gesture.delegate = previousDelegate
            gesture.isEnabled = false
        }

        /// Only when there is something to go back to.
        ///
        /// Each tab owns a `NavigationStack`, and at its root there is nothing
        /// behind the screen; the classic failure of this technique is the gesture
        /// recognising there anyway.
        ///
        /// Measured honestly: this gate could **not** be shown to be load-bearing.
        /// The root behaves the same with and without it, because the delegate is
        /// weak and is gone by the time the terminal has been popped. It is kept as
        /// the documented mitigation for a failure that did not reproduce here,
        /// not because it was observed to prevent one.
        func gestureRecognizerShouldBegin(_ gesture: UIGestureRecognizer) -> Bool {
            (navigationController?.viewControllers.count ?? 0) > 1
        }

    }
}
