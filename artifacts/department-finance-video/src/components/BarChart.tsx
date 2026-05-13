import {
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { FinanceCategory } from "../data/finance-data";
import { categoryColors, colors } from "../styles";
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
              <span
                style={{ color: colors.text, fontSize: 38, fontWeight: 700 }}
              >
                {item.label}
              </span>
              <span style={{ color: colors.muted, fontSize: 34 }}>
                {formatMoney(item.amount)}
              </span>
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
