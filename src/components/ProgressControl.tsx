import { useEffect, useState } from "react";
import { Check, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useUpdateProjectMutation } from "@/hooks/useProjectApi";
import { ApiClientError } from "@/lib/apiClient";
import ProgressBar from "./ProgressBar";

interface Props {
  projectId: string;
  expectedVersion: number;
  isOwner: boolean;
  progressPercentage: number;
}

const ProgressControl = ({
  projectId,
  expectedVersion,
  isOwner,
  progressPercentage,
}: Props) => {
  const updateProject = useUpdateProjectMutation(projectId);
  const [manualValue, setManualValue] = useState(progressPercentage);
  const [editing, setEditing] = useState(false);

  useEffect(() => setManualValue(progressPercentage), [progressPercentage]);

  const save = async (value: number) => {
    try {
      await updateProject.mutateAsync({
        expectedVersion,
        progressPercentage: value,
      });
      setManualValue(value);
      setEditing(false);
      toast.success("Voortgang bijgewerkt");
    } catch (error) {
      console.error("Project progress update failed", error);
      if (error instanceof ApiClientError && error.status === 409) {
        toast.error("De verbouwing is intussen gewijzigd. Probeer het opnieuw.");
        return;
      }
      toast.error("Kon voortgang niet opslaan");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <ProgressBar value={manualValue} />
        </div>
        {isOwner && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing((current) => !current)}
            disabled={updateProject.isPending}
            className="min-h-11 min-w-11 px-2"
            aria-label={editing ? "Voortgang bewerken sluiten" : "Voortgang bewerken"}
          >
            {updateProject.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              : editing
                ? <Check className="h-4 w-4" aria-hidden="true" />
                : <Pencil className="h-4 w-4" aria-hidden="true" />}
          </Button>
        )}
      </div>
      {isOwner && editing && (
        <div className="rounded-md border border-border bg-secondary/30 p-3">
          <Slider
            aria-label="Voortgang in procenten"
            value={[manualValue]}
            min={0}
            max={100}
            step={1}
            disabled={updateProject.isPending}
            onValueChange={(value) => setManualValue(value[0])}
            onValueCommit={(value) => void save(value[0])}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Sleep om de voortgang in te stellen op {manualValue}%.
          </p>
        </div>
      )}
    </div>
  );
};

export default ProgressControl;
