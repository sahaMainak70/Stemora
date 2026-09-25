import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Check, ChevronRight, X } from "lucide-react-native";
import { colors } from "@/constants/theme";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Tappable } from "@/components/Tappable";
import {
  API_BASE_URL,
  APP_VERSION,
  RETENTION_OPTIONS_HOURS,
  SUPPORTED_EXPORT_FORMATS,
} from "@/constants/config";
import { readSettings, updateSettings } from "@/services/settingsStore";
import type { AppSettings, ExportFormat } from "@/types/settings";

type SettingsOption = { label: string; value: string };

type SettingsRow = {
  label: string;
  value?: string;
  hint?: string;
  onPress?: () => void;
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
        {rows.map((row, index) => {
          const interactive = row.onPress !== undefined;
          const inner = (
            <>
              <Text className="flex-1 text-base text-primary">{row.label}</Text>
              {row.value ? <Text className="text-sm text-secondary">{row.value}</Text> : null}
              {row.hint ? (
                <Text className="max-w-[40%] text-right text-xs text-disabled">{row.hint}</Text>
              ) : null}
              {interactive ? <ChevronRight size={16} color={colors.secondary} /> : null}
            </>
          );
          return (
            <View key={row.label} className={`${index > 0 ? "border-t border-subtle" : ""}`}>
              {interactive ? (
                <Tappable
                  onPress={row.onPress}
                  hitSlop={4}
                  className="flex-row items-center gap-3 px-4 py-3"
                >
                  {inner}
                </Tappable>
              ) : (
                <View className="flex-row items-center gap-3 px-4 py-3">{inner}</View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

type PickerState = {
  title: string;
  options: SettingsOption[];
  selectedValue: string;
  onSelect: (value: string) => void;
} | null;

type PickerProps = {
  picker: PickerState;
  onClose: () => void;
};

function OptionSheet({ picker, onClose }: PickerProps) {
  return (
    <Modal transparent visible={picker !== null} animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <Pressable className="flex-1 bg-black/50" onPress={onClose} />
        <View className="gap-3 rounded-t-2xl bg-surface-raised p-5 pb-8">
          <View className="flex-row items-center justify-between">
            <Text className="text-lg font-semibold text-primary">{picker?.title}</Text>
            <Tappable onPress={onClose} hitSlop={8}>
              <X size={18} color={colors.secondary} />
            </Tappable>
          </View>
          {picker?.options.map((option) => {
            const selected = option.value === picker.selectedValue;
            return (
              <Tappable
                key={option.value}
                onPress={() => {
                  picker.onSelect(option.value);
                  onClose();
                }}
                className="flex-row items-center justify-between rounded-md border border-subtle bg-surface px-4 py-3"
              >
                <Text className="text-base text-primary">{option.label}</Text>
                {selected ? <Check size={18} color={colors.accent} /> : null}
              </Tappable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

const exportFormatsLabel = SUPPORTED_EXPORT_FORMATS.map((format) => format.toUpperCase()).join(
  " \u00B7 ",
);

const exportFormatOptions: SettingsOption[] = SUPPORTED_EXPORT_FORMATS.map((format) => ({
  label: format.toUpperCase(),
  value: format,
}));

const retentionOptions: SettingsOption[] = RETENTION_OPTIONS_HOURS.map((hours) => ({
  label: `${hours} ${hours === 1 ? "hour" : "hours"}`,
  value: String(hours),
}));

export default function SettingsScreen() {
  const [settings, setSettings] = useState<AppSettings>(() => readSettings());
  const [picker, setPicker] = useState<PickerState>(null);

  function openDefaultFormat() {
    setPicker({
      title: "Default export format",
      options: exportFormatOptions,
      selectedValue: settings.defaultExportFormat,
      onSelect: (value) => {
        setSettings(updateSettings({ defaultExportFormat: value as ExportFormat }));
      },
    });
  }

  function openRetention() {
    setPicker({
      title: "History retention",
      options: retentionOptions,
      selectedValue: String(settings.retentionHours),
      onSelect: (value) => {
        setSettings(updateSettings({ retentionHours: Number(value) }));
      },
    });
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
      <View className="flex-1 gap-6 px-5 pb-8">
        <ScreenHeader title="Settings" />
        <SettingsGroup title="Server" rows={[{ label: "API server", value: API_BASE_URL }]} />
        <SettingsGroup
          title="Output"
          rows={[
            { label: "Export formats", value: exportFormatsLabel },
            {
              label: "Default format",
              value: settings.defaultExportFormat.toUpperCase(),
              hint: "preselected when exporting",
              onPress: openDefaultFormat,
            },
          ]}
        />
        <SettingsGroup
          title="History"
          rows={[
            {
              label: "Keep recent for",
              value: `${settings.retentionHours} h`,
              hint: "history prunes after this",
              onPress: openRetention,
            },
          ]}
        />
        <SettingsGroup title="About" rows={[{ label: "Version", value: APP_VERSION }]} />
      </View>
      <OptionSheet picker={picker} onClose={() => setPicker(null)} />
    </SafeAreaView>
  );
}