import { useEffect, useRef } from "react";
import { PanResponder, Pressable, Text, View } from "react-native";
import type { GestureResponderEvent, LayoutChangeEvent } from "react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Disc3, Download, Mic, Pause, Play } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { colors } from "@/constants/theme";
import type { StemKind } from "@/types/api";
import { formatSeconds } from "@/utils/format";
import { Button } from "./Button";
import { ProgressBar } from "./ProgressBar";

type StemCardProps = {
  stem: StemKind;
  sourceUrl: string;
  isPlaying: boolean;
  isExporting?: boolean;
  onTogglePlay: () => void;
  onEnded?: () => void;
  onExport: () => void;
};

const STEM_META: Record<StemKind, { label: string; icon: LucideIcon; color: string }> = {
  vocals: { label: "Vocals", icon: Mic, color: colors.stemVocals },
  instrumental: { label: "Instrumental", icon: Disc3, color: colors.stemInstrumental },
};

export function StemCard({
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
  const barWidthRef = useRef(0);
  const durationRef = useRef(0);
  const onEndedRef = useRef(onEnded);

  const duration = Number.isFinite(status.duration) ? status.duration : 0;
  durationRef.current = duration;
  onEndedRef.current = onEnded;

  function seekToLocation(locationX: number) {
    const width = barWidthRef.current;
    const dur = durationRef.current;
    if (width <= 0 || dur <= 0) return;
    const fraction = Math.min(1, Math.max(0, locationX / width));
    player.seekTo(fraction * dur);
  }

  const scrubResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => durationRef.current > 0,
      onMoveShouldSetPanResponder: () => durationRef.current > 0,
      onPanResponderGrant: (event: GestureResponderEvent) =>
        seekToLocation(event.nativeEvent.locationX),
      onPanResponderMove: (event: GestureResponderEvent) =>
        seekToLocation(event.nativeEvent.locationX),
    }),
  ).current;

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

  function handleScrubBarLayout(event: LayoutChangeEvent) {
    barWidthRef.current = event.nativeEvent.layout.width;
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

      <View
        {...scrubResponder.panHandlers}
        onLayout={handleScrubBarLayout}
        className="py-1"
      >
        <ProgressBar progress={progress} color={color} />
      </View>

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