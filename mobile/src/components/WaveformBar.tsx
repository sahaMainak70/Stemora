import { useEffect, useRef, useState } from "react";
import { PanResponder, View } from "react-native";
import type { GestureResponderEvent, LayoutChangeEvent } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { colors } from "@/constants/theme";
import type { LoopRegion } from "@/types/player";

// Unit 25 — rendered waveform: one SVG bar per peak bucket, played buckets in
// the stem/accent color, unplayed in the subtle border tint. Drag or tap to
// seek; drag the two A/B handles to define a loop region (highlighted while
// `looping`). All gesture math runs against the wrapper's measured width, so
// the bars themselves are pure presentation.

const HEIGHT = 40;
const HANDLE_WIDTH = 2;
const HANDLE_CAP = 12;
const HANDLE_HIT_DISTANCE = 20;
const REGION_OPACITY = 0.15;
const BAR_TOP_INSET = 3;

type WaveformBarProps = {
  peaks: number[];
  duration: number;
  currentTime: number;
  color: string;
  region: LoopRegion | null;
  looping: boolean;
  onSeek: (fraction: number) => void;
  onRegionChange: (region: LoopRegion) => void;
};

function clampFraction(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function WaveformBar({
  peaks,
  duration,
  currentTime,
  color,
  region,
  looping,
  onSeek,
  onRegionChange,
}: WaveformBarProps) {
  const [width, setWidth] = useState(0);

  const onSeekRef = useRef(onSeek);
  const onRegionChangeRef = useRef(onRegionChange);
  const widthRef = useRef(0);
  const durationRef = useRef(duration);
  const regionRef = useRef(region);
  const draggingHandleRef = useRef<"start" | "end" | null>(null);

  // Keep the gesture-handler closures current without touching refs during
  // render (react-hooks/refs): the PanResponder handlers only run at gesture
  // time, after this effect has refreshed the values it reads.
  useEffect(() => {
    onSeekRef.current = onSeek;
    onRegionChangeRef.current = onRegionChange;
    widthRef.current = width;
    durationRef.current = duration;
    regionRef.current = region;
  });

  function locationFraction(locationX: number): number {
    const w = widthRef.current;
    if (w <= 0) return 0;
    return clampFraction(locationX / w);
  }

  function handleAt(x: number): "start" | "end" | null {
    const regionNow = regionRef.current;
    const dur = durationRef.current;
    const w = widthRef.current;
    if (!regionNow || dur <= 0 || w <= 0) return null;
    const aX = (regionNow.start / dur) * w;
    const bX = (regionNow.end / dur) * w;
    const dA = Math.abs(x - aX);
    const dB = Math.abs(x - bX);
    if (dA <= HANDLE_HIT_DISTANCE && (dA <= dB || dB > HANDLE_HIT_DISTANCE)) return "start";
    if (dB <= HANDLE_HIT_DISTANCE) return "end";
    return null;
  }

  // eslint-disable-next-line react-hooks/refs -- PanResponder handlers only run at gesture time (never during render); the refs are kept current on every render above, matching the StemCard scrub pattern.
  const [gestureResponder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => durationRef.current > 0,
      onMoveShouldSetPanResponder: () => durationRef.current > 0,
      onPanResponderGrant: (event: GestureResponderEvent) => {
        const x = event.nativeEvent.locationX;
        const hit = handleAt(x);
        if (hit !== null) {
          draggingHandleRef.current = hit;
          return;
        }
        draggingHandleRef.current = null;
        onSeekRef.current(locationFraction(x));
      },
      onPanResponderMove: (event: GestureResponderEvent) => {
        const x = event.nativeEvent.locationX;
        const handle = draggingHandleRef.current;
        const regionNow = regionRef.current;
        const dur = durationRef.current;
        if (handle !== null && regionNow !== null && dur > 0) {
          const t = locationFraction(x) * dur;
          const next: LoopRegion =
            handle === "start"
              ? { start: Math.min(t, regionNow.end), end: regionNow.end }
              : { start: regionNow.start, end: Math.max(t, regionNow.start) };
          onRegionChangeRef.current(next);
          return;
        }
        onSeekRef.current(locationFraction(x));
      },
      onPanResponderRelease: () => {
        draggingHandleRef.current = null;
      },
      onPanResponderTerminate: () => {
        draggingHandleRef.current = null;
      },
    }),
  );

  function handleLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  const progress = duration > 0 ? clampFraction(currentTime / duration) : 0;
  const playedCount = Math.min(peaks.length, Math.round(progress * peaks.length));
  const maxBarHeight = HEIGHT - BAR_TOP_INSET * 2;
  const barWidth = peaks.length > 0 ? width / peaks.length : 0;

  const aFrac = region && duration > 0 ? clampFraction(region.start / duration) : 0;
  const bFrac = region && duration > 0 ? clampFraction(region.end / duration) : 0;
  const aX = aFrac * width;
  const bX = bFrac * width;
  const showHighlight = region !== null && looping && duration > 0 && region.end > region.start;

  return (
    <View
      {...gestureResponder.panHandlers}
      onLayout={handleLayout}
      style={{ height: HEIGHT }}
      className="flex-row"
    >
      {width > 0 ? (
        <Svg width={width} height={HEIGHT}>
          {peaks.map((peak, index) => {
            const h =
              peak <= 0 ? 0 : Math.max(1, Math.min(maxBarHeight, peak * maxBarHeight));
            return (
              <Rect
                key={index}
                x={(index / peaks.length) * width}
                y={HEIGHT - h}
                width={Math.max(0.5, barWidth - 0.4)}
                height={h}
                rx={0.5}
                fill={index < playedCount ? color : colors.borderSubtle}
              />
            );
          })}

          {showHighlight ? (
            <Rect
              x={aX}
              y={0}
              width={Math.max(0, bX - aX)}
              height={HEIGHT}
              fill={color}
              fillOpacity={REGION_OPACITY}
            />
          ) : null}

          {region !== null && duration > 0 ? (
            <>
              <Rect
                x={Math.max(0, Math.min(width - HANDLE_WIDTH, aX - HANDLE_WIDTH / 2))}
                y={BAR_TOP_INSET}
                width={HANDLE_WIDTH}
                height={HEIGHT - BAR_TOP_INSET * 2}
                fill={color}
              />
              <Rect
                x={Math.max(0, Math.min(width - HANDLE_CAP, aX - HANDLE_CAP / 2))}
                y={0}
                width={HANDLE_CAP}
                height={4}
                fill={color}
              />
              <Rect
                x={Math.max(0, Math.min(width - HANDLE_WIDTH, bX - HANDLE_WIDTH / 2))}
                y={BAR_TOP_INSET}
                width={HANDLE_WIDTH}
                height={HEIGHT - BAR_TOP_INSET * 2}
                fill={color}
              />
              <Rect
                x={Math.max(0, Math.min(width - HANDLE_CAP, bX - HANDLE_CAP / 2))}
                y={0}
                width={HANDLE_CAP}
                height={4}
                fill={color}
              />
            </>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}