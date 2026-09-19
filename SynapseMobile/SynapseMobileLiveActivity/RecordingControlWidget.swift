import AppIntents
import SwiftUI
import WidgetKit

/// 控制中心里的那枚控件：点一下开始录音。
///
/// 它是控制中心里 Synapse 唯一的入口，所以这里不做开关——录音的开始与结束在录音页
/// 和实时活动上有更清楚的位置，这里只负责「从任何地方开始录」。
@available(iOS 18.0, *)
struct RecordingControlWidget: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.liy.SynapseMobile.recording") {
            ControlWidgetButton(action: StartRecordingIntent()) {
                Label("录音", systemImage: "waveform")
            }
        }
        .displayName("录音")
    }
}
