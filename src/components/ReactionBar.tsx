import { useEffect, useState } from "react";
import { Smile } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const EMOJIS = ["👍", "❤️", "🔥", "🎉", "👏", "😍"];

interface Reaction {
  id: string;
  emoji: string;
  user_id: string;
}

const ReactionBar = ({ stepId }: { stepId: string }) => {
  const { user } = useAuth();
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [busyEmoji, setBusyEmoji] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase.from("reactions").select("id, emoji, user_id").eq("step_id", stepId);
    if (error) console.error("Reactions load failed:", error);
    setReactions(data || []);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId]);

  const grouped = reactions.reduce<Record<string, Reaction[]>>((acc, r) => {
    (acc[r.emoji] ||= []).push(r);
    return acc;
  }, {});

  const toggle = async (emoji: string) => {
    if (!user) {
      toast.error("Log in om te reageren");
      return;
    }
    if (busyEmoji) return;
    setBusyEmoji(emoji);
    const mine = reactions.find((r) => r.emoji === emoji && r.user_id === user.id);
    if (mine) {
      const { error } = await supabase.from("reactions").delete().eq("id", mine.id);
      if (error) {
        console.error("Reaction delete failed:", error);
        toast.error("Reactie bijwerken mislukt");
      } else {
        setReactions((p) => p.filter((r) => r.id !== mine.id));
      }
    } else {
      const { data, error } = await supabase
        .from("reactions")
        .insert({ step_id: stepId, user_id: user.id, emoji })
        .select()
        .single();
      if (error) {
        console.error("Reaction insert failed:", error);
        toast.error("Reactie plaatsen mislukt");
      }
      if (data) setReactions((p) => [...p, data]);
    }
    setBusyEmoji(null);
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {Object.entries(grouped).map(([emoji, rs]) => {
        const mine = !!user && rs.some((r) => r.user_id === user.id);
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => toggle(emoji)}
            disabled={busyEmoji === emoji}
            aria-label={`${mine ? "Verwijder" : "Plaats"} reactie ${emoji}, ${rs.length}`}
            className={`text-xs px-2 py-0.5 rounded-full border transition-colors flex items-center gap-1 ${
              mine ? "bg-accent/15 border-accent/40 text-accent" : "bg-muted/50 border-border hover:bg-muted"
            }`}
          >
            <span>{emoji}</span>
            <span className="font-medium">{rs.length}</span>
          </button>
        );
      })}
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label="Reactie kiezen" className="text-xs h-6 w-6 rounded-full border border-dashed border-border text-muted-foreground hover:text-accent hover:border-accent flex items-center justify-center">
            <Smile className="h-3 w-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <div className="flex gap-1">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => toggle(e)}
                disabled={busyEmoji === e}
                aria-label={`Reageer met ${e}`}
                className="text-lg hover:scale-125 transition-transform p-1"
              >
                {e}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default ReactionBar;
