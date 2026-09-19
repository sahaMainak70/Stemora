import { Platform } from "react-native";
import Constants from "expo-constants";

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

export const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";

export const SUPPORTED_EXPORT_FORMATS = ["mp3", "wav"] as const;

export const FILE_RETENTION_HOURS = 24;