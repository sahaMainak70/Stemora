import { View } from "react-native";
import { colors } from "@/constants/theme";

type ProgressBarProps = {
  progress: number;
  color?: string;
};

export function ProgressBar({ progress, color }: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, progress));

  return (
    <View className="h-1.5 w-full overflow-hidden rounded-full bg-subtle">
      <View
        className="h-full rounded-full"
        style={{ width: `${clamped * 100}%`, backgroundColor: color ?? colors.accent }}
      />
    </View>
  );
}