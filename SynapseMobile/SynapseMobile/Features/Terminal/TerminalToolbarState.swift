import Foundation

/// Which buttons the accessory bar shows.
///
/// The bar is two lists, and only the second one is anybody else's.
///
/// The **front row** is this phone's own, written here rather than sent, because a
/// phone's front row is not a computer's: it needs arrows and `Tab` where a computer
/// has a keyboard for them. Deriving it from the computer meant every key the phone
/// needed was first something the computer had to be taught.
///
/// Behind it come the **commands the user wrote on their computer** — the only buttons
/// that cross the wire. A computer that has sent `mobile.toolbar` decides that list
/// completely, including by sending an empty one; a computer that has never sent one
/// has nothing of the user's to show. Either way the bar is never empty, which is the
/// property that matters: a phone with no keyboard of its own and an empty bar cannot
/// answer a TUI at all.
struct TerminalToolbarState: Equatable {
    private var custom: [MobileToolbarButton] = []
    private var ownerDesktopClientInstanceId: String?

    /// Adopted whatever computer sent it, rather than dropped when it is not the one on
    /// screen: a `sync` goes to whichever computer is selected, so a message for another
    /// one is an earlier answer arriving late, not an error. Holding it costs a slot and
    /// saves a round trip if the user switches back.
    ///
    /// Only the user's own entries are kept. Everything a computer sends today is
    /// `custom`, but a computer from before this split sends its built-ins too — its own
    /// front row, which this phone draws for itself. Keeping them would draw return,
    /// `Ctrl+C` and the two slash commands twice.
    mutating func adopt(_ payload: MobileToolbarPayload) {
        custom = payload.buttons.filter { $0.group == .custom }
        ownerDesktopClientInstanceId = payload.desktopClientInstanceId
    }

    /// Cleared on sign-out: these are another account's computers' commands.
    ///
    /// The front row is deliberately left alone — it belongs to the phone rather than
    /// to the account, and signing out does not unteach it how to press return.
    mutating func reset() {
        custom = []
        ownerDesktopClientInstanceId = nil
    }

    func buttons(forSelected desktopClientInstanceId: String?) -> [MobileToolbarButton] {
        guard let desktopClientInstanceId,
              ownerDesktopClientInstanceId == desktopClientInstanceId
        else { return Self.frontRow }
        return Self.frontRow + custom
    }

    /// The keys this phone keeps in its own code, in the order the bar draws them.
    ///
    /// Arrows and `Tab` lead because they are what a TUI's option list is answered with,
    /// then `回车` to commit the answer, then the interrupt and the two slash commands.
    /// They are here rather than only on the keyboard panel because choosing an option
    /// is the commonest thing a user does in a terminal on a phone, and that choice
    /// should not cost a panel opening first.
    ///
    /// `Ctrl+C` and the slash commands keep the ids they had when a computer sent them,
    /// so the tests that press them keep finding them. They are the phone's own now:
    /// the computer defines its front row for itself, and this is ours.
    static let frontRow: [MobileToolbarButton] = [
        MobileToolbarButton(id: "arrow-up", label: "↑", group: .key, action: .key(.arrowUp)),
        MobileToolbarButton(id: "arrow-down", label: "↓", group: .key, action: .key(.arrowDown)),
        MobileToolbarButton(id: "tab", label: "Tab", group: .key, action: .key(.tab)),
        MobileToolbarButton(id: "enter", label: "回车", group: .key, action: .key(.enter)),
        MobileToolbarButton(id: "interrupt", label: "Ctrl+C", group: .key, action: .key(.controlC)),
        MobileToolbarButton(
            id: "slash-exit", label: "/exit", group: .command,
            action: .text("/exit", pressEnter: true)
        ),
        MobileToolbarButton(
            id: "slash-clear", label: "/clear", group: .command,
            action: .text("/clear", pressEnter: true)
        ),
    ]
}
