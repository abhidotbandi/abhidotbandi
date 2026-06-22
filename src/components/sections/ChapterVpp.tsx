import SectionShell from "./SectionShell";
import Quiz from "@/components/ui/Quiz";
import VppBuilder from "@/components/ui/VppBuilder";
import StatCallout from "@/components/ui/StatCallout";
import { VPP_EXPLAINER } from "@/data/gridFacts";
import { BASE_POWER } from "@/data/basePower";
import { QUIZ_QUESTIONS } from "@/data/quiz";

export default function ChapterVpp() {
  const question = QUIZ_QUESTIONS.find((q) => q.chapter === "vpp")!;

  return (
    <SectionShell id="vpp" align="right">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-400">Chapter 4 · Zoom back out</p>
      <h2 className="text-3xl font-bold text-slate-50 sm:text-4xl">{VPP_EXPLAINER.title}</h2>
      <p className="text-slate-300">{VPP_EXPLAINER.detail}</p>

      <div className="grid grid-cols-2 gap-3">
        <StatCallout value={BASE_POWER.scale.homes} label="homes on Base today" color="#f5a623" />
        <StatCallout value={BASE_POWER.scale.deployPace} label="new capacity / month" color="#f5a623" />
      </div>

      <VppBuilder />
      <Quiz question={question} />
    </SectionShell>
  );
}
