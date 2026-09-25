import { Platform } from "react-native";
import Constants from "expo-constants";
import type { ExportFormat } from "@/types/settings";

const SERVER_PORT = 3000;

function resolveServerHost(): string {
  if (Platform.OS === "web") return "localhost";

  const hostUri = Constants.expoConfig?.hostUri;
  if (!hostUri) return Platform.OS === "android" ? "10.0.2.2" : "localhost";

  const host = hostUri.split("://").pop()?.split(":")[0]?.trim();
  if (!host) return Platform.OS === "android" ? "10.0.2.2" : "localhost";

  if (host === "localhost" || host === "127.0.0.1") {
    return Platform.OS === "android" ? "10.0.2.2" : "localhost";
  }
  return host;
}

export const API_BASE_URL = `http://${resolveServerHost()}:${SERVER_PORT}`;
export const POLL_INTERVAL_MS = 2000;
export const JOB_STEMS = 4;

export const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";

export const SUPPORTED_EXPORT_FORMATS = ["mp3", "wav"] as const;

export const DEFAULT_EXPORT_FORMAT: ExportFormat = "mp3";

export const RETENTION_OPTIONS_HOURS = [1, 6, 12, 24] as const;

export const DEFAULT_RETENTION_HOURS = 24;