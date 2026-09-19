import Foundation
import Testing

@testable import SynapseMobile

/// 下行帧的解码路径。
///
/// 这条路以前是：先把整个载荷物化成一棵 `[String: JSONValue]` 树，再把它编码回 Data，
/// 再解成具体类型。换掉它是因为前两趟纯属浪费 —— 帧是终端唯一的内容来源，持续输出时
/// 每秒到好几次，而且全程在主 actor 上。
///
/// 但**解出来的东西必须一个字段都不差**：少一格样式在屏幕上就是一整行颜色不对，而那
/// 看起来像渲染坏了，查起来却不在渲染层。所以这里逐字段钉住，包括空行和一段行里的
/// 多段样式。
@MainActor
struct TerminalFrameDecodingTests {
    private enum DecodeFailure: Error { case noHeader, noPayload }

    /// 外层是服务端信封，里层是帧；每一行是 `[文本, [[起点, 长度, 前景, 背景, 标志]]]`。
    private let frameJSON = """
    {
      "type": "mobile.frame",
      "id": "ad0cdaa1-0000-4000-8000-000000000001",
      "sentAt": "2026-09-19T05:17:00.123Z",
      "payload": {
        "desktopClientInstanceId": "d-1",
        "mobileClientInstanceId": "m-1",
        "frame": {
          "sessionId": "s-1",
          "kind": "delta",
          "from": 41,
          "total": 43,
          "seq": 7,
          "alt": false,
          "truncated": true,
          "sizeRevision": 3,
          "cursor": { "row": 42, "col": 6, "visible": true },
          "lines": [
            ["git status", [[0, 10, 2, 0, 1]]],
            ["", []],
            ["中文字宽", [[0, 4, 1, 0, 1], [4, 4, 5, 0, 3]]]
          ]
        }
      }
    }
    """

    /// 走真实的那两步：先读 `type`，再按它解具体载荷。
    private func decodeFrame(_ json: String) throws -> MobileFramePayload {
        let data = Data(json.utf8)
        guard let header = try? JSONDecoder().decode(LiveEnvelopeType.self, from: data) else {
            throw DecodeFailure.noHeader
        }
        #expect(header.type == LiveMessageType.mobileFrame)
        guard let envelope = try? JSONDecoder().decode(PayloadEnvelope<MobileFramePayload>.self, from: data) else {
            throw DecodeFailure.noPayload
        }
        return envelope.payload
    }

    @Test func aFrameEnvelopeDecodesFieldForField() throws {
        let payload = try decodeFrame(frameJSON)
        #expect(payload.desktopClientInstanceId == "d-1")
        #expect(payload.mobileClientInstanceId == "m-1")

        let frame = payload.frame
        #expect(frame.sessionId == "s-1")
        #expect(frame.kind == "delta")
        #expect(frame.from == 41)
        #expect(frame.total == 43)
        #expect(frame.seq == 7)
        #expect(frame.alt == false)
        #expect(frame.truncated == true)
        #expect(frame.sizeRevision == 3)
        #expect(frame.cursor == TerminalCursor(row: 42, col: 6, visible: true))
        // `delta` 既不是整体替换也不是历史页 —— 这两条判错了，缓冲区会被整段丢掉或者
        // 反过来被当成追加。
        #expect(!frame.isReset)
        #expect(!frame.isHistory)

        #expect(frame.lines.count == 3)
        #expect(frame.lines[0].text == "git status")
        #expect(frame.lines[0].runs == [
            StyleRun(start: 0, length: 10, foreground: 2, background: 0, flags: 1)
        ])
        // 空行也得在：少一行就等于整屏往上挪一格。
        #expect(frame.lines[1].text.isEmpty)
        #expect(frame.lines[1].runs.isEmpty)
        // 一段行里两段样式，且带中文 —— 宽度换算另说，这里只管一个字节都没丢。
        #expect(frame.lines[2].text == "中文字宽")
        #expect(frame.lines[2].runs == [
            StyleRun(start: 0, length: 4, foreground: 1, background: 0, flags: 1),
            StyleRun(start: 4, length: 4, foreground: 5, background: 0, flags: 3),
        ])
    }

    /// 载荷类型是跟着信封上的 `type` 走的。
    ///
    /// 拿同一个信封去解成另一种载荷必须失败 —— 这条正是「先读 `type`、再解具体类型」
    /// 这套做法的全部意义所在。哪天有人图省事改成「哪个解得出就算哪个」，这条会红。
    @Test func thePayloadTypeIsTheOneTheEnvelopeNames() {
        let data = Data(frameJSON.utf8)
        #expect((try? JSONDecoder().decode(PayloadEnvelope<MobileSummaryPayload>.self, from: data)) == nil)
    }
}
