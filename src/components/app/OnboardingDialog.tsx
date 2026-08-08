import { useEffect, useState } from "react";
import { BookOpen, LockKeyhole, PlusCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useOwnProfile, useUpdateOwnProfileMutation } from "@/hooks/useProfiles";
import { ApiClientError } from "@/lib/apiClient";
import { createClientIdempotencyKey } from "@/lib/clientIdempotency";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import { useNavigate } from "@/lib/router";

type OnboardingDialogProps = {
  enabled: boolean;
};

const benefits = [
  { icon: LockKeyhole, text: "Je profiel en elk nieuw project beginnen privé." },
  { icon: PlusCircle, text: "Voeg foto-first updates toe wanneer het jou uitkomt." },
  { icon: BookOpen, text: "Maak later één echt Bouwboek van je tijdlijn." },
] as const;

export default function OnboardingDialog({ enabled }: OnboardingDialogProps) {
  const navigate = useNavigate();
  const profileQuery = useOwnProfile(enabled);
  const updateProfile = useUpdateOwnProfileMutation();
  const profile = profileQuery.data;
  const [dismissed, setDismissed] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);

  useEffect(() => {
    if (!profile || profile.onboardedAt) return;
    setDisplayName(profile.displayName);
    setIsPrivate(profile.isPrivate);
  }, [profile]);

  const open = Boolean(enabled && profile && !profile.onboardedAt && !dismissed);

  const complete = async (startProject: boolean) => {
    if (!profile) return;
    const name = displayName.trim();
    if (!name) {
      toast.error("Vul een naam in om verder te gaan.");
      return;
    }

    try {
      await updateProfile.mutateAsync({
        idempotencyKey: createClientIdempotencyKey("profile-onboarding"),
        expectedVersion: profile.version,
        displayName: name,
        isPrivate,
        onboardingCompleted: true,
      });
      setDismissed(true);
      toast.success("Je Buildy-profiel is klaar.");
      if (startProject) navigate(PRODUCT_ROUTES.newProject);
    } catch (error) {
      console.error("Onboarding completion failed", error);
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : "Je keuzes konden niet worden opgeslagen. Probeer het opnieuw.",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && !updateProfile.isPending) setDismissed(true);
    }}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
        aria-describedby="onboarding-description"
      >
        <DialogHeader>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Welkom bij Buildy</p>
          <DialogTitle className="font-serif text-3xl font-normal">Jouw verbouwing, op jouw voorwaarden</DialogTitle>
          <DialogDescription id="onboarding-description" className="leading-6">
            Stel je profiel één keer in. Je kunt alles later aanpassen bij Account en privacy.
          </DialogDescription>
        </DialogHeader>

        <ul className="grid gap-3 py-2" aria-label="Wat je met Buildy kunt doen">
          {benefits.map(({ icon: Icon, text }) => (
            <li className="flex min-h-11 items-center gap-3 rounded-lg bg-muted/60 px-4 py-3 text-sm" key={text}>
              <Icon className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
              <span>{text}</span>
            </li>
          ))}
        </ul>

        <div className="grid gap-2">
          <Label htmlFor="onboarding-display-name">Naam op je profiel</Label>
          <Input
            id="onboarding-display-name"
            autoComplete="name"
            maxLength={80}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={updateProfile.isPending}
          />
        </div>

        <div className="flex min-h-14 items-center justify-between gap-4 rounded-lg border p-4">
          <div>
            <Label htmlFor="onboarding-private" className="font-semibold">Privéprofiel</Label>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Alleen geaccepteerde volgers zien je volledige profiel. Projecten blijven afzonderlijk privé.
            </p>
          </div>
          <Switch
            id="onboarding-private"
            checked={isPrivate}
            onCheckedChange={setIsPrivate}
            disabled={updateProfile.isPending}
            aria-describedby="onboarding-description"
          />
        </div>

        <DialogFooter className="gap-2 sm:space-x-0">
          <Button
            type="button"
            variant="outline"
            disabled={updateProfile.isPending}
            onClick={() => void complete(false)}
          >
            Later een project maken
          </Button>
          <Button
            type="button"
            disabled={updateProfile.isPending}
            onClick={() => void complete(true)}
          >
            {updateProfile.isPending ? "Opslaan…" : "Start mijn eerste project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
