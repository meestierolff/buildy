import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { nl } from "date-fns/locale";
import { Flag, Loader2, LogIn, Reply, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { EngagementComment } from "../../shared/contracts/engagement";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import ReportDialog from "@/components/moderation/ReportDialog";
import { useAuth } from "@/hooks/useAuth";
import {
  useCreateCommentMutation,
  useDeleteCommentMutation,
  useInfiniteComments,
} from "@/hooks/useEngagement";
import { createClientIdempotencyKey } from "@/lib/clientIdempotency";
import { authPagePath } from "@/lib/authClient";
import { extractMentionSlugs } from "@/lib/engagementApi";
import { Link } from "@/lib/router";
import { resolveVisibleMentionSlugs } from "@/lib/socialApi";

interface CommentsSheetProps {
  projectId?: string;
  updateId: string;
  canComment?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCountChange?: (delta: number) => void;
}

function currentPagePath(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

const CommentsSheet = ({
  projectId,
  updateId,
  canComment = true,
  open,
  onOpenChange,
  onCountChange,
}: CommentsSheetProps) => {
  const { user } = useAuth();
  const available = Boolean(projectId && updateId);
  const canWrite = canComment && Boolean(user);
  const signInPath = authPagePath(currentPagePath());
  const commentsQuery = useInfiniteComments(projectId ?? "", updateId, open && available);
  const createComment = useCreateCommentMutation(projectId ?? "", updateId);
  const deleteComment = useDeleteCommentMutation(projectId ?? "", updateId);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<EngagementComment | null>(null);

  const comments = useMemo(
    () => commentsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [commentsQuery.data],
  );
  const commentIds = new Set(comments.map((comment) => comment.id));
  const roots = comments.filter((comment) =>
    !comment.parentCommentId || !commentIds.has(comment.parentCommentId));
  const repliesByParent = useMemo(() => {
    const grouped = new Map<string, EngagementComment[]>();
    for (const comment of comments) {
      if (!comment.parentCommentId) continue;
      const existing = grouped.get(comment.parentCommentId) ?? [];
      existing.push(comment);
      grouped.set(comment.parentCommentId, existing);
    }
    return grouped;
  }, [comments]);

  const submit = async () => {
    const body = text.trim();
    if (!user || !projectId || !body || createComment.isPending) return;
    if (body.length > 2_000) {
      toast.error("Een reactie mag maximaal 2000 tekens bevatten");
      return;
    }

    const slugs = extractMentionSlugs(body);
    if (slugs.length > 10) {
      toast.error("Je kunt maximaal 10 bouwers noemen");
      return;
    }
    if (slugs.some((slug) => slug.length < 2 || slug.length > 80)) {
      toast.error("Een gebruikersnaam na @ moet 2 tot 80 tekens bevatten");
      return;
    }

    try {
      const resolved = await resolveVisibleMentionSlugs(slugs);
      const unresolved = slugs.filter((slug) => !resolved.has(slug));
      if (unresolved.length > 0) {
        toast.error(`Onbekende of afgeschermde gebruiker: @${unresolved[0]}`);
        return;
      }
      await createComment.mutateAsync({
        idempotencyKey: createClientIdempotencyKey("comment-create"),
        body,
        ...(replyTo ? { parentCommentId: replyTo.id } : {}),
        mentionUserIds: slugs.map((slug) => resolved.get(slug)).filter((id): id is string => Boolean(id)),
      });
      setText("");
      setReplyTo(null);
      onCountChange?.(1);
    } catch (error) {
      console.error("Comment create failed", error);
      toast.error("Kon reactie niet plaatsen");
    }
  };

  const remove = async (comment: EngagementComment) => {
    if (!projectId || deleteComment.isPending) return;
    try {
      await deleteComment.mutateAsync({
        commentId: comment.id,
        input: {
          idempotencyKey: createClientIdempotencyKey("comment-delete"),
          expectedVersion: comment.version,
        },
      });
      if (replyTo?.id === comment.id) setReplyTo(null);
      onCountChange?.(-1);
      toast.success("Reactie verwijderd");
    } catch (error) {
      console.error("Comment delete failed", error);
      toast.error("Reactie verwijderen mislukt");
    }
  };

  const renderComment = (comment: EngagementComment, depth = 0) => (
    <div key={comment.id} className={`flex gap-2.5 ${depth > 0 ? "ml-6 mt-2" : "mt-3"}`}>
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarImage src={comment.author.avatar?.proxyPath ?? ""} alt="" />
        <AvatarFallback className="bg-accent/20 text-accent text-xs">
          {comment.author.displayName[0]?.toUpperCase() ?? "?"}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="bg-muted/50 rounded-2xl px-3 py-2">
          <p className="text-xs font-semibold mb-0.5">{comment.author.displayName}</p>
          <p className="text-sm leading-snug whitespace-pre-wrap break-words">{comment.body}</p>
        </div>
        <div className="flex items-center gap-3 mt-1 px-2 text-[11px] text-muted-foreground">
          <span>{formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true, locale: nl })}</span>
          {canWrite && (
            <button
              type="button"
              onClick={() => setReplyTo(comment)}
              className="hover:text-accent flex items-center gap-1"
              aria-label={`Antwoord op ${comment.author.displayName}`}
            >
              <Reply className="h-3 w-3" aria-hidden="true" /> Antwoord
            </button>
          )}
          {canWrite && comment.canDelete && (
            <button
              type="button"
              onClick={() => remove(comment)}
              disabled={deleteComment.isPending}
              className="hover:text-destructive flex items-center gap-1"
              aria-label={`Reactie van ${comment.author.displayName} verwijderen`}
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
          <ReportDialog
            compact
            targetType="comment"
            targetId={comment.id}
            targetLabel={`Reactie van ${comment.author.displayName}`}
            trigger={(
              <button
                type="button"
                className="flex min-h-11 items-center gap-1 hover:text-destructive"
                aria-label={`Reactie van ${comment.author.displayName} melden`}
              >
                <Flag className="h-3 w-3" aria-hidden="true" /> Melden
              </button>
            )}
          />
        </div>
        {(repliesByParent.get(comment.id) ?? []).map((reply) => renderComment(reply, depth + 1))}
      </div>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
        <SheetHeader>
          <SheetTitle>Reacties</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto -mx-2 px-2">
          {!available ? (
            <p className="text-sm text-muted-foreground text-center py-8" role="status">
              Reacties zijn voor deze update niet beschikbaar.
            </p>
          ) : commentsQuery.isPending ? (
            <p className="text-sm text-muted-foreground text-center py-8 flex items-center justify-center gap-2" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Reacties laden…
            </p>
          ) : commentsQuery.isError ? (
            <div className="text-center py-8 space-y-3" role="alert">
              <p className="text-sm text-muted-foreground">Reacties konden niet worden geladen.</p>
              <Button type="button" size="sm" variant="outline" onClick={() => commentsQuery.refetch()}>
                Opnieuw proberen
              </Button>
            </div>
          ) : roots.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Wees de eerste die reageert.</p>
          ) : (
            <>
              {roots.map((comment) => renderComment(comment))}
              {commentsQuery.hasNextPage && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="w-full mt-4"
                  disabled={commentsQuery.isFetchingNextPage}
                  onClick={() => commentsQuery.fetchNextPage()}
                >
                  {commentsQuery.isFetchingNextPage ? "Meer laden…" : "Meer reacties laden"}
                </Button>
              )}
            </>
          )}
        </div>
        {available && !user ? (
          <div className="mt-2 space-y-3 border-t pt-4 text-center">
            <div>
              <p className="text-sm font-semibold text-foreground">Praat mee over dit Bouwmoment</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Log in om te reageren. Daarna kom je terug bij deze gedeelde verbouwing.
              </p>
            </div>
            <Button asChild type="button" size="sm" className="min-h-11 w-full gap-2">
              <Link to={signInPath}>
                <LogIn className="h-4 w-4" aria-hidden="true" /> Inloggen
              </Link>
            </Button>
          </div>
        ) : available && !canComment ? (
          <p className="border-t pt-3 text-center text-xs text-muted-foreground">
            Reageren is voor jou niet beschikbaar.
          </p>
        ) : available && user ? (
          <div className="border-t pt-3 mt-2 space-y-2">
            {replyTo && (
              <div className="text-xs text-muted-foreground flex items-center justify-between bg-muted/50 px-2 py-1 rounded">
                <span>Antwoord op {replyTo.author.displayName}</span>
                <button type="button" onClick={() => setReplyTo(null)} className="text-accent" aria-label="Antwoord annuleren">×</button>
              </div>
            )}
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Schrijf een reactie… gebruik @gebruikersnaam om iemand te noemen"
              aria-label="Nieuwe reactie"
              rows={2}
              maxLength={2_000}
            />
            <p className="text-right text-[10px] tabular-nums text-muted-foreground">{text.length}/2000</p>
            <Button
              type="button"
              onClick={submit}
              disabled={createComment.isPending || !text.trim()}
              size="sm"
              className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
            >
              {createComment.isPending ? "Plaatsen…" : "Plaatsen"}
            </Button>
          </div>
        ) : available ? (
          <p className="text-xs text-center text-muted-foreground border-t pt-3">Log in om te reageren.</p>
        ) : null}
      </SheetContent>
    </Sheet>
  );
};

export default CommentsSheet;
