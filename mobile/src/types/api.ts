export type JobStatus =
  | "queued"
  | "downloading"
  | "extracting"
  | "processing"
  | "encoding"
  | "completed"
  | "failed";

export type JobStage =
  | "downloading"
  | "extracting"
  | "processing"
  | "encoding"
  | "completed";

export type StemKind = "vocals" | "instrumental";

export type StemFiles = { mp3: string; wav: string };

export type JobFiles = Partial<Record<StemKind, StemFiles>>;

export type SongMetadata = {
  title: string;
  duration: number | null;
};

export type JobResponse = {
  jobId: string;
  status: JobStatus;
  stage: JobStage | null;
  progress: number | null;
  files: JobFiles;
  error: string | null;
  metadata: SongMetadata | null;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};