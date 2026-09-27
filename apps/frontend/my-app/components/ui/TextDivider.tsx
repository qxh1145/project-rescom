interface TextDividerProps {
  children: string;
  className?: string;
}

/** Horizontal rule with a centered caption, e.g. "hoặc dùng email". */
export function TextDivider({ children, className = "" }: TextDividerProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
      <span className="text-caption text-ink-muted">{children}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
    </div>
  );
}
