import { useEffect, useRef, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Ban,
  CheckCircle2,
  Inbox,
  LoaderCircle,
  XCircle,
  X,
} from "lucide-react-native";
import { colors } from "@/constants/theme";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/Button";
import { Tappable } from "@/components/Tappable";
import { RetryState } from "@/components/RetryState";
import { ProgressBar } from "@/components/ProgressBar";
import { PIPELINE_STAGES } from "@/constants/stages";
import { ApiError, cancelBatch, cancelJob } from "@/services/api";
import { classifyErrorCode, guidanceForTier } from "@/services/errorGuide";
import { recordJob } from "@/services/historyStore";
import { useBatch } from "@/hooks/useBatch";
import type { BatchResponse, JobResponse, JobStage } from "@/types/api";

function stageLabel(stage: JobStage | null): string {
  if (!stage) return "Starting";
  const match = PIPELINE_STAGES.find((entry) => entry.key === stage);
  return match ? match.label : "Starting";
}

function isTerminal(request: JobResponse["status"]): boolean {
  return (
    request === "completed" ||
    request === "failed" ||
    request === "cancelled"
  );
}

// Local echo of the server's aggregation, only used to keep the per-row
// cancel responsive while the poller (which owns the truth) catches up.
function reindex(batchId: string, jobs: JobResponse[]): BatchResponse {
  const total = jobs.length;
  let completed = 0;
  let failed = 0;
  let cancelled = 0;
  let progressSum = 0;
  for (const job of jobs) {
    if (job.status === "completed") completed++;
    else if (job.status === "failed") failed++;
    else if (job.status === "cancelled") cancelled++;
    progressSum += isTerminal(job.status) ? 100 : (job.progress ?? 0);
  }
  const active = total - completed - failed - cancelled;
  return {
    batchId,
    total,
    progress: total === 0 ? 100 : Math.round(progressSum / total),
    completed,
    failed,
    cancelled,
    active,
    jobs,
  };
}

function upsertJob(batch: BatchResponse, updated: JobResponse): BatchResponse {
  const jobs = batch.jobs.map((job) =>
    job.jobId === updated.jobId ? updated : job,
  );
  return reindex(batch.batchId, jobs);
}

export default function BatchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ batchId?: string }>();
  const batchId = typeof params.batchId === "string" ? params.batchId : undefined;
  const { batch, error, errorCode, retry, apply } = useBatch(batchId);
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);
  const [cancellingBatch, setCancellingBatch] = useState(false);
  const recordedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!batch) return;
    for (const job of batch.jobs) {
      if (job.status !== "completed" && job.status !== "failed" && job.status !== "cancelled") {
        continue;
      }
      if (recordedRef.current.has(job.jobId)) continue;
      recordedRef.current.add(job.jobId);
      try {
        // `recordJob` drops cancelled jobs, so a cancelled row can't stay in
        // Recent as "active" forever.
        recordJob(job);
      } catch {
        // history is best-effort — never break the batch view
      }
    }
  }, [batch]);

  async function handlePerJobCancel(jobId: string) {
    if (cancellingJobId !== null) return;
    setCancellingJobId(jobId);
    try {
      const updated = await cancelJob(jobId);
      if (batch) apply(upsertJob(batch, updated));
    } catch (err) {
      Alert.alert(
        "Cancel failed",
        err instanceof ApiError ? err.message : "Couldn't cancel that job.",
      );
    } finally {
      setCancellingJobId(null);
    }
  }

  async function handleBatchCancel() {
    if (!batch || cancellingBatch) return;
    setCancellingBatch(true);
    try {
      const updated = await cancelBatch(batch.batchId);
      apply(updated);
    } catch (err) {
      Alert.alert(
        "Cancel failed",
        err instanceof ApiError ? err.message : "Couldn't cancel the batch.",
      );
    } finally {
      setCancellingBatch(false);
    }
  }

  if (!batchId) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
        <View className="flex-1 px-5 pb-8">
          <ScreenHeader title="Batch" />
          <View className="flex-1 items-center justify-center gap-4">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-surface">
              <Inbox size={22} color={colors.secondary} />
            </View>
            <Text className="text-base text-primary">No batch in progress</Text>
            <Text className="text-center text-sm text-secondary">
              Paste multiple song links on the Home screen to start a batch.
            </Text>
            <Button label="Back to Home" onPress={() => router.replace("/")} className="mt-2" />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (error && !batch) {
    const pollTier = classifyErrorCode(errorCode);
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
        <View className="flex-1 px-5 pb-8">
          <ScreenHeader title="Batch" />
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

  const finished = (batch?.active ?? 0) === 0;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
      <View className="flex-1 gap-4 px-5 pb-8">
        <ScreenHeader title="Batch" />

        {batch ? (
          <ScrollView className="flex-1" contentContainerClassName="gap-4">
            <View className="gap-3 rounded-lg border border-subtle bg-surface p-4">
              <View className="flex-row items-end justify-between">
                <View className="flex-row items-baseline gap-1">
                  <Text className="text-3xl font-semibold text-primary">{batch.progress}%</Text>
                  <Text className="text-sm text-secondary">done</Text>
                </View>
                <Text className="text-sm text-secondary">
                  {batch.completed + batch.failed} of {batch.total} songs ready
                </Text>
              </View>
              <ProgressBar progress={batch.progress / 100} />
              <View className="flex-row items-center justify-between">
                <Text className="text-xs text-secondary">
                  {batch.completed} ready · {batch.failed} failed · {batch.cancelled} cancelled ·{" "}
                  {batch.active} left
                </Text>
                {!finished ? (
                  <Tappable
                    onPress={handleBatchCancel}
                    hitSlop={8}
                    className="flex-row items-center gap-1 rounded-md border border-subtle px-2 py-1"
                  >
                    {cancellingBatch ? (
                      <LoaderCircle size={14} color={colors.secondary} />
                    ) : (
                      <X size={14} color={colors.secondary} />
                    )}
                    <Text className="text-xs text-secondary">Cancel batch</Text>
                  </Tappable>
                ) : null}
              </View>
            </View>

            <View className="gap-2">
              {batch.jobs.map((job, index) => {
                const running = isPending(job.status);
                const completed = job.status === "completed";
                const failed = job.status === "failed";
                const cancelled = job.status === "cancelled";
                const label = job.metadata?.title?.trim()
                  ? job.metadata.title
                  : `Song ${index + 1}`;
                const sub = completed
                  ? "Ready"
                  : cancelled
                    ? "Cancelled"
                    : failed
                      ? job.error ?? "Failed"
                      : `${Math.round(job.progress ?? 0)}% · ${stageLabel(job.stage)}`;

                return (
                  <View
                    key={job.jobId}
                    className="rounded-lg border border-subtle bg-surface px-4 py-3"
                  >
                    <View className="flex-row items-center gap-3">
                      <View
                        className={`h-9 w-9 items-center justify-center rounded-full bg-background ${
                          completed ? "" : "opacity-60"
                        }`}
                      >
                        {completed ? (
                          <CheckCircle2 size={16} color={colors.success} />
                        ) : cancelled ? (
                          <Ban size={16} color={colors.secondary} />
                        ) : failed ? (
                          <XCircle size={16} color={colors.error} />
                        ) : (
                          <LoaderCircle size={16} color={colors.accent} />
                        )}
                      </View>
                      {completed ? (
                        <Tappable
                          onPress={() =>
                            router.push({ pathname: "/result", params: { jobId: job.jobId } })
                          }
                          className="flex-1 gap-0.5"
                        >
                          <Text className="text-base font-medium text-primary" numberOfLines={1}>
                            {label}
                          </Text>
                          <Text className="text-sm text-secondary">{sub}</Text>
                        </Tappable>
                      ) : (
                        <View className="flex-1 gap-0.5">
                          <Text className="text-base font-medium text-primary" numberOfLines={1}>
                            {label}
                          </Text>
                          <Text className="text-sm text-secondary" numberOfLines={1}>
                            {sub}
                          </Text>
                        </View>
                      )}
                      {running && !finished ? (
                        <Tappable
                          onPress={() => handlePerJobCancel(job.jobId)}
                          hitSlop={8}
                          className="flex-row items-center gap-1 rounded-md border border-subtle px-2 py-1"
                        >
                          {cancellingJobId === job.jobId ? (
                            <LoaderCircle size={14} color={colors.secondary} />
                          ) : (
                            <X size={14} color={colors.secondary} />
                          )}
                          <Text className="text-xs text-secondary">Cancel</Text>
                        </Tappable>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>

            {finished ? (
              <View className="items-center gap-3 pb-2">
                <Text className="text-sm text-secondary">Batch finished.</Text>
                <Button
                  label="Back to Home"
                  variant="secondary"
                  onPress={() => router.replace("/")}
                />
              </View>
            ) : (
              <Text className="text-center text-xs text-secondary">
                Keep the app open — batch jobs usually take a couple of minutes each.
              </Text>
            )}
          </ScrollView>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function isPending(status: JobResponse["status"]): boolean {
  return !isTerminal(status);
}