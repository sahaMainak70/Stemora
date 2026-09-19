import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { AlertCircle, Inbox, X } from "lucide-react-native";
import { colors } from "@/constants/theme";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/Button";
import { StemCard } from "@/components/StemCard";
import { fileUrl } from "@/services/api";
import { triggerWebDownload } from "@/utils/downloadWeb";
import { useJob } from "@/hooks/useJob";
import { formatSeconds } from "@/utils/format";
import type { StemKind } from "@/types/api";

const STEM_ORDER: StemKind[] = ["vocals", "instrumental"];
const STEM_LABEL: Record<StemKind, string> = {
  vocals: "Vocals",
  instrumental: "Instrumental",
};

export default function ResultScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ jobId?: string }>();
  const jobId = typeof params.jobId === "string" ? params.jobId : undefined;
  const { job, error } = useJob(jobId);

  const [playingStem, setPlayingStem] = useState<StemKind | null>(null);
  const [exportStem, setExportStem] = useState<StemKind | null>(null);
  const [exportingStem, setExportingStem] = useState<StemKind | null>(null);

  async function handleExport(stem: StemKind, format: "mp3" | "wav") {
    if (!job || !job.files?.[stem]) return;

    const filename = job.files[stem][format];
    const mimeType = format === "mp3" ? "audio/mpeg" : "audio/wav";
    const targetUri = fileUrl(job.jobId, filename);

    setExportStem(null);
    setExportingStem(stem);
    try {
      if (Platform.OS === "web") {
        const response = await fetch(targetUri);
        if (!response.ok) throw new Error("download failed");
        const blob = await response.blob();
        const objectUrl = (
          globalThis as { URL?: { createObjectURL(value: Blob): string } }
        ).URL?.createObjectURL(blob);
        if (!objectUrl || !triggerWebDownload(objectUrl, filename)) {
          throw new Error("download unavailable on this browser");
        }
        return;
      }

      const dir = new Directory(Paths.cache, "stemora-exports");
      dir.create({ idempotent: true, intermediates: true });
      const target = new File(dir, filename);
      if (target.exists) target.delete();
      const downloaded = await File.downloadFileAsync(targetUri, target);

      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert("Sharing isn't available on this device.");
        return;
      }
      await Sharing.shareAsync(downloaded.uri, {
        mimeType,
        dialogTitle: `Share ${filename}`,
      });
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
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
        <View className="flex-1 px-5 pb-8">
          <ScreenHeader title="Result" />
          <View className="flex-1 items-center justify-center gap-4">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-surface">
              <AlertCircle size={22} color={colors.error} />
            </View>
            <Text className="text-center text-sm text-secondary">{error}</Text>
            <Button label="Back to Home" onPress={() => router.replace("/")} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (job?.status === "failed") {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
        <View className="flex-1 px-5 pb-8">
          <ScreenHeader title="Result" />
          <View className="flex-1 items-center justify-center gap-4">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-surface">
              <AlertCircle size={22} color={colors.error} />
            </View>
            <Text className="text-base font-medium text-primary">Separation failed</Text>
            {job.error ? (
              <Text className="text-center text-sm text-secondary">{job.error}</Text>
            ) : null}
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
  const subtitleProps = `Vocals + Instrumental${durationLabel ? ` · ${durationLabel}` : ""}`;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
      <View className="flex-1 gap-4 px-5 pb-8">
        <ScreenHeader title="Result" />

        <View className="gap-1">
          <Text className="text-lg font-semibold text-primary">{title}</Text>
          <Text className="text-sm text-secondary">{subtitleProps}</Text>
        </View>

        {availableStems.map((stem) => {
          const files = job.files[stem];
          if (!files) return null;
          return (
            <StemCard
              key={stem}
              stem={stem}
              sourceUrl={fileUrl(job.jobId, files.mp3)}
              isPlaying={playingStem === stem}
              isExporting={exportingStem === stem}
              onTogglePlay={() =>
                setPlayingStem((current) => (current === stem ? null : stem))
              }
              onEnded={() => setPlayingStem((current) => (current === stem ? null : current))}
              onExport={() => setExportStem(stem)}
            />
          );
        })}

        <Text className="text-center text-xs text-secondary">
          Tap play to preview a stem, or export it as MP3 or WAV.
        </Text>
      </View>

      <Modal
        transparent
        visible={exportStem !== null}
        animationType="fade"
        onRequestClose={() => setExportStem(null)}
      >
        <View className="flex-1 justify-end">
          <Pressable className="flex-1" onPress={() => setExportStem(null)} />
          <View className="gap-3 rounded-t-2xl bg-surface-raised p-5 pb-8">
            <View className="flex-row items-center justify-between">
              <Text className="text-lg font-semibold text-primary">
                Export {exportStem ? STEM_LABEL[exportStem] : ""}
              </Text>
              <Pressable onPress={() => setExportStem(null)} hitSlop={8}>
                <X size={18} color={colors.secondary} />
              </Pressable>
            </View>
            <Button
              label="Export MP3 · smaller file"
              onPress={() => exportStem && handleExport(exportStem, "mp3")}
            />
            <Button
              label="Export WAV · lossless"
              variant="secondary"
              onPress={() => exportStem && handleExport(exportStem, "wav")}
            />
            <Button label="Cancel" variant="secondary" onPress={() => setExportStem(null)} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}