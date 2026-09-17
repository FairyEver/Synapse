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
