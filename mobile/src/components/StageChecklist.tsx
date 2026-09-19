import { Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { colors } from "@/constants/theme";
import type { Stage } from "@/constants/stages";

type StageChecklistProps = {
  stages: Stage[];
};

export function StageChecklist({ stages }: StageChecklistProps) {
  return (
    <View className="w-full gap-3 self-stretch">
      {stages.map((stage) => {
        const isDone = stage.status === "done";
        const isCurrent = stage.status === "current";

        const statusIcon = isDone ? (
          <View className="h-6 w-6 items-center justify-center rounded-full bg-subtle">
            <Check size={14} color={colors.success} />
          </View>
        ) : isCurrent ? (
          <View className="h-3 w-3 rounded-full bg-accent" />
        ) : (
          <View className="h-3 w-3 rounded-full border border-disabled" />
        );

        const labelClass = isDone
          ? "text-primary"
          : isCurrent
            ? "font-medium text-primary"
            : "text-disabled";

        const statusLabel = isDone ? "Done" : isCurrent ? "In progress" : "Queued";

        return (
          <View key={stage.key} className="flex-row items-center gap-3">
            <View className="w-6 items-center">{statusIcon}</View>
            <Text className={`flex-1 text-base ${labelClass}`}>{stage.label}</Text>
            <Text className="text-xs text-secondary">{statusLabel}</Text>
          </View>
        );
      })}
    </View>
  );
}