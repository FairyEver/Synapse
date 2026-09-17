import Foundation

/// Which buttons the accessory bar shows, and for which computer.
///
/// The one question this has to answer is the one a missing message makes ambiguous:
/// "this computer has no buttons" and "this computer is too old to say" are different
/// answers, and a phone that confuses them shows an empty bar in the second case — which,
/// with no keyboard of its own, means a TUI cannot be confirmed at all.
///
/// So the rule is: a computer that has sent `mobile.toolbar` decides this completely,
/// including by sending an empty list, and only a computer that has never sent one falls
/// back. A single slot is enough to say that, because the message carries its own sender
/// and the question is always about the computer currently being viewed.
struct TerminalToolbarState: Equatable {
    private var buttons: [MobileToolbarButton] = []
    private var ownerDesktopClientInstanceId: String?

    /// Adopted whatever computer sent it, rather than dropped when it is not the one on
    /// screen: a `sync` goes to whichever computer is selected, so a message for another
    /// one is an earlier answer arriving late, not an error. Holding it costs a slot and
    /// saves a round trip if the user switches back.
    mutating func adopt(_ payload: MobileToolbarPayload) {
        buttons = payload.buttons
        ownerDesktopClientInstanceId = payload.desktopClientInstanceId
    }

    /// Cleared on sign-out: these are another account's computers' commands.
    mutating func reset() {
        buttons = []
        ownerDesktopClientInstanceId = nil
    }

    func buttons(forSelected desktopClientInstanceId: String?) -> [MobileToolbarButton] {
        guard let desktopClientInstanceId,
              ownerDesktopClientInstanceId == desktopClientInstanceId
        else { return Self.fallback }
        return buttons
    }

    /// What the bar shows for a computer that cannot describe its own buttons.
    ///
    /// The desktop's built-ins minus `Clear`, which clears the desktop's own renderer and
    /// never reaches the terminal — drawn here it would appear to do nothing, because the
    /// next frame would paint the cleared lines straight back.
    ///
    /// 「回车」 is in here although an older computer has no such button. It is harmless
    /// there, and a phone without it cannot answer anything.
    static let fallback: [MobileToolbarButton] = [
        MobileToolbarButton(id: "enter", label: "回车", group: .key, action: .key(.enter)),
        MobileToolbarButton(id: "interrupt", label: "Ctrl+C", group: .key, action: .key(.controlC)),
        MobileToolbarButton(id: "slash-exit", label: "/exit", group: .command, action: .text("/exit", pressEnter: true)),
        MobileToolbarButton(id: "slash-clear", label: "/clear", group: .command, action: .text("/clear", pressEnter: true)),
    ]
}
