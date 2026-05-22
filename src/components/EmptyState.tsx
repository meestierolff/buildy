import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

const EmptyState = ({ icon: Icon, title, description, action }: Props) => (
  <div className="text-center py-20 px-6 max-w-md mx-auto">
    <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-muted mb-6">
      <Icon className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
    </div>
    <h3 className="font-serif text-2xl mb-2">{title}</h3>
    {description && <p className="text-sm text-muted-foreground leading-relaxed mb-6">{description}</p>}
    {action}
  </div>
);

export default EmptyState;
