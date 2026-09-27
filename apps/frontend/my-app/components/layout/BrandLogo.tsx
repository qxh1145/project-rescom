import Link from "next/link";

interface BrandLogoProps {
  size?: "sm" | "md" | "lg";
  href?: string;
  showSubtitle?: boolean;
}

export function BrandLogo({
  size = "md",
  href = "/",
  showSubtitle = true,
}: BrandLogoProps) {
  const iconSizeClasses = {
    sm: "w-8 h-8 text-base rounded-xl",
    md: "w-10 h-10 text-xl rounded-2xl",
    lg: "w-12 h-12 text-2xl rounded-2xl",
  }[size];

  const titleSizeClasses = {
    sm: "text-lg font-bold tracking-tight",
    md: "text-xl font-extrabold tracking-tight",
    lg: "text-2xl font-black tracking-tight",
  }[size];

  const content = (
    <div className="flex items-center gap-2.5 select-none group">
      <div
        className={`${iconSizeClasses} bg-gradient-to-tr from-emerald-600 via-teal-500 to-sky-500 text-white flex items-center justify-center font-black shadow-md shadow-emerald-500/20 group-hover:scale-105 transition-transform duration-200`}
        aria-hidden="true"
      >
        R
      </div>
      <div className="flex flex-col">
        <div className="flex items-center gap-1.5 leading-none">
          <span className={`${titleSizeClasses} text-slate-900 dark:text-white`}>
            RES<span className="text-emerald-600 dark:text-emerald-400">COM</span>
          </span>
          <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 rounded-full border border-emerald-300 dark:border-emerald-800">
            FPTU
          </span>
        </div>
        {showSubtitle && (
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 tracking-tight mt-0.5">
            Cộng đồng Khảo sát Học thuật
          </span>
        )}
      </div>
    </div>
  );

  if (!href) return content;

  return (
    <Link href={href} className="inline-flex items-center focus:outline-hidden">
      {content}
    </Link>
  );
}
