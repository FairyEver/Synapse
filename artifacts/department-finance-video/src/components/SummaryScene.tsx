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
