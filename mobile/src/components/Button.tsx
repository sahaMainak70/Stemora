import { useState } from "react";
import { Pressable, Text } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { LoaderCircle } from "lucide-react-native";
import { colors } from "@/constants/theme";

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary";
  size?: "md" | "sm";
  icon?: LucideIcon;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
};

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  icon: Icon,
  disabled = false,
  loading = false,
  className = "",
}: ButtonProps) {
  const isPrimary = variant === "primary";
  const [pressed, setPressed] = useState(false);
  const inactive = disabled || loading;

  const bgClass = isPrimary
    ? inactive
      ? "bg-subtle"
      : pressed
        ? "bg-accent-pressed"
        : "bg-accent"
    : inactive
      ? "border border-subtle bg-transparent"
      : pressed
        ? "border border-subtle bg-surface-raised"
        : "border border-subtle bg-transparent";

  const textClass = isPrimary
    ? inactive
      ? "text-disabled"
      : pressed
        ? "text-primary"
        : "text-primary"
    : inactive
      ? "text-disabled"
      : "text-secondary";

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      className={[
        "flex-row items-center justify-center gap-2 rounded-md",
        size === "md" ? "px-5 py-3" : "px-3 py-2",
        bgClass,
        className,
      ].join(" ")}
    >
      {loading ? (
        <LoaderCircle size={size === "md" ? 18 : 16} color={inactive ? colors.disabled : colors.primary} />
      ) : Icon ? (
        <Icon size={size === "md" ? 18 : 16} color={inactive ? colors.disabled : isPrimary ? colors.primary : colors.secondary} />
      ) : null}
      <Text className={`${size === "md" ? "text-base" : "text-sm"} font-medium ${textClass}`}>
        {label}
      </Text>
    </Pressable>
  );
}
