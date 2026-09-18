import Foundation

/// 未捕获异常的最后一手。
///
/// **它抓不到的东西比抓得到的多**，这一点必须写清楚，否则日志会被误读成"没崩过"：
/// 只覆盖 Objective-C 的 `NSException`。Swift 运行时陷阱（`fatalError`、强解包 nil、
/// 数组越界、`precondition`）、POSIX 信号类崩溃（SIGSEGV/SIGABRT）、内存被系统回收
/// （jetsam）、看门狗杀进程 —— 一律不走这里。
///
/// 所以真正的兜底不是它，是**每秒落盘**：无论怎么死，文件里都有死之前那一秒。
/// 这个处理器只是让"恰好是 NSException"的那一类多带上异常名和调用栈。
nonisolated enum DiagnosticCrashHandler {
    /// 崩溃处理器是 C 函数指针，捕获不了上下文，所以目标放在一个静态盒子里。
    private final class Box: @unchecked Sendable {
        var sink: DiagnosticFileSink?
    }

    private static let box = Box()

    /// `C` 函数指针装不了会捕获上下文的闭包，而工程默认一切都是主 actor 的 ——
    /// 所以处理器函数在这里显式 `nonisolated`，否则这个闭包就是在往主 actor 上跳。
    nonisolated static func install(sink: DiagnosticFileSink) {
        box.sink = sink
        NSSetUncaughtExceptionHandler { exception in
            DiagnosticCrashHandler.record(exception)
        }
    }

    /// 在崩溃线程上跑。这里能做的事很少，而且每多一件都可能是压垮它的那一件：
    /// 取锁用 `trylock`（拿不到就整段跳过，绝不死等）、不开文件、不轮转、不编码 JSON、
    /// 不调 `DispatchQueue.sync`（崩溃线程若正持有那把锁就是死锁 —— 那正是"日志把 App
    /// 卡死在崩溃上报里"）。
    nonisolated static func record(_ exception: NSException) {
        guard let sink = box.sink else { return }

        // 先把缓冲区里已经攒下的写出去：它们比这条异常更接近事发经过。
        sink.writeCrashRecordsSynchronously()

        // 异常名是 `NSInvalidArgumentException` 这类类名，不是用户内容；仍然走一遍
        // 脱敏与限长，因为同一个通道不该有"这次可以例外"的说法。
        sink.appendCrashLine(
            DiagnosticLineRenderer.render(
                DiagnosticRecord(
                    seq: 0,
                    time: Date(),
                    level: .error,
                    event: .uncaughtException,
                    fields: [
                        DiagnosticEntry(
                            .exceptionName,
                            .message(RedactedMessage(redacting: exception.name.rawValue))
                        ),
                        DiagnosticEntry(
                            .reason,
                            .message(RedactedMessage(redacting: exception.reason ?? ""))
                        ),
                        DiagnosticEntry(.stack, .stack(RedactedStack.frames(exception.callStackSymbols))),
                    ]
                )
            )
        )
    }
}
