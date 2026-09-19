import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronRight } from "lucide-react-native";
import { colors } from "@/constants/theme";
import { ScreenHeader } from "@/components/ScreenHeader";
import {
  API_BASE_URL,
  APP_VERSION,
  FILE_RETENTION_HOURS,
  SUPPORTED_EXPORT_FORMATS,
} from "@/constants/config";

type SettingsRow = {
  label: string;
  value?: string;
  hint?: string;
};

type SettingsGroupProps = {
  title: string;
  rows: SettingsRow[];
};

function SettingsGroup({ title, rows }: SettingsGroupProps) {
  return (
    <View className="gap-3">
      <Text className="text-sm font-medium text-secondary">{title}</Text>
      <View className="overflow-hidden rounded-lg border border-subtle bg-surface">
        {rows.map((row, index) => (
          <View
            key={row.label}
            className={`flex-row items-center gap-3 px-4 py-3 ${index > 0 ? "border-t border-subtle" : ""}`}
          >
            <Text className="flex-1 text-base text-primary">{row.label}</Text>
            {row.value ? <Text className="text-sm text-secondary">{row.value}</Text> : null}
            {row.hint ? (
              <Text className="max-w-[40%] text-right text-xs text-disabled">{row.hint}</Text>
            ) : null}
            <ChevronRight size={16} color={colors.secondary} />
          </View>
        ))}
      </View>
    </View>
  );
}

const exportFormatsLabel = SUPPORTED_EXPORT_FORMATS.map((format) => format.toUpperCase()).join(
  " \u00B7 ",
);

export default function SettingsScreen() {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
      <View className="flex-1 gap-6 px-5 pb-8">
        <ScreenHeader title="Settings" />
        <SettingsGroup title="Server" rows={[{ label: "API server", value: API_BASE_URL }]} />
        <SettingsGroup title="Output" rows={[{ label: "Export formats", value: exportFormatsLabel }]} />
        <SettingsGroup
          title="Storage"
          rows={[
            {
              label: "Auto-cleanup",
              value: `${FILE_RETENTION_HOURS} h`,
              hint: "server clears files after this window",
            },
          ]}
        />
        <SettingsGroup title="About" rows={[{ label: "Version", value: APP_VERSION }]} />
      </View>
    </SafeAreaView>
  );
}