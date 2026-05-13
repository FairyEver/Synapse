import "./index.css";
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
