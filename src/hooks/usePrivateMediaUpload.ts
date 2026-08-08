import { useMutation } from "@tanstack/react-query";
import {
  uploadProjectImage,
  type PreparedProjectImage,
  type ProjectMediaUploadStage,
} from "@/lib/privateMediaApi";

export type ProjectMediaUploadMutationInput = {
  projectId: string;
  idempotencyKey: string;
  prepared: PreparedProjectImage;
  signal?: AbortSignal;
  onStage?: (stage: ProjectMediaUploadStage) => void;
};

export function usePrivateMediaUpload() {
  return useMutation({
    mutationFn: (input: ProjectMediaUploadMutationInput) => uploadProjectImage(input),
  });
}
