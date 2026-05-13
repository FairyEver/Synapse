import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { FinanceCategory } from "../data/finance-data";
import { categoryColors, colors } from "../styles";
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
    <div
      style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
    >
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
        <text
          x={center}
          y={center + 52}
          textAnchor="middle"
          fill={colors.muted}
          fontSize={30}
        >
          当前截面
        </text>
      </svg>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          width: "100%",
        }}
      >
        {data.map((item) => (
          <div
            key={item.key}
            style={{ display: "flex", alignItems: "center", gap: 14 }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                background: categoryColors[item.key],
              }}
            />
            <span style={{ color: colors.text, fontSize: 30 }}>
              {item.label}
            </span>
            <span style={{ color: colors.muted, fontSize: 28 }}>
              {formatPercent((item.amount / total) * 100)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
