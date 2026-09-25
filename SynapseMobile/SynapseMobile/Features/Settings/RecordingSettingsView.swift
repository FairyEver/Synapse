import AVFoundation
import SwiftUI
import UIKit

/// 「录音」这个分类下眼下只有一件事：麦克风权限。
///
/// 一项也值得单开一个分类 —— 它是给将来留的位置，而不是因为它现在够长。录音相关的
/// 设置会长，长在一个已经叫「录音」的地方，好过到时候重新组织整个「我的」。
struct RecordingSettingsView: View {
    @State private var microphone: PermissionRow.State = .undetermined

    var body: some View {
        List {
            Section {
                PermissionRow(title: "麦克风", state: microphone) {
                    await MeetingPermission.requestMicrophone()
                    microphone = Self.currentMicrophoneState()
                }
            } footer: {
                Text("录音与转写都在服务端处理，不依赖任何一台电脑。")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("录音")
        .navigationBarTitleDisplayMode(.inline)
        // 用户可能在系统设置里改过。回到前台要重新读一次，否则这一行会一直停在
        // 上次进这一页时看到的样子。
        .onAppear { microphone = Self.currentMicrophoneState() }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            microphone = Self.currentMicrophoneState()
        }
    }

    private static func currentMicrophoneState() -> PermissionRow.State {
        switch MeetingPermission.microphone {
        case .granted: .granted
        case .denied: .denied
        case .undetermined: .undetermined
        }
    }
}
