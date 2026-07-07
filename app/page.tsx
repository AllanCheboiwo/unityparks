import Image from "next/image";
import { BookingBar } from "@/components/BookingBar";
import { LODGES, TIER_ORDER } from "@/content/lodges";

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative">
        <div className="relative h-[420px] sm:h-[480px] overflow-hidden">
          <Image
            src="/hero.svg"
            alt="Lodges among the trees on the shore of Lake Naivasha"
            fill
            priority
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-forest/60 via-forest/10 to-transparent" />
          <div className="absolute inset-x-0 bottom-16 sm:bottom-24">
            <div className="mx-auto max-w-5xl px-5 text-white">
              <h1 className="font-display text-4xl sm:text-5xl leading-tight max-w-xl [text-shadow:0_1px_12px_rgba(0,0,0,0.35)]">
                For the ones you love, in the <em>heart of the forest</em>
              </h1>
              <p className="mt-3 max-w-lg text-sm sm:text-base text-white/90 [text-shadow:0_1px_8px_rgba(0,0,0,0.4)]">
                Self-contained lodges in a lakeside forest village near
                Naivasha. Weekend, midweek and full-week breaks.
              </p>
            </div>
          </div>
        </div>

        {/* The persistent booking bar, overlapping the hero */}
        <div className="mx-auto max-w-5xl px-5 -mt-10 relative z-10">
          <BookingBar />
        </div>
      </section>

      {/* Lodge tier teaser */}
      <section className="mx-auto max-w-5xl px-5 mt-16">
        <h2 className="font-display text-2xl text-forest">
          Four lodges, one <em>forest</em>
        </h2>
        <p className="mt-1 text-sm text-foreground/60">
          Every lodge is yours alone for the whole break. One price per lodge,
          however many of you come.
        </p>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TIER_ORDER.map((code) => {
            const lodge = LODGES[code];
            return (
              <div
                key={code}
                className="rounded-xl overflow-hidden bg-white ring-1 ring-forest/10 shadow-sm"
              >
                <div className="relative h-32">
                  <Image src={lodge.image} alt={lodge.name} fill className="object-cover" />
                </div>
                <div className="p-4">
                  <p className="font-display text-forest">{lodge.name}</p>
                  <p className="text-xs text-foreground/60 mt-0.5">{lodge.tagline}</p>
                  <p className="text-xs text-foreground/50 mt-2">
                    {lodge.bedrooms} bedrooms · sleeps {lodge.sleeps}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
