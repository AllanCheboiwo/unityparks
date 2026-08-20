/**
 * Marketing content for each lodge type, keyed by Apaleo unit-group code.
 * Apaleo owns inventory and prices; this file owns words and pictures.
 *
 * The model (docs/village-and-content-direction.md section 5): two axes and
 * nothing else. Size is a number, grade is a name. Cedar is the base spec,
 * Signature is the seven things, identical at both sizes, and the 3 bedroom
 * gets more of the same, never different things. Anything sold as an extra
 * (firewood, grocery packs, spa passes) must never appear in a grade.
 *
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
  /** The two-axis model: size is a number, grade is a name. */
  grade: "Cedar" | "Signature";
  /** Indicative lowest three-night price for the lodge, from the design
   *  handoff. Recompute alongside the seasonal floors in scripts/seed-cms.ts
   *  whenever the Apaleo rates change. */
  fromPrice: string;
  features: string[];
  /** Tailwind-friendly accent used on cards and highlights. */
  accent: string;
  image: string;
  /** The /lodges/[code] detail page. Words and pictures only, like the rest
   *  of this file; prices and availability stay Apaleo's. */
  detail: {
    /** Intro paragraphs under the hero. */
    intro: string[];
    /** The what's-included checklist. */
    included: string[];
    /** Gallery images; placeholders shared across tiers until the real
     *  photo set lands, swapped file-for-file. */
    gallery: Array<{ src: string; alt: string }>;
    /** Room-by-room walkthrough, floor-plan order. */
    rooms: Array<{ name: string; description: string }>;
    /** Practical notes: check-in, decks, parking, that kind of thing. */
    goodToKnow: string[];
  };
};

/** The Cedar base spec, word for word the same in both sizes. */
const CEDAR_INCLUDED_CORE = [
  "Wood-burning stove in the living room",
  "Insulated and double glazed throughout",
  "Full kitchen with oven, hob and fridge-freezer",
  "Hot water that copes with a full house at six in the morning",
  "Made-up beds, towels and linen on arrival",
  "Private deck with a built-in braai",
  "Free Wi-Fi throughout the lodge",
  "Parking beside your lodge",
  "Cot and high chair free on request",
];

/** The seven Signature things, identical in every Signature lodge. */
const SIGNATURE_INCLUDED_CORE = [
  "Private outdoor hot tub, deck-mounted, facing the mountain",
  "Wraparound deck, roofed at one end, with outdoor dining and a built-in braai",
  "Underfloor heating in the bathrooms",
  "En-suite to the main bedroom, plus a second bathroom",
  "Upgraded kitchen: dishwasher, full oven and coffee machine",
  "Robes, slippers, heavier linen and better beds",
  "A bigger plot with a wider tree screen",
  "Everything in the Cedar spec: the stove, the full kitchen, Wi-Fi, parking, cot and high chair on request",
];

export const LODGES: Record<string, LodgeContent> = {
  WDL: {
    code: "WDL",
    name: "Cedar Lodge 2 bedroom",
    tagline: "The break, made simple",
    blurb:
      "Two bedrooms sleeping four, with a wood-burning stove, a full kitchen and a private deck with its own built-in braai, deep among the cedars.",
    sleeps: 4,
    bedrooms: 2,
    grade: "Cedar",
    fromPrice: "KES 84,000",
    features: [
      "Wood-burning stove",
      "Full kitchen",
      "Deck with built-in braai",
      "Free Wi-Fi",
    ],
    accent: "#536917",
    image: "/photos/lodge-wdl.jpg",
    detail: {
      intro: [
        "The Cedar is the lodge the village is built from. It sits in a lane of four to six around a shared green, in the indigenous forest, a short walk from the square. It is insulated and double glazed, because at 2,100 metres the nights are properly cold, and it is warmed by its own wood-burning stove.",
        "Inside it is simple and right: two bedrooms off a central living space, a kitchen with everything you would have at home, and sliding doors onto a private deck with a built-in braai. Light the stove, close the doors, and the cold outside becomes the point.",
      ],
      included: CEDAR_INCLUDED_CORE,
      gallery: [
        { src: "/photos/lodge-wdl.jpg", alt: "A Cedar Lodge among the trees" },
        { src: "/photos/hero-forest.jpg", alt: "The forest around the lanes" },
        { src: "/photos/activity-cycle.jpg", alt: "Cycling the village trails" },
        { src: "/photos/activity-pool.jpg", alt: "Warm water, included every day" },
      ],
      rooms: [
        { name: "Living and dining", description: "Open plan around the stove, with sliding doors onto the deck and a table that seats four properly." },
        { name: "Kitchen", description: "Oven, hob, fridge-freezer, kettle and everything needed to cook for four." },
        { name: "Bedroom 1", description: "A double with a wardrobe and a forest outlook." },
        { name: "Bedroom 2", description: "A twin, easily swapped around for your party." },
        { name: "Bathroom", description: "Walk-in shower, WC and basin, with hot water that never runs out." },
        { name: "Deck", description: "Private timber deck with the built-in braai and outdoor seating." },
      ],
      goodToKnow: [
        "Check-in from 2pm, check-out by 11am",
        "Breaks start on a Friday or a Monday",
        "One price per lodge, however many of you come (sleeps 4)",
        "At 2,100 metres the evenings are cold all year. Bring a jumper; the stove does the rest",
      ],
    },
  },
  FST: {
    code: "FST",
    name: "Cedar Lodge 3 bedroom",
    tagline: "Room for six",
    blurb:
      "The same warm Cedar spec with a third bedroom and room for six, for the parties that travel bigger and the breaks that stretch to a week.",
    sleeps: 6,
    bedrooms: 3,
    grade: "Cedar",
    fromPrice: "KES 129,000",
    features: [
      "Wood-burning stove",
      "Full kitchen",
      "Deck with built-in braai",
      "Free Wi-Fi",
    ],
    accent: "#3f5012",
    image: "/photos/lodge-fst.jpg",
    detail: {
      intro: [
        "The Cedar 3 bedroom is the same lodge the whole village is built from, with a third bedroom and space for six. Same stove, same kitchen, same deck and braai; more room to spread out when the grandparents or the cousins come too.",
        "It suits the bigger party and the longer break. Six sleep comfortably, the hot water copes with a full house at six in the morning, and the deck seats everyone for dinner while the last light comes off the mountain.",
      ],
      included: CEDAR_INCLUDED_CORE,
      gallery: [
        { src: "/photos/lodge-fst.jpg", alt: "A Cedar Lodge 3 bedroom and its deck" },
        { src: "/photos/hero-forest.jpg", alt: "The forest around the lanes" },
        { src: "/photos/activity-pool.jpg", alt: "Warm water, included every day" },
        { src: "/photos/activity-cycle.jpg", alt: "Cycling the village trails" },
      ],
      rooms: [
        { name: "Living and dining", description: "Open plan around the stove, with sliding doors onto the deck and a table that seats six." },
        { name: "Kitchen", description: "Oven, hob, fridge-freezer and enough workspace for two cooks at once." },
        { name: "Bedroom 1", description: "A double with a wardrobe and a forest outlook." },
        { name: "Bedrooms 2 and 3", description: "A double and a twin, easily swapped around for your party." },
        { name: "Bathrooms", description: "A family bathroom with bath and shower, plus a second WC." },
        { name: "Deck", description: "Private timber deck with the built-in braai and dining for six." },
      ],
      goodToKnow: [
        "Check-in from 2pm, check-out by 11am",
        "Breaks start on a Friday or a Monday",
        "One price per lodge, however many of you come (sleeps 6)",
        "At 2,100 metres the evenings are cold all year. Bring a jumper; the stove does the rest",
      ],
    },
  },
  LKV: {
    code: "LKV",
    name: "Signature Lodge 2 bedroom",
    tagline: "The cold-weather grade",
    blurb:
      "Built for cold mornings: a private hot tub facing the mountain, a roofed wraparound deck, heated bathroom floors and two bathrooms for four guests.",
    sleeps: 4,
    bedrooms: 2,
    grade: "Signature",
    fromPrice: "KES 112,000",
    features: [
      "Private hot tub facing the mountain",
      "Roofed wraparound deck",
      "Underfloor-heated bathrooms",
      "En-suite plus second bathroom",
    ],
    accent: "#8b7346",
    image: "/photos/lodge-lkv.jpg",
    detail: {
      intro: [
        "Signature is the cold-weather grade, and the 2 bedroom is its purest form. The private hot tub sits on the deck facing the mountain; the deck itself wraps the lodge and is roofed at one end, so the tub and the braai still work in the rains.",
        "Inside, the bathrooms have underfloor heating, the main bedroom has its own en-suite with a second bathroom besides, and the kitchen steps up to a dishwasher, a full oven and a coffee machine. Robes, slippers and heavier linen finish it. This is the lodge for cold mornings done properly.",
      ],
      included: SIGNATURE_INCLUDED_CORE,
      gallery: [
        { src: "/photos/lodge-lkv.jpg", alt: "A Signature Lodge at the edge of its tree screen" },
        { src: "/photos/activity-spa.jpg", alt: "The Forest Spa, ten minutes uphill" },
        { src: "/photos/hero-forest.jpg", alt: "The forest around the lanes" },
        { src: "/photos/activity-pool.jpg", alt: "Warm water, included every day" },
      ],
      rooms: [
        { name: "Living and dining", description: "Open plan around the stove, with doors onto the roofed end of the deck." },
        { name: "Kitchen", description: "Dishwasher, full oven, coffee machine and workspace for two cooks." },
        { name: "Main bedroom", description: "A double with fitted wardrobes and its own en-suite shower room." },
        { name: "Bedroom 2", description: "A twin on the quiet side of the lodge, easily made up as a double." },
        { name: "Second bathroom", description: "Bath and overhead shower, with underfloor heating like the en-suite." },
        { name: "Deck and hot tub", description: "Wraparound and roofed at one end; the tub faces the mountain and works in any weather." },
      ],
      goodToKnow: [
        "Check-in from 2pm, check-out by 11am",
        "Breaks start on a Friday or a Monday",
        "One price per lodge, however many of you come (sleeps 4)",
        "Every Signature lodge has the same seven things; where it sits is yours to choose at the Location step",
      ],
    },
  },
  EXC: {
    code: "EXC",
    name: "Signature Lodge 3 bedroom",
    tagline: "The celebration lodge",
    blurb:
      "Everything Signature means, at family size: the hot tub, the roofed deck, the en-suite and second bathroom, with three bedrooms sleeping six.",
    sleeps: 6,
    bedrooms: 3,
    grade: "Signature",
    fromPrice: "KES 156,000",
    features: [
      "Private hot tub facing the mountain",
      "Roofed wraparound deck",
      "Underfloor-heated bathrooms",
      "En-suite plus second bathroom",
    ],
    accent: "#6d5934",
    image: "/photos/lodge-exc.jpg",
    detail: {
      intro: [
        "The Signature 3 bedroom is the celebration lodge: the big birthday, the reunion, the whole family filling one lane. It carries exactly what every Signature carries, at family size: a bigger deck, a bigger tub, and the third bedroom and second bathroom a full lodge needs.",
        "It sits on a bigger plot behind a wider screen of trees, so the hot tub and the deck are entirely yours. Six sleep without anyone compromising, and between them the stove and the tub settle every cold evening.",
      ],
      included: SIGNATURE_INCLUDED_CORE,
      gallery: [
        { src: "/photos/lodge-exc.jpg", alt: "A Signature Lodge 3 bedroom behind its tree screen" },
        { src: "/photos/activity-spa.jpg", alt: "The Forest Spa, ten minutes uphill" },
        { src: "/photos/hero-forest.jpg", alt: "The forest around the lanes" },
        { src: "/photos/activity-cycle.jpg", alt: "Cycling the village trails" },
      ],
      rooms: [
        { name: "Living and dining", description: "Open plan around the stove, with doors onto the roofed end of the deck and a table for six." },
        { name: "Kitchen", description: "Dishwasher, full oven, coffee machine and a proper pantry cupboard." },
        { name: "Main bedroom", description: "A double with fitted wardrobes and its own en-suite shower room." },
        { name: "Bedrooms 2 and 3", description: "A double and a twin, both full-size rooms on the quiet side of the lodge." },
        { name: "Second bathroom", description: "Bath and overhead shower, with underfloor heating like the en-suite." },
        { name: "Deck and hot tub", description: "The biggest deck and tub in the village, roofed at one end, facing the mountain." },
      ],
      goodToKnow: [
        "Check-in from 2pm, check-out by 11am",
        "Breaks start on a Friday or a Monday",
        "One price per lodge, however many of you come (sleeps 6)",
        "Every Signature lodge has the same seven things; where it sits is yours to choose at the Location step",
      ],
    },
  },
};

/** Doc order: the Cedar pair then the Signature pair (grade, then size).
 *  Not strictly cheapest-first any more: Signature 2 bedroom sits between
 *  the two Cedars on price, which is the ladder working as designed. */
export const TIER_ORDER = ["WDL", "FST", "LKV", "EXC"] as const;

/** The comparison card on the homepage: the same facts as the *_INCLUDED_CORE
 *  lists above, abridged to five and six lines so the two columns scan. */
export const CEDAR_CARD_SUMMARY = [
  "Wood-burning stove, insulated and double glazed",
  "Full kitchen with oven, hob and fridge-freezer",
  "Private deck with a built-in braai",
  "Beds made up, towels and linen on arrival",
  "Wi-Fi, parking beside your lodge, cot and high chair on request",
];

export const SIGNATURE_CARD_SUMMARY = [
  "Private hot tub, deck-mounted, facing the mountain",
  "Wraparound deck, roofed at one end, outdoor dining and braai",
  "Underfloor heating in the bathrooms",
  "En-suite to the main bedroom, plus a second bathroom",
  "Dishwasher, full oven and coffee machine",
  "Robes, slippers, heavier linen, better beds, a bigger plot",
];
