/** Reported dashboard topology; all values are synthetic fixture data. */
export const codeReportSource = `root = Stack([headline, kpis, viewSwitch, chartCard, tableCard])
$view = "all"
headline = TextContent("Monthly code report")
kpis = OverviewCardBlock([kpiAdd, kpiDel, kpiNet, kpiCommits])
kpiAdd = OverviewCardItem("add", Text("text", "Added"), MetricIndicatorInline("" + @Sum(data.a)))
kpiDel = OverviewCardItem("del", Text("text", "Deleted"), MetricIndicatorInline("" + @Sum(data.d)))
kpiNet = OverviewCardItem("net", Text("text", "Net"), MetricIndicatorInline("" + (@Sum(data.a) - @Sum(data.d))))
kpiCommits = OverviewCardItem("c", Text("text", "Commits"), MetricIndicatorInline("" + @Sum(data.c)))
viewSwitch = Buttons([Button("All", @Set($view, "all")), Button("Source", @Set($view, "src")), Button("Business", @Set($view, "biz"))])
data = $view == "all" ? allRows : $view == "src" ? srcRows : bizRows
chartCard = Card([CardHeader("Daily lines"), views])
views = Tabs([TabItem("bar", "Changes", [chartBar]), TabItem("net", "Net", [chartNet])])
chartBar = BarChart(data.day, [Series("Added", data.a), Series("Deleted", data.d)], "grouped", "Date", "Lines", 340)
net = @Each(data, "r", r.a - r.d)
chartNet = LineChart(data.day, [Series("Net", net)], "linear", "Date", "Lines", 300)
tableCard = Card([CardHeader("Daily details"), Table([Col("Date", data.day), Col("Commits", data.c, "number"), Col("Added", data.a, "number"), Col("Deleted", data.d, "number")])])
allRows = ${JSON.stringify(Array.from({ length: 21 }, (_, n) => ({ day: `Day ${n + 1}`, c: 1, a: 100 + n, d: n })))}
srcRows = ${JSON.stringify(Array.from({ length: 21 }, (_, n) => ({ day: `Day ${n + 1}`, c: 1, a: 50 + n, d: n })))}
bizRows = ${JSON.stringify(Array.from({ length: 21 }, (_, n) => ({ day: `Day ${n + 1}`, c: 1, a: 20 + n, d: n })))}
`

export const reversedTextCodeReportSource = codeReportSource.replace(/Text\("text", "(Added|Deleted|Net|Commits)"\)/g, 'Text("$1", "text")')
