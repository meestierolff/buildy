import { useState } from "react";
import { MessageSquareText } from "lucide-react";
import FeedbackForm from "@/components/moderation/FeedbackForm";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function FeedbackLauncher() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] right-3 z-30 min-h-11 gap-2 bg-background/95 px-3 shadow-md backdrop-blur md:bottom-5 md:right-5"
          aria-label="Feedback over Buildy geven"
        >
          <MessageSquareText className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Feedback</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Help Buildy verbeteren</DialogTitle>
          <DialogDescription>
            Drie korte vragen helpen ons kiezen wat als eerste beter moet. Je waardering is optioneel.
          </DialogDescription>
        </DialogHeader>
        <FeedbackForm />
      </DialogContent>
    </Dialog>
  );
}
