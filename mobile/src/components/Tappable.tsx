import { Pressable } from "react-native";
import type { PressableProps, StyleProp, ViewStyle } from "react-native";

type TappableProps = Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  pressedOpacity?: number;
  disabledOpacity?: number;
};

export function Tappable({
  style,
  pressedOpacity = 0.6,
  disabledOpacity = 0.5,
  disabled = false,
  children,
  ...rest
}: TappableProps) {
  return (
    <Pressable
      {...rest}
      disabled={disabled}
      style={(state): StyleProp<ViewStyle> => [
        style,
        state.pressed ? { opacity: pressedOpacity } : null,
        disabled ? { opacity: disabledOpacity } : null,
      ]}
    >
      {children}
    </Pressable>
  );
}