import { useEffect, useRef, useState } from "react";
import { PanResponder, Pressable, Text, View } from "react-native";
import type { GestureResponderEvent, LayoutChangeEvent } from "react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Disc3, Download, Drum, Mic, Pause, Play, Repeat, Sparkles, Waves } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { colors } from "@/constants/theme";
import type { StemKind } from "@/types/api";
import type { LoopRegion } from "@/types/player";
import { useWaveform } from "@/hooks/useWaveform";
import { formatSeconds } from "@/utils/format";
import { Button } from "./Button";
import { ProgressBar } from "./ProgressBar";
import { WaveformBar } from "./WaveformBar";

type StemCardProps = {
  jobId: string;
  stem: StemKind;
  sourceUrl: string;
  isPlaying: boolean;
  isExporting?: boolean;
  onTogglePlay: () => void;
  onEnded?: () => void;
  onExport: () => void;
};

export const STEM_META: Record<StemKind, { label: string; icon: LucideIcon; color: string }> = {
  vocals: { label: "Vocals", icon: Mic, color: colors.stemVocals },
  drums: { label: "Drums", icon: Drum, color: colors.stemDrums },
  bass: { label: "Bass", icon: Waves, color: colors.stemBass },
  other: { label: "Other", icon: Sparkles, color: colors.stemOther },
  instrumental: { label: "Instrumental", icon: Disc3, color: colors.stemInstrumental },
};

export function StemCard({
  jobId,
  stem,
  sourceUrl,
  isPlaying,
  isExporting = false,
  onTogglePlay,
  onEnded,
  onExport,
}: StemCardProps) {
  const { label, icon: StemIcon, color } = STEM_META[stem];
  const player = useAudioPlayer(sourceUrl);
  const status = useAudioPlayerStatus(player);
  const { peaks, status: waveStatus } = useWaveform(jobId, stem);
  const [region, setRegion] = useState<LoopRegion | null>(null);
  const [looping, setLooping] = useState(false);
  const barWidthRef = useRef(0);
  const durationRef = useRef(0);
  const onEndedRef = useRef(onEnded);

  const duration = Number.isFinite(status.duration) ? status.duration : 0;

  useEffect(() => {
    durationRef.current = duration;
    onEndedRef.current = onEnded;
  });

  // Initialise the A/B loop region to the full track once the player reports a
  // duration, and clamp it if that duration ever changes. Done as a
  // render-time state adjustment (per the React "adjusting state when
  // something changes" pattern) rather than an effect so the region appears in
  // the same render that first sees the duration.
  const [prevDuration, setPrevDuration] = useState(duration);
  if (prevDuration !== duration) {
    setPrevDuration(duration);
    setRegion((current) => {
      if (duration <= 0) return current;
      if (current === null) return { start: 0, end: duration };
      return {
        start: Math.min(current.start, duration),
        end: Math.min(current.end, duration),
      };
    });
  }

  // Loop wrap: while looping and playing, once playback crosses the region end
  // jump back to the region start (continues playing). Reads the player's live
  // currentTime rather than a status snapshot so the stale-closure problem
  // never delays a wrap. The timer only exists while looping && playing.
  useEffect(() => {
    if (!looping || !isPlaying || !region) return;
    if (duration <= 0) return;
    const start = Math.min(region.start, duration);
    const end = Math.min(region.end, duration);
    if (end <= start) return;
    const timer = setInterval(() => {
      if (player.currentTime >= end) player.seekTo(start);
    }, 250);
    return () => clearInterval(timer);
  }, [looping, isPlaying, region, duration, player]);

  function seekToLocation(locationX: number) {
    const width = barWidthRef.current;
    const dur = durationRef.current;
    if (width <= 0 || dur <= 0) return;
    const fraction = Math.min(1, Math.max(0, locationX / width));
    player.seekTo(fraction * dur);
  }

  // eslint-disable-next-line react-hooks/refs -- PanResponder handlers only run at gesture time (never during render); durationRef/barWidthRef stay current via the effects below, so this matches the React lazy-init guidance.
  const [scrubResponder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => durationRef.current > 0,
      onMoveShouldSetPanResponder: () => durationRef.current > 0,
      onPanResponderGrant: (event: GestureResponderEvent) =>
        seekToLocation(event.nativeEvent.locationX),
      onPanResponderMove: (event: GestureResponderEvent) =>
        seekToLocation(event.nativeEvent.locationX),
    }),
  );

  useEffect(() => {
    if (isPlaying) {
      if (status.didJustFinish) player.seekTo(0);
      player.play();
    } else {
      player.pause();
    }
  }, [isPlaying, player, status.didJustFinish]);

  useEffect(() => {
    if (status.didJustFinish) onEndedRef.current?.();
  }, [status.didJustFinish]);

  const progress = duration > 0 ? Math.min(1, Math.max(0, status.currentTime / duration)) : 0;
  const hasWaveform =
    waveStatus === "ready" && peaks !== null && peaks.length > 0 && duration > 0;

  function handleScrubBarLayout(event: LayoutChangeEvent) {
    barWidthRef.current = event.nativeEvent.layout.width;
  }

  function handleWaveformSeek(fraction: number) {
    const dur = durationRef.current;
    if (dur <= 0) return;
    player.seekTo(fraction * dur);
  }

  function handleRegionChange(next: LoopRegion) {
    setRegion(next);
    setLooping(true);
  }

  return (
    <View className="gap-4 rounded-lg border border-subtle bg-surface p-4">
      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-subtle">
          <StemIcon size={18} color={color} />
        </View>
        <Text className="flex-1 text-lg font-semibold text-primary">{label}</Text>
        <Text className="text-sm text-secondary">{formatSeconds(duration)}</Text>
      </View>

      {hasWaveform ? (
        <View className="py-1">
          <WaveformBar
            peaks={peaks}
            duration={duration}
            currentTime={status.currentTime}
            color={color}
            region={region}
            looping={looping}
            onSeek={handleWaveformSeek}
            onRegionChange={handleRegionChange}
          />
        </View>
      ) : (
        <View
          {...scrubResponder.panHandlers}
          onLayout={handleScrubBarLayout}
          className="py-1"
        >
          <ProgressBar progress={progress} color={color} />
        </View>
      )}

      <View className="flex-row items-center justify-between">
        <Text className="text-xs text-secondary">{formatSeconds(status.currentTime)}</Text>
        {status.isBuffering ? (
          <Text className="text-xs text-secondary">Buffering…</Text>
        ) : (
          <Text className="text-xs text-secondary">{formatSeconds(duration)}</Text>
        )}
      </View>

      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={onTogglePlay}
          className="h-10 w-10 items-center justify-center rounded-full border border-subtle bg-surface-raised"
        >
          {isPlaying ? (
            <Pause size={18} color={color} />
          ) : (
            <Play size={18} color={color} />
          )}
        </Pressable>
        <Pressable
          onPress={() => setLooping((current) => !current)}
          disabled={region === null}
          className="h-10 w-10 items-center justify-center rounded-full border border-subtle bg-surface-raised"
        >
          <Repeat size={18} color={looping ? color : colors.secondary} />
        </Pressable>
        <View className="flex-1" />
        <Button
          label="Export"
          icon={Download}
          variant="secondary"
          size="sm"
          onPress={onExport}
          loading={isExporting}
        />
      </View>
    </View>
  );
}