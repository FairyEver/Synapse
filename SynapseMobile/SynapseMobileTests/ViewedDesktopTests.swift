import Foundation
import Testing

@testable import SynapseMobile

/// Which computer the phone is on, and which ones the switch offers.
///
/// The bug these pin is that the phone used to re-answer that question by itself:
/// it took whatever order the cloud returned and re-took it every time the computer
/// went away. The order is the registry's own, sorted by an id nobody chose, so the
/// reader could be looking at one computer and find themselves on another.
@MainActor
struct ViewedDesktopTests {
    @Test func nothingRememberedAdoptsTheFirstComputer() {
        let preference = ViewedDesktopPreference(defaults: scratchDefaults())

        #expect(preference.resolve(online: ["desktop-a", "desktop-b"]) == "desktop-a")
    }

    /// The adoption is a choice like any other from the moment it happens. Not writing
    /// it down would re-run the coin flip on every launch, which is the behaviour this
    /// exists to remove.
    @Test func theAdoptionIsWrittenDown() {
        let defaults = scratchDefaults()
        let preference = ViewedDesktopPreference(defaults: defaults)
        #expect(preference.resolve(online: ["desktop-a", "desktop-b"]) == "desktop-a")

        // A second instance over the same store is what a relaunch looks like. Asserted
        // through the value rather than by reading the key, so the key name is not
        // frozen by this test.
        let relaunched = ViewedDesktopPreference(defaults: defaults)

        #expect(relaunched.resolve(online: ["desktop-b", "desktop-a"]) == "desktop-a")
    }

    /// The test for the whole feature.
    ///
    /// A remembered computer that is not reachable is kept. The screen says it is gone
    /// and offers the switch; it does not move the reader somewhere else while they are
    /// reading a terminal.
    @Test func aRememberedComputerIsNotReplacedByOneThatIsOnline() {
        let defaults = scratchDefaults()
        let preference = ViewedDesktopPreference(defaults: defaults)
        preference.view("desktop-a")

        #expect(preference.resolve(online: ["desktop-b"]) == "desktop-a")
        #expect(preference.clientInstanceId == "desktop-a")
    }

    /// And it survives there being nothing at all to switch to — that state is
    /// `.noComputer`, not a reason to forget which computer the reader means.
    @Test func aRememberedComputerSurvivesAnEmptyList() {
        let preference = ViewedDesktopPreference(defaults: scratchDefaults())
        preference.view("desktop-a")

        #expect(preference.resolve(online: []) == "desktop-a")
    }

    @Test func anExplicitChoiceReplacesTheRememberedOne() {
        let defaults = scratchDefaults()
        let preference = ViewedDesktopPreference(defaults: defaults)
        preference.view("desktop-a")

        preference.view("desktop-b")

        #expect(preference.resolve(online: ["desktop-a", "desktop-b"]) == "desktop-b")
        #expect(ViewedDesktopPreference(defaults: defaults).clientInstanceId == "desktop-b")
    }

    /// A notification can name a computer that is not reachable, and tapping it is the
    /// reader saying which one they mean. Recording it is what keeps the phone from
    /// landing them on a different computer.
    @Test func aChoiceIsHonouredEvenWhenThatComputerIsOffline() {
        let preference = ViewedDesktopPreference(defaults: scratchDefaults())
        preference.view("desktop-a")

        preference.view("desktop-c")

        #expect(preference.clientInstanceId == "desktop-c")
        #expect(preference.resolve(online: ["desktop-a", "desktop-b"]) == "desktop-c")
    }

    @Test func forgetClearsTheChoiceAndTheNames() {
        let preference = ViewedDesktopPreference(defaults: scratchDefaults())
        preference.view("desktop-a")
        preference.remember(name: "MacBook Pro", for: "desktop-a")

        preference.forget()

        #expect(preference.clientInstanceId == nil)
        #expect(preference.name(for: "desktop-a") == nil)
        #expect(preference.resolve(online: ["desktop-b"]) == "desktop-b")
    }

    @Test func theLastNameAComputerGaveIsKept() {
        let defaults = scratchDefaults()
        let preference = ViewedDesktopPreference(defaults: defaults)
        preference.remember(name: "MacBook Pro", for: "desktop-a")

        #expect(preference.name(for: "desktop-a") == "MacBook Pro")
        #expect(ViewedDesktopPreference(defaults: defaults).name(for: "desktop-a") == "MacBook Pro")
    }

    // MARK: - What the switch offers

    /// Nothing to switch to, so the row is not a control and draws no chevron.
    @Test func oneComputerAndItIsTheOneBeingViewedOffersNothing() {
        #expect(ViewedDesktopPreference.switchTargets(online: ["a"], viewing: "a").isEmpty)
    }

    @Test func everyOtherReachableComputerIsOffered() {
        #expect(ViewedDesktopPreference.switchTargets(online: ["a", "b"], viewing: "a") == ["b"])
    }

    /// The case the feature exists for, and the one a `count > 1` predicate gets wrong:
    /// the phone is on a computer that is gone, and the single other computer is the
    /// only way out. With no target the row would not be tappable at all.
    @Test func theOnlyWayOutOfAnOfflineComputerIsStillOffered() {
        #expect(ViewedDesktopPreference.switchTargets(online: ["b"], viewing: "a") == ["b"])
    }

    @Test func nothingIsOfferedBeforeAComputerHasBeenChosen() {
        #expect(ViewedDesktopPreference.switchTargets(online: ["a"], viewing: nil) == ["a"])
        #expect(ViewedDesktopPreference.switchTargets(online: [], viewing: nil).isEmpty)
    }

    // MARK: -

    /// Each test gets its own suite: `UserDefaults.standard` is shared with the rest of
    /// the app and with whatever the previous case left behind.
    private func scratchDefaults() -> UserDefaults {
        let name = "SynapseMobileTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }
}
