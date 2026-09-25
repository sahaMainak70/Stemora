export type ExportFormat = "mp3" | "wav";

export type AppSettings = {
  defaultExportFormat: ExportFormat;
  retentionHours: number;
};