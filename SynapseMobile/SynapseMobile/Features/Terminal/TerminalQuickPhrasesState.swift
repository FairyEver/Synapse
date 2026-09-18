import Foundation

/// The 快捷输入 sentences one computer holds, and which computer sent them.
///
/// The question this answers is three-valued, and that is the whole reason the type
/// exists rather than a plain array:
///
/// - a computer that has sent `mobile.quickPhrases` with sentences → those sentences;
/// - a computer that has sent it *empty* → an empty list, which the panel draws as an
///   empty state reading that nothing has been configured on the computer yet;
/// - a computer that has never sent it → `nil`, and the panel draws no segment control
///   at all, because that computer is too old to have been asked.
///
/// Collapsing the last two is the mistake worth naming: an older computer would be
/// shown an empty list under a segment control that says the feature exists, and the
/// user reads that as their own configuration having gone missing. The rule is
/// `TerminalToolbarState`'s own — the computer that sent the message decides
/// completely, and only a computer that never sent one gets a fallback.
///
/// `nil` is *not* a fallback here, and that is the one place this differs from the
/// toolbar: there are no built-in sentences to stand in with. The bar falls back to
/// four buttons because a phone with an empty bar cannot confirm anything in a TUI;
/// a sentence is the user's own words, and inventing one would type words they never
/// wrote into a composer they are about to send from.
struct TerminalQuickPhrasesState: Equatable {
    private var phrases: [MobileQuickPhrase] = []
    private var ownerDesktopClientInstanceId: String?

    /// Adopted whatever computer sent it, rather than dropped when it is not the one on
    /// screen: a `sync` goes to whichever computer is selected, so a message for another
    /// one is an earlier answer arriving late, not an error. Holding it costs a slot and
    /// saves a round trip if the user switches back — the same rule the toolbar follows.
    mutating func adopt(_ payload: MobileQuickPhrasesPayload) {
        phrases = payload.phrases
        ownerDesktopClientInstanceId = payload.desktopClientInstanceId
    }

    /// Cleared on sign-out: those are another account's computers' sentences.
    mutating func reset() {
        phrases = []
        ownerDesktopClientInstanceId = nil
    }

    /// The sentences for the computer being viewed, or `nil` for one that has never
    /// described any.
    func phrases(forSelected desktopClientInstanceId: String?) -> [MobileQuickPhrase]? {
        guard let desktopClientInstanceId,
              ownerDesktopClientInstanceId == desktopClientInstanceId
        else { return nil }
        return phrases
    }
}
