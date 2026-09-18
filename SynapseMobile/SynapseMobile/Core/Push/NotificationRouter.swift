import Foundation
import Observation

/// Where a notification tap should take the user.
///
/// The delegate that receives the tap is not the view layer, and on a cold launch
/// it runs before any scene exists. So the destination is parked here and the UI
/// picks it up whenever it becomes able to act on it.
///
/// This is the half of a notification that makes it useful. Delivering an alert
/// that says a session needs attention, then dropping the user on a list they
/// have to search, misses the point of the feature.
@Observable
final class NotificationRouter {
    static let shared = NotificationRouter()

    enum Destination: Equatable {
        case terminal(sessionId: String, desktopClientInstanceId: String)
        case meeting(meetingId: String)
    }

    /// Non-nil until the UI consumes it.
    var pending: Destination?

    private init() {}

    func route(to destination: Destination) {
        pending = destination
    }

    func consume() -> Destination? {
        defer { pending = nil }
        return pending
    }
}
