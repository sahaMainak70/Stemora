import { View, Text } from "react-native";
import { AlertCircle } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { colors } from "@/constants/theme";
import { Button } from "@/components/Button";

type RetryStateProps = {
  icon?: LucideIcon;
  title?: string;
  message?: string | null;
  guidance?: string | null;
  retryLabel?: string;
  onRetry?: () => void;
  retryLoading?: boolean;
  onHome?: () => void;
};

export function RetryState({
  icon: Icon = AlertCircle,
  title,
  message,
  guidance,
  retryLabel = "Try again",
  onRetry,
  retryLoading = false,
  onHome,
}: RetryStateProps) {
  return (
    <View className="flex-1 items-center justify-center gap-4 px-5">
      <View className="h-12 w-12 items-center justify-center rounded-full bg-surface">
        <Icon size={22} color={colors.error} />
      </View>
      {title ? <Text className="text-base font-medium text-primary">{title}</Text> : null}
      {message ? <Text className="text-center text-sm text-secondary">{message}</Text> : null}
      {guidance ? <Text className="text-center text-xs text-disabled">{guidance}</Text> : null}
      {onRetry ? (
        <Button
          label={retryLabel}
          onPress={onRetry}
          loading={retryLoading}
          className="mt-2"
        />
      ) : null}
      {onHome ? <Button label="Back to Home" variant="secondary" onPress={onHome} /> : null}
    </View>
  );
}