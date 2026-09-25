import type { JobStage } from "@/types/api";

export type StageStatus = "done" | "current" | "pending";

export type Stage = {
  key: string;
  label: string;
  status: StageStatus;
};

// One source of truth for the copy behind a stage, so the Processing checklist
// and the in-flight Recent row can never disagree about what a stage is called.
const STAGE_LABEL: Record<JobStage, string> = {
  downloading: "Downloading",
  extracting: "Extracting audio",
  processing: "Separating stems",
  encoding: "Encoding files",
  mixing: "Mixing stems",
  completed: "Finishing up",
};

export const PIPELINE_STAGES: { key: JobStage; label: string }[] = [
  { key: "downloading", label: STAGE_LABEL.downloading },
  { key: "extracting", label: STAGE_LABEL.extracting },
  { key: "processing", label: STAGE_LABEL.processing },
  { key: "encoding", label: STAGE_LABEL.encoding },
];

// What the user sees as the current step: the stage the job reports, or
// "Starting" while it is still queued (no stage yet).
export function stageLabel(stage: JobStage | null): string {
  if (!stage) return "Starting";
  return STAGE_LABEL[stage] ?? "Starting";
}

const PIPELINE_ORDER: JobStage[] = PIPELINE_STAGES.map((stage) => stage.key);

export function deriveStages(current: JobStage | null): Stage[] {
  const currentIndex = current ? PIPELINE_ORDER.indexOf(current) : -1;

  return PIPELINE_STAGES.map((stage, index) => {
    if (currentIndex === -1 || index > currentIndex) {
      return { key: stage.key, label: stage.label, status: "pending" };
    }
    if (index === currentIndex) {
      return { key: stage.key, label: stage.label, status: "current" };
    }
    return { key: stage.key, label: stage.label, status: "done" };
  });
}