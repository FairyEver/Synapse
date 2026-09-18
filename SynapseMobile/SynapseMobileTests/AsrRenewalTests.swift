import Foundation
import Testing

@testable import SynapseMobile

/// 轮换这一层单独拿出来测，是因为它决定用户最终拿到的是不是**他说的那句话**：
/// 接缝处一边是多出来的重复字，一边是丢掉的尾巴，两种都只有提交之后才看得出来。
/// 判定本身不读时钟，时间由调用方给，所以「46 秒时正好停顿了一下」这种最容易出错的
/// 时刻能被逐条摆出来，而不是靠手在真机上等一分钟。
struct AsrRenewalTests {
    // MARK: - 接缝怎么接

    @Test func noSeamLeavesTheLiveTextUntouched() {
        let live = AsrTranscript(stable: "帮我看看", unstable: "终端")

        // 没换过连接时（今天的行为）一个字段都不能动。
        let merged = AsrRenewal.merge(seam: nil, live: live)
        #expect(merged.stable == live.stable)
        #expect(merged.unstable == live.unstable)
        #expect(merged == live)
    }

    @Test func aSettledSeamStaysInFrontOfBothHalves() {
        let seam = AsrSeam(text: "前面那段话。", provisional: false)

        // 活连接的已定稿句子跟在前缀后面，未定稿的尾巴照旧排最后。
        let merged = AsrRenewal.merge(
            seam: seam,
            live: AsrTranscript(stable: "接着说的", unstable: "还没完")
        )
        #expect(merged.stable == "前面那段话。接着说的")
        #expect(merged.unstable == "还没完")
    }

    /// 顺序不变量：接缝还没定稿时，活连接**已经定稿**的句子也只能待在未定稿那一半。
    ///
    /// 让它进 stable，屏幕上就会先出现「接着说的」再出现「前面那段话。」—— 用户提交的
    /// 文字前后颠倒，只能自己手改。颜色错了只是看着别扭，等定稿回来就恢复。
    @Test func aProvisionalSeamDragsEverythingIntoTheUnsettledHalf() {
        let seam = AsrSeam(text: "前面那段话。", provisional: true)

        let merged = AsrRenewal.merge(
            seam: seam,
            live: AsrTranscript(stable: "接着说的", unstable: "还没完")
        )
        #expect(merged.stable.isEmpty)
        #expect(merged.unstable == "前面那段话。接着说的还没完")
    }

    @Test func anEmptySeamKeepsTheSameTextInTheSameOrder() {
        let live = AsrTranscript(stable: "帮我看看", unstable: "终端")

        // 空串和「没有前缀」是两回事，但对用户是同一个结果：一个字不多不少。
        #expect(AsrRenewal.merge(seam: AsrSeam(text: "", provisional: false), live: live) == live)

        let provisional = AsrRenewal.merge(seam: AsrSeam(text: "", provisional: true), live: live)
        #expect(provisional.finalText == live.finalText)
        #expect(provisional.stable.isEmpty)
    }

    @Test func theSubmittedTextKeepsOrderInEveryCombination() {
        let seam = AsrSeam(text: "前面那段话。", provisional: false)
        let provisional = AsrSeam(text: "前面那段话。", provisional: true)
        let settledLive = AsrTranscript(stable: "接着说的", unstable: "")
        let pendingLive = AsrTranscript(stable: "", unstable: "接着说的")

        for candidate in [seam, provisional] {
            for live in [settledLive, pendingLive] {
                #expect(AsrRenewal.merge(seam: candidate, live: live).finalText == "前面那段话。接着说的")
            }
        }
    }

    /// 引擎在 `end` 之后会把接缝那一句整个重写一遍，实测会把跨在切分处的半截词补完
    /// （「…一起过」→「…一起过一遍。」）。定稿是拿这一份**换掉**暂定的那一份。
    ///
    /// 这里是整条链路上最容易写错的一处：把定稿接在暂定后面，同一句话就会在提交的
    /// 文字里出现两遍，而屏幕上看着只是「识别重复了」，用户得自己删。
    @Test func promotingASeamReplacesTheTextRatherThanAppendingIt() {
        // 接缝那一段在旧连接上，活连接是从它之后才开始收的。
        let live = AsrTranscript(stable: "", unstable: "主要是想确认")
        let frozen = AsrSeam(text: "…一起过", provisional: true)

        let before = AsrRenewal.merge(seam: frozen, live: live)
        #expect(before.finalText == "…一起过主要是想确认")

        let settled = AsrRenewal.settle(frozen, to: "…一起过一遍。")
        #expect(!settled.provisional)
        #expect(AsrRenewal.merge(seam: settled, live: live).finalText == "…一起过一遍。主要是想确认")
    }

    // MARK: - 什么时候换

    @Test func warmingStartsAtThePlanPointAndNotBefore() {
        // 预热本身要走一次签名加一次握手，等停顿才开始的话，接棒就会落在用户已经
        // 说回话之后 —— 从词中间切开。
        #expect(!AsrRenewal.shouldStartWarming(connectionAge: 45.8))
        #expect(AsrRenewal.shouldStartWarming(connectionAge: 46))
    }

    @Test func aHandOverWaitsForThePause() {
        // 暖连接已经就绪，用户还在连着说：不动。
        #expect(!AsrRenewal.shouldHandOver(rms: 0.12, connectionAge: 46.2))
        #expect(!AsrRenewal.shouldHandOver(rms: 0.12, connectionAge: 49.8))
        // 停了一下，就在这一拍接棒：这一包静音进新连接，旧连接的音频正好停在词尾。
        #expect(AsrRenewal.shouldHandOver(rms: 0, connectionAge: 46.4))
    }

    /// 接棒得有人接。没到点就绝不接棒，哪怕整段录音一句没停、静得跟没人说话一样。
    @Test func nothingHandsOverBeforeAWarmConnectionCouldExist() {
        #expect(!AsrRenewal.shouldHandOver(rms: 0, connectionAge: 20))
        #expect(!AsrRenewal.shouldHandOver(rms: 0, connectionAge: 45.8))
    }

    @Test func theCeilingHandsOverWithoutWaitingForAPause() {
        // 一直说个不停，等不到停顿：硬顶这一拍必须换，不能再拖。
        #expect(!AsrRenewal.shouldHandOver(rms: 0.12, connectionAge: 49.8))
        #expect(AsrRenewal.shouldHandOver(rms: 0.12, connectionAge: 50))
    }

    /// 两个阈值取错都只该退化，不该越界：无论用户是大声说还是不出声，接棒时刻都落在
    /// 46~50 秒之间，离引擎那条 60.90 秒的硬边很远。取到极端最坏也就是「永远走硬顶」。
    @Test func eitherThresholdStillHandsOverWellInsideTheEnginesCeiling() {
        for rms in [Float(0), 0.005, AsrRenewal.silenceRms, 0.02, 0.12, 1] {
            var handOverAt: TimeInterval?
            var step = 0
            while handOverAt == nil, step <= 300 {
                let age = Double(step) * 0.2
                if AsrRenewal.shouldHandOver(rms: rms, connectionAge: age) { handOverAt = age }
                step += 1
            }

            let at = handOverAt ?? -1
            #expect(at >= AsrRenewal.planAfter, "响度 \(rms) 的接棒时刻不该早于 46 秒")
            #expect(at <= AsrRenewal.forceAfter, "响度 \(rms) 的接棒时刻不该晚于 50 秒")
        }
    }

    // MARK: - 响度

    @Test func rmsTellsSilenceFromSpeech() {
        // 补零包（采样不够时 `takeChunk` 会补）和真实的静音一样，都该算静音。
        #expect(AsrRenewal.rms(ofChunk: chunk(Array(repeating: 0, count: 3_200))) == 0)
        #expect(AsrRenewal.rms(ofChunk: Data()) == 0)
        #expect(AsrRenewal.rms(ofChunk: chunk(Array(repeating: Int16.max, count: 3_200))) > 0.99)
        // 小端逐字节拼出来的值要是对的：负数的低字节不该被当成正数。
        #expect(AsrRenewal.rms(ofChunk: chunk(Array(repeating: -32_768, count: 3_200))) > 0.99)
    }

    @Test func aChunkAtHalfScaleSitsOnTheSpeechSideOfTheGate() {
        // 半量程的说话声不该被当成静音 —— 否则用户小声说话时会被不断误判成停顿。
        let half = AsrRenewal.rms(ofChunk: chunk(Array(repeating: 16_384, count: 3_200)))

        #expect(half > AsrRenewal.silenceRms)
    }

    /// 一包 PCM，按送出去的那份字节序（16bit 小端）拼。
    private func chunk(_ samples: [Int16]) -> Data {
        var data = Data(capacity: samples.count * 2)
        for sample in samples {
            let bits = UInt16(bitPattern: sample)
            data.append(UInt8(bits & 0xFF))
            data.append(UInt8(bits >> 8))
        }
        return data
    }
}
