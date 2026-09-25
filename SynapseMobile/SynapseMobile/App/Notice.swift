import Foundation

/// How a notice should read, not how loudly it should shout.
///
/// Narrowed from the desktop's six tones (`desktop/src/app-shell/notifications.tsx`):
/// `warning` and `destructive` both mean "this did not happen, and you may want to try
/// again", and `default` and `loading` both mean "for your information". Three is what a
/// bar on a phone can draw differently without inventing a fourth meaning.
enum NoticeTone: String, CaseIterable, Sendable {
    case success
    case info
    case failure

    /// The desktop's own numbers, so the same event does not linger longer here than it
    /// does on the computer — `desktop/src/app-shell/notification-durations.ts` holds
    /// `DEFAULT_NOTIFICATION_DURATION_MS = 1000` and `ERROR_NOTIFICATION_DURATION_MS = 5000`.
    ///
    /// `info` takes the middle, which is the one number this app chooses rather than
    /// inherits: it is neither a confirmation that needs no reading nor a failure that
    /// has to be read.
    ///
    /// Deliberately pure. The VoiceOver stretch and the drag-pause floor both live in
    /// `SynapseAppModel`, so that what a tone means stays testable without a UI.
    var duration: Duration {
        switch self {
        case .success: .seconds(1)
        case .info: .seconds(3)
        case .failure: .seconds(5)
        }
    }
}

/// One message, from the moment it is posted to the moment it leaves.
///
/// A struct rather than an `@Observable` class on purpose: an edit to an element has to
/// travel through `NoticeQueue.notices` for observation to fire, and a reference type
/// would let `text` change with nothing that reads the queue noticing.
struct Notice: Identifiable, Equatable {
    /// Names the *message*, not the event. Posting an id that is already on screen
    /// replaces it rather than stacking a second copy.
    let id: String
    var text: String
    var tone: NoticeTone
    /// 这条消息说的是哪个终端；与某个具体会话无关的（复制成功、网络断了……）是 `nil`。
    ///
    /// 终端的画布只画属于它自己的那几条。一句「这个会话已经结束了。」如果画在**另一个**
    /// 会话的画布上，读者只会把它读成「我正在用的这个结束了」—— 而这正是它要否认的那件事。
    /// 手机上有五条路能打开终端，其中四条带来的是**某一刻**记下的会话 id（通知、消息里的
    /// 记录、桌面小组件、等下一份列表的挂起请求），它们被拒绝时人已经可能站在别的会话里了。
    ///
    /// 名字本身是必要的：拒绝一次打开请求，说的是那个请求点名的会话，而不是当时屏幕上
    /// 的那一个。这条与 `TerminalScreen.terminalMessages` 是同一条规则 —— 「一次拒绝属于
    /// 它来自的那个会话，不跟着切屏跑到别的会话上去说」。
    var sessionId: String?
    /// Bumped every time this id is posted again. The clock keys off this instead of off
    /// the view's identity, which is exactly the bug the old banner had: its `.task` ran
    /// once per view, so a message replacing another inherited the first one's countdown
    /// and could vanish half a second after it appeared.
    var revision: Int
}

/// The messages waiting to be seen.
///
/// Pure: it owns no clock and knows nothing about views. `SynapseAppModel` holds the
/// timers and reconciles them against `armed` after every change here, which is what
/// keeps the interesting part — what replaces what, and what falls off — unit-testable.
struct NoticeQueue: Equatable {
    /// Two is as many as fit above a terminal's input bar without covering the canvas
    /// they are reporting on. The single slot this replaces dropped the second of two
    /// simultaneous messages on the floor.
    static let maxVisible = 2
    /// A ceiling, because `sendFiles` posts one notice per refused file: a twenty-file
    /// drop must not queue twenty messages that each then take a turn on screen.
    static let maxPending = 5

    private(set) var notices: [Notice] = []

    /// The ones on screen, oldest first. Anything past this is waiting and spends no
    /// time on a clock — it gets its whole duration once it is actually shown.
    var armed: [Notice] { Array(notices.prefix(Self.maxVisible)) }

    /// The armed ones as **one screen** draws them.
    ///
    /// `sessionId` 是这一屏说的是哪个终端：终端的画布传自己的 id，于是它只画属于自己的
    /// 那几条；列表不点名（`nil`），因为它列的就是所有会话，一句「你点的那个结束了」正是
    /// 它该说的话。见 `Notice.sessionId`。
    func armed(forSession sessionId: String?) -> [Notice] {
        let visible = armed
        guard let sessionId else { return visible }
        return visible.filter { $0.sessionId == nil || $0.sessionId == sessionId }
    }

    /// Posts a message.
    ///
    /// - Returns: ids that fell off the end to make room, so their clocks can be stopped.
    @discardableResult
    mutating func post(
        _ text: String,
        tone: NoticeTone,
        id: String,
        sessionId: String? = nil
    ) -> [String] {
        if let index = notices.firstIndex(where: { $0.id == id }) {
            // Replaced where it stands rather than moved to the back: a message being
            // read must not jump position under the reader.
            notices[index].text = text
            notices[index].tone = tone
            // 说什么，连同**说的是谁**一起换：同一个 id 被另一条消息接手时，原来那个会话
            // 的名字留着，就会让这条落到一个它根本不认识的终端上去。
            notices[index].sessionId = sessionId
            // Bumped for a plain re-post as well as for new words. Posting the same
            // sentence again means it is news to whoever is looking, so the clock starts
            // over instead of running out the tail of the previous one.
            notices[index].revision += 1
            return []
        }

        notices.append(Notice(id: id, text: text, tone: tone, sessionId: sessionId, revision: 0))
        guard notices.count > Self.maxPending else { return [] }
        let overflow = notices.count - Self.maxPending
        let dropped = notices.prefix(overflow).map(\.id)
        notices.removeFirst(overflow)
        return dropped
    }

    mutating func remove(_ id: String) {
        notices.removeAll { $0.id == id }
    }

    mutating func removeAll() {
        notices.removeAll()
    }
}
