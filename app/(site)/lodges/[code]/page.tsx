import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { LODGES, TIER_ORDER, type LodgeContent } from "@/content/lodges";

/**
 * The lodge-type detail page: galleries, room-by-room, what's included, a
 * schematic floor plan. Pure content from content/lodges.ts - no session,
 * no Apaleo, no prices (prices belong to a search with real dates, one
 * click away). Not to be confused with /lodges, the funnel selection page.
 */

function lodgeFor(code: string): LodgeContent | null {
  return LODGES[code.toUpperCase()] ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const lodge = lodgeFor((await params).code);
  if (!lodge) return {};
  return {
    title: `${lodge.name} · Unity Parks`,
    description: lodge.blurb,
  };
}

/**
 * A schematic floor plan drawn from the content's room list: deck and
 * terrace entries become the bottom strip, the living space takes the left
 * block, everything else fills a grid on the right. Deliberately a diagram,
 * not architecture - it shows what the lodge has and roughly where.
 */
/** Two-line labels for long room names, split at the middle-most space. */
function labelLines(name: string): string[] {
  if (name.length <= 16) return [name];
  const middle = Math.floor(name.length / 2);
  let split = -1;
  for (let i = 0; i < name.length; i++) {
    if (name[i] === " " && (split === -1 || Math.abs(i - middle) < Math.abs(split - middle))) {
      split = i;
    }
  }
  if (split === -1) return [name];
  return [name.slice(0, split), name.slice(split + 1)];
}

/** One labelled room box. Declared at module level, not inside FloorPlan: a
 *  component created during render is a fresh type every pass. */
function Room({
  x,
  y,
  w,
  h,
  name,
  fill,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  fill: string;
}) {
  const lines = labelLines(name);
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={fill} stroke="#b9b4a8" strokeWidth="1.5" />
      <text
        x={x + w / 2}
        y={y + h / 2 - (lines.length - 1) * 6}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="11"
        fontWeight="600"
        fill="#1d1d1d"
      >
        {lines.map((line, i) => (
          <tspan key={i} x={x + w / 2} dy={i === 0 ? 0 : 13}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function FloorPlan({ lodge }: { lodge: LodgeContent }) {
  const rooms = lodge.detail.rooms;
  const deck = rooms.find((r) => /deck|terrace/i.test(r.name));
  const living = rooms.find((r) => /living/i.test(r.name));
  const rest = rooms.filter((r) => r !== deck && r !== living);

  const W = 480;
  const H = 300;
  const M = 8; // outer margin
  const DECK_H = 64;
  const LIVING_W = 190;
  const innerTop = M;
  const innerBottom = H - M - DECK_H;
  const gridX = M + LIVING_W;
  const gridW = W - M - gridX;
  const cols = 2;
  const rowCount = Math.ceil(rest.length / cols);
  const rowH = (innerBottom - innerTop) / Math.max(1, rowCount);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Schematic floor plan of the ${lodge.name}`}
      className="w-full min-w-[420px] max-w-xl"
    >
      {deck && (
        <Room x={M} y={innerBottom} w={W - 2 * M} h={DECK_H} name={deck.name} fill={`${lodge.accent}22`} />
      )}
      {living && (
        <Room x={M} y={innerTop} w={LIVING_W} h={innerBottom - innerTop} name={living.name} fill="#ffffff" />
      )}
      {rest.map((room, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        // The last room in an odd-count list stretches across both columns.
        const isWide = col === 0 && i === rest.length - 1;
        return (
          <Room
            key={room.name}
            x={gridX + col * (gridW / cols)}
            y={innerTop + row * rowH}
            w={isWide ? gridW : gridW / cols}
            h={rowH}
            name={room.name}
            fill="#f5f3ee"
          />
        );
      })}
      <rect x={M} y={M} width={W - 2 * M} height={H - 2 * M} fill="none" stroke="#4c4e4b" strokeWidth="2.5" />
    </svg>
  );
}

function TickIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-leaf" aria-hidden>
      <path d="M4 12.5 9.5 18 20 6.5" />
    </svg>
  );
}

export default async function LodgeDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const lodge = lodgeFor((await params).code);
  if (!lodge) notFound();
  const others = TIER_ORDER.filter((code) => code !== lodge.code).map((code) => LODGES[code]);

  return (
    <div>
      {/* Hero */}
      <section className="relative h-[420px]">
        <Image src={lodge.image} alt={lodge.name} fill priority className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0">
          <div className="mx-auto max-w-6xl px-5 pb-8">
            <p className="text-sm font-semibold uppercase tracking-widest text-white/80">
              Mount Kenya village
            </p>
            <h1 className="font-display text-4xl font-bold text-white sm:text-5xl">
              {lodge.name}
            </h1>
            <p className="mt-1 text-lg italic text-white/90">{lodge.tagline}</p>
          </div>
        </div>
      </section>

      {/* Key facts bar */}
      <section className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4">
          <span className="text-sm font-semibold text-navy">
            {lodge.bedrooms} bedrooms
          </span>
          <span className="text-sm font-semibold text-navy">Sleeps {lodge.sleeps}</span>
          {lodge.features.slice(0, 3).map((feature) => (
            <span key={feature} className="hidden text-sm text-foreground sm:inline">
              {feature}
            </span>
          ))}
          <span className="grow" />
          <Link href="/#search" className="btn-primary">
            Check dates and prices
          </Link>
        </div>
      </section>

      {/* Intro */}
      <section className="mx-auto max-w-6xl px-5 py-12">
        <div className="max-w-3xl">
          {lodge.detail.intro.map((paragraph) => (
            <p key={paragraph.slice(0, 24)} className="mt-4 text-base leading-relaxed first:mt-0">
              {paragraph}
            </p>
          ))}
        </div>
      </section>

      {/* Gallery */}
      <section className="mx-auto max-w-6xl px-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {lodge.detail.gallery.map((photo, index) => (
            <div
              key={photo.src + index}
              className={`relative overflow-hidden rounded-lg ${
                index === 0 ? "aspect-[4/3] sm:col-span-2 sm:row-span-2 sm:aspect-auto" : "aspect-[4/3]"
              }`}
            >
              <Image
                src={photo.src}
                alt={photo.alt}
                fill
                // Without sizes, a fill image asks for 100vw and downloads a
                // full-viewport file for a thumbnail.
                sizes={
                  index === 0
                    ? "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 560px"
                    : "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 280px"
                }
                className="object-cover"
              />
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-foreground/50">
          Placeholder photography, shared across lodge types until each
          lodge&apos;s own set is shot.
        </p>
      </section>

      {/* What's included + good to know */}
      <section className="mx-auto max-w-6xl gap-10 px-5 py-12 lg:grid lg:grid-cols-[1fr_320px]">
        <div>
          <h2 className="font-display text-2xl font-bold text-ink">
            What&apos;s included
          </h2>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {lodge.detail.included.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm">
                <TickIcon />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-10 rounded-lg border border-line bg-mist p-5 lg:mt-0">
          <h2 className="font-display text-lg font-bold text-navy">Good to know</h2>
          <ul className="mt-3 grid gap-2">
            {lodge.detail.goodToKnow.map((note) => (
              <li key={note} className="text-sm text-foreground">
                {note}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Rooms + floor plan */}
      <section className="bg-mist py-12">
        <div className="mx-auto max-w-6xl gap-10 px-5 lg:grid lg:grid-cols-2 lg:items-start">
          <div>
            <h2 className="font-display text-2xl font-bold text-ink">Room by room</h2>
            <div className="mt-5 grid gap-4">
              {lodge.detail.rooms.map((room) => (
                <div key={room.name} className="rounded-lg border border-line bg-white p-4">
                  <p className="text-sm font-bold text-navy">{room.name}</p>
                  <p className="mt-1 text-sm text-foreground">{room.description}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-10 lg:mt-0">
            <h2 className="font-display text-2xl font-bold text-ink">The layout</h2>
            <p className="mt-2 text-sm text-foreground/70">
              A schematic, not a blueprint: what the lodge has and roughly
              where it sits.
            </p>
            {/* Scrolls rather than shrinks: the labels are sized in viewBox
                units, so a squeezed plan renders them at about 7px. */}
            <div className="mt-5 overflow-x-auto rounded-lg border border-line bg-white p-5">
              <FloorPlan lodge={lodge} />
            </div>
          </div>
        </div>
      </section>

      {/* CTA band */}
      <section className="bg-olive py-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5">
          <div>
            <p className="font-display text-2xl font-bold text-white">
              Ready for the {lodge.name}?
            </p>
            <p className="mt-1 text-sm text-white/80">
              One price per lodge, however many of you come. Breaks start on
              Fridays and Mondays.
            </p>
          </div>
          <Link href="/#search" className="btn-primary">
            Check dates and prices
          </Link>
        </div>
      </section>

      {/* Other lodges */}
      <section className="mx-auto max-w-6xl px-5 py-12">
        <h2 className="font-display text-2xl font-bold text-ink">The other lodges</h2>
        <div className="mt-6 grid gap-5 sm:grid-cols-3">
          {others.map((other) => (
            <Link
              key={other.code}
              href={`/lodges/${other.code.toLowerCase()}`}
              className="group overflow-hidden rounded-lg border border-line bg-white"
            >
              <div className="relative aspect-[4/3] overflow-hidden">
                <Image
                  src={other.image}
                  alt={other.name}
                  fill
                  sizes="(max-width: 640px) 100vw, 380px"
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </div>
              <div className="p-4">
                <p className="font-display text-lg font-bold text-navy">{other.name}</p>
                <p className="mt-0.5 text-sm italic text-foreground/70">{other.tagline}</p>
                <p className="mt-1 text-xs text-foreground/60">
                  {other.bedrooms} bedrooms · sleeps {other.sleeps}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
