import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface DiscardUpdateDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
  onKeep?: () => void;
  busy?: boolean;
}

const DiscardUpdateDraftDialog = ({
  open,
  onOpenChange,
  onDiscard,
  onKeep,
  busy = false,
}: DiscardUpdateDraftDialogProps) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent className="z-[1100] w-[calc(100%-2rem)] max-w-md">
      <AlertDialogHeader>
        <AlertDialogTitle>{onKeep ? "Concept bewaren?" : "Wijzigingen weggooien?"}</AlertDialogTitle>
        <AlertDialogDescription>
          {onKeep
            ? "Je update is nog niet opgeslagen. Bewaar haar op dit apparaat, ga terug om verder te schrijven of gooi de wijzigingen bewust weg."
            : "Je update is nog niet opgeslagen. Ga terug om verder te schrijven of gooi je wijzigingen bewust weg."}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel className="min-h-11" disabled={busy}>Verder met update</AlertDialogCancel>
        <AlertDialogAction
          type="button"
          onClick={onDiscard}
          disabled={busy}
          className="min-h-11 border border-destructive bg-background text-destructive hover:bg-destructive/10"
        >
          Concept weggooien
        </AlertDialogAction>
        {onKeep ? (
          <AlertDialogAction
            type="button"
            onClick={onKeep}
            disabled={busy}
            className="min-h-11"
          >
            {busy ? "Bewaren…" : "Bewaren en sluiten"}
          </AlertDialogAction>
        ) : null}
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export default DiscardUpdateDraftDialog;
