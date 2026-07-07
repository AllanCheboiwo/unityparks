const STEPS = ["Search", "Lodge", "Extras", "Details", "Pay"] as const;

export type StepName = (typeof STEPS)[number];

/** The funnel position indicator shown at the top of every checkout page. */
export function Stepper({ current }: { current: StepName }) {
  const currentIndex = STEPS.indexOf(current);
  return (
    <nav aria-label="Booking steps" className="mb-8">
      <ol className="flex items-center gap-2 text-xs sm:text-sm">
        {STEPS.map((step, i) => {
          const state =
            i < currentIndex ? "done" : i === currentIndex ? "current" : "todo";
          return (
            <li key={step} className="flex items-center gap-2">
              {i > 0 && <span className="w-5 sm:w-8 h-px bg-forest/20" aria-hidden />}
              <span
                className={
                  state === "current"
                    ? "font-semibold text-forest border-b-2 border-gold pb-0.5"
                    : state === "done"
                      ? "text-forest/70"
                      : "text-foreground/35"
                }
              >
                {state === "done" ? "✓ " : ""}
                {step}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
