import { useEffect, useRef, useState } from "react";
import { Alert, Modal, Pressable, Text, View } from "react-native";
import Slider from "@react-native-community/slider";
import { createAudioPlayer } from "expo-audio";
import { Pause, Play, Repeat, SlidersHorizontal, X } from "lucide-react-native";
import { colors } from "@/constants/theme";
import {
  ApiError,
  fileUrl,
  MAX_MIX_GAIN,
  MIN_MIX_GAIN,
  submitMix,
} from "@/services/api";
import { useJob } from "@/hooks/useJob";
import { useWaveform } from "@/hooks/useWaveform";
import { classifyErrorCode, guidanceForTier } from "@/services/errorGuide";
import { downloadAndShare } from "@/utils/exportMedia";
import { readSettings } from "@/services/settingsStore";
import type { ExportFormat } from "@/types/settings";
import type { JobFiles, MixedStemKind, MixGains } from "@/types/api";
import type { LoopRegion } from "@/types/player";
import { Button } from "./Button";
import { STEM_META } from "./StemCard";
import { WaveformBar } from "./WaveformBar";

const STEMS: MixedStemKind[] = ["vocals", "drums", "bass", "other"];
const INITIAL_GAINS: MixGains = { vocals: 1, drums: 1, bass: 1, other: 1 };

type StemMixerProps = {
  jobId: string;
  files: JobFiles;
  active: boolean;
  onActiveChange: (active: boolean) => void;
};

type StemPlayers = Record<MixedStemKind, ReturnType<typeof createAudioPlayer>>;

function stemUrl(files: JobFiles, jobId: string, stem: MixedStemKind): string | null {
  const entry = files[stem];
  return entry ? fileUrl(jobId, entry.mp3) : null;
}

// Unit 23 — the editing window. One 0–100% gain slider per separation stem
// shapes a custom mix; the preview is client-side simultaneous playback (four
// audio players, each at `volume = gain`); "Export mix" kicks off the
// server-side async mix job and shares the render once it completes. The
// players are owned via ref (created once on mount, released on unmount) so
// the imperative `volume` setter — expo-audio exposes a property, not a
// React-correlated setter — doesn't fight React's ownership rules: volume is
// applied in event handlers, playback orchestration happens here.
export function StemMixer({ jobId, files, active, onActiveChange }: StemMixerProps) {
  const playersRef = useRef<StemPlayers | null>(null);
  const { peaks } = useWaveform(jobId, "vocals");
  const [previewRegion, setPreviewRegion] = useState<LoopRegion | null>(null);
  const [previewLooping, setPreviewLooping] = useState(false);
  const [voxTime, setVoxTime] = useState(0);
  const [voxDuration, setVoxDuration] = useState(0);

  useEffect(() => {
    const players: StemPlayers = {
      vocals: createAudioPlayer(stemUrl(files, jobId, "vocals")),
      drums: createAudioPlayer(stemUrl(files, jobId, "drums")),
      bass: createAudioPlayer(stemUrl(files, jobId, "bass")),
      other: createAudioPlayer(stemUrl(files, jobId, "other")),
    };
    playersRef.current = players;
    return () => {
      for (const stem of STEMS) players[stem].remove();
    };
  }, [files, jobId]);

  // Reset the preview loop state when the underlying job changes — a
  // render-time state adjustment (same pattern as StemCard's region init) so
  // the reset lands in the same render that switches jobs.
  const [prevJobId, setPrevJobId] = useState(jobId);
  if (prevJobId !== jobId) {
    setPrevJobId(jobId);
    setPreviewRegion(null);
    setPreviewLooping(false);
    setVoxTime(0);
    setVoxDuration(0);
  }

  // The mixer owns its players imperatively (createAudioPlayer), so the time
  // rail is fed by a light self-sync poll of the vocals player's live
  // duration/currentTime properties. It also initialises the A/B loop region
  // to the full track the first time a duration is known (functional update,
  // so it only runs once).
  useEffect(() => {
    const timer = setInterval(() => {
      const lead = playersRef.current?.vocals;
      if (!lead) return;
      const d = lead.duration;
      if (!Number.isFinite(d) || d <= 0) return;
      setPreviewRegion((current) => (current === null ? { start: 0, end: d } : current));
      setVoxDuration(d);
      setVoxTime(lead.currentTime);
    }, 300);
    return () => clearInterval(timer);
  }, []);

  // Loop wrap for the preview: all four players are seeked in lockstep against
  // the vocals timeline when the region end is crossed.
  useEffect(() => {
    if (!previewLooping || !active || !previewRegion) return;
    const { start, end } = previewRegion;
    if (end <= start) return;
    const timer = setInterval(() => {
      const lead = playersRef.current?.vocals;
      if (!lead) return;
      if (lead.currentTime >= end) {
        for (const stem of STEMS) playersRef.current?.[stem].seekTo(start);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [previewLooping, active, previewRegion]);

  const [gains, setGains] = useState<MixGains>(INITIAL_GAINS);
  const [mixJobId, setMixJobId] = useState<string | undefined>(undefined);
  // Terminal mix job that has already been handed to the export path, so a
  // re-run of the completion effect can't download/share the same mix twice.
  const handledMixJobIdRef = useRef<string | null>(null);
  const [mixModalOpen, setMixModalOpen] = useState(false);
  const [defaultFormat] = useState<ExportFormat>(() => readSettings().defaultExportFormat);
  const { job: mixJob } = useJob(mixJobId);

  // The `active` flag is parent-driven: previewing a stem card pauses the four
  // players, the preview button drives it. Playback orchestration only (seek +
  // play/pause); gains are applied by the slider handlers.
  useEffect(() => {
    const players = playersRef.current;
    if (!players) return;
    if (active) {
      for (const stem of STEMS) {
        players[stem].seekTo(0);
        players[stem].play();
      }
    } else {
      for (const stem of STEMS) players[stem].pause();
    }
  }, [active]);

  useEffect(() => {
    if (!mixJob || mixJobId === undefined) return;
    // Mix renders are async server jobs: any non-terminal status means the
    // render is still running and `useJob` must keep polling. Only a terminal
    // status may clear `mixJobId` — clearing it while the mix is still
    // rendering stops the poll, so the completed render is never downloaded
    // (Unit 26 bug fix: "Export mix is not downloading the mix").
    if (
      mixJob.status !== "completed" &&
      mixJob.status !== "failed" &&
      mixJob.status !== "cancelled"
    ) {
      return;
    }
    // A terminal job is handled exactly once, even if the effect re-runs.
    if (handledMixJobIdRef.current === mixJobId) return;
    handledMixJobIdRef.current = mixJobId;
    void (async () => {
      if (mixJob.status === "completed") {
        const mixFiles = mixJob.files?.mix;
        const filename = mixFiles?.mp3 ?? mixFiles?.wav;
        if (filename) {
          const mimeType = filename.endsWith(".wav") ? "audio/wav" : "audio/mpeg";
          try {
            await downloadAndShare(fileUrl(jobId, filename), filename, mimeType);
          } catch {
            Alert.alert(
              "Export failed",
              "Couldn't prepare the mix — check the server is running and try again.",
            );
          }
        } else {
          Alert.alert(
            "Export failed",
            "The mix finished but the server returned no file. Try exporting again.",
          );
        }
      } else if (mixJob.status === "failed") {
        const tier = classifyErrorCode(mixJob.errorCode);
        Alert.alert(
          "Mix failed",
          `${mixJob.error ?? "We couldn't render the mix."}\n\n${guidanceForTier(tier)}`,
        );
      } else {
        Alert.alert("Mix cancelled", "This mix render was cancelled before it finished.");
      }
      setMixJobId(undefined);
    })();
  }, [mixJob, mixJobId, jobId]);

  async function handleExportMix(format: ExportFormat) {
    if (mixJobId !== undefined) return;
    setMixModalOpen(false);
    try {
      const mix = await submitMix(jobId, gains, format);
      setMixJobId(mix.jobId);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Something went wrong.";
      Alert.alert("Couldn't start the mix", message);
    }
  }

  function setGain(stem: MixedStemKind, value: number) {
    const players = playersRef.current;
    if (players) players[stem].volume = value;
    setGains((current) => ({ ...current, [stem]: value }));
  }

  function handlePreviewSeek(fraction: number) {
    const lead = playersRef.current?.vocals;
    const d = lead?.duration ?? 0;
    if (!Number.isFinite(d) || d <= 0) return;
    const target = fraction * d;
    for (const stem of STEMS) playersRef.current?.[stem].seekTo(target);
  }

  function handleRegionChange(region: LoopRegion) {
    setPreviewRegion(region);
    setPreviewLooping(true);
  }

  function resetAll() {
    const players = playersRef.current;
    if (players) {
      for (const stem of STEMS) players[stem].volume = INITIAL_GAINS[stem];
    }
    setGains(INITIAL_GAINS);
  }

  const allMuted = STEMS.every((stem) => gains[stem] <= MIN_MIX_GAIN);
  const dirty = STEMS.some((stem) => gains[stem] !== 1);
  const mixing = mixJobId !== undefined;
  const formatLabel = (format: ExportFormat) =>
    format === "mp3" ? "Export MP3 · smaller file" : "Export WAV · lossless";
  const alternateFormat: ExportFormat = defaultFormat === "mp3" ? "wav" : "mp3";

  return (
    <View className="gap-4 rounded-lg border border-subtle bg-surface p-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-3">
          <View className="h-10 w-10 items-center justify-center rounded-full bg-subtle">
            <SlidersHorizontal size={18} color={colors.primary} />
          </View>
          <Text className="text-lg font-semibold text-primary">Mixer</Text>
        </View>
        {dirty ? (
          <Pressable onPress={resetAll} hitSlop={8}>
            <Text className="text-sm text-accent">Reset all</Text>
          </Pressable>
        ) : null}
      </View>

      {STEMS.map((stem) => {
        const { label, icon: StemIcon, color } = STEM_META[stem];
        return (
          <View key={stem} className="gap-1">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <StemIcon size={16} color={color} />
                <Text className="text-sm font-medium text-primary">{label}</Text>
              </View>
              <Text className="text-sm text-secondary">{Math.round(gains[stem] * 100)}%</Text>
            </View>
            <Slider
              minimumValue={MIN_MIX_GAIN}
              maximumValue={MAX_MIX_GAIN}
              step={0.01}
              value={gains[stem]}
              onValueChange={(value) => setGain(stem, value)}
              minimumTrackTintColor={color}
              maximumTrackTintColor={colors.borderSubtle}
              thumbTintColor={color}
            />
          </View>
        );
      })}

      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={() => onActiveChange(!active)}
          className="h-10 w-10 items-center justify-center rounded-full border border-subtle bg-surface-raised"
        >
          {active ? (
            <Pause size={18} color={colors.accent} />
          ) : (
            <Play size={18} color={colors.accent} />
          )}
        </Pressable>
        <Pressable
          onPress={() => setPreviewLooping((current) => !current)}
          disabled={previewRegion === null}
          className="h-10 w-10 items-center justify-center rounded-full border border-subtle bg-surface-raised"
        >
          <Repeat size={18} color={previewLooping ? colors.accent : colors.secondary} />
        </Pressable>
        <Text className="flex-1 text-xs text-secondary">
          {active
            ? "Previewing the current mix — adjust sliders while it plays."
            : "Play to hear every stem together, then export your mix."}
        </Text>
      </View>

      {peaks !== null && peaks.length > 0 && voxDuration > 0 ? (
        <View className="py-1">
          <WaveformBar
            peaks={peaks}
            duration={voxDuration}
            currentTime={voxTime}
            color={colors.accent}
            region={previewRegion}
            looping={previewLooping}
            onSeek={handlePreviewSeek}
            onRegionChange={handleRegionChange}
          />
        </View>
      ) : null}

      <Button
        label={mixing ? "Mixing…" : "Export mix"}
        icon={SlidersHorizontal}
        onPress={() => setMixModalOpen(true)}
        loading={mixing}
        disabled={allMuted}
      />

      <Modal
        transparent
        visible={mixModalOpen}
        animationType="fade"
        onRequestClose={() => setMixModalOpen(false)}
      >
        <View className="flex-1 justify-end">
          <Pressable className="flex-1 bg-black/50" onPress={() => setMixModalOpen(false)} />
          <View className="gap-3 rounded-t-2xl bg-surface-raised p-5 pb-8">
            <View className="flex-row items-center justify-between">
              <Text className="text-lg font-semibold text-primary">Export mix</Text>
              <Pressable onPress={() => setMixModalOpen(false)} hitSlop={8}>
                <X size={18} color={colors.secondary} />
              </Pressable>
            </View>
            <Button label={formatLabel(defaultFormat)} onPress={() => handleExportMix(defaultFormat)} />
            <Button
              label={formatLabel(alternateFormat)}
              variant="secondary"
              onPress={() => handleExportMix(alternateFormat)}
            />
            <Button label="Cancel" variant="secondary" onPress={() => setMixModalOpen(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}