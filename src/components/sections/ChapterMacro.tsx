import SectionShell from "./SectionShell";
import Quiz from "@/components/ui/Quiz";
import { INTERCONNECTIONS, GRID_BASICS } from "@/data/gridFacts";
import { QUIZ_QUESTIONS } from "@/data/quiz";

export default function ChapterMacro() {
  const question = QUIZ_QUESTIONS.find((q) => q.chapter === "macro")!;

  return (
    <SectionShell id="macro" align="left">
      <p className="text-xs font-semibold uppercase tracking-wide text-sky-400">Chapter 1 · Macro</p>
      <h2 className="text-3xl font-bold text-slate-50 sm:text-4xl">One grid, three islands</h2>
      <p className="text-slate-300">
        The United States doesn&apos;t run on a single power grid. It runs on three, loosely
        linked but mostly independent networks. Electricity flows {GRID_BASICS.generation}{" "}
        {GRID_BASICS.transmission} {GRID_BASICS.substation} {GRID_BASICS.distribution}
      </p>
      <div className="grid gap-3">
        {INTERCONNECTIONS.map((ic) => (
          <div key={ic.id} className="flex gap-3 rounded-md border border-white/10 bg-white/5 p-4">
            <span
              className="mt-1 h-3 w-3 flex-shrink-0 rounded-full"
              style={{ backgroundColor: ic.color, boxShadow: `0 0 12px ${ic.color}` }}
            />
            <div>
              <p className="font-semibold text-slate-100">{ic.name}</p>
              <p className="text-sm text-slate-400">{ic.blurb}</p>
            </div>
          </div>
        ))}
      </div>
      <Quiz question={question} />
    </SectionShell>
  );
}
