import Foundation

/// 接缝：换连接之前那一段已经冻结的文本。
///
/// 它排在活连接的前面，位置一旦定下就不再动。`provisional` 只影响**画成什么颜色**，
/// 不影响它排在哪 —— 定稿之前引擎还会改写它（实测接缝处会把半截词补完），所以那时
/// 它只能算未定稿；但把它挪到后面去是另一回事，那是把用户说的话前后颠倒。
struct AsrSeam: Equatable {
    let text: String
    let provisional: Bool
}

/// 一条识别连接能用多久，以及接缝处两段文字怎么接。
///
/// 现用的 `Hy-ASR-3.0-preview` 是混元内测版，**不接受 `needvad`**（服务端签名一直带着
/// `needvad=1`，这个引擎不认），于是落到「未开 VAD 时单次连续识别最长 60 秒」这条规则
/// 上：实测第 60.90 秒收到 `{"code":4014,"message":"音频过长, 请设置参数needvad为1"}`，
/// 随后连接被掐（1006），攒下的一整段文字**全部丢失**。
///
/// 所以轮换不是对用户说话时长的限制，而是**引擎连接的寿命管理**：快到上限时换一条新
/// 连接接着写。用户视角是一段连续转写，界面不加计时、不加提示、不设时长上限。
enum AsrRenewal {
    /// 到了这个时间就开始预热下一条连接。
    ///
    /// 不等停顿再预热：预热要走一次签名 + 一次握手（实测 0.26 秒，弱网更久），等停顿
    /// 才开始的话，接棒就会落在停顿结束、用户已经说回话之后 —— 从词中间切开。
    static let planAfter: TimeInterval = 46

    /// 到这个时间无条件接棒，不再等停顿。
    ///
    /// 实测硬边是 60.90 秒，这里留了 10 秒余量。等引擎自己动手就晚了：它不是"收尾"，
    /// 是直接报错掐连接。
    static let forceAfter: TimeInterval = 50

    /// 包内均方根低于这个值算静音。
    ///
    /// 实测同一段语音里，说话包在 0.07~0.18，句间隙接近 0.0001，0.01 落在两者中间，
    /// 不敏感。包粒度是 200ms，所以「本包是静音」就等于「这 200ms 里没有人声」，
    /// 已经够窄，不需要再攒连续几包。
    static let silenceRms: Float = 0.01

    /// 本拍该不该开始预热。`connectionAge` 是**这条连接**已经收了多久音频，不是这次
    /// 录音已经录了多久 —— 权限弹窗和握手都可能在录音开始之后才把它拖慢。
    static func shouldStartWarming(connectionAge: TimeInterval) -> Bool {
        connectionAge >= planAfter
    }

    /// 暖连接已经就绪时，本拍该不该接棒。
    ///
    /// 在停顿处接棒，接缝两边都不缺字；一直不停就拖到硬顶，那时只能从词中间切开，
    /// 实测会让跨在接缝上的那个词两边各认领一次（多出两三个字）。选停顿只是为了让
    /// 接缝干净，**不决定换不换**：引擎数的是收到的采样，用户不出声也在烧它的额度。
    ///
    /// 这两个阈值取错只会退化、不会越界：一个高到天上去也只会走停顿那条路，一个低到
    /// 零也只会 46 秒就走，两者都不会让连接活过 `forceAfter`。
    static func shouldHandOver(rms: Float, connectionAge: TimeInterval) -> Bool {
        guard connectionAge >= planAfter else { return false }
        return connectionAge >= forceAfter || rms < silenceRms
    }

    /// 接缝定稿。引擎在 `end` 之后会把最后一句整个重写一遍（实测补完了半截词、顺带
    /// 改掉了错字），所以定稿是拿这一份**换掉**暂定的那一份，不是接在它后面 ——
    /// 接在后面同一句话会出现两遍，用户只能自己删。
    ///
    /// 代价是这份重写偶尔会吞掉接缝处的半个字（实测「本地缓冲」丢过一个「本」，因为
    /// 那个字正好跨在两次切分之间）。认下它：引擎对自己听到的那段音频的判断，比暂定
    /// 文本里那个半听半猜的字更可信。
    static func settle(_ seam: AsrSeam, to text: String) -> AsrSeam {
        AsrSeam(text: text, provisional: false)
    }

    /// 把冻结的接缝和活连接的文本接起来。
    ///
    /// 接缝还没有定稿时，活连接**已经定稿**的句子也只能排进未定稿的那一半。顺序比
    /// 颜色重要：颜色错了只是看着别扭，等定稿回来就恢复；顺序错了是用户提交的文字
    /// 前后颠倒，只能自己手改。
    static func merge(seam: AsrSeam?, live: AsrTranscript) -> AsrTranscript {
        guard let seam else { return live }
        guard seam.provisional else {
            return AsrTranscript(stable: seam.text + live.stable, unstable: live.unstable)
        }
        return AsrTranscript(stable: "", unstable: seam.text + live.stable + live.unstable)
    }

    /// 一包 PCM 的响度。包是 16k / 16bit / 单声道的小端字节，和送出去的那一份完全一样。
    ///
    /// 逐字节拼，不用 `bindMemory` 把它当成 `Int16` 数组读：那要求指针对齐，`Data`
    /// 的缓冲区不保证满足。
    static func rms(ofChunk chunk: Data) -> Float {
        let sampleCount = chunk.count / 2
        guard sampleCount > 0 else { return 0 }
        var sum = 0.0
        chunk.withUnsafeBytes { raw in
            for index in stride(from: 0, to: sampleCount * 2, by: 2) {
                let bits = UInt16(raw[index]) | (UInt16(raw[index + 1]) << 8)
                let value = Double(Int16(bitPattern: bits)) / 32_768
                sum += value * value
            }
        }
        return Float((sum / Double(sampleCount)).squareRoot())
    }
}
