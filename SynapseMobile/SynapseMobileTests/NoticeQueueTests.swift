import Testing

@testable import SynapseMobile

/// What the queue does before any view draws it.
///
/// Every case here is a way the old single `String?` slot was visibly wrong to the
/// person holding the phone, so the queue is a plain value that can be pinned without a
/// screen: three files refused at once showed only the last reason, and a message that
/// replaced another inherited the first one's countdown and could leave half a second
/// after it arrived.
struct NoticeQueueTests {
    private func queue(
        _ posts: [(text: String, tone: NoticeTone, id: String)]
    ) -> NoticeQueue {
        var queue = NoticeQueue()
        for post in posts { queue.post(post.text, tone: post.tone, id: post.id) }
        return queue
    }

    // MARK: - Replacement

    /// Posting the same id again is the same message arriving twice — a reconnect loop,
    /// or one rejection reported by two paths — so it must edit the bar rather than
    /// stack a duplicate beside it.
    @Test func theSameIdReplacesRatherThanStacks() {
        let queue = self.queue([
            ("命令没有发送。", .failure, "write.rejected"),
            ("电脑离线。", .failure, "write.rejected"),
        ])

        #expect(queue.notices.count == 1)
        #expect(queue.notices.first?.text == "电脑离线。")
    }

    /// The clock keys off this, so a re-post has to move it even when the words are
    /// identical. Without the bump, repeating a message would leave the original
    /// countdown running and the second sighting could vanish immediately.
    @Test func rePostingTheSameWordsStillMovesTheRevision() {
        let once = self.queue([("电脑离线。", .failure, "desktop.offline")])
        let twice = self.queue([
            ("电脑离线。", .failure, "desktop.offline"),
            ("电脑离线。", .failure, "desktop.offline"),
        ])

        #expect(once.notices.first?.revision == 0)
        #expect(twice.notices.first?.revision == 1)
    }

    /// Different words under the same id are a genuinely new message, so the revision
    /// moves and the tone is adopted along with the text.
    @Test func newWordsUnderTheSameIdTakeTheNewTone() {
        let queue = self.queue([
            ("准备上传", .info, "relay.state"),
            ("没有送达", .failure, "relay.state"),
        ])

        #expect(queue.notices.count == 1)
        #expect(queue.notices.first?.tone == .failure)
        #expect(queue.notices.first?.revision == 1)
    }

    /// A message being read must not jump position because something else re-posted.
    @Test func aReplacedMessageKeepsItsPlace() {
        let queue = self.queue([
            ("第一条", .info, "a"),
            ("第二条", .info, "b"),
            ("第一条改过", .info, "a"),
        ])

        #expect(queue.notices.map(\.id) == ["a", "b"])
    }

    // MARK: - Queueing and the visible window

    @Test func differentIdsQueueInArrivalOrder() {
        let queue = self.queue([
            ("甲", .info, "a"),
            ("乙", .info, "b"),
        ])

        #expect(queue.notices.map(\.text) == ["甲", "乙"])
    }

    /// Only the first few are on screen. The rest are waiting and spend no time on a
    /// clock, which is why `armed` is a window rather than the whole queue.
    @Test func onlyTheFirstFewAreArmed() {
        let queue = self.queue([
            ("甲", .info, "a"),
            ("乙", .info, "b"),
            ("丙", .info, "c"),
        ])

        #expect(queue.notices.count == 3)
        #expect(queue.armed.map(\.id) == ["a", "b"])
    }

    /// Taking one away is what promotes the next, so a queued message gets its whole
    /// duration rather than whatever was left of someone else's.
    @Test func dismissingTheFirstPromotesTheNext() {
        var queue = self.queue([
            ("甲", .info, "a"),
            ("乙", .info, "b"),
            ("丙", .info, "c"),
        ])
        queue.remove("a")

        #expect(queue.armed.map(\.id) == ["b", "c"])
    }

    /// `sendFiles` posts one notice per refused file, so a large drop must not queue a
    /// message per file. The ones dropped are reported back so their clocks can be
    /// stopped rather than left running against a notice that is gone.
    @Test func aLongQueueDropsFromTheFrontAndSaysWhich() {
        var queue = NoticeQueue()
        var dropped: [String] = []
        for index in 0..<(NoticeQueue.maxPending + 2) {
            dropped += queue.post("第 \(index) 条", tone: .failure, id: "n\(index)")
        }

        #expect(queue.notices.count == NoticeQueue.maxPending)
        #expect(queue.notices.first?.id == "n2")
        #expect(dropped == ["n0", "n1"])
    }

    @Test func clearingLeavesNothingBehind() {
        var queue = self.queue([
            ("甲", .info, "a"),
            ("乙", .info, "b"),
        ])
        queue.removeAll()

        #expect(queue.notices.isEmpty)
        #expect(queue.armed.isEmpty)
    }

    // MARK: - 一条消息说的是哪个会话

    /// 一句「这个会话已经结束了。」说的是**被点的那个**会话，不是当时屏幕上的那个。
    ///
    /// 五条进终端的路里只有列表那一行是当场取的 id，其余四条（通知、消息里的记录、桌面
    /// 小组件、等下一份列表的挂起请求）带来的都是某一刻记下的 id —— 它们被拒绝时，人很
    /// 可能已经站在另一个会话里了。画在那里，读者只会读成「我正在用的这个结束了」。
    @Test func aSessionScopedNoticeIsNotDrawnOnAnotherTerminalsCanvas() {
        var queue = NoticeQueue()
        queue.post("这个会话已经结束了。", tone: .failure, id: "terminal.ended.a", sessionId: "a")
        queue.post("已复制。", tone: .success, id: "copy")

        // 站在会话 b 的画布上：只有那条不点名归属的话要被画出来。
        #expect(queue.armed(forSession: "b").map(\.id) == ["copy"])
    }

    /// 而它自己的会话、以及**不点名**的那一屏（会话列表列的就是所有会话，这句话正是它该
    /// 说的）照旧画它。
    @Test func aSessionScopedNoticeIsDrawnOnItsOwnScreenAndOnTheList() {
        var queue = NoticeQueue()
        queue.post("这个会话已经结束了。", tone: .failure, id: "terminal.ended.a", sessionId: "a")

        #expect(queue.armed(forSession: "a").map(\.id) == ["terminal.ended.a"])
        #expect(queue.armed(forSession: nil).map(\.id) == ["terminal.ended.a"])
    }

    /// 与某个会话无关的话（复制成功、电脑离线……）哪儿都该画。
    @Test func anUnscopedNoticeIsDrawnEverywhere() {
        var queue = NoticeQueue()
        queue.post("电脑离线，命令没有发送。", tone: .failure, id: "write.rejected")

        #expect(queue.armed(forSession: "a").map(\.id) == ["write.rejected"])
        #expect(queue.armed(forSession: nil).map(\.id) == ["write.rejected"])
    }

    /// 同一个 id 是「同一条消息的又一次到达」，所以**说的是谁**也跟着换。
    ///
    /// 留下来的话，这条落到一个它根本不认识的终端上时照样会被画出来 —— 正好是要防的那件事。
    @Test func rePostingUnderTheSameIdMovesTheSessionToo() {
        var queue = NoticeQueue()
        queue.post("这个会话已经结束了。", tone: .failure, id: "terminal.ended", sessionId: "a")
        queue.post("这个会话已经结束了。", tone: .failure, id: "terminal.ended", sessionId: "b")

        #expect(queue.armed(forSession: "a").isEmpty)
        #expect(queue.armed(forSession: "b").map(\.id) == ["terminal.ended"])
    }

    /// 被筛掉的那条**仍然在队列里**：换个屏幕（回到列表）它就该出现，时钟也照走。
    @Test func filteringIsAboutTheScreenNotTheQueue() {
        var queue = NoticeQueue()
        queue.post("这个会话已经结束了。", tone: .failure, id: "terminal.ended.a", sessionId: "a")

        #expect(queue.armed(forSession: "b").isEmpty)
        #expect(queue.notices.count == 1)
        #expect(queue.armed.map(\.id) == ["terminal.ended.a"])
    }

    // MARK: - Durations

    /// The desktop's own numbers, so the same event does not linger longer on the phone
    /// than on the computer: `desktop/src/app-shell/notification-durations.ts` holds
    /// 1000 ms for a plain notice and 5000 ms for an error.
    @Test func aToneDecidesHowLongItStays() {
        #expect(NoticeTone.success.duration == .seconds(1))
        #expect(NoticeTone.info.duration == .seconds(3))
        #expect(NoticeTone.failure.duration == .seconds(5))
    }

    /// The one thing the three tones must never do is all mean the same amount of
    /// attention. A fixed duration for everything was what made a copied terminal sit on
    /// screen for four seconds and a real failure leave before it could be read.
    @Test func failureOutlastsSuccess() {
        #expect(NoticeTone.failure.duration > NoticeTone.info.duration)
        #expect(NoticeTone.info.duration > NoticeTone.success.duration)
    }
}
