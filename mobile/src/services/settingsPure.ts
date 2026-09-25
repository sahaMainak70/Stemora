import type { AppSettings, ExportFormat } from "@/types/settings";

export function isExportFormat(value: unknown): value is ExportFormat {
  return value === "mp3" || value === "wav";
}

export function isRetentionHour(value: unknown, options: readonly number[]): value is number {
  return typeof value === "number" && options.includes(value);
}

export function resolveSettings(
  raw: unknown,
  defaults: AppSettings,
  retentionOptions: readonly number[],
): AppSettings {
  const candidate =
    typeof raw === "object" && raw !== null ? (raw as Partial<AppSettings>) : {};
  const fallbackFormat: ExportFormat = isExportFormat(defaults.defaultExportFormat)
    ? defaults.defaultExportFormat
    : "mp3";
  const fallbackRetention = isRetentionHour(defaults.retentionHours, retentionOptions)
    ? defaults.retentionHours
    : retentionOptions[retentionOptions.length - 1];

  return {
    defaultExportFormat: isExportFormat(candidate.defaultExportFormat)
      ? candidate.defaultExportFormat
      : fallbackFormat,
    retentionHours: isRetentionHour(candidate.retentionHours, retentionOptions)
      ? candidate.retentionHours
      : fallbackRetention,
  };
}