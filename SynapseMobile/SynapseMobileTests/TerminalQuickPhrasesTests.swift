import Foundation
import Testing

@testable import SynapseMobile

/// The phone half of the computer's 快捷输入 sentences: decoding what a computer sent,
/// and deciding what to show when it sent nothing.
///
/// Almost nothing here is a choice — the sentences belong to the computer and are
/// rendered verbatim. What *is* a choice, and what these pin down, is the three-valued
/// answer: sentences, an empty list, or nothing at all. The middle and last of those
/// look identical on screen and mean opposite things to a user.
struct TerminalQuickPhrasesTests {

    // MARK: - Decoding

    private func decode(_ json: String) -> MobileQuickPhrasesPayload? {
        try? JSONDecoder().decode(MobileQuickPhrasesPayload.self, from: Data(json.utf8))
    }

    @Test func decodesASnapshotInTheComputersOwnOrder() throws {
        let payload = try #require(decode("""
        {
          "desktopClientInstanceId": "desktop-1",
          "revision": 7,
          "phrases": [
            {"id": "q1", "content": "用 Easy Worklog 初始化今天的工作日志"},
            {"id": "q2", "content": "这次改动整理成提交说明，中文，说清楚改了什么"}
          ]
        }
        """))

        #expect(payload.desktopClientInstanceId == "desktop-1")
        #expect(payload.revision == 7)
        // Order is the computer's own — it is the order the user arranged, and the
        // phone has nothing of its own to sort by.
        #expect(payload.phrases.map(\.id) == ["q1", "q2"])
        #expect(payload.phrases[0].content == "用 Easy Worklog 初始化今天的工作日志")
    }

    @Test func keepsASentenceByteForByte() throws {
        /*
         * The content goes into the composer as a draft the user is about to send, so
         * anything this client "tidied" would be sent instead of what they wrote on the
         * computer. Leading spaces, a newline, quotes — all of it is theirs.
         */
        let raw = "  第一行\n第二行 \"引号\" & 制表符\t结尾  "
        let payload = try #require(decode("""
        {
          "desktopClientInstanceId": "d",
          "revision": 1,
          "phrases": [{"id": "q1", "content": \(String(data: try JSONEncoder().encode(raw), encoding: .utf8)!)}]
        }
        """))

        #expect(payload.phrases[0].content == raw)
    }

    @Test func rejectsAMessageItCouldNotFileUnderAComputer() {
        // Without an identity the sentences cannot be attributed, and attributing them to
        // the wrong computer is worse than not having them: the panel would offer one
        // machine's sentences while another is on screen.
        #expect(decode("""
        {"revision": 1, "phrases": []}
        """) == nil)
        #expect(decode("""
        {"desktopClientInstanceId": "d", "phrases": []}
        """) == nil)
        #expect(decode("""
        {"desktopClientInstanceId": "d", "revision": 1}
        """) == nil)
        // Strict where the toolbar is lossy: a sentence this build cannot decode is not
        // a newer feature it must tolerate, it is a malformed message.
        #expect(decode("""
        {"desktopClientInstanceId": "d", "revision": 1, "phrases": [{"id": "q1"}]}
        """) == nil)
    }

    // MARK: - What the panel shows

    @Test func aComputerThatHasNeverSaidAnythingHasNoSentences() {
        /*
         * Not an empty list. A computer that predates this message has not told the
         * phone it has no sentences — it has told it nothing — and drawing an empty list
         * for it would show the user an empty state saying their configuration is not
         * there when in fact the phone simply cannot see it.
         */
        #expect(TerminalQuickPhrasesState().phrases(forSelected: "desktop-1") == nil)
        #expect(TerminalQuickPhrasesState().phrases(forSelected: nil) == nil)
    }

    @Test func anEmptyListIsAnAnswerAndIsNotTheSameAsNeverHavingHeard() {
        /*
         * The distinction the whole state exists for. A computer that has sent this
         * message has said what it has, and "none" is a thing it can say — the user can
         * act on that by going to their computer and adding some. Collapsing it into
         * `nil` is what makes a phone and a computer that supports the feature
         * indistinguishable from one too old to.
         */
        var state = TerminalQuickPhrasesState()
        state.adopt(MobileQuickPhrasesPayload(
            desktopClientInstanceId: "desktop-1", revision: 1, phrases: []))

        #expect(state.phrases(forSelected: "desktop-1")?.isEmpty == true)
        // And a computer that has not answered is still `nil`, in the same state.
        #expect(state.phrases(forSelected: "desktop-2") == nil)
    }

    @Test func whatOneComputerSaysIsNotShownForAnother() {
        var state = TerminalQuickPhrasesState()
        state.adopt(MobileQuickPhrasesPayload(
            desktopClientInstanceId: "desktop-1",
            revision: 1,
            phrases: [MobileQuickPhrase(id: "q1", content: "整理成提交说明")]))

        #expect(state.phrases(forSelected: "desktop-1")?.map(\.id) == ["q1"])
        // Switched to a computer that has never sent the message: no segment control,
        // not this other machine's sentences.
        #expect(state.phrases(forSelected: "desktop-2") == nil)
    }

    @Test func aLaterMessageReplacesTheWholeList() {
        // A snapshot, not a delta. A sentence the user deleted on the computer has to
        // disappear here, which is only true if nothing is merged.
        var state = TerminalQuickPhrasesState()
        state.adopt(MobileQuickPhrasesPayload(desktopClientInstanceId: "d", revision: 1, phrases: [
            MobileQuickPhrase(id: "old", content: "旧的"),
            MobileQuickPhrase(id: "keep", content: "留的"),
        ]))
        state.adopt(MobileQuickPhrasesPayload(desktopClientInstanceId: "d", revision: 2, phrases: [
            MobileQuickPhrase(id: "keep", content: "留的"),
        ]))

        #expect(state.phrases(forSelected: "d")?.map(\.id) == ["keep"])
    }

    @Test func editsOnTheComputerArriveAsANewSnapshot() {
        // What "第 24 条：在电脑上改一条短语，手机上能看到更新" rests on — the second
        // message is adopted and its text is the new text, not the old one re-sent.
        var state = TerminalQuickPhrasesState()
        state.adopt(MobileQuickPhrasesPayload(desktopClientInstanceId: "d", revision: 1, phrases: [
            MobileQuickPhrase(id: "q1", content: "整理成提交说明"),
        ]))
        state.adopt(MobileQuickPhrasesPayload(desktopClientInstanceId: "d", revision: 2, phrases: [
            MobileQuickPhrase(id: "q1", content: "整理成提交说明，中文"),
        ]))

        #expect(state.phrases(forSelected: "d")?.first?.content == "整理成提交说明，中文")
    }

    @Test func signingOutForgetsThem() {
        // They are another account's computers' sentences, and nothing here persists.
        var state = TerminalQuickPhrasesState()
        state.adopt(MobileQuickPhrasesPayload(desktopClientInstanceId: "d", revision: 1, phrases: [
            MobileQuickPhrase(id: "q1", content: "整理成提交说明"),
        ]))
        state.reset()

        #expect(state.phrases(forSelected: "d") == nil)
    }
}
