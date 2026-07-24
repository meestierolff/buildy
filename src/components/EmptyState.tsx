import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

const EmptyState = ({ icon: Icon, title, description, action }: Props) => (
  <div className="text-center py-12 px-6 max-w-md mx-auto rounded-xl border border-border/80 bg-card/60 backdrop-blur-xs shadow-xs my-6">
    <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-accent/10 text-accent mb-5 ring-4 ring-accent/5">
      <Icon className="h-6 w-6" strokeWidth={1.75} />
    </div>
    <h3 className="font-serif italic text-2xl mb-2 text-foreground">{title}</h3>
    {description && <p className="text-sm text-muted-foreground leading-relaxed mb-6 font-light">{description}</p>}
    {action && <div className="flex justify-center">{action}</div>}
  </div>
);

export default EmptyState;

