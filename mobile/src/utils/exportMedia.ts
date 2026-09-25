import { Alert, Platform } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { triggerWebDownload } from "@/utils/downloadWeb";

// Single export path shared by the Result screen (single-stem exports) and the
// editing window (mix renders): fetch + save + platform share sheet. Throws on
// failure so callers can show a contextual alert; the "sharing unavailable"
// case already alerts inline and does not throw.
export async function downloadAndShare(
  targetUri: string,
  filename: string,
  mimeType: string,
): Promise<void> {
  if (Platform.OS === "web") {
    const response = await fetch(targetUri);
    if (!response.ok) throw new Error("download failed");
    const blob = await response.blob();
    const objectUrl = (
      globalThis as { URL?: { createObjectURL(value: Blob): string } }
    ).URL?.createObjectURL(blob);
    if (!objectUrl || !triggerWebDownload(objectUrl, filename)) {
      throw new Error("download unavailable on this browser");
    }
    return;
  }

  const dir = new Directory(Paths.cache, "stemora-exports");
  dir.create({ idempotent: true, intermediates: true });
  const target = new File(dir, filename);
  if (target.exists) target.delete();
  const downloaded = await File.downloadFileAsync(targetUri, target);

  const available = await Sharing.isAvailableAsync();
  if (!available) {
    Alert.alert("Sharing isn't available on this device.");
    return;
  }
  await Sharing.shareAsync(downloaded.uri, {
    mimeType,
    dialogTitle: `Share ${filename}`,
  });
}