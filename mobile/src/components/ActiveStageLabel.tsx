import { Text } from "react-native";
import { stageLabel } from "@/constants/stages";
import { useAnimatedDots } from "@/hooks/useAnimatedDots";
import type { JobStage } from "@/types/api";

type ActiveStageLabelProps = {
  stage: JobStage | null;
  className?: string;
};

// "Downloading." → "Extracting audio." → "Separating stems." … — the live step of
// an in-flight Recent row, with the ellipsis ticking to signal it's still
// running. It lives in its own component so the ticking dots re-render one small
// `Text` instead of the whole Recent list — and so nothing that renders it can
// disturb a running animation nearby.
export function ActiveStageLabel({ stage, className = "" }: ActiveStageLabelProps) {
  const dots = useAnimatedDots();
  return <Text className={className}>{`${stageLabel(stage)}${dots}`}</Text>;
}
