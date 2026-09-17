import Foundation

/// Which build of the app this device is actually running.
///
/// Read from the bundle, not from the checked-in project file. `release-ios.sh`
/// passes `CURRENT_PROJECT_VERSION` at archive time, so the value in
/// `project.pbxproj` is only the floor for the next release — the bundle is the
/// one thing that knows what was installed. The version alone does not name a
/// build: `1.0.1` ships more than once, and `1.0.1 (3)` is a different thing to
/// look at than `1.0.1 (4)` when a report comes back.
enum AppVersion {
    /// The released version, shared with the desktop (`MARKETING_VERSION`).
    static let number: String =
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "未知"

    /// The build of that version (`CURRENT_PROJECT_VERSION`), raised by every
    /// archive.
    static let build: String =
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "未知"

    /// Both, as App Store Connect names a build.
    static let label = "\(number) (\(build))"
}
