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
        // have to be the same length — and `MOBILE_KEYS` is 38.
        let names = [
            "Enter", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
            "Backspace", "Ctrl+C", "Ctrl+D",
            "Home", "End", "PageUp", "PageDown", "Delete",
            "Ctrl+A", "Ctrl+E", "Ctrl+U", "Ctrl+K", "Ctrl+W", "Ctrl+L", "Ctrl+R", "Ctrl+Z",
            "Ctrl+B", "Ctrl+F", "Ctrl+G", "Ctrl+H", "Ctrl+J", "Ctrl+N", "Ctrl+O",
            "Ctrl+P", "Ctrl+Q", "Ctrl+S", "Ctrl+T", "Ctrl+V", "Ctrl+X", "Ctrl+Y",
            "Shift+Tab",
        ]
        let buttons = names.map {
            """
            {"id": "\($0)", "label": "\($0)", "group": "key", "action": {"type": "key", "key": "\($0)"}}
            """
        }.joined(separator: ",")
        let payload = try #require(decode("""
        {"desktopClientInstanceId": "d", "revision": 1, "buttons": [\(buttons)]}
        """))

        #expect(payload.buttons.count == 38)
        for name in names {
            #expect(MobileKey(rawValue: name) != nil, "\(name) is not a key this build knows")
        }
        // The two the alphabet is missing, and the reason it is missing them: their
        // bytes belong to Tab and Return, so a chord on I or M is sent as that key.
        #expect(MobileKey(rawValue: "Ctrl+I") == nil)
        #expect(MobileKey(rawValue: "Ctrl+M") == nil)
        // Every case is one of the names above: a case the panel can draw but the
        // computer has never heard of would be a key that is rejected on press.
        #expect(MobileKey.allCases.count == 38)
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
            {"id": "a", "label": "A", "group": "key", "action": {"type": "key", "key": "F5"}},
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
        // selected computer has an empty id, so this list is shown for nobody.
        var state = TerminalToolbarState()
        state.adopt(MobileToolbarPayload(
            desktopClientInstanceId: "", revision: 1,
            buttons: [MobileToolbarButton(id: "c1", label: "部署", group: .custom,
                                          action: .text("pnpm deploy", pressEnter: true))]
        ))
        #expect(state.buttons(forSelected: "desktop-1").map(\.id)
            == ["enter", "interrupt", "slash-exit", "slash-clear"])
    }

    // MARK: - What the bar shows

    @Test func aComputerThatHasNeverSaidAnythingGetsTheFallback() {
        // An older desktop does not know this message exists. Showing an empty bar for it
        // would leave the phone unable to confirm anything in a TUI, which is the whole
        // reason return is in the fallback.
        #expect(TerminalToolbarState().buttons(forSelected: "desktop-1").map(\.id)
            == ["enter", "interrupt", "slash-exit", "slash-clear"])
        #expect(TerminalToolbarState().buttons(forSelected: nil).map(\.id)
            == ["enter", "interrupt", "slash-exit", "slash-clear"])
    }

    @Test func anEmptyListIsAnAnswerAndIsNotTheFallback() {
        /*
         * The distinction the whole state exists for. A computer that has sent this
         * message has said what it has, and "nothing" is a thing it can say. Falling back
         * here would invent four buttons the user did not configure — and pressing one
         * would run a command on a computer that never offered it.
         */
        var state = TerminalToolbarState()
        state.adopt(MobileToolbarPayload(desktopClientInstanceId: "desktop-1", revision: 1, buttons: []))

        #expect(state.buttons(forSelected: "desktop-1").isEmpty)
        // And a computer that has not answered still gets its fallback, in the same state.
        #expect(state.buttons(forSelected: "desktop-2").map(\.id)
            == ["enter", "interrupt", "slash-exit", "slash-clear"])
    }

    @Test func whatOneComputerSaysIsNotShownForAnother() {
        var state = TerminalToolbarState()
        state.adopt(MobileToolbarPayload(
            desktopClientInstanceId: "desktop-1",
            revision: 1,
            buttons: [MobileToolbarButton(id: "c1", label: "部署", group: .custom,
                                          action: .text("pnpm deploy", pressEnter: true))]
        ))

        #expect(state.buttons(forSelected: "desktop-1").map(\.id) == ["c1"])
        #expect(state.buttons(forSelected: "desktop-2").map(\.id)
            == ["enter", "interrupt", "slash-exit", "slash-clear"])
    }

    @Test func aLaterMessageReplacesTheWholeList() {
        // The message is a snapshot, not a delta. A button the user deleted on the
        // computer has to disappear here, which is only true if nothing is merged.
        var state = TerminalToolbarState()
        state.adopt(MobileToolbarPayload(desktopClientInstanceId: "d", revision: 1, buttons: [
            MobileToolbarButton(id: "old", label: "旧", group: .custom, action: .text("old", pressEnter: true)),
            MobileToolbarButton(id: "keep", label: "留", group: .custom, action: .text("keep", pressEnter: true)),
        ]))
        state.adopt(MobileToolbarPayload(desktopClientInstanceId: "d", revision: 2, buttons: [
            MobileToolbarButton(id: "keep", label: "留", group: .custom, action: .text("keep", pressEnter: true)),
        ]))

        #expect(state.buttons(forSelected: "d").map(\.id) == ["keep"])
    }

    @Test func signingOutForgetsThem() {
        var state = TerminalToolbarState()
        state.adopt(MobileToolbarPayload(desktopClientInstanceId: "d", revision: 1, buttons: [
            MobileToolbarButton(id: "c1", label: "部署", group: .custom, action: .text("pnpm deploy", pressEnter: true)),
        ]))
        state.reset()

        #expect(state.buttons(forSelected: "d").map(\.id)
            == ["enter", "interrupt", "slash-exit", "slash-clear"])
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

    @Test func everyFallbackButtonIsOneTheComputerWouldRecognise() {
        // The fallback stands in for a computer that cannot describe itself, so it has to
        // be made only of things such a computer can still do: keys it can encode and
        // commands it will run. `Clear` is absent because it never reaches the terminal.
        for button in TerminalToolbarState.fallback {
            switch button.action {
            case .key(let key):
                #expect(key != .controlL, "the fallback must not be a second clear")
            case .text(let text, _):
                #expect(!text.isEmpty)
                #expect(!text.contains("\n"))
            }
            #expect(!button.id.isEmpty)
            #expect(!button.label.isEmpty)
        }
        #expect(TerminalToolbarState.fallback.contains { $0.id == "enter" },
                "a phone without return cannot confirm anything in a TUI")
    }
}
