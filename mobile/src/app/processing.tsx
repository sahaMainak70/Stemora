import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CheckCircle2, Inbox, Ban } from "lucide-react-native";
import { colors } from "@/constants/theme";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/Button";
import { RetryState } from "@/components/RetryState";
import { ProgressBar } from "@/components/ProgressBar";
import { StageChecklist } from "@/components/StageChecklist";
import { deriveStages, stageLabel } from "@/constants/stages";
import { useJob } from "@/hooks/useJob";
import { submitJob } from "@/services/api";
import { classifyErrorCode, guidanceForTier } from "@/services/errorGuide";
import { recordJob } from "@/services/historyStore";

export default function ProcessingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ jobId?: string }>();
  const jobId = typeof params.jobId === "string" ? params.jobId : undefined;
  const { job, error, errorCode, retry } = useJob(jobId);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!job) return;
    if (job.status === "completed" || job.status === "failed") {
      try {
        recordJob(job);
      } catch {
        // history is best-effort — never break the terminal view
      }
    }
  }, [job]);

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

  const isFailed = job?.status === "failed";
  const isCompleted = job?.status === "completed";
  const isCancelled = job?.status === "cancelled";
  const percent = Math.round(job?.progress ?? 0);
  const stemCount = job ? Object.keys(job.files).length : 0;

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

  if (isCancelled) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
        <View className="flex-1 px-5 pb-8">
          <ScreenHeader title="Separating" />
          <View className="flex-1 items-center justify-center gap-4">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-surface">
              <Ban size={22} color={colors.secondary} />
            </View>
            <Text className="text-base font-medium text-primary">Separation cancelled</Text>
            <Text className="text-center text-sm text-secondary">
              The job was cancelled before it finished.
            </Text>
            <Button label="Back to Home" onPress={() => router.replace("/")} className="mt-2" />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (isFailed) {
    const tier = classifyErrorCode(job.errorCode);
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
        <View className="flex-1 px-5 pb-8">
          <ScreenHeader title="Separating" />
          <RetryState
            title="Separation failed"
            message={job.error}
            guidance={guidanceForTier(tier)}
            retryLabel="Try again"
            onRetry={tier === "retryable" ? retryFailedJob : undefined}
            retryLoading={retrying}
            onHome={() => router.replace("/")}
          />
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
            <Text className="text-base font-medium text-primary">Stems are ready</Text>
            <Text className="text-sm text-secondary">
              {stemCount > 0
                ? `${stemCount} stems are ready to play, remix and export.`
                : "Your stems are ready to play and export."}
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

  if (error && !job) {
    const pollTier = classifyErrorCode(errorCode);
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
        <View className="flex-1 px-5 pb-8">
          <ScreenHeader title="Separating" />
          <RetryState
            message={error}
            guidance={guidanceForTier(pollTier)}
            retryLabel={pollTier === "retryable" ? "Try again" : undefined}
            onRetry={pollTier === "retryable" ? retry : undefined}
            onHome={() => router.replace("/")}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
      <View className="flex-1 px-5 pb-8">
        <ScreenHeader title="Separating" />

        <View className="flex-1 items-center justify-center gap-8">
          <View className="items-center gap-2">
            <Text className="text-2xl font-semibold text-primary">{percent}%</Text>
            <Text className="text-sm text-secondary">
              {stageLabel(job?.stage ?? null)} — hang tight
            </Text>
          </View>
          <ProgressBar progress={(job?.progress ?? 0) / 100} />
          {job ? <StageChecklist stages={deriveStages(job.stage)} /> : null}
        </View>

        <Text className="text-center text-xs text-secondary">
          This usually takes a couple of minutes. You can go back — the job keeps running and
          stays in Recent.
        </Text>
      </View>
    </SafeAreaView>
  );
}