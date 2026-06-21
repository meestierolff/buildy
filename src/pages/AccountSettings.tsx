import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { toast } from "sonner";
import { Loader2, KeyRound, Trash2, Mail } from "lucide-react";
import { usePageMeta } from "@/hooks/usePageMeta";

const AccountSettings = () => {
  usePageMeta({
    title: "Account & instellingen — Buildy",
    description: "Beheer je wachtwoord en account.",
    path: "/account",
    noIndex: true,
  });
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState("");

  if (!user) {
    return (
      <div className="container py-20 text-center">
        <p className="text-muted-foreground">Log eerst in om je account te beheren.</p>
      </div>
    );
  }

  const handleResetMail = async () => {
    if (!user.email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/wachtwoord-resetten`,
    });
    if (error) toast.error("Kon geen reset-mail sturen.");
    else toast.success("Reset-link verstuurd naar je e-mail.");
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error("Wachtwoord moet minstens 6 tekens zijn.");
      return;
    }
    setSavingPwd(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPwd(false);
    if (error) {
      toast.error("Wachtwoord wijzigen mislukt.");
      return;
    }
    setNewPassword("");
    toast.success("Wachtwoord bijgewerkt.");
  };

  const handleDelete = async () => {
    setDeleting(true);
    const { error } = await supabase.functions.invoke("delete-account");
    if (error) {
      console.error(error);
      toast.error("Account verwijderen mislukt. Neem contact op als het blijft falen.");
      setDeleting(false);
      return;
    }
    toast.success("Je account is verwijderd.");
    await signOut();
    navigate("/");
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-12 space-y-10">
      <div>
        <p className="eyebrow mb-2">Account</p>
        <h1 className="font-serif italic text-4xl leading-tight">Instellingen</h1>
        <p className="text-sm text-muted-foreground mt-3">Beheer je login en account.</p>
      </div>

      <section className="border border-border rounded-md p-6 space-y-4">
        <div className="flex items-start gap-3">
          <Mail className="h-4 w-4 mt-1 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">E-mail</h2>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>
      </section>

      <section className="border border-border rounded-md p-6 space-y-5">
        <div className="flex items-start gap-3">
          <KeyRound className="h-4 w-4 mt-1 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Wachtwoord</h2>
            <p className="text-sm text-muted-foreground">Wijzig direct of vraag een reset-link aan via e-mail.</p>
          </div>
        </div>
        <form onSubmit={handlePasswordChange} className="space-y-3">
          <Input
            type="password"
            placeholder="Nieuw wachtwoord"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={6}
            className="h-10"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={savingPwd || !newPassword} size="sm" className="rounded-full px-5 text-[11px] font-bold uppercase tracking-widest">
              {savingPwd ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Wachtwoord opslaan"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleResetMail} className="rounded-full px-5 text-[11px] font-bold uppercase tracking-widest">
              Stuur reset-link
            </Button>
          </div>
        </form>
      </section>

      <section className="border border-destructive/30 rounded-md p-6 space-y-4">
        <div className="flex items-start gap-3">
          <Trash2 className="h-4 w-4 mt-1 text-destructive" />
          <div>
            <h2 className="text-sm font-semibold text-destructive">Account verwijderen</h2>
            <p className="text-sm text-muted-foreground">
              Dit verwijdert je profiel, projecten, updates en geüploade foto's permanent. Lopende fotoboek-bestellingen blijven bij ons in de administratie.
            </p>
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" className="rounded-full px-5 text-[11px] font-bold uppercase tracking-widest">
              Account permanent verwijderen
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Weet je het zeker?</AlertDialogTitle>
              <AlertDialogDescription>
                Deze actie is onomkeerbaar. Typ <strong>VERWIJDEREN</strong> hieronder om te bevestigen.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="VERWIJDEREN"
              className="h-10"
            />
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Annuleren</AlertDialogCancel>
              <AlertDialogAction
                disabled={confirm !== "VERWIJDEREN" || deleting}
                onClick={(e) => {
                  e.preventDefault();
                  handleDelete();
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Verwijder mijn account"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </div>
  );
};

export default AccountSettings;
