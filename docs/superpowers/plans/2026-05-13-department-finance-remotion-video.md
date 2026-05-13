# Department Finance Remotion Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 1080 x 1920, 60fps Remotion short video from Synapse `money_record` data, with animated bar and pie charts.

**Architecture:** Create an isolated generated-video workspace under `artifacts/department-finance-video/` so Synapse app code remains untouched. Store the queried finance snapshot as a local data module and render one Remotion composition, `DepartmentFinanceShort`, from focused React components.

**Tech Stack:** Remotion, React, TypeScript, SVG, Node/pnpm or npm scripts.

---

## File Structure

- Create `artifacts/department-finance-video/`: isolated Remotion project directory.
- Create `artifacts/department-finance-video/src/data/finance-data.ts`: typed finance totals and largest items from the Synapse MCP query.
- Create `artifacts/department-finance-video/src/Root.tsx`: Remotion composition registration for `DepartmentFinanceShort`.
- Create `artifacts/department-finance-video/src/DepartmentFinanceShort.tsx`: scene timing and layout orchestration.
- Create `artifacts/department-finance-video/src/components/ImpactNumber.tsx`: animated balance number.
- Create `artifacts/department-finance-video/src/components/BarChart.tsx`: animated four-category bar chart.
- Create `artifacts/department-finance-video/src/components/PieChart.tsx`: animated donut/pie structure chart.
- Create `artifacts/department-finance-video/src/components/SummaryScene.tsx`: final conclusion scene.
- Create `artifacts/department-finance-video/src/styles.ts`: shared layout, typography, and color constants local to the video project.
- Create `artifacts/department-finance-video/src/utils/format.ts`: currency and percentage helpers.

## Task 1: Scaffold Remotion Project

**Files:**
- Create: `artifacts/department-finance-video/package.json`
- Create: `artifacts/department-finance-video/remotion.config.ts`
- Create: `artifacts/department-finance-video/tsconfig.json`
- Create: `artifacts/department-finance-video/src/index.ts`
- Create: `artifacts/department-finance-video/src/Root.tsx`

- [ ] **Step 1: Scaffold a blank Remotion app**

Run:

```bash
mkdir -p artifacts
cd artifacts
npx create-video@latest --yes --blank --no-tailwind department-finance-video
```

Expected: `artifacts/department-finance-video` exists with a Remotion project.

- [ ] **Step 2: Replace the composition root with the target video settings**

In `artifacts/department-finance-video/src/Root.tsx`, ensure the composition uses:

```tsx
import { Composition } from "remotion";
import { DepartmentFinanceShort } from "./DepartmentFinanceShort";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="DepartmentFinanceShort"
      component={DepartmentFinanceShort}
      durationInFrames={900}
      fps={60}
      width={1080}
      height={1920}
    />
  );
};
```

- [ ] **Step 3: Verify the scaffold compiles far enough to list compositions**

Run:

```bash
cd artifacts/department-finance-video
npx remotion compositions
```

Expected: the command lists `DepartmentFinanceShort` after later component files exist. If this step fails because `DepartmentFinanceShort` is not created yet, continue to Task 2 and re-run this command there.

## Task 2: Add Data and Utilities

**Files:**
- Create: `artifacts/department-finance-video/src/data/finance-data.ts`
- Create: `artifacts/department-finance-video/src/utils/format.ts`

- [ ] **Step 1: Add the typed finance snapshot**

Create `src/data/finance-data.ts`:

```ts
export type FinanceCategory = {
  key: "income" | "expense" | "receivable" | "payable";
  label: string;
  amount: number;
};

export type FinanceItem = {
  type: string;
  label: string;
  amount: number;
};

export const financeCategories: FinanceCategory[] = [
  { key: "income", label: "收入", amount: 5540 },
  { key: "expense", label: "支出", amount: 5120.13 },
  { key: "receivable", label: "应收款", amount: 50 },
  { key: "payable", label: "应付款", amount: 6422.42 },
];

export const largestItems: FinanceItem[] = [
  { type: "应付款", label: "苹东家宴 樊总垫付", amount: 2753 },
  { type: "支出", label: "8月10号 瑞福春", amount: 1432 },
  { type: "应付款", label: "樊总支付麦当劳", amount: 1046.4 },
  { type: "支出", label: "王磊奖金", amount: 1000 },
];

export const financeSummary = {
  rowCount: 86,
  balance: -5952.55,
  totalPositive: 5590,
  totalNegative: 11542.55,
};
```

- [ ] **Step 2: Add formatting helpers**

Create `src/utils/format.ts`:

```ts
export const formatMoney = (value: number): string =>
  value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const formatPercent = (value: number): string =>
  `${Math.round(value * 10) / 10}%`;
```

- [ ] **Step 3: Verify TypeScript imports**

Run:

```bash
cd artifacts/department-finance-video
npx tsc --noEmit
```

Expected: this may fail until all component imports are added. Re-run after Task 5.

## Task 3: Build Shared Visual Constants

**Files:**
- Create: `artifacts/department-finance-video/src/styles.ts`

- [ ] **Step 1: Add local video style constants**

Create `src/styles.ts`:

```ts
export const colors = {
  background: "#0f172a",
  panel: "#111827",
  text: "#f8fafc",
  muted: "#94a3b8",
  income: "#22c55e",
  expense: "#f97316",
  receivable: "#38bdf8",
  payable: "#ef4444",
  line: "#334155",
};

export const categoryColors = {
  income: colors.income,
  expense: colors.expense,
  receivable: colors.receivable,
  payable: colors.payable,
} as const;

export const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
```

Note: These hex colors are local to the generated video project, not Synapse UI code. They are acceptable for a rendered video asset.

- [ ] **Step 2: Verify no Synapse renderer files changed**

Run:

```bash
git status --short desktop/src desktop/electron
```

Expected: no new changes from this video implementation.

## Task 4: Implement Animated Components

**Files:**
- Create: `artifacts/department-finance-video/src/components/ImpactNumber.tsx`
- Create: `artifacts/department-finance-video/src/components/BarChart.tsx`
- Create: `artifacts/department-finance-video/src/components/PieChart.tsx`
- Create: `artifacts/department-finance-video/src/components/SummaryScene.tsx`

- [ ] **Step 1: Implement `ImpactNumber`**

Create `src/components/ImpactNumber.tsx`:

```tsx
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { colors } from "../styles";
import { formatMoney } from "../utils/format";

type ImpactNumberProps = {
  value: number;
};

export const ImpactNumber: React.FC<ImpactNumberProps> = ({ value }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = interpolate(frame, [0, 1.4 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const opacity = interpolate(frame, [0, 0.35 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale = interpolate(frame, [0, 0.5 * fps, 1.4 * fps], [0.86, 1.04, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const shownValue = value * progress;

  return (
    <div style={{ opacity, transform: `scale(${scale})`, transformOrigin: "center" }}>
      <div style={{ fontSize: 48, color: colors.muted, marginBottom: 28 }}>综合余额</div>
      <div style={{ fontSize: 128, fontWeight: 800, color: colors.payable }}>
        {shownValue < 0 ? "-" : ""}
        {formatMoney(Math.abs(shownValue))}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Implement `BarChart`**

Create `src/components/BarChart.tsx`:

```tsx
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { categoryColors, colors } from "../styles";
import { FinanceCategory } from "../data/finance-data";
import { formatMoney } from "../utils/format";

type BarChartProps = {
  data: FinanceCategory[];
};

export const BarChart: React.FC<BarChartProps> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const maxAmount = Math.max(...data.map((item) => item.amount));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
      {data.map((item, index) => {
        const delay = index === 3 ? 0 : 150 + index * 16;
        const growth = spring({
          frame: frame - delay,
          fps,
          config: { damping: 22, stiffness: 120, mass: 0.9 },
        });
        const labelOpacity = interpolate(frame, [delay, delay + 24], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        });
        const width = `${Math.max(2, (item.amount / maxAmount) * 100 * growth)}%`;

        return (
          <div key={item.key}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 12,
                opacity: labelOpacity,
              }}
            >
              <span style={{ color: colors.text, fontSize: 38, fontWeight: 700 }}>
                {item.label}
              </span>
              <span style={{ color: colors.muted, fontSize: 34 }}>{formatMoney(item.amount)}</span>
            </div>
            <div
              style={{
                height: 52,
                borderRadius: 26,
                background: colors.panel,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width,
                  borderRadius: 26,
                  background: categoryColors[item.key],
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
```

- [ ] **Step 3: Implement `PieChart`**

Create `src/components/PieChart.tsx`:

```tsx
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { categoryColors, colors } from "../styles";
import { FinanceCategory } from "../data/finance-data";
import { formatPercent } from "../utils/format";

type PieChartProps = {
  data: FinanceCategory[];
};

export const PieChart: React.FC<PieChartProps> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = frame - 9 * fps;
  const total = data.reduce((sum, item) => sum + item.amount, 0);
  const radius = 228;
  const center = 270;
  const circumference = 2 * Math.PI * radius;
  let accumulated = 0;

  const progress = interpolate(localFrame, [0, 2.1 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width={540} height={540} viewBox="0 0 540 540">
        {data.map((item) => {
          const ratio = item.amount / total;
          const segmentLength = ratio * circumference;
          const dash = `${segmentLength * progress} ${circumference}`;
          const dashOffset = -accumulated * circumference;
          accumulated += ratio;

          return (
            <circle
              key={item.key}
              r={radius}
              cx={center}
              cy={center}
              fill="none"
              stroke={categoryColors[item.key]}
              strokeWidth={64}
              strokeDasharray={dash}
              strokeDashoffset={dashOffset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${center} ${center})`}
            />
          );
        })}
        <circle r={150} cx={center} cy={center} fill={colors.background} />
        <text
          x={center}
          y={center - 10}
          textAnchor="middle"
          fill={colors.text}
          fontSize={48}
          fontWeight={800}
        >
          资金结构
        </text>
        <text x={center} y={center + 52} textAnchor="middle" fill={colors.muted} fontSize={30}>
          当前截面
        </text>
      </svg>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, width: "100%" }}>
        {data.map((item) => (
          <div key={item.key} style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                background: categoryColors[item.key],
              }}
            />
            <span style={{ color: colors.text, fontSize: 30 }}>{item.label}</span>
            <span style={{ color: colors.muted, fontSize: 28 }}>
              {formatPercent((item.amount / total) * 100)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Implement `SummaryScene`**

Create `src/components/SummaryScene.tsx`:

```tsx
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { colors } from "../styles";

export const SummaryScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [13 * fps, 13.7 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        opacity,
        color: colors.text,
        fontSize: 58,
        fontWeight: 800,
        lineHeight: 1.25,
        textAlign: "center",
      }}
    >
      应付款占比最高
      <br />
      需优先处理
    </div>
  );
};
```

## Task 5: Compose the Video

**Files:**
- Create: `artifacts/department-finance-video/src/DepartmentFinanceShort.tsx`
- Modify: `artifacts/department-finance-video/src/Root.tsx`

- [ ] **Step 1: Implement scene orchestration**

Create `src/DepartmentFinanceShort.tsx`:

```tsx
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { BarChart } from "./components/BarChart";
import { ImpactNumber } from "./components/ImpactNumber";
import { PieChart } from "./components/PieChart";
import { SummaryScene } from "./components/SummaryScene";
import { financeCategories, financeSummary, largestItems } from "./data/finance-data";
import { colors, fontFamily } from "./styles";
import { formatMoney } from "./utils/format";

const fadeWindow = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, start + 18, end - 18, end], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

export const DepartmentFinanceShort: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const barOpacity = fadeWindow(frame, 2 * fps, 9 * fps);
  const pieOpacity = fadeWindow(frame, 9 * fps, 13.2 * fps);

  return (
    <AbsoluteFill
      style={{
        background: colors.background,
        color: colors.text,
        fontFamily,
        padding: "116px 86px",
      }}
    >
      <div style={{ fontSize: 42, color: colors.muted, marginBottom: 42 }}>部门收支速览</div>
      <div style={{ position: "relative", flex: 1 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: fadeWindow(frame, 0, 2.4 * fps),
          }}
        >
          <ImpactNumber value={financeSummary.balance} />
        </div>

        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            opacity: barOpacity,
          }}
        >
          <div style={{ fontSize: 64, fontWeight: 800, marginBottom: 56 }}>应付款压力最大</div>
          <BarChart data={financeCategories} />
        </div>

        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 54,
            opacity: pieOpacity,
          }}
        >
          <PieChart data={financeCategories} />
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {largestItems.slice(0, 3).map((item) => (
              <div
                key={`${item.type}-${item.label}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 24,
                  color: colors.muted,
                  fontSize: 30,
                }}
              >
                <span>{item.label}</span>
                <span>{formatMoney(item.amount)}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <SummaryScene />
        </div>
      </div>
      <div style={{ color: colors.muted, fontSize: 28 }}>当前记录：86 条</div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Verify composition registration**

Run:

```bash
cd artifacts/department-finance-video
npx remotion compositions
```

Expected: `DepartmentFinanceShort` appears with `1080x1920`, `60 fps`, `900 frames`.

## Task 6: Render and Verify

**Files:**
- Generated: `artifacts/department-finance-video/out/department-finance-short.mp4`
- Generated: `artifacts/department-finance-video/out/frame-300.png`

- [ ] **Step 1: Run type checking**

Run:

```bash
cd artifacts/department-finance-video
npx tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 2: Render a still frame**

Run:

```bash
cd artifacts/department-finance-video
npx remotion still DepartmentFinanceShort out/frame-300.png --frame=300 --scale=0.5
```

Expected: `out/frame-300.png` is created and shows the bar chart phase.

- [ ] **Step 3: Render the final MP4**

Run:

```bash
cd artifacts/department-finance-video
npx remotion render DepartmentFinanceShort out/department-finance-short.mp4
```

Expected: `out/department-finance-short.mp4` is created at 1080 x 1920, 60fps, 15 seconds.

- [ ] **Step 4: Inspect the rendered video metadata**

Run:

```bash
cd artifacts/department-finance-video
npx remotion ffprobe out/department-finance-short.mp4
```

Expected: metadata reports 1080 width, 1920 height, 60 fps, and about 15 seconds duration.

## Task 7: Commit Plan and Artifacts

**Files:**
- Add plan file if not already committed.
- Add Remotion source files.
- Do not add large MP4 unless the user explicitly wants rendered artifacts committed.

- [ ] **Step 1: Check status**

Run:

```bash
git status --short
```

Expected: only this plan and `artifacts/department-finance-video` source files are new or modified, plus pre-existing unrelated user changes.

- [ ] **Step 2: Commit source files only**

Run:

```bash
git add docs/superpowers/plans/2026-05-13-department-finance-remotion-video.md artifacts/department-finance-video
git reset artifacts/department-finance-video/out
git commit -m "feat: add department finance remotion video"
```

Expected: commit succeeds without staging unrelated provider files or rendered MP4 output.
