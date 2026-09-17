import Foundation
import Testing

@testable import SynapseMobile

/// The title bar names the installed build, so that number is worth exactly as
/// much as the bundle it is read from.
///
/// These run inside the app process, which is what makes them worth having: they
/// see the built `Info.plist` after Xcode has substituted it. Measured against a
/// build whose `CFBundleVersion` had been taken out, this is what goes red — the
/// key arrives missing, the fallback renders "未知" in the title bar, and nothing
/// else in the app notices.
///
/// They prove the wiring, not what the numbers are: the version is the desktop's
/// to choose and the build is raised by every archive, so a test that pinned either
/// would be red the next time the app shipped.
struct AppVersionTests {

    @Test func bundleCarriesARealVersion() {
        #expect(AppVersion.number != "未知")
        #expect(AppVersion.number.isEmpty == false)
    }

    /// Whole digits, because that is what App Store Connect accepts as a build
    /// number and what `release-ios.sh` writes.
    @Test func bundleCarriesANumericBuild() {
        #expect(AppVersion.build != "未知")
        #expect(AppVersion.build.allSatisfy { $0.isNumber })
        #expect(Int(AppVersion.build) ?? 0 > 0)
    }

    @Test func labelNamesTheBuildTheWayAppStoreConnectDoes() {
        #expect(AppVersion.label == "\(AppVersion.number) (\(AppVersion.build))")
    }
}
