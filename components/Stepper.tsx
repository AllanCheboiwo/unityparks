const STEPS = [
  "Location",
  "Little Extras",
  "Your Details",
  "Guest Details",
  "Payment",
] as const;

export type StepName = (typeof STEPS)[number];

// How deep each cell's arrow point cuts into the next cell.
const ARROW = 14;

/**
 * The checkout band: one arrow-shaped cell per step,
 * pointing at the next. Cells overlap by the arrow depth and stack earlier-
 * on-top, so each point sits inside its neighbour's notch; a hard 1px
 * drop-shadow along the clip path draws the arrow edge even between two
 * same-coloured cells. Colours: current olive on white, done mist with a
 * leaf tick, todo white with grey text.
 */
export function Stepper({ current }: { current: StepName }) {
  const currentIndex = STEPS.indexOf(current);
  return (
    <nav aria-label="Booking steps" className="mb-8">
      <ol className="flex rounded-lg overflow-hidden ring-1 ring-line bg-white text-[11px] sm:text-sm">
        {STEPS.map((step, i) => {
          const state =
            i < currentIndex ? "done" : i === currentIndex ? "current" : "todo";
          const first = i === 0;
          const last = i === STEPS.length - 1;

          const cellColor =
            state === "current"
              ? "bg-olive text-white font-bold"
              : state === "done"
                ? "bg-mist text-olive font-semibold"
                : "bg-white text-foreground/50 font-medium";

          const rightEdge = last
            ? "100% 0, 100% 100%"
            : `calc(100% - ${ARROW}px) 0, 100% 50%, calc(100% - ${ARROW}px) 100%`;
          const leftNotch = first ? "" : `, ${ARROW}px 50%`;
          const clipPath = `polygon(0 0, ${rightEdge}, 0 100%${leftNotch})`;

          return (
            <li
              key={step}
              className="relative flex-1 min-w-0"
              style={{
                zIndex: STEPS.length - i,
                marginLeft: first ? 0 : -ARROW,
                filter: last ? undefined : "drop-shadow(1px 0 0 #d9d6cf)",
              }}
            >
              <div
                aria-current={state === "current" ? "step" : undefined}
                className={`${cellColor} flex items-center justify-center gap-1.5 py-2.5 pr-2`}
                style={{ clipPath, paddingLeft: first ? 8 : ARROW + 6 }}
              >
                {state === "done" ? (
                  <span
                    aria-hidden
                    className="hidden sm:flex shrink-0 w-4 h-4 rounded-full bg-leaf text-white items-center justify-center"
                  >
                    <svg viewBox="0 0 12 12" className="w-2.5 h-2.5" fill="none">
                      <path
                        d="M2.5 6.5 5 9l4.5-5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                ) : state === "current" ? (
                  <span
                    aria-hidden
                    className="hidden sm:flex shrink-0 w-4 h-4 rounded-full border-2 border-white/70 items-center justify-center"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-white" />
                  </span>
                ) : (
                  <span
                    aria-hidden
                    className="hidden sm:block shrink-0 w-4 h-4 rounded-full border border-line"
                  />
                )}
                <span className="truncate">{step}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
