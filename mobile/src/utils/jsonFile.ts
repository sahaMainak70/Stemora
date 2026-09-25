import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";

type WebStorage = {
  localStorage?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
  };
};

const isWeb = Platform.OS === "web";

export function readJsonFile(name: string): unknown {
  if (isWeb) {
    try {
      const raw = (globalThis as WebStorage).localStorage?.getItem(name);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  try {
    const file = new File(Paths.document, name);
    if (!file.exists) return null;
    return JSON.parse(file.textSync());
  } catch {
    return null;
  }
}

export function writeJsonFile(name: string, value: unknown): void {
  const contents = JSON.stringify(value);

  if (isWeb) {
    try {
      (globalThis as WebStorage).localStorage?.setItem(name, contents);
    } catch {
      // storage unavailable — best-effort on web
    }
    return;
  }

  const file = new File(Paths.document, name);
  if (!file.exists) file.create({ intermediates: true });
  file.write(contents);
}