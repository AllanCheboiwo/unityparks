import Image from "next/image";
import Link from "next/link";
import { BookingBar } from "@/components/BookingBar";
import { MemoriesCounter } from "@/components/MemoriesCounter";
import { StickySearch } from "./StickySearch";
import { LODGES, TIER_ORDER } from "@/content/lodges";
import { getHomeContent, mediaRef } from "@/server/content";
import { countMemories, MEMORIES_GOAL } from "@/server/memories";

// CMS edits must show on the next request; declared rather than relying on
// the layout's cookie read to keep this page dynamic.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [{ home, activities, seasons, faqs }, memories] = await Promise.all([
    getHomeContent(),
    countMemories(),
  ]);
  const heroVideo = mediaRef(home.hero.video);
  const heroPoster = mediaRef(home.hero.poster);

  return (
    <div>
      {/* 1. Split hero: light display h1 left, supporting copy and CTA right. */}
      <section className="bg-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-14 sm:py-20 md:grid-cols-2">
          <h1 className="font-display text-5xl font-light leading-[1.1] text-ink sm:text-6xl lg:text-[68px]">
            {home.hero.headingBefore}{" "}
            <em className="font-light italic">{home.hero.headingEmphasis}</em>{" "}
            {home.hero.headingAfter}
          </h1>
          <div>
            <h2 className="font-display text-2xl font-bold text-[#6b6248]">
              {home.hero.subheading}
            </h2>
            <p className="mt-3 text-base">{home.hero.intro}</p>
            <p className="mt-3 text-base font-bold text-ink">{home.hero.urgency}</p>
            <a href="#search" className="btn-primary btn-hero mt-6 inline-block">
              {home.hero.ctaLabel}
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
            src={heroVideo.url}
            poster={heroPoster.url}
            autoPlay
            muted
            loop
            playsInline
            aria-label={home.hero.videoDescription}
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
          {home.village.heading}
        </h2>
        <p className="mt-3 max-w-2xl text-base">{home.village.intro}</p>
        <div className="mt-8 grid items-center gap-8 overflow-hidden rounded-lg border border-line bg-white p-5 sm:p-6 md:grid-cols-2">
          <div className="relative aspect-[3/2] overflow-hidden rounded-md">
            <Image
              src="/village-map.svg"
              alt={home.village.mapAlt}
              fill
              className="object-cover"
            />
          </div>
          <div>
            <h3 className="font-display text-2xl font-bold text-navy">
              {home.village.cardName}
            </h3>
            <p className="mt-1 flex items-center gap-1.5 text-sm">
              <PinIcon />
              {home.village.locationLine}
            </p>
            <p className="mt-3 text-base">{home.village.blurb}</p>
            <a
              href="#lodges"
              className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-navy"
            >
              Explore the village
              <ChevronIcon />
            </a>
          </div>
        </div>
      </section>

      {/* 4. Lodge showcase, alternating image sides per tier. */}
      <section id="lodges" className="bg-mist py-16">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="font-display text-3xl font-bold text-ink sm:text-4xl">
            {home.sections.lodgesHeading}
          </h2>
          <p className="mt-3 max-w-2xl text-base">{home.sections.lodgesIntro}</p>
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
              {home.sections.activitiesHeading}
            </h2>
            <p className="mt-2 max-w-2xl text-base text-white/90">
              {home.sections.activitiesIntro}
            </p>
          </div>
        </div>
        <div className="mx-auto -mt-4 max-w-6xl px-5">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {activities.map((activity) => (
              <div
                key={activity.slug}
                className="overflow-hidden rounded-lg border border-line bg-white"
              >
                <div className="relative aspect-[3/2]">
                  <Image
                    src={mediaRef(activity.photo).url}
                    alt={mediaRef(activity.photo).alt}
                    fill
                    className="object-cover"
                  />
                </div>
                <div className="p-4">
                  <h3 className="font-display text-lg font-bold text-ink">
                    {activity.title}
                  </h3>
                  <p className="mt-1 text-sm">{activity.copy}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6. Seasonal trio with placeholder from-prices. */}
      <section className="mx-auto max-w-6xl px-5 pb-16">
        <h2 className="font-display text-3xl font-bold text-ink sm:text-4xl">
          {home.sections.seasonsHeading}
        </h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {seasons.map((season) => (
            <div
              key={season.slug}
              className="overflow-hidden rounded-lg border border-line bg-white"
            >
              <div className="relative aspect-video">
                <Image
                  src={mediaRef(season.photo).url}
                  alt={mediaRef(season.photo).alt}
                  fill
                  className="object-cover"
                />
              </div>
              <div className="p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground/50">
                  {season.months}
                </p>
                <h3 className="mt-1 font-display text-xl font-bold text-ink">
                  {season.title}
                </h3>
                <p className="mt-1 text-sm">{season.copy}</p>
                <p className="mt-3 text-base font-bold text-ink">
                  {season.fromPrice}
                </p>
                <Link href="/#search" className="btn-outline mt-4 inline-block">
                  Explore breaks
                </Link>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-foreground/60">
          {home.sections.seasonsFootnote}
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
            {home.memories.caption}
          </p>
          <p className="mt-2 text-sm text-foreground/60">
            {home.memories.explainer} Just{" "}
            {(MEMORIES_GOAL - memories).toLocaleString("en-GB")} to go.
          </p>
        </div>
      </section>

      {/* 8. Discover trio. */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="font-display text-3xl font-bold text-ink sm:text-4xl">
          {home.sections.discoverHeading}
        </h2>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {(home.discoverCards ?? []).map((card) => (
            <div
              key={card.title}
              className="overflow-hidden rounded-lg border border-line bg-white"
            >
              <div className="relative aspect-[3/2]">
                <Image
                  src={mediaRef(card.photo).url}
                  alt={mediaRef(card.photo).alt}
                  fill
                  className="object-cover"
                />
              </div>
              <div className="p-5">
                <h3 className="font-display text-xl font-bold text-ink">
                  {card.title}
                </h3>
                <p className="mt-1 text-sm">{card.copy}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 9. FAQ accordion, native details so it stays server-rendered. */}
      <section id="faq" className="mx-auto max-w-3xl px-5 pb-20">
        <h2 className="font-display text-3xl font-bold text-ink sm:text-4xl">
          {home.sections.faqsHeading}
        </h2>
        <div className="mt-6 border-t border-line">
          {faqs.map((faq) => (
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
