import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AlertCircle, CheckCircle2, Inbox } from "lucide-react-native";
import { colors } from "@/constants/theme";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/Button";
import { ProgressBar } from "@/components/ProgressBar";
import { StageChecklist } from "@/components/StageChecklist";
import { PIPELINE_STAGES, deriveStages } from "@/constants/stages";
import { useJob } from "@/hooks/useJob";
import type { JobStage } from "@/types/api";

function stageLabel(stage: JobStage | null): string {
  if (!stage) return "Starting";
  const match = PIPELINE_STAGES.find((entry) => entry.key === stage);
  return match ? match.label : "Starting";
}

export default function ProcessingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ jobId?: string }>();
  const jobId = typeof params.jobId === "string" ? params.jobId : undefined;
  const { job, error } = useJob(jobId);

  const isFailed = job?.status === "failed";
  const isCompleted = job?.status === "completed";
  const percent = Math.round(job?.progress ?? 0);

  if (!jobId) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
        <View className="flex-1 px-5 pb-8">
          <ScreenHeader title="Separating" />
          <View className="flex-1 items-center justify-center gap-4">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-surface">
              <Inbox size={22} color={colors.secondary} />
            </View>
            <Text className="text-base text-primary">No job in progress</Text>
            <Text className="text-sm text-secondary">
              Start separating a song from the Home screen.
            </Text>
            <Button label="Back to Home" onPress={() => router.replace("/")} className="mt-2" />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (isFailed) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
        <View className="flex-1 px-5 pb-8">
          <ScreenHeader title="Separating" />
          <View className="flex-1 items-center justify-center gap-4">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-surface">
              <AlertCircle size={22} color={colors.error} />
            </View>
            <Text className="text-base font-medium text-primary">
              Separation failed
            </Text>
            {job?.error ? (
              <Text className="text-center text-sm text-secondary">{job.error}</Text>
            ) : null}
            <Button label="Back to Home" onPress={() => router.replace("/")} className="mt-2" />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (isCompleted) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
        <View className="flex-1 px-5 pb-8">
          <ScreenHeader title="Separating" />
          <View className="flex-1 items-center justify-center gap-4">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-surface">
              <CheckCircle2 size={22} color={colors.success} />
            </View>
            <Text className="text-base font-medium text-primary">
              Both stems are ready
            </Text>
            <Text className="text-sm text-secondary">
              Vocals and instrumental are ready to play and export.
            </Text>
            <Button
              label="View results"
              onPress={() =>
                router.replace({ pathname: "/result", params: { jobId } })
              }
              className="mt-2"
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
      <View className="flex-1 px-5 pb-8">
        <ScreenHeader title="Separating" />

        {error && !job ? (
          <View className="flex-1 items-center justify-center gap-4">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-surface">
              <AlertCircle size={22} color={colors.error} />
            </View>
            <Text className="text-center text-sm text-secondary">{error}</Text>
            <Button label="Back to Home" onPress={() => router.replace("/")} />
          </View>
        ) : (
          <View className="flex-1 items-center justify-center gap-8">
            <View className="items-center gap-2">
              <Text className="text-2xl font-semibold text-primary">{percent}%</Text>
              <Text className="text-sm text-secondary">
                {stageLabel(job?.stage ?? null)} — hang tight
              </Text>
            </View>
            <ProgressBar progress={(job?.progress ?? 0) / 100} />
            {job ? (
              <StageChecklist stages={deriveStages(job.stage)} />
            ) : null}
          </View>
        )}

        <Text className="text-center text-xs text-secondary">
          Keep the app open — this usually takes a couple of minutes.
        </Text>
      </View>
    </SafeAreaView>
  );
}