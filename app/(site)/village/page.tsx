import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ZONES } from "@/content/village";
import { getSeasons, mediaRef } from "@/server/content";

/**
 * The village page: the character piece behind "Discover Unity Parks".
 * Copy is code-owned (same convention as content/lodges.ts); the seasons
 * strip is CMS-driven so its prices stay in step with the homepage cards.
 * This is the one page that gets "karibu" (docs/DESIGN.md voice rules).
 */

export const metadata: Metadata = {
  title: "Unity Parks | The village",
  description:
    "A car-free forest village on the western slopes of Mount Kenya: one gate, one road in, and warm water at the heart of it.",
};

const SQUARE = [
  { name: "The Water Garden", note: "Warm water under glass, looking at the mountain. Included in every break." },
  { name: "The Market", note: "Groceries, the butcher's counter, firewood and the things people forget." },
  { name: "The Bakehouse", note: "Bread, coffee and pastries from six in the morning." },
  { name: "The Long Table", note: "All-day family restaurant. High chairs everywhere, no booking needed." },
  { name: "Kirimara", note: "The evening restaurant, bookable, for the night the parents get an hour to themselves." },
  { name: "The Barn", note: "Bike hire, the climbing wall, indoor courts and the bookings desk." },
  { name: "The Den", note: "Kids' club and soft play, for the hours the grown-ups pretend not to enjoy." },
] as const;

const WILDLIFE = [
  "Colobus and sykes monkeys in the canopy",
  "Tree hyrax calling after dark",
  "Bushbuck in the glades at dawn",
  "Hartlaub's turacos and sunbirds",
  "Trout in the Burguret",
  "Elephant and buffalo beyond the fence, which is exactly why there is one",
] as const;

export default async function VillagePage() {
  const seasons = await getSeasons();

  return (
    <div>
      {/* Hero */}
      <section className="relative h-[380px]">
        <Image
          src="/photos/band-lake.jpg"
          alt="Golden evening light over the forest"
          fill
          priority
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0">
          <div className="mx-auto max-w-6xl px-5 pb-8">
            <p className="text-sm font-semibold uppercase tracking-widest text-white/80">
              Naro Moru · Mount Kenya
            </p>
            <h1 className="font-display text-4xl font-bold text-white sm:text-5xl">
              The village
            </h1>
            <p className="mt-1 text-lg italic text-white/90">
              A car-free forest village on the western slopes of Mount Kenya
            </p>
          </div>
        </div>
      </section>

      {/* Karibu */}
      <section className="mx-auto max-w-6xl px-5 py-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="max-w-2xl">
          <p className="text-lg leading-relaxed text-foreground">
            Karibu. Unity Parks Mount Kenya sits in indigenous montane forest
            at Naro Moru: cedar and podo, wild olive and fig, the forest
            reserve as our eastern boundary and the Burguret running down
            through the middle. Days are mild, nights are properly cold, and
            the mountain shows itself at dawn and again at sunset, which is
            why an early breakfast here is an event.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-foreground">
            The promise underneath everything: you arrive, you park beside
            your lodge, and you do not get back in the car until you leave.
            Every lane loops, there is no through road, and the children can
            cross the village on their own because there are no cars in it.
          </p>
        </div>
        <div className="rounded-lg border border-line bg-mist p-6">
          <p className="font-display text-lg font-bold text-ink">What this is not</p>
          <ul className="mt-3 space-y-2.5 text-sm text-foreground">
            <li>Not a safari camp: wildlife is a neighbour here, not an itinerary.</li>
            <li>Not a coast hotel: no flight, no packing for a week of heat.</li>
            <li>Not a resort with a lawn: it is a village, with a centre and lanes.</li>
          </ul>
        </div>
      </section>

      {/* The map and the zones */}
      <section className="bg-mist">
        <div className="mx-auto max-w-6xl px-5 py-12">
          <h2 className="font-display text-3xl font-bold text-ink">
            One village, four corners
          </h2>
          <p className="mt-2 max-w-2xl text-foreground/80">
            The land climbs from the gate to the forest edge, and character
            climbs with it. Where your lodge sits is a real choice, made on
            the Location step when you book.
          </p>
          <div className="mt-6 rounded-lg bg-white border border-line overflow-hidden">
            <Image
              src="/village-map.svg"
              alt="Illustrated map of the Unity Parks Mount Kenya village"
              width={1200}
              height={640}
              className="w-full h-auto"
            />
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {ZONES.map((zone) => (
              <div key={zone.id} className="rounded-lg border border-line bg-white p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-display text-lg font-bold text-navy">{zone.name}</p>
                  {!zone.live && (
                    <span className="text-xs font-semibold text-foreground/50">
                      Opens with a later phase
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-sm text-foreground">{zone.character}</p>
                <p className="mt-1.5 text-xs font-semibold text-foreground/60">{zone.suits}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The square */}
      <section className="mx-auto max-w-6xl px-5 py-12">
        <h2 className="font-display text-3xl font-bold text-ink">The Village Square</h2>
        <p className="mt-2 max-w-2xl text-foreground/80">
          Low and central, within a ten-minute walk of every lodge, and the
          reason nobody misses their car.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SQUARE.map((place) => (
            <div key={place.name} className="rounded-lg border border-line bg-white p-5">
              <p className="font-display text-lg font-bold text-olive">{place.name}</p>
              <p className="mt-1.5 text-sm text-foreground">{place.note}</p>
            </div>
          ))}
          <div className="rounded-lg border border-line bg-white p-5">
            <p className="font-display text-lg font-bold text-olive">The Forest Spa</p>
            <p className="mt-1.5 text-sm text-foreground">
              Deliberately apart, ten minutes uphill through the trees. Adults
              only, and quiet is the rule.
            </p>
          </div>
        </div>
      </section>

      {/* Wildlife */}
      <section className="bg-mist">
        <div className="mx-auto max-w-6xl px-5 py-12 grid gap-8 lg:grid-cols-2 lg:items-start">
          <div>
            <h2 className="font-display text-3xl font-bold text-ink">
              Neighbours, behind an honest fence
            </h2>
            <p className="mt-3 max-w-xl text-foreground">
              The eastern edge of the village is the Mount Kenya forest
              reserve, and the fence along it is not hidden. It is the edge of
              the wild, and standing at it is one of the things you come for.
              The trailhead, the canopy walk and the sunrise deck all start
              there.
            </p>
          </div>
          <ul className="grid gap-2.5 text-sm text-foreground sm:grid-cols-2">
            {WILDLIFE.map((line) => (
              <li key={line} className="rounded-md border border-line bg-white px-4 py-3">
                {line}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Getting there */}
      <section className="mx-auto max-w-6xl px-5 py-12">
        <h2 className="font-display text-3xl font-bold text-ink">Getting here</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-white p-5">
            <p className="font-display text-lg font-bold text-navy">By road</p>
            <p className="mt-1.5 text-sm text-foreground">
              About 180 km from Nairobi on the A2: two and a half to three
              hours, tarmac the whole way.
            </p>
          </div>
          <div className="rounded-lg border border-line bg-white p-5">
            <p className="font-display text-lg font-bold text-navy">By air</p>
            <p className="mt-1.5 text-sm text-foreground">
              Nanyuki airstrip is 30 km north, and a road transfer covers the
              last half hour.
            </p>
          </div>
          <div className="rounded-lg border border-line bg-white p-5">
            <p className="font-display text-lg font-bold text-navy">At the gate</p>
            <p className="mt-1.5 text-sm text-foreground">
              We take your number plate at booking, so the Gatehouse simply
              opens as you arrive.
            </p>
          </div>
        </div>
      </section>

      {/* Seasons strip */}
      <section className="bg-mist">
        <div className="mx-auto max-w-6xl px-5 py-12">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <h2 className="font-display text-3xl font-bold text-ink">
              A forest for every season
            </h2>
            <Link href="/breaks" className="text-sm font-bold text-olive hover:text-leaf">
              See breaks and prices
            </Link>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {seasons.map((season) => (
              <Link
                key={season.slug}
                href="/breaks"
                className="group rounded-lg border border-line bg-white overflow-hidden"
              >
                <div className="relative aspect-[16/9]">
                  <Image
                    src={mediaRef(season.photo).url}
                    alt={mediaRef(season.photo).alt}
                    fill
                    className="object-cover"
                  />
                </div>
                <div className="p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60">
                    {season.months}
                  </p>
                  <p className="font-display text-lg font-bold text-navy group-hover:text-olive">
                    {season.title}
                  </p>
                  <p className="mt-1 text-sm font-bold text-ink">{season.fromPrice}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-olive">
        <div className="mx-auto max-w-6xl px-5 py-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <p className="font-display text-2xl font-bold text-white">
            The village is a ten-minute walk end to end. Come and cross it.
          </p>
          <Link href="/#search" className="btn-primary shrink-0">
            Find your break
          </Link>
        </div>
      </section>
    </div>
  );
}
