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
      <img
        src="/logo.png"
        alt="Buildy logo"
        className={cn("h-9 w-9 rounded-xl object-contain", imageClassName)}
      />
      <span className={cn("text-lg font-semibold tracking-tight", textClassName)}>Buildy</span>
    </>
  );

  return href ? (
    <Link to={href} className={cn("inline-flex items-center gap-2", className)}>
      {content}
    </Link>
  ) : (
    <div className={cn("inline-flex items-center gap-2", className)}>{content}</div>
  );
};

export default BrandLogo;