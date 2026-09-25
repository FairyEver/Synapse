import Foundation
import Testing

@testable import SynapseMobile

/// The phone half of the terminal toolbar: decoding what a computer sent, deciding what
/// to show when it sent nothing, and turning a press into an intent.
///
/// The buttons themselves belong to the computer, so almost nothing here is a choice.
/// What is a choice — and what these pin down — is the two places the phone could
/// disagree with the computer: which intent a press becomes, and whether a missing
/// message means an empty bar.
struct TerminalToolbarTests {

    // MARK: - Decoding

    private func decode(_ json: String) -> MobileToolbarPayload? {
        try? JSONDecoder().decode(MobileToolbarPayload.self, from: Data(json.utf8))
    }

    /// The front row's ids, in the order the bar draws them.
    ///
    /// Almost every expectation below is "the phone's own keys, then whatever the
    /// computer said", so the first half is written once here rather than seven times
    /// — where a change to it would be seven chances to forget one.
    private var frontRowIds: [String] { TerminalToolbarState.frontRow.map(\.id) }

    @Test func decodesAWholeToolbarInOrder() throws {
        let payload = try #require(decode("""
        {
          "desktopClientInstanceId": "desktop-1",
          "revision": 4,
          "buttons": [
            {"id": "enter", "label": "回车", "group": "key", "action": {"type": "key", "key": "Enter"}},
            {"id": "interrupt", "label": "Ctrl+C", "group": "key", "action": {"type": "key", "key": "Ctrl+C"}},
            {"id": "slash-exit", "label": "/exit", "group": "command",
             "action": {"type": "text", "text": "/exit", "pressEnter": true}},
            {"id": "c1", "label": "部署", "group": "custom",
             "action": {"type": "text", "text": "pnpm deploy", "pressEnter": false}}
          ]
        }
        """))

        #expect(payload.desktopClientInstanceId == "desktop-1")
        #expect(payload.revision == 4)
        // Order is the computer's own, and it is what the bar draws.
        #expect(payload.buttons.map(\.id) == ["enter", "interrupt", "slash-exit", "c1"])
        #expect(payload.buttons.map(\.group) == [.key, .key, .command, .custom])
        #expect(payload.buttons[0].action == .key(.enter))
        #expect(payload.buttons[3].action == .text("pnpm deploy", pressEnter: false))
    }

    @Test func decodesEveryKeyThePanelCanSend() throws {
        // The panel draws its keys from `MobileKey`, and the computer sends names. A
        // name this build does not know is a button it cannot press, so the two lists
        // have to be the same length — and `MOBILE_KEYS` is 51.
        let names = [
            "Enter", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
            "Backspace", "Ctrl+C", "Ctrl+D",
            "Home", "End", "PageUp", "PageDown", "Delete",
            "Ctrl+A", "Ctrl+E", "Ctrl+U", "Ctrl+K", "Ctrl+W", "Ctrl+L", "Ctrl+R", "Ctrl+Z",
            "Ctrl+B", "Ctrl+F", "Ctrl+G", "Ctrl+H", "Ctrl+J", "Ctrl+N", "Ctrl+O",
            "Ctrl+P", "Ctrl+Q", "Ctrl+S", "Ctrl+T", "Ctrl+V", "Ctrl+X", "Ctrl+Y",
            "Shift+Tab",
            "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
            "Insert",
        ]
        let buttons = names.map {
            """
            {"id": "\($0)", "label": "\($0)", "group": "key", "action": {"type": "key", "key": "\($0)"}}
            """
        }.joined(separator: ",")
        let payload = try #require(decode("""
        {"desktopClientInstanceId": "d", "revision": 1, "buttons": [\(buttons)]}
        """))

        #expect(payload.buttons.count == 51)
        for name in names {
            #expect(MobileKey(rawValue: name) != nil, "\(name) is not a key this build knows")
        }
        // The two the alphabet is missing, and the reason it is missing them: their
        // bytes belong to Tab and Return, so a chord on I or M is sent as that key.
        #expect(MobileKey(rawValue: "Ctrl+I") == nil)
        #expect(MobileKey(rawValue: "Ctrl+M") == nil)
        // Every case is one of the names above: a case the panel can draw but the
        // computer has never heard of would be a key that is rejected on press.
        #expect(MobileKey.allCases.count == 51)
        #expect(Set(MobileKey.allCases.map(\.rawValue)) == Set(names))
    }

    @Test func anAltChordTravelsAsOneIntent() throws {
        /*
         * Alt is an Escape prefix in a terminal, so `Alt+B` is two actions. They have
         * to ride in one intent: sent as two, the terminal sees the bare Escape on its
         * own and acts on it before the letter arrives — which for Escape means
         * leaving whatever mode the user was in.
         */
        let request = MobileIntentRequest(
            intentId: "i1",
            kind: "keys",
            sessionId: "s1",
            actions: [.key(.escape), .text("b")]
        )
        let encoded = try JSONSerialization.jsonObject(
            with: JSONEncoder().encode(request)
        ) as? [String: Any]
        let actions = try #require(encoded?["actions"] as? [[String: Any]])

        #expect(actions.count == 2)
        #expect(actions[0]["type"] as? String == "key")
        #expect(actions[0]["key"] as? String == "Escape")
        #expect(actions[1]["type"] as? String == "text")
        #expect(actions[1]["text"] as? String == "b")
    }

    @Test func dropsOnlyTheButtonsThisBuildCannotActOn() {
        /*
         * Lossy per button, strict for the message. A key from a newer desktop cannot be
         * drawn as something it is not and cannot be sent, so that one button goes — but
         * failing the whole message over it would freeze the entire bar on every older
         * phone the moment a computer gained a single new key.
         */
        #expect(decode("""
        {
          "desktopClientInstanceId": "d",
          "revision": 1,
          "buttons": [
            {"id": "a", "label": "A", "group": "key", "action": {"type": "key", "key": "F13"}},
            {"id": "b", "label": "B", "group": "key", "action": {"type": "key", "key": "Enter"}},
            {"id": "c", "label": "C", "group": "custom", "action": {"type": "script", "text": "rm -rf /"}},
            {"id": "d", "label": "D", "group": "nowhere", "action": {"type": "key", "key": "Tab"}},
            {"id": "e", "label": "E", "group": "custom", "action": {"type": "text", "text": "deploy", "pressEnter": true}}
          ]
        }
        """)?.buttons.map(\.id) == ["b", "e"])
    }

    @Test func rejectsAMessageItCouldNotFileUnderAComputer() {
        // Without an identity the list cannot be attributed, and attributing it to the
        // wrong computer is worse than not having it: the bar would show one machine's
        // commands while another is on screen.
        #expect(decode("""
        {"revision": 1, "buttons": []}
        """) == nil)
        #expect(decode("""
        {"desktopClientInstanceId": "d", "buttons": []}
        """) == nil)
        // An empty identity is not rejected here — the wire's own validator requires a
        // non-empty one, so this is a defence rather than a rule the phone can state
        // alone. What it must not do is match a real computer, which it cannot: no
        // selected computer has an empty id, so none of these commands is shown for
        // anybody. The front row is drawn regardless, being nobody's but the phone's.
        var state = TerminalToolbarState()
        state.adopt(MobileToolbarPayload(
            desktopClientInstanceId: "", revision: 1,
            buttons: [MobileToolbarButton(id: "c1", label: "部署", group: .custom,
                                          action: .text("pnpm deploy", pressEnter: true))]
        ))
        #expect(state.buttons(forSelected: "desktop-1").map(\.id) == frontRowIds)
    }

    // MARK: - What the bar shows

    @Test func aComputerThatHasNeverSaidAnythingStillLeavesTheBarUsable() {
        // An older desktop may never send this message, and one that has nothing
        // configured sends it with an empty list. Neither leaves a bar that cannot
        // confirm anything in a TUI: the front row is the phone's own.
        #expect(TerminalToolbarState().buttons(forSelected: "desktop-1").map(\.id) == frontRowIds)
        #expect(TerminalToolbarState().buttons(forSelected: nil).map(\.id) == frontRowIds)
    }

    @Test func anEmptyListMeansNoCommandsOfTheUsersAndNothingMore() {
        /*
         * A computer that has sent this message has said what it has, and "nothing" is a
         * thing it can say. Inventing a command from it would run something on a computer
         * that never offered one — which is why the front row is not invented: it is the
         * phone's own, and it is drawn whether or not a computer has spoken.
         */
        var state = TerminalToolbarState()
        state.adopt(MobileToolbarPayload(desktopClientInstanceId: "desktop-1", revision: 1, buttons: []))

        #expect(state.buttons(forSelected: "desktop-1").map(\.id) == frontRowIds)
        // And one that has not answered looks the same, having nothing of its own to add.
        #expect(state.buttons(forSelected: "desktop-2").map(\.id) == frontRowIds)
    }

    @Test func aComputersOwnFrontRowIsNotDrawnASecondTime() {
        /*
         * A computer from before the split still sends its built-ins. Those are its front
         * row, and this phone has its own; drawing both would put two returns and two
         * `Ctrl+C`s side by side, with only one of each being the one the user learned.
         * The group is what separates them: everything a computer sends today is
         * `custom`, so anything else in the list is its own front row arriving late.
         */
        var state = TerminalToolbarState()
        state.adopt(MobileToolbarPayload(desktopClientInstanceId: "desktop-1", revision: 1, buttons: [
            MobileToolbarButton(id: "enter", label: "回车", group: .key, action: .key(.enter)),
            MobileToolbarButton(id: "interrupt", label: "Ctrl+C", group: .key, action: .key(.controlC)),
            MobileToolbarButton(id: "slash-exit", label: "/exit", group: .command,
                                action: .text("/exit", pressEnter: true)),
            MobileToolbarButton(id: "c1", label: "部署", group: .custom,
                                action: .text("pnpm deploy", pressEnter: true)),
        ]))

        #expect(state.buttons(forSelected: "desktop-1").map(\.id) == frontRowIds + ["c1"])
    }

    @Test func whatOneComputerSaysIsNotShownForAnother() {
        var state = TerminalToolbarState()
        state.adopt(MobileToolbarPayload(
            desktopClientInstanceId: "desktop-1",
            revision: 1,
            buttons: [MobileToolbarButton(id: "c1", label: "部署", group: .custom,
                                          action: .text("pnpm deploy", pressEnter: true))]
        ))

        #expect(state.buttons(forSelected: "desktop-1").map(\.id) == frontRowIds + ["c1"])
        #expect(state.buttons(forSelected: "desktop-2").map(\.id) == frontRowIds)
    }

    @Test func aLaterMessageReplacesTheWholeList() {
        // The message is a snapshot, not a delta. A command the user deleted on the
        // computer has to disappear here, which is only true if nothing is merged. The
        // front row is not part of that list and is not replaced by it.
        var state = TerminalToolbarState()
        state.adopt(MobileToolbarPayload(desktopClientInstanceId: "d", revision: 1, buttons: [
            MobileToolbarButton(id: "old", label: "旧", group: .custom, action: .text("old", pressEnter: true)),
            MobileToolbarButton(id: "keep", label: "留", group: .custom, action: .text("keep", pressEnter: true)),
        ]))
        state.adopt(MobileToolbarPayload(desktopClientInstanceId: "d", revision: 2, buttons: [
            MobileToolbarButton(id: "keep", label: "留", group: .custom, action: .text("keep", pressEnter: true)),
        ]))

        #expect(state.buttons(forSelected: "d").map(\.id) == frontRowIds + ["keep"])
    }

    @Test func signingOutForgetsThem() {
        var state = TerminalToolbarState()
        state.adopt(MobileToolbarPayload(desktopClientInstanceId: "d", revision: 1, buttons: [
            MobileToolbarButton(id: "c1", label: "部署", group: .custom, action: .text("pnpm deploy", pressEnter: true)),
        ]))
        state.reset()

        // The commands go, because they are another account's computers'. The front row
        // stays: it belongs to the phone, and signing out does not unteach it how to
        // press return.
        #expect(state.buttons(forSelected: "d").map(\.id) == frontRowIds)
        #expect(state.buttons(forSelected: "d").map(\.group)
            == [.key, .key, .key, .key, .key, .command, .command])
    }

    // MARK: - Pressing one

    @Test func aKeyButtonSendsAKeyAction() {
        let intent = MobileToolbarAction.key(.controlC).intent(sessionId: "s1", intentId: "i1")

        #expect(intent.kind == "keys")
        #expect(intent.sessionId == "s1")
        #expect(intent.actions == [.key(.controlC)])
        #expect(intent.text == nil)
    }

    @Test func aCommandButtonRunsItAndATypingButtonOnlyTypesIt() {
        /*
         * The one distinction this client must not blur. `command` writes the text and
         * then a carriage return, so using it for a `pressEnter: false` button would run
         * a command the user configured to only be typed — which, on a terminal, is the
         * difference between reading a command and executing it.
         */
        let runs = MobileToolbarAction.text("pnpm deploy", pressEnter: true)
            .intent(sessionId: "s1", intentId: "i1")
        #expect(runs.kind == "command")
        #expect(runs.text == "pnpm deploy")
        #expect(runs.actions == nil)

        let types = MobileToolbarAction.text("lsof -i :3001", pressEnter: false)
            .intent(sessionId: "s1", intentId: "i1")
        #expect(types.kind == "keys")
        #expect(types.actions == [.text("lsof -i :3001")])
        #expect(types.text == nil)
    }

    @Test func theCommandTextIsSentUntouched() {
        // The computer runs the command the user wrote, character for character. A phone
        // that trimmed or quoted it here would be running a different one.
        let raw = "  echo \"a  b\"  |  grep a  "
        let intent = MobileToolbarAction.text(raw, pressEnter: true).intent(sessionId: "s1", intentId: "i1")

        #expect(intent.text == raw)
    }

    @Test func onlyASubmittingButtonSpendsAnInsertedPath() {
        // The chip a file's path was typed into is the undo for those characters, so it
        // goes exactly when a line carrying them is submitted — not before, or the user
        // loses the undo, and not after, or it offers to delete what they have typed since.
        #expect(MobileToolbarAction.key(.enter).submitsLine)
        #expect(MobileToolbarAction.key(.arrowUp).submitsLine == false)
        #expect(MobileToolbarAction.key(.controlC).submitsLine == false)
        #expect(MobileToolbarAction.text("pnpm deploy", pressEnter: true).submitsLine)
        #expect(MobileToolbarAction.text("lsof -i :3001", pressEnter: false).submitsLine == false)
    }

    @Test func theFrontRowIsWhatAPhoneNeedsToAnswerATUI() {
        // The row is written on this side, so nothing else would catch a typo in it: an
        // id is a string, and the key a button names is only checked when it is pressed.
        // This pins what is in it, in the order the bar draws it.
        #expect(TerminalToolbarState.frontRow.map(\.id)
            == ["arrow-up", "arrow-down", "tab", "enter", "interrupt", "slash-exit", "slash-clear"])
        #expect(TerminalToolbarState.frontRow.map(\.label)
            == ["↑", "↓", "Tab", "回车", "Ctrl+C", "/exit", "/clear"])
        // What each one sends, spelled the way it goes on the wire: a key name, or a
        // command's text and whether pressing it runs the command or only types it.
        // This is the half a typo would change without changing anything visible.
        #expect(TerminalToolbarState.frontRow.map(\.wireForm) == [
            "key ArrowUp", "key ArrowDown", "key Tab", "key Enter", "key Ctrl+C",
            "text /exit runs", "text /clear runs",
        ])
        // The rest is what the wire needs of any button it carries: a name to press it by
        // and text that is neither empty nor a lie about pressing return.
        for button in TerminalToolbarState.frontRow {
            #expect(!button.id.isEmpty)
            #expect(!button.label.isEmpty)
            if case .key(let key) = button.action {
                // `Ctrl+L` is the computer's own clear, which never reaches a terminal;
                // the phone's clear is the command that follows, not a key.
                #expect(key != .controlL)
            }
            if case .text(let text, _) = button.action {
                #expect(!text.isEmpty)
                #expect(!text.contains("\n"))
            }
        }
        #expect(TerminalToolbarState.frontRow.map(\.wireForm).contains("key Enter"),
                "a phone without return cannot confirm anything in a TUI")
    }
}

/// How a button spells itself on the wire, for the one test that pins the front row.
///
/// Spelled out rather than compared as `MobileToolbarAction`s: that conformance is main
/// actor-isolated, and using it from a nonisolated context warns today and is an error in
/// the Swift 6 language mode. A string is also closer to what the assertion is about —
/// these names are what the computer looks up in its byte table.
private extension MobileToolbarButton {
    var wireForm: String {
        switch action {
        case .key(let key): return "key \(key.rawValue)"
        case .text(let text, let pressEnter): return "text \(text) \(pressEnter ? "runs" : "types")"
        }
    }
}
