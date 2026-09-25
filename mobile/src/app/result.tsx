import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Inbox, X, Ban } from "lucide-react-native";
import { colors } from "@/constants/theme";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/Button";
import { RetryState } from "@/components/RetryState";
import { Tappable } from "@/components/Tappable";
import { StemCard } from "@/components/StemCard";
import { StemMixer } from "@/components/StemMixer";
import { fileUrl, submitJob } from "@/services/api";
import { classifyErrorCode, guidanceForTier } from "@/services/errorGuide";
import { readSettings } from "@/services/settingsStore";
import { downloadAndShare } from "@/utils/exportMedia";
import { useJob } from "@/hooks/useJob";
import { formatSeconds } from "@/utils/format";
import type { MixedStemKind, StemKind } from "@/types/api";
import type { ExportFormat } from "@/types/settings";

const STEM_ORDER: StemKind[] = ["vocals", "drums", "bass", "other", "instrumental"];
const STEM_LABEL: Record<StemKind, string> = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  other: "Other",
  instrumental: "Instrumental",
};
const EDITING_STEMS: MixedStemKind[] = ["vocals", "drums", "bass", "other"];

export default function ResultScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ jobId?: string }>();
  const jobId = typeof params.jobId === "string" ? params.jobId : undefined;
  const { job, error, errorCode, retry } = useJob(jobId);
  const [retrying, setRetrying] = useState(false);

  async function retryFailedJob() {
    if (!job?.url || retrying) return;
    setRetrying(true);
    try {
      const newJob = await submitJob(job.url);
      router.replace({ pathname: "/processing", params: { jobId: newJob.jobId } });
    } catch {
      setRetrying(false);
    }
  }

  const [playingStem, setPlayingStem] = useState<StemKind | null>(null);
  const [previewActive, setPreviewActive] = useState(false);
  const [exportStem, setExportStem] = useState<StemKind | null>(null);
  const [exportingStem, setExportingStem] = useState<StemKind | null>(null);
  const [defaultFormat] = useState<ExportFormat>(() => readSettings().defaultExportFormat);

  async function handleExport(stem: StemKind, format: ExportFormat) {
    if (!job || !job.files?.[stem]) return;

    const filename = job.files[stem][format];
    const mimeType = format === "mp3" ? "audio/mpeg" : "audio/wav";
    const targetUri = fileUrl(job.jobId, filename);

    setExportStem(null);
    setExportingStem(stem);
    try {
      await downloadAndShare(targetUri, filename, mimeType);
    } catch {
      Alert.alert(
        "Export failed",
        "Couldn't prepare the file — check the server is running and try again.",
      );
    } finally {
      setExportingStem(null);
    }
  }

  if (!jobId) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
        <View className="flex-1 px-5 pb-8">
          <ScreenHeader title="Result" />
          <View className="flex-1 items-center justify-center gap-4">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-surface">
              <Inbox size={22} color={colors.secondary} />
            </View>
            <Text className="text-base text-primary">No song to show</Text>
            <Text className="text-center text-sm text-secondary">
              Separate a song from the Home screen to see its stems here.
            </Text>
            <Button label="Back to Home" onPress={() => router.replace("/")} className="mt-2" />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (error && !job) {
    const pollTier = classifyErrorCode(errorCode);
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
        <View className="flex-1 px-5 pb-8">
          <ScreenHeader title="Result" />
          <RetryState
            message={error}
            guidance={guidanceForTier(pollTier)}
            onRetry={pollTier === "retryable" ? retry : undefined}
            onHome={() => router.replace("/")}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (job?.status === "failed") {
    const tier = classifyErrorCode(job.errorCode);
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
        <View className="flex-1 px-5 pb-8">
          <ScreenHeader title="Result" />
          <RetryState
            title="Separation failed"
            message={job.error}
            guidance={guidanceForTier(tier)}
            onRetry={tier === "retryable" ? retryFailedJob : undefined}
            retryLoading={retrying}
            onHome={() => router.replace("/")}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (job?.status === "cancelled") {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
        <View className="flex-1 px-5 pb-8">
          <ScreenHeader title="Result" />
          <View className="flex-1 items-center justify-center gap-4">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-surface">
              <Ban size={22} color={colors.secondary} />
            </View>
            <Text className="text-base font-medium text-primary">Separation cancelled</Text>
            <Text className="text-center text-sm text-secondary">
              This separation was cancelled before it finished.
            </Text>
            <Button label="Back to Home" onPress={() => router.replace("/")} className="mt-2" />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (job?.status !== "completed") {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
        <View className="flex-1 px-5 pb-8">
          <ScreenHeader title="Result" />
          <View className="flex-1 items-center justify-center gap-4">
            <ActivityIndicator size="large" color={colors.accent} />
            <Text className="text-sm text-secondary">
              This song is still separating — hang tight.
            </Text>
            <Button label="Back to Home" onPress={() => router.replace("/")} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const title = job.metadata?.title?.trim() ? job.metadata.title : "Separated stems";
  const durationLabel =
    job.metadata?.duration != null ? formatSeconds(job.metadata.duration) : null;
  const availableStems = STEM_ORDER.filter((stem) => job.files?.[stem]);
  const subtitleProps = `${availableStems
    .map((stem) => STEM_LABEL[stem])
    .join(" + ")}${durationLabel ? ` · ${durationLabel}` : ""}`;
  const formatLabel = (format: ExportFormat) =>
    format === "mp3" ? "Export MP3 · smaller file" : "Export WAV · lossless";
  const alternateFormat: ExportFormat = defaultFormat === "mp3" ? "wav" : "mp3";
  const isEditingJob = EDITING_STEMS.every((stem) => job.files?.[stem]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
      <ScrollView className="flex-1" contentContainerClassName="gap-4 px-5 pb-8">
        <ScreenHeader title="Result" />

        <View className="gap-1">
          <Text className="text-lg font-semibold text-primary">{title}</Text>
          <Text className="text-sm text-secondary">{subtitleProps}</Text>
        </View>

        {isEditingJob ? (
          <StemMixer
            jobId={job.jobId}
            files={job.files}
            active={previewActive}
            onActiveChange={(active) => {
              setPreviewActive(active);
              if (active) setPlayingStem(null);
            }}
          />
        ) : null}

        {availableStems.map((stem) => {
          const files = job.files[stem];
          if (!files) return null;
          return (
            <StemCard
              key={stem}
              jobId={job.jobId}
              stem={stem}
              sourceUrl={fileUrl(job.jobId, files.mp3)}
              isPlaying={playingStem === stem}
              isExporting={exportingStem === stem}
              onTogglePlay={() => {
                setPreviewActive(false);
                setPlayingStem((current) => (current === stem ? null : stem));
              }}
              onEnded={() => setPlayingStem((current) => (current === stem ? null : current))}
              onExport={() => setExportStem(stem)}
            />
          );
        })}

        <Text className="text-center text-xs text-secondary">
          Tap play to preview a stem, or export it as MP3 or WAV.
        </Text>
      </ScrollView>

      <Modal
        transparent
        visible={exportStem !== null}
        animationType="fade"
        onRequestClose={() => setExportStem(null)}
      >
        <View className="flex-1 justify-end">
          <Pressable className="flex-1 bg-black/50" onPress={() => setExportStem(null)} />
          <View className="gap-3 rounded-t-2xl bg-surface-raised p-5 pb-8">
            <View className="flex-row items-center justify-between">
              <Text className="text-lg font-semibold text-primary">
                Export {exportStem ? STEM_LABEL[exportStem] : ""}
              </Text>
              <Tappable onPress={() => setExportStem(null)} hitSlop={8}>
                <X size={18} color={colors.secondary} />
              </Tappable>
            </View>
            <Button
              label={formatLabel(defaultFormat)}
              onPress={() => exportStem && handleExport(exportStem, defaultFormat)}
            />
            <Button
              label={formatLabel(alternateFormat)}
              variant="secondary"
              onPress={() => exportStem && handleExport(exportStem, alternateFormat)}
            />
            <Button label="Cancel" variant="secondary" onPress={() => setExportStem(null)} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}