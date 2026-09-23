import Foundation
import Testing

@testable import SynapseMobile

/// 手机这一半：解出电脑发来的分组命令，以及「这个分组有没有命令」这个问题在
/// 「收到过、里面没有」与「从没收到过」两种情形下的答案。
///
/// 两者在屏幕上长得一样（都不画箭头），但只有一个是「我知道，它没有」—— 这条边界是
/// `TerminalToolbarState` 立下的同一条规矩：发过消息的电脑说了算，包括说「没有」。
struct TerminalGroupCommandTests {

    private func decode(_ json: String) -> MobileGroupCommandsPayload? {
        try? JSONDecoder().decode(MobileGroupCommandsPayload.self, from: Data(json.utf8))
    }

    @Test func decodesAGroupCommandListInOrder() throws {
        let payload = try #require(decode("""
        {
          "desktopClientInstanceId": "desktop-1",
          "revision": 3,
          "groups": [
            {"groupId": "g1", "commands": [
              {"id": "c1", "name": "Claude"},
              {"id": "c2", "name": "Codex"}
            ]},
            {"groupId": "g2", "commands": [{"id": "c3", "name": "小慧日报"}]}
          ]
        }
        """))

        #expect(payload.desktopClientInstanceId == "desktop-1")
        #expect(payload.revision == 3)
        // 顺序是电脑自己的，正是分组行要画的那个顺序。
        #expect(payload.groups.map(\.groupId) == ["g1", "g2"])
        #expect(payload.groups[0].commands.map(\.name) == ["Claude", "Codex"])
    }

    @Test func answersForTheComputerBeingViewed() {
        var state = TerminalGroupCommandState()
        state.adopt(MobileGroupCommandsPayload(
            desktopClientInstanceId: "desktop-1",
            revision: 1,
            groups: [MobileGroupCommandsEntry(
                groupId: "g1",
                commands: [MobileGroupCommand(id: "c1", name: "Claude")],
            )],
        ))

        #expect(state.hasCommands(for: "g1", onSelected: "desktop-1"))
        #expect(state.commands(for: "g1", onSelected: "desktop-1").map(\.name) == ["Claude"])
        // 这份列表里没有的分组：这台电脑说了它没有。
        #expect(!state.hasCommands(for: "g2", onSelected: "desktop-1"))
        // 另一台电脑：它自己的分组与这一份无关，不能拿这一份去画它的箭头。
        #expect(!state.hasCommands(for: "g1", onSelected: "desktop-2"))
        // 没在看任何电脑（还没有选中的那台）。
        #expect(!state.hasCommands(for: "g1", onSelected: nil))
    }

    @Test func treatsNoMessageAndAnEmptyListTheSameOnScreen() {
        // 从没收到过 —— 那台电脑太旧：没箭头、点了直接建终端。
        let neverHeard = TerminalGroupCommandState()
        #expect(!neverHeard.hasCommands(for: "g1", onSelected: "desktop-1"))

        // 收到过一份空列表 —— 那台电脑一个分组都没配：屏幕上一样。
        var empty = TerminalGroupCommandState()
        empty.adopt(MobileGroupCommandsPayload(
            desktopClientInstanceId: "desktop-1",
            revision: 1,
            groups: [],
        ))
        #expect(!empty.hasCommands(for: "g1", onSelected: "desktop-1"))
    }

    @Test func clearsTheListOnSignOut() {
        var state = TerminalGroupCommandState()
        state.adopt(MobileGroupCommandsPayload(
            desktopClientInstanceId: "desktop-1",
            revision: 1,
            groups: [MobileGroupCommandsEntry(
                groupId: "g1",
                commands: [MobileGroupCommand(id: "c1", name: "Claude")],
            )],
        ))

        state.reset()

        // 那是上一个账号的电脑上的东西。
        #expect(!state.hasCommands(for: "g1", onSelected: "desktop-1"))
    }

    @Test func keepsTheLastComputerThatSent() {
        // 谁发的就收谁的：`sync` 只发给选中的那台，所以一条别的电脑的消息是迟到的旧
        // 答案，不是错误。
        var state = TerminalGroupCommandState()
        state.adopt(MobileGroupCommandsPayload(
            desktopClientInstanceId: "desktop-1",
            revision: 1,
            groups: [MobileGroupCommandsEntry(
                groupId: "g1",
                commands: [MobileGroupCommand(id: "c1", name: "Claude")],
            )],
        ))
        state.adopt(MobileGroupCommandsPayload(
            desktopClientInstanceId: "desktop-2",
            revision: 1,
            groups: [],
        ))

        #expect(!state.hasCommands(for: "g1", onSelected: "desktop-1"))
        #expect(!state.hasCommands(for: "g1", onSelected: "desktop-2"))
    }
}
