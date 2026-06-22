import SectionShell from "./SectionShell";
import Quiz from "@/components/ui/Quiz";
import OutageSimulator from "@/components/ui/OutageSimulator";
import StatCallout from "@/components/ui/StatCallout";
import { BASE_POWER } from "@/data/basePower";
import { QUIZ_QUESTIONS } from "@/data/quiz";

export default function ChapterMicro() {
  const question = QUIZ_QUESTIONS.find((q) => q.chapter === "micro")!;

  return (
    <SectionShell id="micro" align="left">
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-400">Chapter 3 · One home</p>
      <h2 className="text-3xl font-bold text-slate-50 sm:text-4xl">Zoom into a single house</h2>
      <p className="text-slate-300">
        Every macro grid problem eventually shows up here: at the wall outlet. Base puts a{" "}
        {BASE_POWER.hardware.capacityRange} battery and a smart hub between your home and the
        grid.
      </p>
      <ul className="space-y-2 text-sm text-slate-300">
        {BASE_POWER.howItWorks.map((line, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-emerald-400">{i + 1}.</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-2 gap-3">
        <StatCallout value="<0.5s" label="automatic backup failover" color="#34d399" />
        <StatCallout value={BASE_POWER.hardware.backupDuration.split(",")[0]} label="on one battery" color="#34d399" />
      </div>

      <OutageSimulator />
      <Quiz question={question} />
    </SectionShell>
  );
}
