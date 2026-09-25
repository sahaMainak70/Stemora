import {
  DEFAULT_EXPORT_FORMAT,
  DEFAULT_RETENTION_HOURS,
  RETENTION_OPTIONS_HOURS,
} from "@/constants/config";
import { readJsonFile, writeJsonFile } from "@/utils/jsonFile";
import { isExportFormat, isRetentionHour, resolveSettings } from "@/services/settingsPure";
import type { AppSettings } from "@/types/settings";

const SETTINGS_FILE_NAME = "stemora-settings.json";

const DEFAULTS: AppSettings = {
  defaultExportFormat: DEFAULT_EXPORT_FORMAT,
  retentionHours: DEFAULT_RETENTION_HOURS,
};

export function readSettings(): AppSettings {
  return resolveSettings(readJsonFile(SETTINGS_FILE_NAME), DEFAULTS, RETENTION_OPTIONS_HOURS);
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  if (patch.defaultExportFormat !== undefined && !isExportFormat(patch.defaultExportFormat)) {
    throw new Error("invalid settings patch");
  }
  if (
    patch.retentionHours !== undefined &&
    !isRetentionHour(patch.retentionHours, RETENTION_OPTIONS_HOURS)
  ) {
    throw new Error("invalid settings patch");
  }
  const next: AppSettings = { ...readSettings(), ...patch };
  writeJsonFile(SETTINGS_FILE_NAME, next);
  return next;
}