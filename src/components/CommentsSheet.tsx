import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDistanceToNow } from "date-fns";
import { nl } from "date-fns/locale";
import { Reply, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Comment {
  id: string;
  content: string;
  user_id: string;
  parent_id: string | null;
  created_at: string;
  mentions: string[] | null;
  profile?: { display_name: string; avatar_url?: string | null };
}

const CommentsSheet = ({
  stepId,
  open,
  onOpenChange,
  onCountChange,
  canModerate = false,
}: {
  stepId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCountChange?: (delta: number) => void;
  canModerate?: boolean;
}) => {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [posting, setPosting] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("comments")
      .select("*")
      .eq("step_id", stepId)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("Comments load failed:", error);
      toast.error("Reacties laden mislukt");
      return;
    }
    if (!data) return;
    const ids = [...new Set(data.map((c) => c.user_id))];
    const { data: profs, error: profilesError } = await supabase.rpc("get_profiles_basic", { _ids: ids });
    if (profilesError) console.error("Comment profiles load failed:", profilesError);
    const map = new Map((profs || []).map((p) => [p.user_id, p]));
    setComments(data.map((c) => ({ ...c, profile: map.get(c.user_id) })));
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stepId]);

  const submit = async () => {
    if (!user || !text.trim()) return;
    if (text.trim().length > 2000) {
      toast.error("Een reactie mag maximaal 2000 tekens bevatten");
      return;
    }
    setPosting(true);
    // parse @mentions: @display_name → look up in profiles
    const mentionTags = Array.from(text.matchAll(/@(\w[\w-]*)/g)).map((m) => m[1]);
    let mentions: string[] = [];
    if (mentionTags.length) {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("display_name", mentionTags);
      mentions = (data || []).map((p) => p.user_id);
    }
    try {
      const { error } = await supabase.from("comments").insert({
        step_id: stepId,
        user_id: user.id,
        content: text.trim(),
        parent_id: replyTo?.id ?? null,
        mentions,
      });
      if (error) {
        console.error("Comment insert failed:", error);
        toast.error("Kon reactie niet plaatsen");
      } else {
        setText("");
        setReplyTo(null);
        onCountChange?.(1);
        await load();
      }
    } finally {
      setPosting(false);
    }
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("comments").delete().eq("id", id);
    if (error) {
      console.error("Comment delete failed:", error);
      toast.error("Reactie verwijderen mislukt");
      return;
    }
    const removedCount = comments.filter((comment) => comment.id === id || comment.parent_id === id).length;
    onCountChange?.(-Math.max(1, removedCount));
    setComments((p) => p.filter((c) => c.id !== id && c.parent_id !== id));
  };

  const roots = comments.filter((c) => !c.parent_id);
  const repliesOf = (id: string) => comments.filter((c) => c.parent_id === id);

  const renderComment = (c: Comment, isReply = false) => (
    <div key={c.id} className={`flex gap-2.5 ${isReply ? "ml-9 mt-2" : "mt-3"}`}>
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarImage src={c.profile?.avatar_url ?? ""} />
        <AvatarFallback className="bg-accent/20 text-accent text-xs">
          {c.profile?.display_name?.[0]?.toUpperCase() ?? "?"}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="bg-muted/50 rounded-2xl px-3 py-2">
          <p className="text-xs font-semibold mb-0.5">{c.profile?.display_name ?? "Gebruiker"}</p>
          <p className="text-sm leading-snug whitespace-pre-wrap">{c.content}</p>
        </div>
        <div className="flex items-center gap-3 mt-1 px-2 text-[11px] text-muted-foreground">
          <span>{formatDistanceToNow(new Date(c.created_at), { addSuffix: true, locale: nl })}</span>
          {!isReply && (
            <button type="button" onClick={() => setReplyTo(c)} className="hover:text-accent flex items-center gap-1" aria-label={`Antwoord op ${c.profile?.display_name ?? "reactie"}`}>
              <Reply className="h-3 w-3" /> Antwoord
            </button>
          )}
          {(user?.id === c.user_id || canModerate) && (
            <button type="button" onClick={() => remove(c.id)} className="hover:text-destructive flex items-center gap-1" aria-label="Reactie verwijderen">
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
        {!isReply && repliesOf(c.id).map((r) => renderComment(r, true))}
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
          {roots.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Wees de eerste die reageert.</p>
          ) : (
            roots.map((c) => renderComment(c))
          )}
        </div>
        {user ? (
          <div className="border-t pt-3 mt-2 space-y-2">
            {replyTo && (
              <div className="text-xs text-muted-foreground flex items-center justify-between bg-muted/50 px-2 py-1 rounded">
                <span>Antwoord op {replyTo.profile?.display_name}</span>
                <button type="button" onClick={() => setReplyTo(null)} className="text-accent" aria-label="Antwoord annuleren">×</button>
              </div>
            )}
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Schrijf een reactie... gebruik @naam om iemand te taggen"
              rows={2}
              maxLength={2000}
            />
            <p className="text-right text-[10px] tabular-nums text-muted-foreground">{text.length}/2000</p>
            <Button onClick={submit} disabled={posting || !text.trim()} size="sm" className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
              Plaatsen
            </Button>
          </div>
        ) : (
          <p className="text-xs text-center text-muted-foreground border-t pt-3">Log in om te reageren.</p>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default CommentsSheet;
