import { memo, useEffect, useMemo, useState } from "react";
import { Animated, Easing } from "react-native";
import { LoaderCircle } from "lucide-react-native";
import { colors } from "@/constants/theme";

type SpinnerProps = {
  size?: number;
  color?: string;
};

const SPIN_DURATION_MS = 900;

// The static `LoaderCircle` glyph reads as "busy" but doesn't move, so an
// in-flight row can look frozen. This rotates the glyph continuously for as
// long as the row is in flight.
//
// Three details keep it turning until the job finishes (a single-turn stall was
// reported on device):
//   - the `Animated.Value` lives in `useState` (stable) and the interpolated
//     style is `useMemo`d, so a parent re-render can't swap the animated node
//     out from under a running animation — a fresh interpolation object per
//     render re-attaches the view and stalls the rotation;
//   - each turn is chained from the previous turn's end callback instead of
//     `Animated.loop`, so the spin doesn't rely on the native driver honouring
//     `iterations: -1` (the path that turned out to stop after one revolution);
//   - the component is memoized, so the ticking ellipsis in the same row can't
//     re-render it.
//
// The inline style carries the animated transform only — size and color stay
// props, so no token lives outside `constants/theme.ts`.
function SpinnerComponent({ size = 16, color = colors.secondary }: SpinnerProps) {
  const [rotation] = useState(() => new Animated.Value(0));

  useEffect(() => {
    let stopped = false;

    const spin = () => {
      Animated.timing(rotation, {
        toValue: 1,
        duration: SPIN_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start(({ finished }) => {
        // `finished: false` means we stopped it ourselves (unmount) — don't
        // queue another turn.
        if (stopped || !finished) return;
        // The value rests at 1 (a full turn) after each pass; rewind it so the
        // next turn has somewhere to travel from.
        rotation.setValue(0);
        spin();
      });
    };

    spin();
    return () => {
      stopped = true;
      rotation.stopAnimation();
    };
  }, [rotation]);

  const style = useMemo(
    () => ({
      transform: [
        {
          rotate: rotation.interpolate({
            inputRange: [0, 1],
            outputRange: ["0deg", "360deg"],
          }),
        },
      ],
    }),
    [rotation],
  );

  return (
    <Animated.View style={style}>
      <LoaderCircle size={size} color={color} />
    </Animated.View>
  );
}

export const Spinner = memo(SpinnerComponent);
