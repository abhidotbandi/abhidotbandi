import { ReactNode } from "react";
import { ChapterId } from "@/lib/store";
import { chapterHeightVh } from "@/lib/chapters";

interface SectionShellProps {
  id: ChapterId;
  align?: "left" | "right" | "center";
  variant?: "card" | "plain";
  children: ReactNode;
  className?: string;
}

export default function SectionShell({
  id,
  align = "left",
  variant = "card",
  children,
  className = "",
}: SectionShellProps) {
  const height = chapterHeightVh(id);
  const alignCls =
    align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
  const cardCls =
    variant === "card"
      ? "rounded-md border border-white/10 bg-slate-950/85 p-5 backdrop-blur-md shadow-xl shadow-black/40 sm:p-6"
      : "";

  return (
    <section
      style={{ minHeight: `${height}vh` }}
      className={`pointer-events-none relative flex w-full items-center ${alignCls} px-4 sm:px-10 lg:px-16`}
    >
      <div className={`pointer-events-auto w-full max-w-xl space-y-5 ${cardCls} ${className}`}>
        {children}
      </div>
    </section>
  );
}
