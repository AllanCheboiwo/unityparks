import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaign, mediaRef } from "@/server/content";

/**
 * An evergreen campaign page (docs/village-and-content-direction.md section
 * 10.4): the window line changes in the admin, the page never dates. Fully
 * CMS-driven; the site banner (SiteSettings) is what points guests here.
 * The break shapes strip is code, not CMS, because it is product truth.
 */

const BREAK_SHAPES = [
  { name: "Weekend break", nights: "3 nights", days: "Friday to Monday" },
  { name: "Midweek break", nights: "4 nights", days: "Monday to Friday" },
  { name: "Full week", nights: "7 nights", days: "Friday or Monday start" },
] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const campaign = await getCampaign((await params).slug);
  if (!campaign) return {};
  return {
    title: `Unity Parks | ${campaign.name}`,
    description: campaign.strapline,
  };
}

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const campaign = await getCampaign((await params).slug);
  if (!campaign) notFound();
  const hero = mediaRef(campaign.hero);

  return (
    <div>
      {/* Hero: image band, window eyebrow, name, strapline */}
      <section className="relative h-[420px]">
        <Image
          src={hero.url}
          alt={hero.alt}
          fill
          priority
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0">
          <div className="mx-auto max-w-6xl px-5 pb-8">
            <p className="text-sm font-semibold uppercase tracking-widest text-white/80">
              {campaign.window}
            </p>
            <h1 className="font-display text-4xl font-bold text-white sm:text-5xl">
              {campaign.name}
            </h1>
            <p className="mt-1 text-lg italic text-white/90">{campaign.strapline}</p>
          </div>
        </div>
      </section>

      {/* Intro and the price, side by side on desktop */}
      <section className="mx-auto max-w-6xl px-5 py-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <p className="text-lg leading-relaxed text-foreground max-w-2xl">
          {campaign.intro}
        </p>
        <div className="rounded-lg border border-line bg-mist p-6">
          <p className="text-sm text-foreground/60">3-night breaks</p>
          <p className="mt-1 font-display text-3xl font-bold text-ink">
            {campaign.fromPrice}
          </p>
          <Link href="/#search" className="btn-primary mt-4 inline-block">
            {campaign.ctaLabel}
          </Link>
          <p className="mt-3 text-xs text-foreground/60">{campaign.fromNote}</p>
        </div>
      </section>

      {/* Highlights */}
      <section className="bg-mist">
        <div className="mx-auto max-w-6xl px-5 py-12">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {(campaign.highlights ?? []).map((h) => {
              const photo = mediaRef(h.photo);
              return (
                <div
                  key={h.id ?? h.title}
                  className="rounded-lg border border-line bg-white overflow-hidden"
                >
                  <div className="relative aspect-[3/2]">
                    <Image
                      src={photo.url}
                      alt={photo.alt}
                      fill
                      className="object-cover"
                    />
                  </div>
                  <div className="p-5">
                    <h2 className="font-display text-xl font-bold text-navy">
                      {h.title}
                    </h2>
                    <p className="mt-2 text-sm text-foreground">{h.copy}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* The three break shapes: product truth, same on every campaign */}
      <section className="mx-auto max-w-6xl px-5 py-12">
        <h2 className="font-display text-3xl font-bold text-ink">
          Breaks start on a Friday or a Monday
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {BREAK_SHAPES.map((shape) => (
            <div key={shape.name} className="rounded-lg border border-line bg-white p-5">
              <p className="font-display text-lg font-bold text-olive">{shape.name}</p>
              <p className="mt-1 text-2xl font-bold text-ink">{shape.nights}</p>
              <p className="mt-1 text-sm text-foreground/70">{shape.days}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Campaign questions, if the editor added any */}
      {campaign.faqs && campaign.faqs.length > 0 && (
        <section className="mx-auto max-w-6xl px-5 pb-12">
          <h2 className="font-display text-3xl font-bold text-ink">
            Questions, answered
          </h2>
          <div className="mt-4">
            {campaign.faqs.map((faq) => (
              <details
                key={faq.id ?? faq.question}
                className="group border-b border-line py-4"
              >
                <summary className="flex cursor-pointer items-center justify-between text-lg font-semibold text-ink list-none">
                  {faq.question}
                  <span className="ml-4 text-olive transition-transform group-open:rotate-90">
                    ›
                  </span>
                </summary>
                <p className="mt-3 text-foreground">{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* Closing CTA */}
      <section className="bg-olive">
        <div className="mx-auto max-w-6xl px-5 py-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <p className="font-display text-2xl font-bold text-white">
            {campaign.name}: {campaign.window}
          </p>
          <Link href="/#search" className="btn-primary shrink-0">
            {campaign.ctaLabel}
          </Link>
        </div>
      </section>
    </div>
  );
}
