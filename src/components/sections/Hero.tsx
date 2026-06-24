import SectionShell from "./SectionShell";

export default function Hero() {
  return (
    <SectionShell id="hero" align="center" variant="plain" className="max-w-3xl text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-livewire">
        An interactive tour of the US energy grid
      </p>
      <h1 className="text-4xl font-bold leading-tight text-slate-50 sm:text-6xl">
        The grid is breaking.
        <br />
        Here&apos;s how <span className="text-livewire">Base Power</span> is fixing it.
      </h1>
      <p className="mx-auto max-w-xl text-base text-slate-300 sm:text-lg">
        Scroll to descend from the national grid all the way down to a single home&apos;s
        battery — then zoom back out to see how thousands of those batteries are becoming
        Texas&apos;s newest power plant. Collect badges and XP as you go.
      </p>
      <div className="flex flex-col items-center gap-1 pt-6 text-slate-500">
        <span className="text-xs uppercase tracking-wide">Scroll to begin</span>
        <span className="animate-bounce text-lg">⌄</span>
      </div>
    </SectionShell>
  );
}
