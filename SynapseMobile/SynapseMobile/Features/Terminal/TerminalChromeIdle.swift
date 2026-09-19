import Foundation

/// 三条栏此刻可不可以自动收起来（设计文档 §2）。
///
/// 收起 = 全屏终端：顶栏、工具栏、输入栏一起让位给画布。**这不是一条"多久没动"的规则，
/// 而是两条**——闲置够久，并且屏幕上没有一件正在被使用的东西。后一条才是这份类型存在的
/// 理由：举着手说话的人、正在打字的人、面板开着的人都在操作，只是恰好没有新的触摸事件
/// 落到屏幕上；只看时钟会把他们的界面从手底下抽走。
///
/// 纯值：不认识 `VoiceInputController`，也不认识任何一个 `@State`，只认识调用方算好交进来
/// 的几个布尔。判定因此能被单测逐条走完 —— 否则"按住说话时到底收没收"只能靠人在真机上
/// 举着手盯三秒。
struct TerminalChromeConditions: Equatable {
    /// 系统键盘起来了，或者输入框拿着焦点。
    var isTyping: Bool
    /// 自绘的键盘面板（工具栏左端那颗 ⌘）开着。
    var isKeyboardPanelUp: Bool
    /// 语音正忙：手指压着、正在录、或者已经固定住继续录。
    ///
    /// 三种都是"用户正拿着这个东西"，而它们在时间轴上互相衔接 —— 松手到收尾之间
    /// `holdLatched` 已经是假而 `phase` 还没回 `.idle`，所以必须一起看。
    var isVoiceBusy: Bool
    /// 表单 sheet、确认弹窗、附件选择器盖在上面。
    ///
    /// 它们挡着的是**栏本身**，所以收不收当场看不出来；代价出在关掉之后：用户放下重命名
    /// 面板，看到的是一块没有栏的屏幕，还得再点一下才知道栏去哪了。
    var isOverlayUp: Bool
    /// 输入栏上方那张"最新的一张图"还挂着。它也是一条栏，和三条栏存亡与共。
    var isPhotoBubbleUp: Bool
    /// 屏幕是竖着的（竖屏 iPhone、iPad）。
    ///
    /// **竖屏的栏不自己走**（2026-09-20 产品负责人定的）：顶栏加输入栏在那个方向上只占
    /// 一行多一点，而它们自己消失读起来是「界面不见了」，不是「腾地方了」—— 要收就点
    /// 右上角菜单里的「全屏」。横屏相反，那两条占掉可用高度的近三成，所以"自己收"这一条
    /// 只对横屏成立。
    ///
    /// 放在这个纯值里而不是留在 `armChromeIdle` 的守卫上，有两个理由。一是它就是这条
    /// **判定**本身，而这里每一条都被单测逐条走完；二是**什么时候读它**：守卫是在"上表"
    /// 那一刻读的，而转屏前后 `verticalSizeClass` 会飘 —— 上表时读到横屏、到点时其实已经
    /// 不是，那一班岗就白排了（真机实测：三次上表只起来一次，还立刻被下一次取消）。
    /// 读在**到点那一下**，读到的一定是当下。`TerminalScreen.armChromeIdle`。
    var isPortrait: Bool
    /// 正在收或正在放的动画里。中途不重新计数 —— 那会把一次收栏拖成两次。
    var isSettling: Bool
    /// 读屏或切换控制开着。
    ///
    /// 这是唯一一条与用户此刻在干什么无关的判据，也正是它必须在这里的理由：读屏用户
    /// 是用"逐元素浏览"在操作，两次触摸之间可以隔很久，而屏幕上的栏正在被逐条念出来。
    /// 苹果对自动隐藏的界面明确要求在这种时候不要动。
    var isAssistiveTechOn: Bool

    static let none = TerminalChromeConditions(
        isTyping: false,
        isKeyboardPanelUp: false,
        isVoiceBusy: false,
        isOverlayUp: false,
        isPhotoBubbleUp: false,
        isPortrait: false,
        isSettling: false,
        isAssistiveTechOn: false
    )

    /// 这一次闲置到点了，可不可以收。
    var mayAutoHide: Bool {
        !isPortrait
            && !isTyping
            && !isKeyboardPanelUp
            && !isVoiceBusy
            && !isOverlayUp
            && !isPhotoBubbleUp
            && !isSettling
            && !isAssistiveTechOn
    }
}
