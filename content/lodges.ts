/**
 * Marketing content for each lodge tier, keyed by Apaleo unit-group code.
 * Apaleo owns inventory and prices; this file owns words and pictures.
 * Swap the image paths for real photography when it exists - nothing else
 * needs to change.
 */

export type LodgeContent = {
  code: string;
  name: string;
  tagline: string;
  blurb: string;
  sleeps: number;
  bedrooms: number;
  features: string[];
  /** Tailwind-friendly accent used on cards and highlights. */
  accent: string;
  image: string;
};

export const LODGES: Record<string, LodgeContent> = {
  WDL: {
    code: "WDL",
    name: "Woodland Lodge",
    tagline: "Practical and stylish",
    blurb:
      "Our most popular lodge. Three bedrooms with a private timber deck set among indigenous trees, a fully equipped kitchen and easy access to the village trails.",
    sleeps: 4,
    bedrooms: 3,
    features: ["Private timber deck", "Full kitchen", "Trail access", "Free Wi-Fi"],
    accent: "#536917",
    image: "/photos/lodge-wdl.jpg",
  },
  FST: {
    code: "FST",
    name: "Forest Lodge",
    tagline: "A touch of added luxury",
    blurb:
      "A step up in space and finish. Three generous bedrooms, a larger wraparound deck, upgraded kitchen appliances and blackout blinds for late risers.",
    sleeps: 6,
    bedrooms: 3,
    features: ["Wraparound deck", "Upgraded kitchen", "Blackout blinds", "Free Wi-Fi"],
    accent: "#3f5012",
    image: "/photos/lodge-fst.jpg",
  },
  LKV: {
    code: "LKV",
    name: "Lakeview Lodge",
    tagline: "Wake up to the water",
    blurb:
      "Four bedrooms on the elevated ridge with unobstructed views across the lake, floor-to-ceiling glazing, a furnished terrace and a dedicated games room.",
    sleeps: 8,
    bedrooms: 4,
    features: ["Lake views", "Floor-to-ceiling glazing", "Games room", "Furnished terrace"],
    accent: "#2c5670",
    image: "/photos/lodge-lkv.jpg",
  },
  EXC: {
    code: "EXC",
    name: "Exclusive Lodge",
    tagline: "Luxury as standard",
    blurb:
      "Our flagship lodge. Four bedrooms, a private outdoor hot tub, cedar sauna, and a games and cinema room, set apart from the village for complete privacy.",
    sleeps: 8,
    bedrooms: 4,
    features: ["Private hot tub", "Cedar sauna", "Cinema room", "Set apart for privacy"],
    accent: "#8b7346",
    image: "/photos/lodge-exc.jpg",
  },
};

/** Cheapest first - the Center Parcs price ladder. */
export const TIER_ORDER = ["WDL", "FST", "LKV", "EXC"] as const;
