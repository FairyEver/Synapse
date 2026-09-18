import { describe, expect, it, vi } from "vitest"

import { buildMinutesPrompt, createMeetingMinutesGenerator, normalizeMinutes, parseMinutesJson } from "../minutes"

const speakers = [
  { speakerId: 0, name: "李杨" },
  { speakerId: 1, name: null },
]

const segments = [
  { id: "s1", speakerId: 0, startMs: 0, endMs: 1000, text: "先过导出方案。", words: [] },
  { id: "s2", speakerId: 1, startMs: 1200, endMs: 2000, text: "客户要能直接汇报的东西。", words: [] },
]

describe("提示词", () => {
  it("带上说话人真名，填过的用真名，没填的用编号", () => {
    const prompt = buildMinutesPrompt({ title: "Q3 评审", speakers, segments })
    expect(prompt).toContain("李杨：先过导出方案。")
    expect(prompt).toContain("发言人 2：客户要能直接汇报的东西。")
  })

  it("要求只输出 JSON，并说明每一段的结构", () => {
    const prompt = buildMinutesPrompt({ title: "Q3 评审", speakers, segments })
    expect(prompt).toContain("只输出一个 JSON 对象")
    expect(prompt).toContain('"topics"')
    expect(prompt).toContain('"conclusions"')
    expect(prompt).toContain('"todos"')
  })

  it("明确要求不补充逐字稿里没有的内容", () => {
    // 纪要最常见的毛病就是模型自己加戏，这条是提示词里唯一能防它的地方。
    const prompt = buildMinutesPrompt({ title: "Q3 评审", speakers, segments })
    expect(prompt).toContain("不要补充任何没提到的内容")
  })
})

describe("解析模型输出", () => {
  it("直接给 JSON 能解析", () => {
    expect(parseMinutesJson('{"topics":["导出"]}')).toEqual({ topics: ["导出"] })
  })

  it("包在代码块里也能解析", () => {
    const raw = '好的，这是纪要：\n```json\n{"topics":["导出"],"todos":[]}\n```\n'
    expect(parseMinutesJson(raw)).toMatchObject({ topics: ["导出"] })
  })

  it("前后有解释文字时抠出中间那个对象", () => {
    expect(parseMinutesJson('我先说明一下 {"topics":[]} 以上。')).toEqual({ topics: [] })
  })

  it("不是 JSON 就返回 null，交给调用方报错", () => {
    expect(parseMinutesJson("抱歉，我没能整理出纪要。")).toBeNull()
    expect(parseMinutesJson("[1,2,3]")).toBeNull()
  })
})

describe("结构规整", () => {
  it("丢掉非字符串项和空串", () => {
    expect(normalizeMinutes({ topics: ["导出", "", 42, null, "  移动端"] }).topics).toEqual(["导出", "移动端"])
  })

  it("待办缺 text 就丢掉，缺负责人和时间给 null", () => {
    const minutes = normalizeMinutes({
      todos: [
        { text: "对齐接口", owner: "李杨", due: "下周三" },
        { text: "   " },
        { owner: "没人", due: null },
      ],
    })
    expect(minutes.todos).toHaveLength(1)
    expect(minutes.todos[0]).toMatchObject({ text: "对齐接口", owner: "李杨", due: "下周三", done: false })
  })

  it("模型把 null 写成字符串时当作没填", () => {
    expect(normalizeMinutes({ todos: [{ text: "做事", owner: "null", due: "null" }] }).todos[0]).toMatchObject({
      owner: null,
      due: null,
    })
  })

  it("字段缺失或类型不对时给空数组，不抛异常", () => {
    expect(normalizeMinutes({})).toEqual({ topics: [], conclusions: [], todos: [], editedAt: null })
    expect(normalizeMinutes({ topics: "导出" }).topics).toEqual([])
  })

  it("给每个待办一个稳定的本地 id", () => {
    const minutes = normalizeMinutes({ todos: [{ text: "一" }, { text: "二" }] })
    expect(minutes.todos.map((todo) => todo.id)).toEqual(["todo-1", "todo-2"])
  })
})

describe("生成", () => {
  function generatorWith(summary: string, status = "success") {
    const sendScheduled = vi.fn(async () => ({ status, summary }))
    return {
      sendScheduled,
      generator: createMeetingMinutesGenerator({ sendScheduled, projectId: "builtin:default-agent-workspace" }),
    }
  }

  it("拿 Agent 的返回整理成纪要", async () => {
    const { sendScheduled, generator } = generatorWith(
      JSON.stringify({ topics: ["导出"], conclusions: [], todos: [{ text: "对齐格式", owner: null, due: null }] }),
    )
    const minutes = await generator.generate({ title: "Q3 评审", speakers, segments })
    expect(minutes.topics).toEqual(["导出"])
    expect(minutes.todos).toHaveLength(1)
    expect(sendScheduled).toHaveBeenCalledWith(expect.objectContaining({ projectId: "builtin:default-agent-workspace" }))
  })

  it("没有逐字稿时不调用模型", async () => {
    const { sendScheduled, generator } = generatorWith("{}")
    await expect(generator.generate({ title: "空会议", speakers: [], segments: [] })).rejects.toThrow("没有识别到语音")
    expect(sendScheduled).not.toHaveBeenCalled()
  })

  it("模型跑失败时把原因抛给界面", async () => {
    const sendScheduled = vi.fn(async () => ({ status: "error", error: "运行失败" }))
    const generator = createMeetingMinutesGenerator({ sendScheduled, projectId: "p" })
    await expect(generator.generate({ title: "t", speakers, segments })).rejects.toThrow("运行失败")
  })

  it("返回的不是 JSON 时报错，而不是存一份空纪要", async () => {
    const { generator } = generatorWith("抱歉，我没能整理出纪要。")
    await expect(generator.generate({ title: "t", speakers, segments })).rejects.toThrow("生成纪要失败")
  })
})
