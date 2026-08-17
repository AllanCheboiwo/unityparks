"use client";

import type { ZoneId } from "@/content/village";
import { VILLAGE_NAME, ZONES } from "@/content/village";

/**
 * The village map with selectable zones, used on the location step. This is
 * the same placeholder drawing as public/village-map.svg (which the
 * homepage renders as a plain image): east and the forest reserve at the
 * top, the land falling toward the bottom. Keep the two in sync until the
 * real map art replaces both.
 *
 * Interactivity is deliberately thin: each zone is a button-like <g> that
 * reports clicks, and the same choice is always available as real buttons
 * beside the map, so the map is an enhancement rather than the only way in.
 */

type ZoneState = "selectable" | "selected" | "muted";

export function VillageMap({
  selectedZone,
  availableZones,
  onSelectZone,
}: {
  selectedZone?: ZoneId | null;
  /** Zones with at least one pickable lodge right now; others render muted. */
  availableZones?: Set<ZoneId>;
  onSelectZone?: (zone: ZoneId) => void;
}) {
  const interactive = Boolean(onSelectZone);

  const stateOf = (zone: ZoneId): ZoneState => {
    if (selectedZone === zone) return "selected";
    if (!availableZones || availableZones.has(zone)) return "selectable";
    return "muted";
  };

  const zoneProps = (zone: ZoneId) => {
    const state = stateOf(zone);
    const clickable = interactive && state !== "muted";
    return {
      opacity: state === "muted" ? 0.35 : 1,
      cursor: clickable ? "pointer" : undefined,
      onClick: clickable ? () => onSelectZone?.(zone) : undefined,
      onKeyDown: clickable
        ? (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelectZone?.(zone);
            }
          }
        : undefined,
      role: clickable ? "button" : undefined,
      tabIndex: clickable ? 0 : undefined,
      "aria-pressed": clickable ? selectedZone === zone : undefined,
      "aria-label": clickable ? `${ZONES.find((z) => z.id === zone)?.name}` : undefined,
    };
  };

  /** Selected zones get the navy focus treatment the rest of checkout uses. */
  const blobStroke = (zone: ZoneId, base: string) =>
    stateOf(zone) === "selected"
      ? { stroke: "#2c5670", strokeWidth: 4 }
      : { stroke: base, strokeWidth: 1.5 };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1200 640"
      role="img"
      aria-label={`Map of the ${VILLAGE_NAME} village showing the four zones`}
      className="w-full h-auto"
    >
      <rect width="1200" height="640" fill="#ffffff" />

      {/* village grounds */}
      <path
        d="M70 620 C40 430 90 260 240 180 C420 80 760 70 960 130 C1120 180 1170 340 1140 480 C1110 600 950 630 700 632 C480 634 150 636 70 620 Z"
        fill="#eef0e4"
      />
      <path
        d="M120 600 C100 440 140 290 270 215 C430 125 740 115 930 165 C1080 210 1130 350 1100 470 C1070 580 930 606 700 610 C500 613 190 615 120 600 Z"
        fill="#e6ebd6"
      />

      <g fontFamily="ui-sans-serif, system-ui, sans-serif">
        {/* the forest reserve along the top: the eastern edge of the village */}
        <path d="M0 0 H1200 V78 C1000 108 220 108 0 78 Z" fill="#3f5012" />
        <path
          d="M520 52 L560 12 L588 36 L616 4 L654 46 L688 22 L716 52 Z"
          fill="#f5f3ee"
          stroke="#2c5670"
          strokeWidth={3}
          strokeLinejoin="round"
        />
        <text x={28} y={42} fontSize={20} fontWeight={700} fill="#f5f3ee">
          Mount Kenya forest reserve
        </text>
        <line x1={0} y1={100} x2={1200} y2={100} stroke="#8b7346" strokeWidth={3} strokeDasharray="12 8" />
        <text x={28} y={124} fontSize={14} fill="#8b7346">
          the fence, and the trailhead to the canopy walk
        </text>
        <circle cx={1005} cy={100} r={7} fill="#8b7346" />

        {/* the Burguret, running down the slope */}
        <path
          d="M845 100 C825 195 765 260 735 340 C705 420 665 500 645 555 C636 583 626 612 616 638"
          fill="none"
          stroke="#7fb2c0"
          strokeWidth={16}
          strokeLinecap="round"
          opacity={0.85}
        />
        <path
          d="M845 100 C825 195 765 260 735 340 C705 420 665 500 645 555 C636 583 626 612 616 638"
          fill="none"
          stroke="#a8cdd8"
          strokeWidth={7}
          strokeLinecap="round"
        />
        <text x={768} y={248} fontSize={16} fontStyle="italic" fill="#2d5f73" transform="rotate(62 768 248)">
          The Burguret
        </text>

        {/* zones, downhill to uphill */}
        <g id="zone-riverside" {...zoneProps("riverside")}>
          <path
            d="M215 505 C230 455 330 435 420 438 C520 442 590 462 588 505 C586 550 500 572 395 572 C300 572 202 552 215 505 Z"
            fill="#d8e4cf"
            {...blobStroke("riverside", "#536917")}
          />
          <text x={330} y={480} fontSize={22} fontWeight={700} fill="#1d1d1d">
            Riverside
          </text>
          <g fill="#6d5934">
            <rect x={290} y={500} width={11} height={9} rx={2} />
            <rect x={308} y={512} width={11} height={9} rx={2} />
            <rect x={326} y={500} width={11} height={9} rx={2} />
            <rect x={344} y={512} width={11} height={9} rx={2} />
            <rect x={452} y={502} width={11} height={9} rx={2} />
            <rect x={470} y={514} width={11} height={9} rx={2} />
            <rect x={488} y={502} width={11} height={9} rx={2} />
            <rect x={506} y={514} width={11} height={9} rx={2} />
          </g>
          <circle cx={318} cy={532} r={9} fill="#b7c98f" />
          <circle cx={480} cy={534} r={9} fill="#b7c98f" />
        </g>

        <g id="zone-the-glades" {...zoneProps("the-glades")}>
          <path
            d="M185 285 C200 220 300 195 385 200 C480 206 545 235 540 290 C535 348 445 372 350 370 C255 368 170 345 185 285 Z"
            fill="#dfe6c8"
            {...blobStroke("the-glades", "#536917")}
          />
          <text x={290} y={252} fontSize={22} fontWeight={700} fill="#1d1d1d">
            The Glades
          </text>
          <g fill="#6d5934">
            <rect x={250} y={280} width={11} height={9} rx={2} />
            <rect x={268} y={292} width={11} height={9} rx={2} />
            <rect x={286} y={280} width={11} height={9} rx={2} />
            <rect x={304} y={292} width={11} height={9} rx={2} />
            <rect x={322} y={280} width={11} height={9} rx={2} />
            <rect x={400} y={300} width={11} height={9} rx={2} />
            <rect x={418} y={312} width={11} height={9} rx={2} />
            <rect x={436} y={300} width={11} height={9} rx={2} />
            <rect x={454} y={312} width={11} height={9} rx={2} />
            <rect x={472} y={300} width={11} height={9} rx={2} />
          </g>
          <circle cx={286} cy={315} r={9} fill="#b7c98f" />
          <circle cx={436} cy={335} r={9} fill="#b7c98f" />
        </g>

        <g id="zone-cedar-rise" {...zoneProps("cedar-rise")}>
          <path
            d="M680 335 C695 280 790 258 875 262 C965 266 1040 292 1035 345 C1030 400 940 424 850 421 C760 418 665 392 680 335 Z"
            fill="#e6e0c8"
            {...blobStroke("cedar-rise", "#8b7346")}
          />
          <text x={790} y={312} fontSize={22} fontWeight={700} fill="#1d1d1d">
            Cedar Rise
          </text>
          <g fill="#6d5934">
            <rect x={750} y={340} width={11} height={9} rx={2} />
            <rect x={768} y={352} width={11} height={9} rx={2} />
            <rect x={786} y={340} width={11} height={9} rx={2} />
            <rect x={804} y={352} width={11} height={9} rx={2} />
            <rect x={900} y={345} width={11} height={9} rx={2} />
            <rect x={918} y={357} width={11} height={9} rx={2} />
            <rect x={936} y={345} width={11} height={9} rx={2} />
            <rect x={954} y={357} width={11} height={9} rx={2} />
          </g>
          <circle cx={786} cy={375} r={9} fill="#b7c98f" />
          <circle cx={927} cy={380} r={9} fill="#b7c98f" />
        </g>

        <g id="zone-sunrise-ridge" {...zoneProps("sunrise-ridge")}>
          <path
            d="M740 185 C755 140 850 118 940 122 C1035 126 1115 150 1110 200 C1105 252 1010 274 915 271 C820 268 725 240 740 185 Z"
            fill="#e9ddc2"
            {...blobStroke("sunrise-ridge", "#8b7346")}
          />
          <text x={845} y={170} fontSize={22} fontWeight={700} fill="#1d1d1d">
            Sunrise Ridge
          </text>
          <g fill="#6d5934">
            <rect x={800} y={195} width={11} height={9} rx={2} />
            <rect x={818} y={207} width={11} height={9} rx={2} />
            <rect x={836} y={195} width={11} height={9} rx={2} />
            <rect x={854} y={207} width={11} height={9} rx={2} />
            <rect x={960} y={200} width={11} height={9} rx={2} />
            <rect x={978} y={212} width={11} height={9} rx={2} />
            <rect x={996} y={200} width={11} height={9} rx={2} />
            <rect x={1014} y={212} width={11} height={9} rx={2} />
          </g>
          <circle cx={836} cy={230} r={9} fill="#b7c98f" />
          <circle cx={988} cy={235} r={9} fill="#b7c98f" />
        </g>

        {/* the square, the Water Garden and the spa */}
        <circle cx={600} cy={418} r={26} fill="#536917" />
        <text x={600} y={423} fontSize={12} fontWeight={700} fill="#ffffff" textAnchor="middle">
          Square
        </text>
        <text x={600} y={465} fontSize={15} fontWeight={700} fill="#1d1d1d" textAnchor="middle">
          The Village Square
        </text>
        <rect x={630} y={380} width={86} height={34} rx={10} fill="#bcd9d4" stroke="#2c5670" strokeWidth={1.5} />
        <text x={673} y={401} fontSize={11} fontWeight={700} fill="#2c5670" textAnchor="middle">
          Water Garden
        </text>

        <circle cx={255} cy={152} r={16} fill="#2d5f73" />
        <text x={255} y={185} fontSize={15} fontWeight={700} fill="#2d5f73" textAnchor="middle">
          The Forest Spa
        </text>

        {/* one gate, one road in */}
        <path
          d="M560 640 L565 600 C572 545 585 490 596 452"
          fill="none"
          stroke="#d9d6cf"
          strokeWidth={12}
          strokeLinecap="round"
        />
        <rect x={546} y={596} width={28} height={18} rx={3} fill="#8b7346" />
        <text x={588} y={612} fontSize={14} fill="#4c4e4b">
          The Gatehouse · one road in
        </text>

        {/* trees */}
        <g fill="#647e1b" opacity={0.7}>
          <circle cx={150} cy={230} r={12} />
          <circle cx={175} cy={400} r={10} />
          <circle cx={130} cy={500} r={12} />
          <circle cx={620} cy={180} r={11} />
          <circle cx={660} cy={240} r={9} />
          <circle cx={565} cy={230} r={9} />
          <circle cx={700} cy={500} r={11} />
          <circle cx={760} cy={545} r={9} />
          <circle cx={880} cy={480} r={11} />
          <circle cx={1010} cy={440} r={10} />
          <circle cx={1085} cy={300} r={10} />
          <circle cx={390} cy={140} r={10} />
          <circle cx={480} cy={165} r={9} />
          <circle cx={205} cy={560} r={9} />
        </g>

        {/* placeholder pill */}
        <rect x={24} y={592} width={292} height={30} rx={15} fill="#f5f3ee" stroke="#d9d6cf" />
        <text x={40} y={612} fontSize={14} fill="#4c4e4b">
          Illustrative map · final art to come
        </text>
      </g>
    </svg>
  );
}
