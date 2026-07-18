import Image from "next/image";
import Link from "next/link";
import { BookingBar } from "@/components/BookingBar";
import { MemoriesCounter } from "@/components/MemoriesCounter";
import { StickySearch } from "@/app/StickySearch";
import { LODGES, TIER_ORDER } from "@/content/lodges";
import { ACTIVITIES, DISCOVER, FAQS, SEASONS } from "@/content/home";
import { countMemories, MEMORIES_GOAL } from "@/server/memories";

export default async function HomePage() {
  const memories = await countMemories();

  return (
    <div>
      {/* 1. Split hero: light display h1 left, supporting copy and CTA right. */}
      <section className="bg-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-14 sm:py-20 md:grid-cols-2">
          <h1 className="font-display text-5xl font-light leading-[1.1] text-ink sm:text-6xl lg:text-[68px]">
            For a <em className="font-light italic">billion</em> happy memories
          </h1>
          <div>
            <h2 className="font-display text-2xl font-bold text-[#6b6248]">
              Your forest break at Lake Naivasha
            </h2>
            <p className="mt-3 text-base">
              A lodge of your own among the trees, a lagoon to splash in and
              time together that nobody has to plan. Breaks start every Friday
              and Monday at Unity Parks Naivasha.
            </p>
            <p className="mt-3 text-base font-bold text-ink">
              School holiday breaks are booking fast. Find yours before they
              fill.
            </p>
            <a href="#search" className="btn-primary btn-hero mt-6 inline-block">
              Find your break
            </a>
          </div>
        </div>
      </section>

      {/* 2. Media band with the booking bar floating over its top. */}
      <section id="search" className="relative">
        <div className="relative aspect-[21/9] min-h-[340px] w-full overflow-hidden">
          {/* Muted looping video, poster first so the band never flashes empty. */}
          <video
            className="absolute inset-0 h-full w-full object-cover"
            src="/videos/hero-family-lake.mp4"
            poster="/photos/hero-forest.jpg"
            autoPlay
            muted
            loop
            playsInline
            aria-label="A family walking together by the lake"
          />
        </div>
        <div className="absolute inset-x-0 top-6 z-10 sm:top-10">
          <StickySearch>
            <BookingBar />
          </StickySearch>
        </div>
      </section>

      {/* 3. Village intro. */}
      <section id="discover" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="font-display text-3xl font-bold text-ink sm:text-4xl">
          One village, endless memories
        </h2>
        <p className="mt-3 max-w-2xl text-base">
          Unity Parks Naivasha sits in the forest on the shore of Lake
          Naivasha, Kenya. Every lodge, trail and splash of the lagoon is part
          of one village built for time together.
        </p>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          <div className="overflow-hidden rounded-lg border border-line bg-white">
            <div className="relative aspect-[3/2]">
              <Image
                src="/village-map.svg"
                alt="Illustrated map of the Unity Parks Naivasha village"
                fill
                className="object-cover"
              />
            </div>
            <div className="p-5">
              <h3 className="font-display text-xl font-bold text-navy">
                Unity Parks Naivasha
              </h3>
              <p className="mt-1 flex items-center gap-1.5 text-sm">
                <PinIcon />
                Lake Naivasha, Kenya
              </p>
              <p className="mt-2 text-sm">
                Lakeside forest, four lodge styles, one swimming lagoon and
                room for the whole family.
              </p>
              <a
                href="#lodges"
                className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-navy"
              >
                Explore the village
                <ChevronIcon />
              </a>
            </div>
          </div>
          {["Our next village", "And one more after that"].map((title) => (
            <div
              key={title}
              className="flex flex-col justify-center rounded-lg border border-dashed border-line bg-mist p-5 text-center"
            >
              <h3 className="font-display text-xl font-bold text-ink/40">
                {title}
              </h3>
              <p className="mt-1 text-sm text-foreground/50">
                Coming in time. A billion memories need more than one forest.
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Lodge showcase, alternating image sides per tier. */}
      <section id="lodges" className="bg-mist py-16">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="font-display text-3xl font-bold text-ink sm:text-4xl">
            Find the lodge that fits
          </h2>
          <p className="mt-3 max-w-2xl text-base">
            Every lodge is yours alone for the whole break. One price per
            lodge, however many of you come.
          </p>
          <div className="mt-10 space-y-12">
            {TIER_ORDER.map((code, index) => {
              const lodge = LODGES[code];
              const imageFirst = index % 2 === 0;
              return (
                <div
                  key={code}
                  className="grid items-center gap-8 md:grid-cols-2"
                >
                  <div
                    className={`relative aspect-[4/3] overflow-hidden rounded-lg ${
                      imageFirst ? "" : "md:order-2"
                    }`}
                  >
                    <Image
                      src={lodge.image}
                      alt={lodge.name}
                      fill
                      className="object-cover"
                    />
                  </div>
                  <div>
                    <h3 className="font-display text-2xl font-bold text-navy">
                      {lodge.name}
                    </h3>
                    <p className="mt-1 text-sm italic">{lodge.tagline}</p>
                    <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                      {lodge.features.map((feature) => (
                        <li
                          key={feature}
                          className="flex items-center gap-2 text-sm"
                        >
                          <TickIcon />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-4 text-base">{lodge.blurb}</p>
                    <p className="mt-2 text-sm text-foreground/60">
                      {lodge.bedrooms} bedrooms · sleeps {lodge.sleeps}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-3">
                      <Link href="/#search" className="btn-primary">
                        View lodges
                      </Link>
                      <Link href="/#search" className="btn-dark-outline">
                        Compare all lodges
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 5. Activities band. */}
      <section id="things-to-do" className="py-16">
        <div className="bg-olive py-10">
          <div className="mx-auto max-w-6xl px-5">
            <h2 className="font-display text-3xl font-bold text-white sm:text-4xl">
              Things to do, together
            </h2>
            <p className="mt-2 max-w-2xl text-base text-white/90">
              Days in the village fill themselves. Here is where they usually
              start.
            </p>
          </div>
        </div>
        <div className="mx-auto -mt-4 max-w-6xl px-5">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {ACTIVITIES.map((activity) => (
              <div
                key={activity.title}
                className="overflow-hidden rounded-lg border border-line bg-white"
              >
                <div className="relative aspect-[3/2]">
                  <Image
                    src={activity.image}
                    alt={activity.title}
                    fill
                    className="object-cover"
                  />
                </div>
                <div className="p-4">
                  <h3 className="font-display text-lg font-bold text-ink">
                    {activity.title}
                  </h3>
                  <p className="mt-1 text-sm">{activity.copy}</p>
                  <a
                    href="#"
                    className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-navy"
                  >
                    Discover more
                    <ChevronIcon />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6. Seasonal trio with placeholder from-prices. */}
      <section className="mx-auto max-w-6xl px-5 pb-16">
        <h2 className="font-display text-3xl font-bold text-ink sm:text-4xl">
          A forest for every season
        </h2>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {SEASONS.map((season) => (
            <div
              key={season.title}
              className="overflow-hidden rounded-lg border border-line bg-white"
            >
              <div className="relative aspect-video">
                <Image
                  src={season.image}
                  alt={season.title}
                  fill
                  className="object-cover"
                />
              </div>
              <div className="p-5">
                <h3 className="font-display text-xl font-bold text-ink">
                  {season.title}
                </h3>
                <p className="mt-1 text-sm">{season.copy}</p>
                <p className="mt-3 text-base font-bold text-ink">
                  {season.price}
                </p>
                <Link href="/#search" className="btn-outline mt-4 inline-block">
                  Explore breaks
                </Link>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-foreground/60">
          *Lowest lodge price for the season, subject to availability.
        </p>
      </section>

      {/* 7. Memories counter band. */}
      <section className="contour-bg bg-mist py-16">
        <div className="mx-auto max-w-4xl px-5 text-center">
          <MemoriesCounter
            value={memories}
            className="font-display text-6xl font-light text-olive sm:text-7xl lg:text-8xl"
          />
          <p className="mt-3 font-display text-xl font-bold text-ink sm:text-2xl">
            memories made so far, counting our way to a billion
          </p>
          <p className="mt-2 text-sm text-foreground/60">
            One memory is one guest, one night in the forest. Just{" "}
            {(MEMORIES_GOAL - memories).toLocaleString("en-GB")} to go.
          </p>
        </div>
      </section>

      {/* 8. Discover trio. */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="font-display text-3xl font-bold text-ink sm:text-4xl">
          More from Unity Parks
        </h2>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {DISCOVER.map((card) => (
            <div
              key={card.title}
              className="overflow-hidden rounded-lg border border-line bg-white"
            >
              <div className="relative aspect-[3/2]">
                <Image
                  src={card.image}
                  alt={card.title}
                  fill
                  className="object-cover"
                />
              </div>
              <div className="p-5">
                <h3 className="font-display text-xl font-bold text-ink">
                  {card.title}
                </h3>
                <p className="mt-1 text-sm">{card.copy}</p>
                <a
                  href="#"
                  className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-navy"
                >
                  Discover more
                  <ChevronIcon />
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 9. FAQ accordion, native details so it stays server-rendered. */}
      <section id="faq" className="mx-auto max-w-3xl px-5 pb-20">
        <h2 className="font-display text-3xl font-bold text-ink sm:text-4xl">
          Questions, answered
        </h2>
        <div className="mt-6 border-t border-line">
          {FAQS.map((faq) => (
            <details key={faq.question} className="group border-b border-line">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-lg font-semibold text-ink [&::-webkit-details-marker]:hidden">
                {faq.question}
                <span className="shrink-0 transition-transform group-open:rotate-90">
                  <ChevronIcon />
                </span>
              </summary>
              <p className="pb-5 text-base">{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

/* Small inline icons, stroke currentColor to inherit text colour. */

function PinIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function TickIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-leaf"
    >
      <path d="m4 12.5 5.5 5.5L20 6.5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}
