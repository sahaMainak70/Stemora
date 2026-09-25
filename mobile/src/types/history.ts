import type { JobStage, StemKind } from "@/types/api";

// `active` = submitted and still running. The entry is written the moment the
// job is created (Home), so it survives navigating back mid-separation and the
// user can re-open the separation window for it (Unit 26 manual pass).
export type HistoryStatus = "active" | "completed" | "failed";

export type HistoryEntry = {
  jobId: string;
  url: string;
  title: string;
  stems: StemKind[];
  status: HistoryStatus;
  // The step the job is on while it runs ("downloading", "extracting",
  // "processing", "encoding"), so an in-flight Recent row can name the current
  // stage instead of a generic "Separating…". Null until the server reports
  // one, and only read while the entry is `active`.
  stage: JobStage | null;
  createdAt: number; // when the job was submitted (preserved on upsert)
  completedAt: number | null; // set when the job reaches a terminal status
  duration: number | null;
};
