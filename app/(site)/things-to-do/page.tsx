import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getActivities, mediaRef } from "@/server/content";

/**
 * The things-to-do landing. The included list and the bookable catalogue
 * are code-owned (product truth from docs/village-and-content-direction.md
 * section 6); the four feature cards come from the CMS Activities
 * collection so editors keep owning them. Honesty rule: activities are
 * booked at the desk today, and the page says so rather than pretending an
 * activity-booking engine exists.
 */

export const metadata: Metadata = {
  title: "Unity Parks | Things to do",
  description:
    "Warm water and forest trails included in every break, a dozen real activities to book on site, and the wild beyond the fence.",
};

const INCLUDED = [
  { name: "The Water Garden", note: "Covered, heated and glazed toward the mountain. The anchor of every day, whatever the sky does." },
  { name: "The outdoor pool", note: "Alongside the Water Garden for the dry months." },
  { name: "The forest trails", note: "Waymarked walking and running loops under the big trees." },
  { name: "The village green and playgrounds", note: "The bit the children organise themselves." },
  { name: "The sunrise deck", note: "On the forest edge, for the mornings the peaks come out." },
  { name: "Courts and table tennis at The Barn", note: "Rackets at the desk, honour rules on the scoreboard." },
] as const;

const BOOKABLE = [
  { name: "The canopy walkway", note: "Timed entry, up in the crowns" },
  { name: "Guided forest walk", note: "Mornings, with a village guide" },
  { name: "Night walk", note: "Tree hyrax, bushbabies, the sounds after dark" },
  { name: "Trout fishing", note: "On the Burguret beat, rods provided" },
  { name: "Horse riding", note: "Trails and lessons; this is riding country" },
  { name: "Cycle hire", note: "Per bike, per break, trailers for the little ones" },
  { name: "Climbing wall and high ropes", note: "At The Barn" },
  { name: "Archery", note: "At The Barn" },
  { name: "The craft workshop", note: "Pottery and making, built for wet afternoons" },
  { name: "Stargazing evening", note: "Both hemispheres' skies, at altitude, on the equator" },
  { name: "Kids' club sessions", note: "At The Den" },
  { name: "Swim lessons", note: "In the Water Garden, early" },
] as const;

const BEYOND = [
  { name: "Ol Pejeta Conservancy", note: "The big-name day trip: rhino, chimps and open plains." },
  { name: "Ngare Ndare Forest", note: "Blue pools and the famous canopy bridge." },
  { name: "The equator line", note: "Just north of Nanyuki, for the photograph." },
  { name: "Routes onto the mountain", note: "Guided, serious and unforgettable, for the ambitious." },
] as const;

export default async function ThingsToDoPage() {
  const activities = await getActivities();

  return (
    <div>
      {/* Hero */}
      <section className="relative h-[380px]">
        <Image
          src="/photos/activity-pool.jpg"
          alt="Warm water in the Water Garden"
          fill
          priority
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0">
          <div className="mx-auto max-w-6xl px-5 pb-8">
            <p className="text-sm font-semibold uppercase tracking-widest text-white/80">
              Included first, extras second
            </p>
            <h1 className="font-display text-4xl font-bold text-white sm:text-5xl">
              Things to do
            </h1>
            <p className="mt-1 text-lg italic text-white/90">
              Days in the village fill themselves. Here is what they are made of.
            </p>
          </div>
        </div>
      </section>

      {/* Included */}
      <section className="mx-auto max-w-6xl px-5 py-12">
        <h2 className="font-display text-3xl font-bold text-ink">
          Included in every break
        </h2>
        <p className="mt-2 max-w-2xl text-foreground/80">
          Including the water is the decision the whole village rests on: the
          anchor is never ticketed, so a wet afternoon costs a family nothing.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {INCLUDED.map((item) => (
            <div key={item.name} className="rounded-lg border border-line bg-white p-5">
              <p className="font-display text-lg font-bold text-olive">{item.name}</p>
              <p className="mt-1.5 text-sm text-foreground">{item.note}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CMS feature cards */}
      <section className="bg-mist">
        <div className="mx-auto max-w-6xl px-5 py-12">
          <h2 className="font-display text-3xl font-bold text-ink">
            Where days usually start
          </h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {activities.map((activity) => (
              <div
                key={activity.slug}
                className="rounded-lg border border-line bg-white overflow-hidden"
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
                  <p className="font-display text-lg font-bold text-navy">{activity.title}</p>
                  <p className="mt-1.5 text-sm text-foreground">{activity.copy}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bookable */}
      <section className="mx-auto max-w-6xl px-5 py-12">
        <h2 className="font-display text-3xl font-bold text-ink">
          Bookable on your break
        </h2>
        <p className="mt-2 max-w-2xl text-foreground/80">
          A dozen real things, run properly, rather than two hundred on a
          poster. Book them at The Barn once you arrive; booking them online
          before you travel is still being built, and this page will say so
          the day that changes.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {BOOKABLE.map((item) => (
            <div key={item.name} className="rounded-md border border-line bg-white px-4 py-3">
              <p className="font-semibold text-ink">{item.name}</p>
              <p className="text-sm text-foreground/70">{item.note}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The spa */}
      <section className="bg-mist">
        <div className="mx-auto max-w-6xl px-5 py-12 grid gap-8 lg:grid-cols-2 lg:items-center">
          <div className="relative aspect-[3/2] rounded-lg overflow-hidden border border-line">
            <Image
              src="/photos/activity-spa.jpg"
              alt="The Forest Spa"
              fill
              className="object-cover"
            />
          </div>
          <div>
            <h2 className="font-display text-3xl font-bold text-ink">The Forest Spa</h2>
            <p className="mt-3 max-w-xl text-foreground">
              On a cold mountain a spa sells heat: hot pools, sauna, steam and
              outdoor tubs looking at the peaks, ten minutes uphill through
              the trees. Adults only, quiet is the rule, and the day pass is
              one of the extras you can add to any break.
            </p>
          </div>
        </div>
      </section>

      {/* Beyond the fence */}
      <section className="mx-auto max-w-6xl px-5 py-12">
        <h2 className="font-display text-3xl font-bold text-ink">Beyond the fence</h2>
        <p className="mt-2 max-w-2xl text-foreground/80">
          Partner-run day trips, sold at the desk. They are somebody else's
          operations, run well, and we say so.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BEYOND.map((trip) => (
            <div key={trip.name} className="rounded-lg border border-line bg-white p-5">
              <p className="font-display text-lg font-bold text-navy">{trip.name}</p>
              <p className="mt-1.5 text-sm text-foreground">{trip.note}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-olive">
        <div className="mx-auto max-w-6xl px-5 py-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <p className="font-display text-2xl font-bold text-white">
            The Water Garden is included. Everything else is appetite.
          </p>
          <Link href="/#search" className="btn-primary shrink-0">
            Find your break
          </Link>
        </div>
      </section>
    </div>
  );
}
