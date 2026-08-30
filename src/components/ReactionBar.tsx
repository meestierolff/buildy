import { LogIn, Smile } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/hooks/useAuth";
import { useReactionMutation, useReactionSummary } from "@/hooks/useEngagement";
import { authPagePath } from "@/lib/authClient";
import { Link } from "@/lib/router";
import type { SupportedReactionEmoji } from "../../shared/contracts/engagement";
import { toast } from "sonner";

const EMOJIS: readonly SupportedReactionEmoji[] = ["👍", "❤️", "🔥", "👏", "🔨"];

function currentPagePath(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

interface ReactionBarProps {
  projectId?: string;
  updateId: string;
  canReact?: boolean;
}

const ReactionBar = ({ projectId, updateId, canReact = true }: ReactionBarProps) => {
  const { user } = useAuth();
  const available = Boolean(projectId && updateId);
  const canMutate = canReact && Boolean(user);
  const signInPath = authPagePath(currentPagePath());
  const reactions = useReactionSummary(projectId ?? "", updateId, available);
  const mutation = useReactionMutation(projectId ?? "", updateId);

  const toggle = async (emoji: SupportedReactionEmoji, viewerReacted: boolean) => {
    if (!user) {
      toast.error("Log in met Google om te reageren");
      return;
    }
    if (!projectId || mutation.isPending) return;

    try {
      await mutation.mutateAsync({
        action: viewerReacted ? "remove" : "add",
        input: { target: "update", emoji },
      });
    } catch (error) {
      console.error("Reaction update failed", error);
      toast.error("Reactie bijwerken mislukt");
    }
  };

  if (!available) {
    return <span className="text-xs text-muted-foreground">Reacties niet beschikbaar</span>;
  }

  if (reactions.isPending) {
    return <span className="text-xs text-muted-foreground" role="status">Reacties laden…</span>;
  }

  if (reactions.isError) {
    return (
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <span role="alert">Reacties laden mislukt.</span>
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={() => reactions.refetch()}
        >
          Opnieuw
        </button>
      </span>
    );
  }

  const items = reactions.data?.items ?? [];
  const byEmoji = new Map(items.map((item) => [item.emoji, item]));

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {items.map((item) => canMutate ? (
        <button
          key={item.emoji}
          type="button"
          onClick={() => toggle(item.emoji, item.viewerReacted)}
          disabled={mutation.isPending}
          aria-label={`${item.viewerReacted ? "Verwijder" : "Plaats"} reactie ${item.emoji}, ${item.count}`}
          aria-pressed={item.viewerReacted}
          className={`text-xs px-2 py-0.5 rounded-full border transition-colors flex items-center gap-1 ${
            item.viewerReacted
              ? "bg-accent/15 border-accent/40 text-accent"
              : "bg-muted/50 border-border hover:bg-muted"
          }`}
        >
          <span aria-hidden="true">{item.emoji}</span>
          <span className="font-medium">{item.count}</span>
        </button>
      ) : (
        <span
          key={item.emoji}
          className="flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs"
          aria-label={`Reactie ${item.emoji}, ${item.count}`}
        >
          <span aria-hidden="true">{item.emoji}</span>
          <span className="font-medium">{item.count}</span>
        </span>
      ))}
      {canMutate ? <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Reactie kiezen"
            className="text-xs h-6 w-6 rounded-full border border-dashed border-border text-muted-foreground hover:text-accent hover:border-accent flex items-center justify-center"
          >
            <Smile className="h-3 w-3" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <div className="flex gap-1" aria-label="Kies een reactie">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => toggle(emoji, byEmoji.get(emoji)?.viewerReacted ?? false)}
                disabled={mutation.isPending}
                aria-label={`Reageer met ${emoji}`}
                aria-pressed={byEmoji.get(emoji)?.viewerReacted ?? false}
                className="text-lg hover:scale-125 transition-transform p-1"
              >
                {emoji}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover> : !user ? (
        <Link
          to={signInPath}
          aria-label="Inloggen met Google om te reageren"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-accent/45 px-3 text-xs font-semibold text-accent transition-colors hover:border-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
          Inloggen met Google
        </Link>
      ) : null}
    </div>
  );
};

export default ReactionBar;
