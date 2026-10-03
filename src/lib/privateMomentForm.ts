import type { UpdatePrivateDetails } from "../../shared/contracts/projects";

export class PrivateMomentInputError extends Error {}

export type PrivateMomentDraft = { notes: string; cost: string; ownHours: string; contractorHours: string };
export function privateMomentDraft(details?: UpdatePrivateDetails): PrivateMomentDraft {
  return { notes: details?.notes ?? "", cost: details?.costAmountMinor ? String(details.costAmountMinor / 100) : "",
    ownHours: details?.ownMinutes ? String(details.ownMinutes / 60) : "",
    contractorHours: details?.contractorMinutes ? String(details.contractorMinutes / 60) : "" };
}
export function parsePrivateNumber(value: string, factor: number, maximum: number): number {
  if (!value.trim()) return 0;
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new PrivateMomentInputError("Vul een positief bedrag of aantal uren in.");
  const result = Math.round(Number(normalized) * factor);
  if (!Number.isSafeInteger(result) || result > maximum) throw new PrivateMomentInputError("Dit bedrag of aantal uren is te groot.");
  return result;
}
export function privateMomentInput(draft: PrivateMomentDraft): UpdatePrivateDetails {
  return { notes: draft.notes.trim() || null, costAmountMinor: parsePrivateNumber(draft.cost, 100, 2_000_000_000),
    ownMinutes: parsePrivateNumber(draft.ownHours, 60, 6_000_000),
    contractorMinutes: parsePrivateNumber(draft.contractorHours, 60, 6_000_000) };
}
