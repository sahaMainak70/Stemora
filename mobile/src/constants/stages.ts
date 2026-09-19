import type { JobStage } from "@/types/api";

export type StageStatus = "done" | "current" | "pending";

export type Stage = {
  key: string;
  label: string;
  status: StageStatus;
};

export const PIPELINE_STAGES: { key: JobStage; label: string }[] = [
  { key: "downloading", label: "Downloading" },
  { key: "extracting", label: "Extracting audio" },
  { key: "processing", label: "Separating stems" },
  { key: "encoding", label: "Encoding files" },
];

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