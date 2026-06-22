import { ReactNode } from "react";
import { ChapterId } from "@/lib/store";
import { chapterHeightVh } from "@/lib/chapters";

interface SectionShellProps {
  id: ChapterId;
  align?: "left" | "right" | "center";
  children: ReactNode;
  className?: string;
}

export default function SectionShell({ id, align = "left", children, className = "" }: SectionShellProps) {
  const height = chapterHeightVh(id);
  const alignCls =
    align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";

  return (
    <section
      style={{ minHeight: `${height}vh` }}
      className={`pointer-events-none relative flex w-full items-center ${alignCls} px-4 sm:px-10 lg:px-16`}
    >
      <div className={`pointer-events-auto w-full max-w-xl space-y-5 ${className}`}>{children}</div>
    </section>
  );
}
