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
  const scale = interpolate(
    frame,
    [0, 0.5 * fps, 1.4 * fps],
    [0.86, 1.04, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    },
  );
  const shownValue = value * progress;

  return (
    <div
      style={{
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: "center",
      }}
    >
      <div style={{ fontSize: 48, color: colors.muted, marginBottom: 28 }}>
        综合余额
      </div>
      <div style={{ fontSize: 128, fontWeight: 800, color: colors.payable }}>
        {shownValue < 0 ? "-" : ""}
        {formatMoney(Math.abs(shownValue))}
      </div>
    </div>
  );
};
