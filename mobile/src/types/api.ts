import type { ExportFormat } from "@/types/settings";

export type JobStatus =
  | "queued"
  | "downloading"
  | "extracting"
  | "processing"
  | "encoding"
  | "mixing"
  | "completed"
  | "failed"
  | "cancelled";

export type JobStage =
  | "downloading"
  | "extracting"
  | "processing"
  | "encoding"
  | "mixing"
  | "completed";

export type StemKind = "vocals" | "drums" | "bass" | "other" | "instrumental";

export type MixedStemKind = "vocals" | "drums" | "bass" | "other";

export type MixGains = Record<MixedStemKind, number>;

export type StemFiles = { mp3: string; wav: string };

// A mix render produces only the format that was requested, so its file map
// carries a single key (Unit 23) — unlike a stem, which has both.
export type MixFiles = Partial<Record<ExportFormat, string>>;

export type JobFiles = Partial<Record<StemKind, StemFiles>> & { mix?: MixFiles };

export type SongMetadata = {
  title: string;
  duration: number | null;
};

export type JobResponse = {
  jobId: string;
  url: string;
  status: JobStatus;
  stage: JobStage | null;
  progress: number | null;
  files: JobFiles;
  error: string | null;
  errorCode: string | null;
  metadata: SongMetadata | null;
};

export type BatchResponse = {
  batchId: string;
  total: number;
  progress: number;
  completed: number;
  failed: number;
  cancelled: number;
  active: number;
  jobs: JobResponse[];
};

export type WaveformStem = StemKind;

export type WaveformResponse = {
  jobId: string;
  stem: WaveformStem;
  duration: number;
  peaks: number[];
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};