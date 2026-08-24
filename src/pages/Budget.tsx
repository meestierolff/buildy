import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Loader2,
  LockKeyhole,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type { BudgetItem, ProjectBudget } from "../../shared/contracts/planning";
import EmptyState from "@/components/EmptyState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import {
  useCreateBudgetItem,
  useCreateProjectBudget,
  useDeleteBudgetItem,
  useDeleteProjectBudget,
  useProjectBudget,
  useUpdateBudgetItem,
  useUpdateProjectBudget,
} from "@/hooks/usePlanning";
import { ApiClientError } from "@/lib/apiClient";
import {
  createPlanningIdempotencyKey,
  formatMinorCurrency,
  minorToEuroInput,
  parseEuroInputToMinor,
} from "@/lib/planningApi";
import { Link, useParams } from "@/lib/router";
import { toast } from "sonner";

function mutationMessage(error: Error | null): string {
  if (error instanceof ApiClientError && error.status === 409) {
    return "De begroting is intussen gewijzigd. De nieuwste versie wordt opgehaald.";
  }
  return error?.message || "Opslaan is niet gelukt. Probeer het opnieuw.";
}

function MutationError({ error, onRetry }: { error: Error | null; onRetry?: () => void }) {
  if (!error) return null;
  const isConflict = error instanceof ApiClientError && error.status === 409;
  return (
    <Alert variant="destructive" className="mt-4">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Wijziging niet opgeslagen</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{mutationMessage(error)}</span>
        {onRetry && !isConflict && (
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" /> Opnieuw proberen
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

function BudgetItemRow({
  projectId,
  currency,
  item,
}: {
  projectId: string;
  currency: string;
  item: BudgetItem;
}) {
  const updateItem = useUpdateBudgetItem(projectId);
  const deleteItem = useDeleteBudgetItem(projectId);
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<BudgetItem["kind"]>(item.kind);
  const [category, setCategory] = useState(item.category);
  const [description, setDescription] = useState(item.description ?? "");
  const [amount, setAmount] = useState(minorToEuroInput(item.amountMinor));
  const [occurredOn, setOccurredOn] = useState(item.occurredOn ?? "");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (editing) return;
    setKind(item.kind);
    setCategory(item.category);
    setDescription(item.description ?? "");
    setAmount(minorToEuroInput(item.amountMinor));
    setOccurredOn(item.occurredOn ?? "");
  }, [editing, item]);

  const save = (event: FormEvent) => {
    event.preventDefault();
    const amountMinor = parseEuroInputToMinor(amount);
    if (!category.trim()) {
      setValidationError("Vul een categorie in.");
      return;
    }
    if (amountMinor === null) {
      setValidationError("Vul een geldig bedrag met maximaal twee decimalen in.");
      return;
    }
    setValidationError(null);
    updateItem.mutate({
      projectId,
      itemId: item.id,
      input: {
        idempotencyKey: createPlanningIdempotencyKey("budget-item-update"),
        expectedVersion: item.version,
        kind,
        category: category.trim(),
        description: description.trim() || null,
        amountMinor,
        occurredOn: occurredOn || null,
        sortOrder: item.sortOrder,
      },
    }, {
      onSuccess: () => {
        setEditing(false);
        toast.success("Budgetpost bijgewerkt");
      },
      onError: (error) => {
        console.error("Update budget item failed", error);
        toast.error(mutationMessage(error));
      },
    });
  };

  const remove = () => {
    deleteItem.mutate({
      projectId,
      itemId: item.id,
      input: {
        idempotencyKey: createPlanningIdempotencyKey("budget-item-delete"),
        expectedVersion: item.version,
      },
    }, {
      onSuccess: () => toast.success("Budgetpost verwijderd"),
      onError: (error) => {
        console.error("Delete budget item failed", error);
        toast.error(mutationMessage(error));
      },
    });
  };

  if (editing) {
    return (
      <li className="border-b border-border py-6 last:border-0">
        <form onSubmit={save} className="grid gap-4" aria-label={`Bewerk ${item.category}`}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`kind-${item.id}`}>Soort</Label>
              <select
                id={`kind-${item.id}`}
                value={kind}
                onChange={(event) => setKind(event.target.value as BudgetItem["kind"])}
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="planned">Gepland</option>
                <option value="actual">Werkelijk</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`amount-${item.id}`}>Bedrag in euro</Label>
              <Input
                id={`amount-${item.id}`}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                autoComplete="off"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`category-${item.id}`}>Categorie</Label>
              <Input
                id={`category-${item.id}`}
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                maxLength={80}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`date-${item.id}`}>Datum, optioneel</Label>
              <Input
                id={`date-${item.id}`}
                type="date"
                value={occurredOn}
                onChange={(event) => setOccurredOn(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`description-${item.id}`}>Toelichting, optioneel</Label>
            <Input
              id={`description-${item.id}`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
            />
          </div>
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={updateItem.isPending}>
              {updateItem.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Opslaan
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={updateItem.isPending}>
              <X className="mr-2 h-4 w-4" /> Annuleren
            </Button>
          </div>
          <MutationError
            error={updateItem.error}
            onRetry={updateItem.variables ? () => updateItem.mutate(updateItem.variables) : undefined}
          />
        </form>
      </li>
    );
  }

  return (
    <li className="border-b border-border py-5 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{item.category}</p>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {item.kind === "actual" ? "Werkelijk" : "Gepland"}
            </span>
          </div>
          {item.description && <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>}
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {item.occurredOn && (
              <time dateTime={item.occurredOn}>
                {new Date(`${item.occurredOn}T00:00:00`).toLocaleDateString("nl-NL")}
              </time>
            )}
            {item.updateId && <span>Gekoppeld aan Bouwmoment</span>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-serif text-2xl italic tabular-nums">
            {formatMinorCurrency(item.amountMinor, currency)}
          </p>
          <div className="mt-2 flex justify-end gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" /> Bewerk
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Verwijder
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Budgetpost verwijderen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    “{item.category}” wordt definitief uit je budget verwijderd.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuleren</AlertDialogCancel>
                  <AlertDialogAction onClick={remove} disabled={deleteItem.isPending}>
                    Verwijderen
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
      <MutationError
        error={deleteItem.error}
        onRetry={deleteItem.variables ? () => deleteItem.mutate(deleteItem.variables) : undefined}
      />
    </li>
  );
}

function NewBudgetItemForm({ projectId, budget }: { projectId: string; budget: ProjectBudget }) {
  const createItem = useCreateBudgetItem(projectId);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<BudgetItem["kind"]>("actual");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const amountMinor = parseEuroInputToMinor(amount);
    if (!category.trim()) {
      setValidationError("Vul een categorie in.");
      return;
    }
    if (amountMinor === null) {
      setValidationError("Vul een geldig bedrag met maximaal twee decimalen in.");
      return;
    }
    setValidationError(null);
    createItem.mutate({
      projectId,
      input: {
        idempotencyKey: createPlanningIdempotencyKey("budget-item-create"),
        kind,
        category: category.trim(),
        description: description.trim() || undefined,
        amountMinor,
        occurredOn: occurredOn || undefined,
        sortOrder: Math.max(-1, ...budget.items.map((item) => item.sortOrder)) + 1,
      },
    }, {
      onSuccess: () => {
        setCategory("");
        setDescription("");
        setAmount("");
        setOccurredOn("");
        setOpen(false);
        toast.success("Budgetpost toegevoegd");
      },
      onError: (error) => {
        console.error("Create budget item failed", error);
        toast.error(mutationMessage(error));
      },
    });
  };

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" /> Budgetpost toevoegen
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-border bg-muted/30 p-5" aria-label="Nieuwe budgetpost">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="new-budget-kind">Soort</Label>
          <select
            id="new-budget-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as BudgetItem["kind"])}
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="actual">Werkelijk</option>
            <option value="planned">Gepland</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-budget-amount">Bedrag in euro</Label>
          <Input
            id="new-budget-amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="Bijv. 1250,00"
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-budget-category">Categorie</Label>
          <Input
            id="new-budget-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            placeholder="Bijv. Keuken"
            maxLength={80}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-budget-date">Datum, optioneel</Label>
          <Input
            id="new-budget-date"
            type="date"
            value={occurredOn}
            onChange={(event) => setOccurredOn(event.target.value)}
          />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <Label htmlFor="new-budget-description">Toelichting, optioneel</Label>
        <Input
          id="new-budget-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={500}
        />
      </div>
      {validationError && <p role="alert" className="mt-3 text-sm text-destructive">{validationError}</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="submit" disabled={createItem.isPending}>
          {createItem.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Toevoegen
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={createItem.isPending}>
          Annuleren
        </Button>
      </div>
      <MutationError
        error={createItem.error}
        onRetry={createItem.variables ? () => createItem.mutate(createItem.variables) : undefined}
      />
    </form>
  );
}

const Budget = () => {
  const { id = "" } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const budgetQuery = useProjectBudget(id, Boolean(user));
  const createBudget = useCreateProjectBudget(id);
  const updateBudget = useUpdateProjectBudget(id);
  const deleteBudget = useDeleteProjectBudget(id);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState("");
  const [budgetValidationError, setBudgetValidationError] = useState<string | null>(null);

  usePageMeta({
    title: "Budget van je verbouwing — Buildy",
    description: "Beheer je privébegroting en werkelijke verbouwingskosten in Buildy.",
    path: id ? `/project/${id}/budget` : undefined,
    noIndex: true,
  });

  const budget = budgetQuery.data;
  const isUnavailable = budgetQuery.error instanceof ApiClientError
    && budgetQuery.error.status === 404;
  const actualPercentage = useMemo(() => {
    if (!budget?.plannedAmountMinor) return 0;
    return Math.min(100, (budget.totals.actualAmountMinor / budget.plannedAmountMinor) * 100);
  }, [budget]);

  const submitBudget = (event: FormEvent) => {
    event.preventDefault();
    const plannedAmountMinor = parseEuroInputToMinor(budgetDraft);
    if (plannedAmountMinor === null) {
      setBudgetValidationError("Vul een geldig bedrag met maximaal twee decimalen in.");
      return;
    }
    setBudgetValidationError(null);
    if (budget) {
      updateBudget.mutate({
        projectId: id,
        input: {
          idempotencyKey: createPlanningIdempotencyKey("budget-update"),
          expectedVersion: budget.version,
          plannedAmountMinor,
        },
      }, {
        onSuccess: () => {
          setEditingBudget(false);
          toast.success("Budget bijgewerkt");
        },
        onError: (error) => {
          console.error("Update project budget failed", error);
          toast.error(mutationMessage(error));
        },
      });
      return;
    }

    createBudget.mutate({
      projectId: id,
      input: {
        idempotencyKey: createPlanningIdempotencyKey("budget-create"),
        plannedAmountMinor,
      },
    }, {
      onSuccess: () => {
        setEditingBudget(false);
        toast.success("Budget ingesteld");
      },
      onError: (error) => {
        console.error("Create project budget failed", error);
        toast.error(mutationMessage(error));
      },
    });
  };

  const removeBudget = () => {
    if (!budget) return;
    deleteBudget.mutate({
      projectId: id,
      input: {
        idempotencyKey: createPlanningIdempotencyKey("budget-delete"),
        expectedVersion: budget.version,
      },
    }, {
      onSuccess: () => toast.success("Budget verwijderd"),
      onError: (error) => {
        console.error("Delete project budget failed", error);
        toast.error(mutationMessage(error));
      },
    });
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Account laden</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6">
        <EmptyState
          icon={LockKeyhole}
          title="Log in voor je budget"
          description="Budgetinformatie is uitsluitend zichtbaar voor de eigenaar van de verbouwing."
          action={<Button asChild><Link to={`/auth?next=${encodeURIComponent(`/project/${id}/budget`)}`}>Inloggen</Link></Button>}
        />
      </div>
    );
  }

  if (budgetQuery.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center gap-3 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-5 w-5 animate-spin" /> Privébudget laden
      </div>
    );
  }

  if (budgetQuery.error && !isUnavailable) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-xl items-center px-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Budget kon niet worden geladen</AlertTitle>
          <AlertDescription>
            <p>{budgetQuery.error.message}</p>
            <Button type="button" variant="outline" className="mt-4" onClick={() => budgetQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Opnieuw proberen
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!budget) {
    const mutation = createBudget;
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-2xl px-6 py-12 md:px-8 md:py-16">
          <Link to={`/project/${id}`} className="mb-10 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Terug naar verbouwing
          </Link>
          <p className="eyebrow mb-3">Privébudget</p>
          <h1 className="font-serif text-4xl italic leading-tight md:text-5xl">Begin met een helder bedrag.</h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Er is geen budget beschikbaar of je hebt geen toegang. Alleen de eigenaar van de verbouwing kan een budget aanmaken en bekijken.
          </p>
          <form onSubmit={submitBudget} className="mt-10 rounded-xl border border-border p-6">
            <Label htmlFor="initial-budget">Totaal verbouwingsbudget in euro</Label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <Input
                id="initial-budget"
                value={budgetDraft}
                onChange={(event) => setBudgetDraft(event.target.value)}
                inputMode="decimal"
                placeholder="Bijv. 50000,00"
                autoComplete="off"
                autoFocus
              />
              <Button type="submit" disabled={mutation.isPending || !id}>
                {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Budget instellen
              </Button>
            </div>
            {budgetValidationError && <p role="alert" className="mt-3 text-sm text-destructive">{budgetValidationError}</p>}
            <MutationError
              error={mutation.error}
              onRetry={mutation.variables ? () => mutation.mutate(mutation.variables) : undefined}
            />
          </form>
        </main>
      </div>
    );
  }

  const overBudget = budget.totals.remainingAmountMinor < 0;
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl px-6 py-12 md:px-8 md:py-16">
        <Link to={`/project/${id}`} className="mb-10 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Terug naar verbouwing
        </Link>

        <header className="mb-12">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="eyebrow mb-3">Privébudget · EUR</p>
              <h1 className="font-serif text-4xl italic leading-tight md:text-5xl">Wat de verbouwing kost.</h1>
              <p className="mt-3 text-sm text-muted-foreground">Alle bedragen worden exact in eurocenten opgeslagen.</p>
            </div>
            {budgetQuery.isFetching && (
              <span className="inline-flex items-center gap-2 text-xs text-muted-foreground" role="status">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Vernieuwen
              </span>
            )}
          </div>
        </header>

        <section className="border-t border-border pt-10" aria-labelledby="budget-overview-title">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h2 id="budget-overview-title" className="text-[11px] font-bold uppercase tracking-[0.2em]">Verbouwingsbudget</h2>
            <div className="flex gap-1">
              {!editingBudget && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setBudgetDraft(minorToEuroInput(budget.plannedAmountMinor));
                    setEditingBudget(true);
                  }}
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" /> Wijzig
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Verwijder budget
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Hele budget verwijderen?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Het verbouwingsbudget en alle budgetposten worden definitief verwijderd.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuleren</AlertDialogCancel>
                    <AlertDialogAction onClick={removeBudget} disabled={deleteBudget.isPending}>
                      Budget verwijderen
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          {editingBudget ? (
            <form onSubmit={submitBudget} className="max-w-lg">
              <Label htmlFor="edit-budget">Totaal verbouwingsbudget in euro</Label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <Input
                  id="edit-budget"
                  value={budgetDraft}
                  onChange={(event) => setBudgetDraft(event.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  autoFocus
                />
                <Button type="submit" disabled={updateBudget.isPending}>
                  {updateBudget.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                  Opslaan
                </Button>
                <Button type="button" variant="ghost" onClick={() => setEditingBudget(false)} disabled={updateBudget.isPending}>
                  Annuleren
                </Button>
              </div>
              {budgetValidationError && <p role="alert" className="mt-3 text-sm text-destructive">{budgetValidationError}</p>}
              <MutationError
                error={updateBudget.error}
                onRetry={updateBudget.variables ? () => updateBudget.mutate(updateBudget.variables) : undefined}
              />
            </form>
          ) : (
            <div>
              <div className="grid gap-8 sm:grid-cols-3">
                <div>
                  <p className="eyebrow mb-2">Begroot</p>
                  <p className="font-serif text-4xl italic tabular-nums">
                    {formatMinorCurrency(budget.plannedAmountMinor, budget.currency)}
                  </p>
                </div>
                <div>
                  <p className="eyebrow mb-2">Werkelijk</p>
                  <p className="font-serif text-4xl italic tabular-nums">
                    {formatMinorCurrency(budget.totals.actualAmountMinor, budget.currency)}
                  </p>
                </div>
                <div>
                  <p className="eyebrow mb-2">{overBudget ? "Overschrijding" : "Resterend"}</p>
                  <p className={`font-serif text-4xl italic tabular-nums ${overBudget ? "text-destructive" : "text-accent"}`}>
                    {formatMinorCurrency(Math.abs(budget.totals.remainingAmountMinor), budget.currency)}
                  </p>
                </div>
              </div>
              <div
                className="mt-7 h-1 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label="Werkelijk besteed budget"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(actualPercentage)}
              >
                <div
                  className={`h-full transition-[width] ${overBudget ? "bg-destructive" : "bg-accent"}`}
                  style={{ width: `${actualPercentage}%` }}
                />
              </div>
              <div className="mt-2 flex justify-between text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                <span>{Math.round(actualPercentage)}% gebruikt</span>
                <span>{formatMinorCurrency(budget.totals.allocatedAmountMinor, budget.currency)} verdeeld over geplande posten</span>
              </div>
            </div>
          )}
          <MutationError
            error={deleteBudget.error}
            onRetry={deleteBudget.variables ? () => deleteBudget.mutate(deleteBudget.variables) : undefined}
          />
        </section>

        <section className="mt-16 border-t border-border pt-10" aria-labelledby="budget-items-title">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="budget-items-title" className="text-[11px] font-bold uppercase tracking-[0.2em]">Budgetposten</h2>
              <p className="mt-2 text-sm text-muted-foreground">Planning en werkelijke kosten, door de server opgeteld.</p>
            </div>
            <NewBudgetItemForm projectId={id} budget={budget} />
          </div>

          {budget.items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
              <ReceiptText className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 font-medium">Nog geen budgetposten</p>
              <p className="mt-1 text-sm text-muted-foreground">Voeg een gepland of werkelijk bedrag toe.</p>
            </div>
          ) : (
            <ul>
              {budget.items.map((item) => (
                <BudgetItemRow key={item.id} projectId={id} currency={budget.currency} item={item} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
};

export default Budget;
