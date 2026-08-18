/**
 * Village facts, in one place: the name, where it is, and how lanes map to
 * zones. Guest-facing words live here; Apaleo owns the units themselves.
 * The setting and the zone model come from docs/village-and-content-direction.md.
 */

export const VILLAGE_NAME = "Unity Parks Mount Kenya";

/** The header and email locale line. */
export const VILLAGE_LOCALE_LINE = "Naro Moru, Mount Kenya";

export type ZoneId = "riverside" | "the-glades" | "cedar-rise" | "sunrise-ridge";

export type Zone = {
  id: ZoneId;
  name: string;
  /** One line of character, straight from the direction doc. */
  character: string;
  /** Who the zone suits, for the picker. */
  suits: string;
  /** False until the zone opens with a later build phase. */
  live: boolean;
};

/** Price rises as you climb: the order below is downhill to uphill. */
export const ZONES: Zone[] = [
  {
    id: "riverside",
    name: "Riverside",
    character:
      "Low along the Burguret: the flattest lanes, pushchair-easy, the sound of water, closest to the square.",
    suits: "Families with small children",
    live: false,
  },
  {
    id: "the-glades",
    name: "The Glades",
    character: "Central, among the trees, three minutes from the Water Garden.",
    suits: "Short breaks and convenience",
    live: true,
  },
  {
    id: "cedar-rise",
    name: "Cedar Rise",
    character: "Mid slope, facing east: the first real mountain views over the canopy.",
    suits: "The upgrade sweet spot",
    live: false,
  },
  {
    id: "sunrise-ridge",
    name: "Sunrise Ridge",
    character:
      "Top of the village, on the forest edge: the biggest plots, the widest tree screens, tubs facing the peaks.",
    suits: "Celebrations, escapes and long stays",
    live: true,
  },
];

export type Lane = { name: string; zone: ZoneId };

/**
 * Lanes of four to six lodges around a shared green. Tree lanes in The
 * Glades, creature lanes up on the forest edge. Apaleo unit names are
 * "<lane> <number>" (set by the provisioning project), so the prefix is ours
 * to rely on.
 */
export const LANES: Lane[] = [
  { name: "Fig Lane", zone: "the-glades" },
  { name: "Olive Lane", zone: "the-glades" },
  { name: "Turaco Lane", zone: "sunrise-ridge" },
  { name: "Hyrax Lane", zone: "sunrise-ridge" },
];

/**
 * The lane a unit belongs to, parsed off its name ("Fig Lane 3"). Null for
 * names that predate the lane renaming, so the location step can fall back
 * to a flat list until the Apaleo migration has run.
 */
export function laneOf(unitName: string): Lane | null {
  return LANES.find((lane) => unitName.startsWith(`${lane.name} `)) ?? null;
}

export function zoneById(id: ZoneId): Zone {
  return ZONES.find((z) => z.id === id)!;
}
