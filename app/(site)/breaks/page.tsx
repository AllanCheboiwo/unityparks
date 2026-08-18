import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getSeasons, mediaRef } from "@/server/content";

/**
 * The breaks overview: the three shapes, who can travel when, the four
 * seasons with their real from-prices (CMS-driven, same cards as the
 * homepage) and the two evergreen campaigns. This is the destination the
 * season cards' "Explore breaks" buttons deserve.
 */

export const metadata: Metadata = {
  title: "Unity Parks | Breaks",
  description:
    "Weekend, midweek or a full week: breaks start on a Friday or a Monday, all year, priced by season per lodge.",
};

const SHAPES = [
  {
    name: "Weekend break",
    nights: "3 nights",
    days: "Friday to Monday",
    note: "The easiest sale in the range: leave after school on Friday, back for Monday evening.",
  },
  {
    name: "Midweek break",
    nights: "4 nights",
    days: "Monday to Friday",
    note: "Quieter lanes, better value, and the village mostly to yourselves.",
  },
  {
    name: "Full week",
    nights: "7 nights",
    days: "Friday or Monday start",
    note: "The best value in the range once a three-hour drive is part of the sum.",
  },
] as const;

const CAMPAIGNS = [
  {
    slug: "august-by-the-fire",
    name: "August by the fire",
    window: "June to September",
    line: "Mist at dawn, fires by five, the Water Garden steaming. The one the coast cannot answer.",
  },
  {
    slug: "the-festive-break",
    name: "The festive break",
    window: "Mid-December to early January",
    line: "A Friday or Monday start covering Christmas or New Year. The first weeks to sell out.",
  },
] as const;

export default async function BreaksPage() {
  const seasons = await getSeasons();

  return (
    <div>
      {/* Hero */}
      <section className="relative h-[380px]">
        <Image
          src="/photos/season-festive.jpg"
          alt="Lights in the trees at festive time"
          fill
          priority
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0">
          <div className="mx-auto max-w-6xl px-5 pb-8">
            <p className="text-sm font-semibold uppercase tracking-widest text-white/80">
              Fridays and Mondays, all year
            </p>
            <h1 className="font-display text-4xl font-bold text-white sm:text-5xl">
              Breaks
            </h1>
            <p className="mt-1 text-lg italic text-white/90">
              Three shapes, four seasons, one price per lodge
            </p>
          </div>
        </div>
      </section>

      {/* The three shapes */}
      <section className="mx-auto max-w-6xl px-5 py-12">
        <h2 className="font-display text-3xl font-bold text-ink">
          The turnover rule is the product
        </h2>
        <p className="mt-2 max-w-2xl text-foreground/80">
          Every break starts on a Friday or a Monday, so every break is one of
          three shapes, and the village turns over in one smooth day.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {SHAPES.map((shape) => (
            <div key={shape.name} className="rounded-lg border border-line bg-white p-5">
              <p className="font-display text-lg font-bold text-olive">{shape.name}</p>
              <p className="mt-1 text-2xl font-bold text-ink">{shape.nights}</p>
              <p className="text-sm text-foreground/70">{shape.days}</p>
              <p className="mt-2.5 text-sm text-foreground">{shape.note}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Who travels when */}
      <section className="bg-mist">
        <div className="mx-auto max-w-6xl px-5 py-12">
          <h2 className="font-display text-3xl font-bold text-ink">
            Who can come, and when
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-line bg-white p-5">
              <p className="font-display text-lg font-bold text-navy">School holidays</p>
              <p className="mt-1.5 text-sm text-foreground">
                April, August, and late October to early January. These weeks
                book first and fill fastest; if the dates are fixed by a term
                calendar, book early.
              </p>
            </div>
            <div className="rounded-lg border border-line bg-white p-5">
              <p className="font-display text-lg font-bold text-navy">Term time</p>
              <p className="mt-1.5 text-sm text-foreground">
                Couples, grandparents, remote workers and families with
                pre-school children get the quiet village, the midweek prices
                and the spa at its stillest.
              </p>
            </div>
            <div className="rounded-lg border border-line bg-white p-5">
              <p className="font-display text-lg font-bold text-navy">Long weekends</p>
              <p className="mt-1.5 text-sm text-foreground">
                A Friday three-night break covers a Monday public holiday
                exactly: Easter, Labour Day, Madaraka Day, Mashujaa Day and
                the rest.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Seasons and prices */}
      <section className="mx-auto max-w-6xl px-5 py-12">
        <h2 className="font-display text-3xl font-bold text-ink">Pick your season</h2>
        <p className="mt-2 max-w-2xl text-foreground/80">
          Prices are per lodge per break, whatever the party size, and they
          move with the season, not with the number of people in the car.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {seasons.map((season) => (
            <div
              key={season.slug}
              className="flex flex-col rounded-lg border border-line bg-white overflow-hidden"
            >
              <div className="relative aspect-[16/9]">
                <Image
                  src={mediaRef(season.photo).url}
                  alt={mediaRef(season.photo).alt}
                  fill
                  className="object-cover"
                />
              </div>
              <div className="flex flex-1 flex-col p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60">
                  {season.months}
                </p>
                <p className="font-display text-lg font-bold text-navy">{season.title}</p>
                <p className="mt-1 text-sm text-foreground">{season.copy}</p>
                <p className="mt-3 text-base font-bold text-ink">{season.fromPrice}</p>
                <div className="mt-auto pt-3">
                  <Link href="/#search" className="btn-outline inline-block text-sm">
                    Check dates
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-foreground/60">
          *Lowest price for a three-night Cedar Lodge 2 bedroom break in the
          season, subject to availability.
        </p>
      </section>

      {/* Campaigns */}
      <section className="bg-mist">
        <div className="mx-auto max-w-6xl px-5 py-12">
          <h2 className="font-display text-3xl font-bold text-ink">
            The two moments of the year
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {CAMPAIGNS.map((campaign) => (
              <Link
                key={campaign.slug}
                href={`/breaks/${campaign.slug}`}
                className="group rounded-lg border border-line bg-white p-6 transition hover:border-navy/40"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60">
                  {campaign.window}
                </p>
                <p className="font-display text-2xl font-bold text-navy group-hover:text-olive">
                  {campaign.name}
                </p>
                <p className="mt-2 text-sm text-foreground">{campaign.line}</p>
                <p className="mt-3 text-sm font-bold text-olive">
                  Explore the break ›
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-olive">
        <div className="mx-auto max-w-6xl px-5 py-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <p className="font-display text-2xl font-bold text-white">
            Bookable thirteen months out. The best weeks go first.
          </p>
          <Link href="/#search" className="btn-primary shrink-0">
            Find your break
          </Link>
        </div>
      </section>
    </div>
  );
}
