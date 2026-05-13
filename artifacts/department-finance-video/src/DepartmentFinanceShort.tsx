import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BarChart } from "./components/BarChart";
import { ImpactNumber } from "./components/ImpactNumber";
import { PieChart } from "./components/PieChart";
import { SummaryScene } from "./components/SummaryScene";
import {
  financeCategories,
  financeSummary,
  largestItems,
} from "./data/finance-data";
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
      <div style={{ fontSize: 42, color: colors.muted, marginBottom: 42 }}>
        部门收支速览
      </div>
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
          <div style={{ fontSize: 64, fontWeight: 800, marginBottom: 56 }}>
            应付款压力最大
          </div>
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
      <div style={{ color: colors.muted, fontSize: 28 }}>
        当前记录：{financeSummary.rowCount} 条
      </div>
    </AbsoluteFill>
  );
};
