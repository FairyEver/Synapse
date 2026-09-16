import Testing

@testable import SynapseMobile

/// 腾讯云返回的识别结果按「句」推进，每句带自己的 index 和 slice_type。
///
/// 这一层之所以单独拿出来测，是因为它决定了用户看到的是不是他说的话：未定稿的
/// 文字**还会变**，一旦被当成结果写进输入框，用户眼看着字变了会很难受。所以下面
/// 每一条都在钉住两级的边界，而不是在测拼接本身。
struct AsrTranscriptTests {
    /// 直接读那一句的二级文本。分开断言 stable 和 unstable，正是因为「没算进已定
    /// 稿」和「没被丢掉」是两件事，合成一个字符串就看不出区别了。
    private func transcript(_ steps: [(slice: Int, index: Int, text: String)]) -> AsrTranscript {
        var accumulator = AsrTranscriptAccumulator()
        for step in steps {
            accumulator.apply(index: step.index, sliceType: step.slice, text: step.text)
        }
        return accumulator.snapshot()
    }

    @Test func unsettledTextNeverCountsAsSettled() {
        let result = transcript([(1, 0, "帮我看看")])

        // 一个字都不能进 stable：还没定稿的句子写得进去，就等于把它当成了结果。
        #expect(result.stable.isEmpty)
        #expect(result.unstable == "帮我看看")
    }

    @Test func settlingMovesTheSentenceOutOfTheCurrentOne() {
        let result = transcript([(1, 0, "帮我看看"), (2, 0, "帮我看看终端")])

        #expect(result.stable == "帮我看看终端")
        // 定稿之后当前句就该空了，否则同一句会在两级里各出现一次。
        #expect(result.unstable.isEmpty)
    }

    @Test func aSentenceStartIsNotASettledSentence() {
        // slice_type 0 是「这句开始」，文字后面还会改。把它当定稿，同一句的下半截
        // 会再以当前句的身份跟一遍，屏幕上就成了「帮我看看帮我看看终端」。
        let result = transcript([(0, 0, "帮我看看"), (1, 0, "帮我看看终端")])

        #expect(result.stable.isEmpty)
        #expect(result.unstable == "帮我看看终端")
        #expect(result.combined == "帮我看看终端")
    }

    @Test func sentencesAreJoinedByIndexNotByArrivalOrder() {
        let result = transcript([(2, 1, "的终端"), (2, 0, "帮我看看"), (2, 2, "渲染")])

        #expect(result.stable == "帮我看看的终端渲染")
        #expect(result.unstable.isEmpty)
    }

    @Test func onlySentenceStartsAndFinalsStillProduceTheWholeText() {
        // 短句可能一次「识别中」都没有，直接 0 到 2。
        let result = transcript([(0, 0, "帮我看看"), (2, 0, "帮我看看"), (0, 1, "的终端"), (2, 1, "的终端")])

        #expect(result.stable == "帮我看看的终端")
        #expect(result.finalText == "帮我看看的终端")
    }

    @Test func aLateUnsettledResultCannotReopenASettledSentence() {
        // 网络抖动会把旧结果迟到送上来。放它进当前句，同一句又会算两遍。
        let result = transcript([(2, 0, "帮我看看"), (1, 0, "帮我")])

        #expect(result.stable == "帮我看看")
        #expect(result.unstable.isEmpty)
        #expect(result.combined == "帮我看看")
    }

    @Test func theCurrentSentenceAlwaysFollowsEverySettledOne() {
        let result = transcript([(2, 0, "帮我看看"), (1, 1, "的终端")])

        #expect(result.stable == "帮我看看")
        #expect(result.unstable == "的终端")
        #expect(result.combined == "帮我看看的终端")
    }

    @Test func blankResultsLeaveNothingToSubmit() {
        // 没有人声时引擎回的是空串，或者只有一段空白。那都不是命令。
        #expect(transcript([(2, 0, "")]).finalText.isEmpty)
        #expect(transcript([(1, 0, "   ")]).finalText.isEmpty)
        #expect(transcript([(2, 0, "\n")]).finalText.isEmpty)
        #expect(AsrTranscript.empty.finalText.isEmpty)
        // 有内容时前后的空白要抹掉，句子之间不留空。
        #expect(transcript([(2, 0, " 帮我看看 ")]).finalText == "帮我看看")
    }

    @Test func emptyMeansNothingWasHeard() {
        var accumulator = AsrTranscriptAccumulator()
        #expect(accumulator.isEmpty)

        accumulator.apply(index: 0, sliceType: 1, text: "帮我看看")
        #expect(!accumulator.isEmpty)

        // 定稿之后仍然不算空：那是听到的内容。
        accumulator.apply(index: 0, sliceType: 2, text: "帮我看看")
        #expect(!accumulator.isEmpty)
    }

    @Test func onlyRealChangesAreReported() {
        var accumulator = AsrTranscriptAccumulator()

        // 同一句的非稳态结果会重复下发，内容是全量而非增量。
        #expect(accumulator.apply(index: 0, sliceType: 1, text: "帮我看看"))
        #expect(!accumulator.apply(index: 0, sliceType: 1, text: "帮我看看"))
        #expect(accumulator.apply(index: 0, sliceType: 1, text: "帮我看看终端"))
        #expect(accumulator.apply(index: 0, sliceType: 2, text: "帮我看看终端"))
        // 已经定稿的句子再来一次同样的定稿，文本没有变。
        #expect(!accumulator.apply(index: 0, sliceType: 2, text: "帮我看看终端"))
    }
}
