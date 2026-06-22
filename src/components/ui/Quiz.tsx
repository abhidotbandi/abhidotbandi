"use client";

import { useState } from "react";
import { QuizQuestion } from "@/data/quiz";
import { CHAPTER_BADGE, useGridStore } from "@/lib/store";

export default function Quiz({ question }: { question: QuizQuestion }) {
  const [selected, setSelected] = useState<number | null>(null);
  const answerQuiz = useGridStore((s) => s.answerQuiz);
  const unlockBadge = useGridStore((s) => s.unlockBadge);

  const handleSelect = (index: number) => {
    if (selected !== null) return;
    setSelected(index);
    const correct = index === question.correctIndex;
    answerQuiz(question.id, correct);
    unlockBadge(CHAPTER_BADGE[question.chapter]);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-400">Pop quiz · +25 XP</p>
      <p className="mt-2 text-lg font-medium text-slate-100">{question.question}</p>
      <div className="mt-4 grid gap-2">
        {question.options.map((option, i) => {
          const isSelected = selected === i;
          const isCorrect = i === question.correctIndex;
          let cls =
            "text-left rounded-lg border px-4 py-2.5 text-sm transition-colors border-white/10 bg-black/20 hover:border-white/30";
          if (selected !== null) {
            if (isCorrect) cls = "text-left rounded-lg border px-4 py-2.5 text-sm border-emerald-400/60 bg-emerald-400/10 text-emerald-200";
            else if (isSelected) cls = "text-left rounded-lg border px-4 py-2.5 text-sm border-rose-400/60 bg-rose-400/10 text-rose-200";
            else cls = "text-left rounded-lg border px-4 py-2.5 text-sm border-white/5 bg-black/10 text-slate-500";
          }
          return (
            <button key={i} className={cls} onClick={() => handleSelect(i)} disabled={selected !== null}>
              {option}
            </button>
          );
        })}
      </div>
      {selected !== null && (
        <p className="mt-4 text-sm text-slate-300">
          {selected === question.correctIndex ? "Correct. " : "Not quite. "}
          {question.explanation}
        </p>
      )}
    </div>
  );
}
