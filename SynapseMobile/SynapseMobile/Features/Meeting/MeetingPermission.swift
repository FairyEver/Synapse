import AVFoundation
import Foundation

/// 麦克风权限的三态。
///
/// 「被拒绝」是一个要显示出来的状态，不是错误：录音照常开始，波形走示意，提示行里
/// 明说这一点。拿假波形冒充真的比不录更糟。
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
