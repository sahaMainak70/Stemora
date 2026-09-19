import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  AlertCircle,
  Link2,
  Music2,
  Scissors,
  Settings,
} from "lucide-react-native";
import { colors } from "@/constants/theme";
import { Button } from "@/components/Button";
import { ApiError, submitJob } from "@/services/api";

export default function HomeScreen() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSeparate() {
    const trimmed = url.trim();
    if (!trimmed) {
      setErrorMessage("Paste a link to a song first.");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const job = await submitJob(trimmed);
      router.replace({
        pathname: "/processing",
        params: { jobId: job.jobId },
      });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
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
          <Pressable
            onPress={() => router.push("/settings")}
            hitSlop={8}
            className="h-10 w-10 items-center justify-center rounded-full border border-subtle bg-surface"
          >
            <Settings size={18} color={colors.primary} />
          </Pressable>
        </View>

        <View className="gap-3 rounded-lg border border-subtle bg-surface p-4">
          <View className="flex-row items-center gap-2">
            <Link2 size={16} color={colors.secondary} />
            <Text className="text-sm font-medium text-primary">Song URL</Text>
          </View>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="Paste a link to a song…"
            placeholderTextColor={colors.disabled}
            className="rounded-md border border-subtle bg-background px-3 py-2.5 text-base text-primary"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!submitting}
          />
          <Button
            label="Separate stems"
            icon={Scissors}
            onPress={handleSeparate}
            loading={submitting}
          />
          {errorMessage ? (
            <View className="flex-row items-start gap-2">
              <AlertCircle size={15} color={colors.error} />
              <Text className="flex-1 text-sm text-error">{errorMessage}</Text>
            </View>
          ) : null}
        </View>

        <View className="gap-3">
          <Text className="text-sm font-medium text-secondary">Recent</Text>
          <View className="items-center gap-2 rounded-lg border border-dashed border-subtle bg-surface px-4 py-6">
            <Music2 size={18} color={colors.secondary} />
            <Text className="text-sm text-secondary">
              Your recent separations will show here.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
