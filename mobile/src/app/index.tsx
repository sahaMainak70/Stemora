import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  AlertCircle,
  ChevronRight,
  Link2,
  LoaderCircle,
  Music2,
  RefreshCw,
  Scissors,
  Settings,
  Trash2,
} from "lucide-react-native";
import { colors } from "@/constants/theme";
import { ActiveStageLabel } from "@/components/ActiveStageLabel";
import { Button } from "@/components/Button";
import { Spinner } from "@/components/Spinner";
import { Tappable } from "@/components/Tappable";
import { ApiError, submitBatch, submitJob } from "@/services/api";
import { classifyErrorCode, guidanceForTier } from "@/services/errorGuide";
import type { ErrorTier } from "@/services/errorGuide";
import { useHistory } from "@/hooks/useHistory";
import { recordPendingJob } from "@/services/historyStore";
import { formatSeconds } from "@/utils/format";
import type { StemKind } from "@/types/api";
import type { HistoryEntry } from "@/types/history";

const STEM_LABEL: Record<StemKind, string> = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  other: "Other",
  instrumental: "Instrumental",
};

// The sub-line of a finished or failed row. An in-flight row renders
// `ActiveStageLabel` (its live pipeline step) instead, so there is no active
// case here.
function entrySummary(entry: HistoryEntry): string {
  if (entry.status === "failed") return "Separation failed";
  const stems = entry.stems.map((stem) => STEM_LABEL[stem] ?? stem).join(" + ");
  return entry.duration != null ? `${stems} · ${formatSeconds(entry.duration)}` : stems;
}

export default function HomeScreen() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorTier, setErrorTier] = useState<ErrorTier | null>(null);
  const { entries, clearAll } = useHistory();

function parseUrlList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function submitUrls(urls: string[]) {
  if (urls.length === 0) {
    setErrorMessage("Paste a link to a song first.");
    setErrorTier(null);
    return;
  }

  setSubmitting(true);
  setErrorMessage(null);
  setErrorTier(null);

  try {
    if (urls.length === 1) {
      const job = await submitJob(urls[0]);
      // Listed in Recent before we navigate, so the job survives the user
      // leaving the separation screen while it is still running.
      try {
        recordPendingJob(job.jobId, job.url);
      } catch {
        // history is best-effort — never block the submit
      }
      router.replace({
        pathname: "/processing",
        params: { jobId: job.jobId },
      });
    } else {
      const batch = await submitBatch(urls);
      try {
        batch.jobs.forEach((row, index) => recordPendingJob(row.jobId, urls[index] ?? ""));
      } catch {
        // history is best-effort — never block the submit
      }
      router.replace({
        pathname: "/batch",
        params: { batchId: batch.batchId },
      });
    }
  } catch (err) {
    const tier: ErrorTier =
      err instanceof ApiError ? classifyErrorCode(err.code) : "retryable";
    setErrorMessage(
      err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
    );
    setErrorTier(tier);
  } finally {
    setSubmitting(false);
    setRetryingJobId(null);
  }
}

function submitUrl(target: string) {
  void submitUrls(parseUrlList(target));
}

  function retryFailedEntry(entry: HistoryEntry) {
    if (!entry.url || submitting) return;
    setRetryingJobId(entry.jobId);
    void submitUrl(entry.url);
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pb-8 pt-4"
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-row items-center justify-between pt-2">
          <View className="flex-1">
            <Text className="text-xl font-semibold text-primary">Stemora</Text>
            <Text className="text-sm text-secondary">AI song stem separator</Text>
          </View>
          <Tappable
            onPress={() => router.push("/settings")}
            hitSlop={8}
            className="h-10 w-10 items-center justify-center rounded-full border border-subtle bg-surface"
          >
            <Settings size={18} color={colors.primary} />
          </Tappable>
        </View>

        <View className="gap-3 rounded-lg border border-subtle bg-surface p-4">
          <View className="flex-row items-center gap-2">
            <Link2 size={16} color={colors.secondary} />
            <Text className="text-sm font-medium text-primary">Song URL</Text>
          </View>
          <TextInput
            value={url}
            onChangeText={setUrl}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder="Paste one or more song links (one per line)…"
            placeholderTextColor={colors.disabled}
            className={`rounded-md border bg-background px-3 py-2.5 text-base text-primary ${
              errorMessage ? "border-error" : inputFocused ? "border-accent" : "border-subtle"
            }`}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!submitting}
            multiline
          />
          <Button
            label="Separate stems"
            icon={Scissors}
            onPress={() => submitUrl(url)}
            loading={submitting}
          />
          {errorMessage ? (
            <View className="gap-1.5">
              <View className="flex-row items-start gap-2">
                <AlertCircle size={15} color={colors.error} />
                <Text className="flex-1 text-sm text-error">{errorMessage}</Text>
              </View>
              {errorTier ? (
                <Text className="pl-6 text-xs text-disabled">{guidanceForTier(errorTier)}</Text>
              ) : null}
              {errorTier === "retryable" ? (
                <Button
                  label="Try again"
                  size="sm"
                  variant="secondary"
                  icon={RefreshCw}
                  onPress={() => submitUrl(url)}
                  loading={submitting}
                />
              ) : null}
            </View>
          ) : null}
        </View>

        <View className="gap-3">
          {entries.length > 0 ? (
            <>
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-medium text-secondary">Recent</Text>
                <Tappable
                  onPress={clearAll}
                  hitSlop={8}
                  className="h-8 w-8 items-center justify-center rounded-full border border-subtle bg-surface"
                >
                  <Trash2 size={14} color={colors.secondary} />
                </Tappable>
              </View>
              <View className="gap-2">
                {entries.map((entry) => {
                  const failed = entry.status === "failed";
                  const active = entry.status === "active";
                  const retrying = retryingJobId === entry.jobId;
                  return (
                    <Tappable
                      key={entry.jobId}
                      onPress={() => {
                        if (active) {
                          // Re-open the separation window — it follows the job to
                          // completion and hands off to the result screen.
                          router.push({ pathname: "/processing", params: { jobId: entry.jobId } });
                        } else if (failed) {
                          retryFailedEntry(entry);
                        } else {
                          router.push({ pathname: "/result", params: { jobId: entry.jobId } });
                        }
                      }}
                      disabled={submitting}
                      className="flex-row items-center gap-3 rounded-lg border border-subtle bg-surface px-4 py-3"
                    >
                      <View
                        className={`h-9 w-9 items-center justify-center rounded-full bg-background ${
                          failed ? "opacity-60" : ""
                        }`}
                      >
                        {active ? (
                          <Spinner color={colors.accent} />
                        ) : (
                          <Music2 size={16} color={failed ? colors.error : colors.secondary} />
                        )}
                      </View>
                      <View className="flex-1 gap-0.5">
                        <Text className="text-base font-medium text-primary" numberOfLines={1}>
                          {entry.title}
                        </Text>
                        {active ? (
                          <ActiveStageLabel stage={entry.stage} className="text-sm text-accent" />
                        ) : (
                          <Text className={`text-sm ${failed ? "text-error" : "text-secondary"}`}>
                            {entrySummary(entry)}
                          </Text>
                        )}
                      </View>
                      {failed ? (
                        retrying ? (
                          <LoaderCircle size={16} color={colors.secondary} />
                        ) : (
                          <View className="flex-row items-center gap-1">
                            <Text className="text-xs text-secondary">Retry</Text>
                            <RefreshCw size={15} color={colors.secondary} />
                          </View>
                        )
                      ) : active ? null : (
                        <ChevronRight size={16} color={colors.secondary} />
                      )}
                    </Tappable>
                  );
                })}
              </View>
            </>
          ) : (
            <View className="items-center gap-2 rounded-lg border border-dashed border-subtle bg-surface px-4 py-6">
              <Music2 size={18} color={colors.secondary} />
              <Text className="text-sm text-secondary">
                Your recent separations will show here.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}