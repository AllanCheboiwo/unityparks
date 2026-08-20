import Image from "next/image";
import Link from "next/link";
import { BookingBar } from "@/components/BookingBar";
import { StickySearch } from "./StickySearch";
import {
  CEDAR_CARD_SUMMARY,
  LODGES,
  SIGNATURE_CARD_SUMMARY,
  TIER_ORDER,
} from "@/content/lodges";
import { ZONES } from "@/content/village";
import { getHomeContent, mediaRef } from "@/server/content";

// CMS edits must show on the next request; declared rather than relying on
// the layout's cookie read to keep this page dynamic.
export const dynamic = "force-dynamic";

/* The design-handoff container: 1240px, 40px gutters (20px on phones). */
const container = "mx-auto max-w-[1240px] px-5 sm:px-10";

/* Repeated section-header pattern: eyebrow, big heading, right-aligned intro. */
function SectionHead({
  eyebrow,
  heading,
  intro,
  dark = false,
  divided = true,
}: {
  eyebrow: string;
  heading: string;
  intro: string;
  dark?: boolean;
  divided?: boolean;
}) {
  return (
    <div
      className={`grid gap-3.5 md:grid-cols-[1fr_auto] md:gap-[60px] md:items-end ${
        divided ? "pb-[30px] border-b border-line" : ""
      }`}
    >
      <div>
        <p
          className={`text-xs font-bold uppercase tracking-[0.18em] mb-[18px] ${
            dark ? "text-[#c9dbb2]" : "text-olive"
          }`}
        >
          {eyebrow}
        </p>
        <h2
          className={`font-display text-[32px] sm:text-[42px] font-bold leading-[1.12] tracking-[-0.015em] ${
            dark ? "text-white" : "text-ink"
          }`}
        >
          {heading}
        </h2>
      </div>
      <p
        className={`text-base leading-[1.7] md:max-w-[38ch] ${
          dark ? "text-white/85" : "text-[#6f6c64]"
        }`}
      >
        {intro}
      </p>
    </div>
  );
}

export default async function HomePage() {
  const { home, activities, seasons, faqs } = await getHomeContent();
  const heroVideo = mediaRef(home.hero.video);
  const heroPoster = mediaRef(home.hero.poster);
  // Big Water Garden tile first, then the two stacked tiles beside it.
  const [activityMain, ...activitySide] = activities.slice(0, 3);

  return (
    <div>
      {/* 1. Full-bleed motion hero with the booking bar riding its bottom edge. */}
      <section id="hero" className="relative bg-[#12160f]">
        <div className="relative h-[78vh] min-h-[600px] max-h-[820px] overflow-hidden">
          {/* Poster underneath so reduced-motion (and slow loads) show a
              still frame instead of a black band. */}
          <Image
            src={heroPoster.url}
            alt=""
            fill
            priority
            className="object-cover photo-tone"
          />
          <video
            className="absolute inset-0 h-full w-full object-cover photo-tone motion-reduce:hidden"
            src={heroVideo.url}
            poster={heroPoster.url}
            autoPlay
            muted
            loop
            playsInline
            aria-label={home.hero.videoDescription}
          />
          <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(12,18,10,0.8)_0%,rgba(12,18,10,0.5)_46%,rgba(12,18,10,0.08)_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(12,18,10,0.72)_0%,rgba(12,18,10,0)_42%)]" />
          <div
            className={`relative h-full ${container} pb-14 lg:pb-[190px] flex flex-col justify-end`}
          >
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#c9dbb2] mb-[22px]">
              One village · 2,100 m · Naro Moru
            </p>
            <h1 className="font-display text-[40px] sm:text-[64px] font-bold leading-[1.06] tracking-[-0.02em] text-white max-w-[16ch]">
              {home.hero.headingBefore}{" "}
              <em className="italic">{home.hero.headingEmphasis}</em>
              {home.hero.headingAfter ? ` ${home.hero.headingAfter}` : ""}
            </h1>
            <p className="mt-[26px] text-base sm:text-lg leading-[1.65] text-white/85 max-w-[50ch]">
              {home.hero.intro}
            </p>
          </div>
        </div>

        {/* The bar overlaps the hero's bottom edge by half its height on
            desktop; below lg it stacks and sits in normal flow instead. */}
        <div
          id="search"
          className="relative lg:absolute lg:inset-x-0 lg:bottom-0 lg:translate-y-1/2 z-30"
        >
          <div className={container}>
            <StickySearch>
              <BookingBar />
            </StickySearch>
          </div>
        </div>
      </section>

      {/* 2. The village: story and stats left, map and zones right. */}
      <section id="village" className={`${container} pt-[72px] lg:pt-[180px]`}>
        <div className="grid gap-10 lg:grid-cols-[1fr_1.05fr] lg:gap-20 items-start">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-olive mb-5">
              The village
            </p>
            <h2 className="font-display text-[32px] sm:text-[42px] font-bold leading-[1.12] tracking-[-0.015em] text-ink">
              {home.village.heading}
            </h2>
            <p className="mt-6 text-[17px] leading-[1.75]">{home.village.intro}</p>
            <p className="mt-[18px] text-[17px] leading-[1.75]">{home.village.blurb}</p>
            <div className="mt-11 pt-9 border-t border-line grid grid-cols-2 gap-x-10 gap-y-8">
              {[
                { value: "2,100 m", caption: "above sea level, in the cedar forest" },
                { value: "4", caption: "lodge types: two grades in two sizes" },
                { value: "Car-free", caption: "lanes, with parking beside your lodge" },
                { value: "Fri / Mon", caption: "the two days every break starts" },
              ].map((stat) => (
                <div key={stat.value}>
                  <p className="font-display text-[34px] font-semibold leading-none text-olive">
                    {stat.value}
                  </p>
                  <p className="mt-2 text-sm text-[#6f6c64]">{stat.caption}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="border border-line rounded-xl overflow-hidden bg-mist">
              <Image
                src="/village-map.svg"
                alt={home.village.mapAlt}
                width={1600}
                height={1000}
                className="block w-full h-auto aspect-[16/10] object-cover"
              />
            </div>
            <div className="mt-7">
              <p className="font-display text-xl font-semibold text-ink mb-1">
                Four zones, downhill to uphill
              </p>
              <p className="text-sm text-[#8a877f] mb-[18px]">
                Grade and size decide the lodge. The zone decides the view.
                Price climbs with the slope.
              </p>
              <div className="flex flex-col">
                {ZONES.map((zone, index) => (
                  <div
                    key={zone.id}
                    className={`grid grid-cols-[1fr_auto] gap-4 items-baseline py-4 border-t border-line ${
                      index === ZONES.length - 1 ? "border-b" : ""
                    }`}
                  >
                    <div>
                      <p className="text-[15px] font-bold text-ink">{zone.name}</p>
                      <p className="mt-0.5 text-sm text-[#6f6c64]">{zone.character}</p>
                    </div>
                    {zone.live ? (
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-white bg-olive rounded-[3px] px-[9px] py-1 whitespace-nowrap">
                        Open
                      </span>
                    ) : (
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#8a877f] border border-[#d4d1c9] rounded-[3px] px-[9px] py-1 whitespace-nowrap">
                        Phase two
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Full-bleed quote band. */}
      <section className="mt-[72px] sm:mt-[120px] relative overflow-hidden">
        <div className="relative h-[52vh] min-h-[380px] max-h-[540px]">
          <Image
            src="/photos/season-cool.jpg"
            alt="Mist drifting through the cedar forest"
            fill
            className="object-cover photo-tone"
          />
          <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(12,18,10,0.7)_0%,rgba(12,18,10,0.15)_55%,rgba(12,18,10,0.05)_100%)]" />
          <div className={`relative h-full ${container} pb-14 flex flex-col justify-end`}>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#c9dbb2] mb-3.5">
              Life in the village
            </p>
            <p className="font-display text-[28px] sm:text-[34px] font-bold leading-[1.2] text-white max-w-[26ch]">
              Park once. The mountain does the rest.
            </p>
          </div>
        </div>
      </section>

      {/* 4. Lodges on the two-axis model: grade × size, with from-prices. */}
      <section id="lodges" className={`${container} pt-[72px] sm:pt-[120px]`}>
        <SectionHead
          eyebrow="Lodges"
          heading={home.sections.lodgesHeading}
          intro={home.sections.lodgesIntro}
        />

        <div className="grid gap-7 min-[640px]:grid-cols-2 min-[1000px]:grid-cols-4 mt-11">
          {TIER_ORDER.map((code) => {
            const lodge = LODGES[code];
            return (
              <article key={code} className="flex flex-col">
                <Link
                  href={`/lodges/${lodge.code.toLowerCase()}`}
                  className="relative block overflow-hidden aspect-[4/3] bg-mist rounded-xl"
                >
                  <Image
                    src={lodge.image}
                    alt={lodge.name}
                    fill
                    className="object-cover photo-tone"
                  />
                  {code === "FST" && (
                    <span className="absolute top-3.5 left-3.5 bg-white text-ink text-[11px] font-bold uppercase tracking-[0.08em] px-2.5 py-[5px] rounded-[3px]">
                      Family favourite
                    </span>
                  )}
                </Link>
                <p
                  className={`text-[11px] font-bold uppercase tracking-[0.12em] mt-5 mb-2 ${
                    lodge.grade === "Cedar" ? "text-olive" : "text-ink"
                  }`}
                >
                  {lodge.grade} · {lodge.bedrooms} bedroom
                </p>
                <h3 className="font-display text-[21px] font-bold text-ink">
                  <Link href={`/lodges/${lodge.code.toLowerCase()}`}>{lodge.tagline}</Link>
                </h3>
                <p className="mt-2 mb-4 text-sm leading-[1.65] text-[#5f5c55]">
                  {lodge.blurb}
                </p>
                <div className="mt-auto pt-3.5 border-t border-line flex items-baseline justify-between gap-2.5 flex-wrap">
                  <span className="text-[13px] font-bold text-ink">
                    {lodge.bedrooms} bed · sleeps {lodge.sleeps}
                  </span>
                  <span className="text-[13px] text-[#8a877f]">
                    from{" "}
                    <strong className="font-display text-[17px] font-bold text-ink">
                      {lodge.fromPrice}*
                    </strong>
                  </span>
                </div>
                <Link
                  href="/#search"
                  className="mt-3.5 inline-flex items-center gap-[7px] text-sm font-bold text-ochre hover:text-ochre-dark"
                >
                  See dates and prices
                  <ChevronIcon />
                </Link>
              </article>
            );
          })}
        </div>
        <p className="mt-4 text-[13px] text-[#8a877f]">
          *Lowest three-night break per lodge, subject to season and availability.
        </p>

        {/* Cedar vs Signature comparison card. */}
        <div className="mt-12 border border-line rounded-xl grid min-[1000px]:grid-cols-2 overflow-hidden">
          <div className="p-7 sm:px-10 sm:py-9 border-b min-[1000px]:border-b-0 min-[1000px]:border-r border-line">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-olive mb-3.5">
              In every Cedar lodge
            </p>
            <div className="grid gap-[11px]">
              {CEDAR_CARD_SUMMARY.map((line) => (
                <p key={line} className="flex items-start gap-[11px] text-[15px]">
                  <TickIcon />
                  {line}
                </p>
              ))}
            </div>
          </div>
          <div className="p-7 sm:px-10 sm:py-9 bg-mist">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink mb-3.5">
              Signature adds, at either size
            </p>
            <div className="grid gap-[11px]">
              {SIGNATURE_CARD_SUMMARY.map((line) => (
                <p key={line} className="flex items-start gap-[11px] text-[15px]">
                  <TickIcon />
                  {line}
                </p>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 5. Things to do: olive band with tiles overlapping its bottom edge. */}
      <section id="things-to-do" className="mt-[72px] sm:mt-[120px]">
        <div className="bg-olive pt-[52px] pb-[100px]">
          <div className={container}>
            <SectionHead
              eyebrow="Things to do"
              heading={home.sections.activitiesHeading}
              intro={home.sections.activitiesIntro}
              dark
              divided={false}
            />
          </div>
        </div>
        <div className={`${container} -mt-14`}>
          <div className="grid gap-7 min-[1000px]:grid-cols-[1.4fr_1fr]">
            {activityMain && (
              <article className="relative rounded-xl overflow-hidden min-h-[340px] min-[1000px]:min-h-[460px]">
                <Image
                  src={mediaRef(activityMain.photo).url}
                  alt={mediaRef(activityMain.photo).alt}
                  fill
                  className="object-cover object-[center_68%] photo-tone"
                />
                <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(12,18,10,0.85)_0%,rgba(12,18,10,0.1)_58%,rgba(12,18,10,0)_100%)]" />
                <div className="absolute left-6 right-6 bottom-6 sm:left-[34px] sm:right-[34px] sm:bottom-8">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#c9dbb2] mb-3">
                    Included every day
                  </p>
                  <h3 className="font-display text-[26px] sm:text-[32px] font-bold text-white mb-2.5">
                    {activityMain.title}
                  </h3>
                  <p className="text-[15px] leading-[1.65] text-white/85 max-w-[36ch]">
                    {activityMain.copy}
                  </p>
                </div>
              </article>
            )}
            <div className="grid gap-7 grid-rows-2">
              {activitySide.map((activity) => (
                <article
                  key={activity.slug}
                  className="relative rounded-xl overflow-hidden min-h-[216px]"
                >
                  <Image
                    src={mediaRef(activity.photo).url}
                    alt={mediaRef(activity.photo).alt}
                    fill
                    className="object-cover photo-tone"
                  />
                  <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(12,18,10,0.85)_0%,rgba(12,18,10,0)_70%)]" />
                  <div className="absolute left-[26px] right-[26px] bottom-6">
                    <h3 className="font-display text-[22px] font-bold text-white mb-1.5">
                      {activity.title}
                    </h3>
                    <p className="text-sm leading-[1.6] text-white/85">{activity.copy}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
          <p className="mt-[22px] text-sm text-[#8a877f]">
            Spa treatments, bike hire and firewood are added to your booking in
            the village, not at checkout.
          </p>
        </div>
      </section>

      {/* 6. When to come: the four seasons with indicative from-prices. */}
      <section id="seasons" className={`${container} pt-[72px] sm:pt-[120px]`}>
        <SectionHead
          eyebrow="When to come"
          heading={home.sections.seasonsHeading}
          intro="The stove is lit all year. What changes is the sky."
        />
        <div className="grid gap-7 min-[640px]:grid-cols-2 min-[1000px]:grid-cols-4 mt-11">
          {seasons.map((season) => (
            <article key={season.slug} className="flex flex-col">
              <div className="aspect-[16/10] overflow-hidden bg-mist rounded-xl relative">
                <Image
                  src={mediaRef(season.photo).url}
                  alt={mediaRef(season.photo).alt}
                  fill
                  className="object-cover photo-tone"
                />
              </div>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#8a877f] mt-5 mb-1.5">
                {season.months}
              </p>
              <h3 className="font-display text-[21px] font-bold text-ink mb-2">
                {season.title}
              </h3>
              <p className="text-sm leading-[1.65] text-[#5f5c55] mb-[18px]">
                {season.copy}
              </p>
              <p className="mt-auto pt-4 border-t border-line text-[13px] text-[#8a877f]">
                from{" "}
                <strong className="font-display block mt-[3px] text-[21px] font-bold text-ink">
                  {season.fromPrice.replace(/^from\s+/, "")}
                </strong>
              </p>
            </article>
          ))}
        </div>
        <p className="mt-5 text-[13px] text-[#8a877f]">{home.sections.seasonsFootnote}</p>
      </section>

      {/* 7. FAQ: sticky intro left, native details accordion right. */}
      <section id="faq" className={`${container} pt-[72px] sm:pt-[120px]`}>
        <div className="grid gap-10 min-[900px]:grid-cols-[1fr_1.5fr] min-[900px]:gap-20 items-start">
          <div className="min-[900px]:sticky min-[900px]:top-10">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-olive mb-[18px]">
              Questions
            </p>
            <h2 className="font-display text-[32px] sm:text-[42px] font-bold leading-[1.12] tracking-[-0.015em] text-ink">
              {home.sections.faqsHeading}
            </h2>
            <p className="mt-[22px] text-base leading-[1.7] text-[#6f6c64]">
              Still stuck? Call the village on{" "}
              <a href="tel:+254700000000" className="font-bold text-navy">
                +254 700 000 000
              </a>
              .
            </p>
          </div>
          <div>
            {faqs.map((faq, index) => (
              <details
                key={faq.question}
                className={`group border-t border-line ${
                  index === faqs.length - 1 ? "border-b" : ""
                }`}
                open={index === 0}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 font-display text-lg sm:text-[19px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                  {faq.question}
                  <span className="shrink-0 text-olive text-2xl font-light transition-transform duration-150 group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="pb-6 text-[15px] leading-[1.75] max-w-[66ch]">{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* 8. Closing CTA card. */}
      <section className={`${container} mt-[72px] sm:mt-[120px]`}>
        <div className="relative rounded-xl overflow-hidden min-h-[340px] flex items-center">
          <Image
            src="/photos/discover-groups.jpg"
            alt="A party gathered on the deck of a lodge"
            fill
            className="object-cover photo-tone"
          />
          <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(12,18,10,0.88)_0%,rgba(12,18,10,0.4)_66%,rgba(12,18,10,0.1)_100%)]" />
          <div className="relative p-11 sm:p-16 max-w-[660px]">
            <h2 className="font-display text-[28px] sm:text-4xl font-bold leading-[1.15] tracking-[-0.015em] text-white">
              Your dates are still free. <em className="italic">For now.</em>
            </h2>
            <p className="mt-[18px] mb-[30px] text-base leading-[1.7] text-white/85 max-w-[46ch]">
              School holidays and festive weeks fill first. Find yours while the
              lanes are still open.
            </p>
            <div className="flex gap-3.5 flex-wrap">
              <Link
                href="/#search"
                className="bg-ochre text-white text-base font-bold rounded-md px-7 py-[13px] hover:bg-ochre-dark transition-colors"
              >
                Find your break
              </Link>
              <Link
                href="/#lodges"
                className="border border-white/60 text-white text-base font-semibold rounded-md px-7 py-[13px] hover:bg-white/10 transition-colors"
              >
                Compare the lodges
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/* Small inline icons, stroke currentColor to inherit text colour. */

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
      className="shrink-0 mt-[5px] text-leaf"
    >
      <path d="m4 12.5 5.5 5.5L20 6.5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}
