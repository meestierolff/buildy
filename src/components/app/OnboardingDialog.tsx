import { useEffect, useRef, useState } from "react";
import { ImagePlus, LockKeyhole } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOwnProfile, useUpdateOwnProfileMutation } from "@/hooks/useProfiles";
import { useCreateProjectMutation } from "@/hooks/useProjectApi";
import { ApiClientError } from "@/lib/apiClient";
import { createClientIdempotencyKey } from "@/lib/clientIdempotency";
import { LANDING_PHOTO_INTENT } from "@/lib/landingPhotoHandoffStore";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import {
  buildCreateProjectCommand,
  type CreateProjectFlowCommand,
} from "@/lib/projectWriteFlow";
import { useLocation, useNavigate } from "@/lib/router";
import type { UpdateOwnProfileInput } from "../../../shared/contracts/profiles";

type OnboardingDialogProps = {
  enabled: boolean;
  activeProjectId?: string;
};

const PROJECT_TYPES = [
  "Volledige renovatie",
  "Nieuwbouw",
  "Verduurzaming",
  "Aanbouw",
  "Keuken",
  "Badkamer",
  "Zolder",
  "Tuin",
  "Boot of camper",
  "Anders",
];

export default function OnboardingDialog({ enabled, activeProjectId }: OnboardingDialogProps) {
  const navigate = useNavigate();
  const { search } = useLocation();
  const profileQuery = useOwnProfile(enabled);
  const updateProfile = useUpdateOwnProfileMutation();
  const createProject = useCreateProjectMutation();
  const profile = profileQuery.data;
  const [dismissed, setDismissed] = useState(false);
  const [projectTitle, setProjectTitle] = useState("");
  const [projectType, setProjectType] = useState("");
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(activeProjectId ?? null);
  const [retryLocked, setRetryLocked] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const submitGuardRef = useRef(false);
  const projectCommandRef = useRef<CreateProjectFlowCommand | null>(null);
  const profileCommandRef = useRef<UpdateOwnProfileInput | null>(null);

  useEffect(() => {
    if (activeProjectId) setCreatedProjectId(activeProjectId);
  }, [activeProjectId]);

  const open = Boolean(enabled && profile && !profile.onboardedAt && !dismissed);
  const isPending = createProject.isPending || updateProfile.isPending;
  const needsProject = !createdProjectId;

  const complete = async () => {
    if (!profile || submitGuardRef.current) return;
    const normalizedTitle = projectTitle.trim();
    if (needsProject && normalizedTitle.length < 2) {
      toast.error("Geef je verbouwing een herkenbare naam.");
      return;
    }

    submitGuardRef.current = true;
    setSaveError(null);
    let projectId = createdProjectId;
    let stage: "project" | "profile" = needsProject ? "project" : "profile";

    try {
      if (!projectId) {
        projectCommandRef.current ??= buildCreateProjectCommand({
          title: normalizedTitle,
          description: "",
          projectType,
          address: "",
          startDate: "",
          expectedEndDate: "",
          visibility: "private",
        }, createClientIdempotencyKey("project-onboarding"));
        const result = await createProject.mutateAsync(projectCommandRef.current);
        projectId = result.project.id;
        setCreatedProjectId(projectId);
        setRetryLocked(true);
        projectCommandRef.current = null;
      }

      stage = "profile";
      profileCommandRef.current ??= {
        idempotencyKey: createClientIdempotencyKey("profile-onboarding"),
        expectedVersion: profile.version,
        onboardingCompleted: true,
      };
      await updateProfile.mutateAsync(profileCommandRef.current);

      setDismissed(true);
      setRetryLocked(false);
      toast.success("Je verbouwing staat klaar.");
      const next = new URLSearchParams({ update: "nieuw" });
      if (new URLSearchParams(search).get("intent") === LANDING_PHOTO_INTENT) {
        next.set("intent", LANDING_PHOTO_INTENT);
      }
      navigate(`${PRODUCT_ROUTES.project(projectId)}?${next.toString()}`, { replace: true });
    } catch (error) {
      console.error("Onboarding completion failed", error);
      if (stage === "project") {
        const outcomeUncertain = !(error instanceof ApiClientError)
          || error.status >= 500
          || [408, 425, 429].includes(error.status);
        setRetryLocked(outcomeUncertain);
        if (!outcomeUncertain) projectCommandRef.current = null;
      } else {
        setRetryLocked(true);
        if (error instanceof ApiClientError && error.status === 409) {
          profileCommandRef.current = null;
        }
      }
      const message = stage === "profile" && projectId
        ? "Je verbouwing is veilig aangemaakt. Rond de laatste stap nog een keer af."
        : error instanceof ApiClientError
          ? error.message
          : "Je invoer staat nog klaar. Probeer het opnieuw.";
      setSaveError(message);
      toast.error(message);
    } finally {
      submitGuardRef.current = false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && !isPending) setDismissed(true);
    }}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        aria-describedby="onboarding-description"
      >
        <DialogHeader>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Welkom bij Buildy</p>
          <DialogTitle className="font-serif text-3xl font-normal leading-tight">
            {needsProject ? "Hoe heet je verbouwing?" : "Klaar voor je eerste Bouwmoment?"}
          </DialogTitle>
          <DialogDescription id="onboarding-description" className="leading-6">
            {needsProject
              ? "Een naam en eventueel een type zijn genoeg. Daarna voeg je meteen je eerste foto toe."
              : "Je verbouwing is veilig aangemaakt. Open nu de Bouwmoment-composer om je Verhaal te beginnen."}
          </DialogDescription>
        </DialogHeader>

        {needsProject ? (
          <div className="grid gap-5 py-2">
            <div className="grid gap-2">
              <Label htmlFor="onboarding-project-title">Hoe heet je verbouwing?</Label>
              <Input
                id="onboarding-project-title"
                autoFocus
                maxLength={80}
                minLength={2}
                placeholder="Bijv. Ons jaren-30 huis"
                value={projectTitle}
                onChange={(event) => setProjectTitle(event.target.value)}
                disabled={isPending || retryLocked}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="onboarding-project-type">Wat verbouw je? <span className="font-normal text-muted-foreground">(optioneel)</span></Label>
              <Select value={projectType} onValueChange={setProjectType} disabled={isPending || retryLocked}>
                <SelectTrigger id="onboarding-project-type"><SelectValue placeholder="Kies wat het beste past" /></SelectTrigger>
                <SelectContent>
                  {PROJECT_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-start gap-3 border-l-2 border-accent bg-muted/40 px-4 py-3 text-sm">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              <p><span className="font-semibold">Je begint privé.</span> Pas als jij een deellink maakt, kan iemand anders meekijken.</p>
            </div>
          </div>
        ) : null}

        {saveError ? <p className="text-sm text-destructive" role="status" aria-live="polite">{saveError}</p> : null}

        <DialogFooter className="gap-2 sm:space-x-0">
          <Button
            type="button"
            className="w-full sm:w-auto"
            disabled={isPending || (needsProject && projectTitle.trim().length < 2)}
            onClick={() => void complete()}
          >
            {isPending ? "Even bewaren…" : saveError ? "Opnieuw proberen" : needsProject ? "Verbouwing starten" : "Bouwmoment toevoegen"}
            {!isPending ? <ImagePlus className="h-4 w-4" aria-hidden="true" /> : null}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
