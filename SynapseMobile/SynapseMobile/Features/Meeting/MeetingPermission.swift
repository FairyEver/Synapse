import AVFoundation
import Foundation

/// 麦克风权限的三态。
///
/// 未取得权限时不启动录音，录音页保留原因提示、设置与取消入口，不显示假波形。
enum MeetingMicrophonePermission: Equatable {
    case undetermined
    case granted
    case denied
}

enum MeetingPermission {
    static var microphone: MeetingMicrophonePermission {
        // iOS 17 起麦克风权限归 `AVAudioApplication` 管，`AVAudioSession` 上那个已经
        // 废弃；本 target 的部署版本是 18.0，所以只走新 API，不留兼容分支。
        switch AVAudioApplication.shared.recordPermission {
        case .granted: return .granted
        case .denied: return .denied
        default: return .undetermined
        }
    }

    /// 问一次。已经问过就直接给结论，不会再弹框。
    @discardableResult
    static func requestMicrophone() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }
}
