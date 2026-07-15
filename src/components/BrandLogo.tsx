import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";

type BrandLogoProps = {
  className?: string;
  imageClassName?: string;
  textClassName?: string;
  href?: string;
};

const BrandLogo = ({
  className,
  imageClassName,
  textClassName,
  href = "/",
}: BrandLogoProps) => {
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-card text-foreground shadow-sm ring-1 ring-foreground/12", imageClassName)}
      >
        <svg viewBox="0 0 40 40" className="h-full w-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M9.5 18.2 20 9.8l10.5 8.4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12.5 17.3v10.2h15V17.3L20 11.2l-7.5 6.1Z" fill="hsl(var(--accent))" />
          <path d="M17.2 19.1h5.6v5.6h-5.6z" fill="hsl(var(--accent-foreground))" />
          <path d="M7.8 29.3c4.4-.5 8.5.4 12.2 2.7 3.7-2.3 7.8-3.2 12.2-2.7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M20 28.5V32" stroke="hsl(var(--accent))" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
      <span className={cn("font-serif text-xl italic tracking-tight", textClassName)}>Buildy</span>
    </>
  );

  return href ? (
    <Link to={href} className={cn("inline-flex items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4", className)}>
      {content}
    </Link>
  ) : (
    <div className={cn("inline-flex items-center gap-2", className)}>{content}</div>
  );
};

export default BrandLogo;
