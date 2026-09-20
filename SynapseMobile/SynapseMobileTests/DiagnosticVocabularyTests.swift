import Testing

@testable import SynapseMobile

/// 诊断日志那套闭合词汇表自己的一致性。
///
/// 这套机制把「日志能有什么」全部压在编译期：事件、字段、标签、路由、意图都是闭合枚举。
/// 代价是每加一样都要走一道手续，收益是**写错词是编译不过的**。这里补的是编译期管不到的
/// 那几件事 —— 词与词之间的对应关系。
struct DiagnosticVocabularyTests {
    /// 每一个事件名的前缀都得在已知表里。
    ///
    /// `lane` 那个 switch 有一个 `default: .app`（Swift 的 `switch` 对 `String` 必须穷尽），
    /// 于是「随手写了个 `netx.foo`」不会被编译器拦住，只会落进 app 路。这条测试就是那道
    /// 防线的替代品：它把每一个 `allCases` 的前缀都过一遍，没见过的前缀是红灯 ——
    /// 而不是磁盘上悄悄多出一路文件。
    @Test func everyEventPrefixIsKnown() {
        for event in DiagnosticEvent.allCases {
            #expect(
                DiagnosticEvent.knownLanePrefixes.contains(event.lanePrefix),
                "事件 \(event.rawValue) 的前缀「\(event.lanePrefix)」不在已知表里 —— 要么加进 knownLanePrefixes 与 lane 的 switch，要么改个名字"
            )
        }
    }

    /// 每一个域都得有事件会落到它上面。
    ///
    /// 一个没有任何事件指向的域就是磁盘上一个**永远为空**的文件 —— 读日志的人会以为
    /// 「这个域什么都没发生」，而事实是它根本没被接上。
    @Test func everyLaneIsReachable() {
        let reachable = Set(DiagnosticEvent.allCases.map(\.lane))
        for lane in DiagnosticLane.allCases {
            #expect(reachable.contains(lane), "没有事件会落到「\(lane.rawValue)」这一路")
        }
    }

    /// 域在磁盘上的目录名就是它自己的名字 —— 不另起一套命名。
    @Test func laneDirectoryMatchesItsName() {
        for lane in DiagnosticLane.allCases {
            #expect(lane.directoryName == lane.rawValue)
        }
    }

    /// 前缀到域的归属逐条钉住。
    ///
    /// 上面那条只证明「前缀是已知的」，不证明「分到了对的那一路」。少了两条 `net.` 被分到
    /// `term` 也是绿的 —— 而这正是显式给每个事件写 `domain` 属性会允许的那种不一致。
    @Test func prefixesMapToTheLaneTheyShould() {
        let expected: [DiagnosticLane: Set<String>] = [
            .app: ["app", "ui"],
            .term: ["term"],
            .net: ["net", "auth", "push"],
            .env: ["env"],
            .crash: ["crash"],
            .log: ["log"],
        ]
        for (lane, prefixes) in expected {
            #expect(Set(DiagnosticLane.allCases).contains(lane))
            for prefix in prefixes {
                let event = DiagnosticEvent.allCases.first { $0.lanePrefix == prefix }
                #expect(event != nil, "没有任何事件用前缀「\(prefix)」，这条对应关系是死的")
                #expect(event?.lane == lane, "前缀「\(prefix)」应当落到 \(lane.rawValue) 路")
            }
        }
        // 反过来：已知表里的每一个前缀都被上面覆盖了。
        let covered = Set(expected.values.flatMap { $0 })
        #expect(covered == DiagnosticEvent.knownLanePrefixes, "已知前缀表与归属表对不上了")
    }

    /// 意图：认得出来的转成自己，认不出的走 `.other` 而不是丢记录。
    ///
    /// 协议加一种新 intent 而这里忘了跟的时候，日志显示 `other` —— 信息少了一点，
    /// 但那条记录还在，不会让人以为「没发过这个 intent」。
    @Test func intentsRoundTripAndUnknownsFallBack() {
        for intent in DiagnosticIntent.allCases where intent != .other {
            #expect(DiagnosticIntent.named(intent.rawValue) == intent)
        }
        #expect(DiagnosticIntent.named("attach") == .attach)
        #expect(DiagnosticIntent.named("somethingTheProtocolAddedLater") == .other)
        #expect(DiagnosticIntent.named("") == .other)
    }

    /// REST 路由：按第一段分家族，认不出的走 `.other`。
    ///
    /// 这些形状直接来自 `APIClient` 里各 typed 方法实际用的 path，改路由前缀时这条会红。
    @Test func routesAreDerivedFromTheFirstPathSegment() {
        let cases: [(String, DiagnosticRoute)] = [
            ("/auth/login", .auth),
            ("/auth/refresh", .auth),
            ("/mobile/devices", .mobile),
            ("/mobile/summary?desktopClientInstanceId=x", .mobile),
            ("/mobile/terminal/intent", .mobile),
            ("/drive/uploads/prepare", .drive),
            ("/meetings/recordings", .meetings),
            ("/meetings/abc-123/audio-url", .meetings),
            ("/voice/asr", .voice),
            ("/voice/asr/session", .voice),
            ("/", .other),
            ("", .other),
            ("/somethingnew/x", .other),
        ]
        for (path, route) in cases {
            #expect(DiagnosticRoute.family(of: path) == route, "\(path) 分错了家族")
        }
    }
}
