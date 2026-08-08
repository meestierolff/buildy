export type UpdateComposerCloseIntent = "close" | "confirm-discard" | "ignore";

interface UpdateComposerCloseState {
  isDirty: boolean;
  isSaving: boolean;
}

export const getUpdateComposerCloseIntent = ({
  isDirty,
  isSaving,
}: UpdateComposerCloseState): UpdateComposerCloseIntent => {
  if (isSaving) return "ignore";
  if (isDirty) return "confirm-discard";
  return "close";
};
