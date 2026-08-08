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
    detail: {
      intro: [
        "The Woodland is the lodge most families come back to. It sits in the thick of the indigenous trees, close enough to the village heart that the pool and restaurants are a short walk or an easy cycle, far enough that all you hear from the deck is the forest.",
        "Inside it is simple and right: three bedrooms off a central living space, a kitchen with everything you would have at home, and sliding doors that open the whole living area onto the deck.",
      ],
      included: [
        "Fully equipped kitchen with oven, hob and fridge-freezer",
        "Towels, linen and made-up beds on arrival",
        "Private timber deck with outdoor furniture",
        "Free Wi-Fi throughout the lodge",
        "Parking beside your lodge",
        "Direct access to the car-free forest trails",
        "Highchair and cot available on request",
      ],
      gallery: [
        { src: "/photos/lodge-wdl.jpg", alt: "Woodland Lodge among the trees" },
        { src: "/photos/hero-forest.jpg", alt: "The forest around the lodges" },
        { src: "/photos/activity-cycle.jpg", alt: "Cycling the village trails" },
        { src: "/photos/band-lake.jpg", alt: "Lake Naivasha at golden hour" },
      ],
      rooms: [
        { name: "Living and dining", description: "Open-plan with sliding doors onto the deck, seating the whole party for meals and evenings in." },
        { name: "Kitchen", description: "Oven, hob, fridge-freezer, kettle and everything needed to cook for four." },
        { name: "Bedroom 1", description: "Double bed with wardrobe and forest outlook." },
        { name: "Bedrooms 2 and 3", description: "A twin and a single, easily swapped around for your party." },
        { name: "Bathroom", description: "Walk-in shower, WC and basin." },
        { name: "Deck", description: "Private timber deck with a table for six and the braai stand." },
      ],
      goodToKnow: [
        "Check-in from 2pm, check-out by 11am",
        "Breaks start on a Friday or a Monday",
        "One price per lodge, however many of you come (sleeps 4)",
        "The lodge is yours alone for the whole break",
      ],
    },
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
    detail: {
      intro: [
        "The Forest takes everything the Woodland does well and gives it more room to breathe. The three bedrooms are noticeably larger, the wraparound deck follows the sun through the day, and the finish steps up everywhere you touch.",
        "It suits bigger parties and longer breaks: six sleeps comfortably, the upgraded kitchen makes proper cooking a pleasure rather than a chore, and blackout blinds in every bedroom mean nobody is up before they mean to be.",
      ],
      included: [
        "Upgraded kitchen with full-size oven and dishwasher",
        "Towels, linen and made-up beds on arrival",
        "Wraparound timber deck with outdoor dining for eight",
        "Blackout blinds in every bedroom",
        "Free Wi-Fi throughout the lodge",
        "Parking beside your lodge",
        "Direct access to the car-free forest trails",
        "Highchair and cot available on request",
      ],
      gallery: [
        { src: "/photos/lodge-fst.jpg", alt: "Forest Lodge and its wraparound deck" },
        { src: "/photos/hero-forest.jpg", alt: "The forest around the lodges" },
        { src: "/photos/activity-pool.jpg", alt: "The village lagoon pool" },
        { src: "/photos/band-lake.jpg", alt: "Lake Naivasha at golden hour" },
      ],
      rooms: [
        { name: "Living and dining", description: "A generous open-plan space with doors onto two sides of the deck." },
        { name: "Kitchen", description: "Full-size oven, dishwasher and enough workspace for two cooks at once." },
        { name: "Bedroom 1", description: "Double bed with fitted wardrobes and its own deck door." },
        { name: "Bedrooms 2 and 3", description: "A double and a twin, both full-size rooms, all with blackout blinds." },
        { name: "Bathrooms", description: "A family bathroom with bath and shower, plus a second WC." },
        { name: "Deck", description: "Wraparound deck that follows the sun, with dining for eight and the braai stand." },
      ],
      goodToKnow: [
        "Check-in from 2pm, check-out by 11am",
        "Breaks start on a Friday or a Monday",
        "One price per lodge, however many of you come (sleeps 6)",
        "The lodge is yours alone for the whole break",
      ],
    },
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
    detail: {
      intro: [
        "The Lakeview earns its name every single morning. The lodges sit on the elevated ridge with nothing between the floor-to-ceiling glazing and the water, so the lake is the first thing you see with your coffee and the last thing you see at night.",
        "Four proper bedrooms sleep eight, the furnished terrace runs the width of the lodge, and the games room settles the question of what happens after dinner. This is the lodge for the whole family, grandparents included.",
      ],
      included: [
        "Floor-to-ceiling glazing with unobstructed lake views",
        "Games room with table football and board games",
        "Furnished terrace the width of the lodge",
        "Full kitchen with dishwasher and coffee machine",
        "Towels, linen and made-up beds on arrival",
        "Free Wi-Fi throughout the lodge",
        "Parking beside your lodge",
        "Highchair and cot available on request",
      ],
      gallery: [
        { src: "/photos/lodge-lkv.jpg", alt: "Lakeview Lodge on the ridge" },
        { src: "/photos/band-lake.jpg", alt: "The view across Lake Naivasha" },
        { src: "/photos/activity-boats.jpg", alt: "Boats on the lake below the ridge" },
        { src: "/photos/activity-spa.jpg", alt: "The spa, a short walk away" },
      ],
      rooms: [
        { name: "Living and dining", description: "Glazed wall to the lake, doors onto the terrace, room for the whole party." },
        { name: "Kitchen", description: "Dishwasher, coffee machine and a breakfast bar facing the water." },
        { name: "Bedrooms 1 and 2", description: "Two doubles, both lake-facing, the main with fitted wardrobes." },
        { name: "Bedrooms 3 and 4", description: "A double and a twin on the forest side, quiet and cool." },
        { name: "Bathrooms", description: "Two full bathrooms, one with bath, one with walk-in shower." },
        { name: "Games room", description: "Table football, board games and space for tournaments." },
        { name: "Terrace", description: "Furnished, lake-facing, the width of the lodge." },
      ],
      goodToKnow: [
        "Check-in from 2pm, check-out by 11am",
        "Breaks start on a Friday or a Monday",
        "One price per lodge, however many of you come (sleeps 8)",
        "Ridge-top position: a short but steepish walk up from the village heart",
      ],
    },
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
    detail: {
      intro: [
        "The Exclusive is the lodge for the break that has to be special: the big birthday, the reunion, the honeymoon with the whole family invited anyway. It sits apart from the village behind its own screen of trees, so the hot tub, the sauna and the deck are entirely yours.",
        "Four bedrooms sleep eight without anyone compromising, the cinema room turns rainy afternoons into an event, and the finish throughout is the best we build.",
      ],
      included: [
        "Private outdoor hot tub on the deck",
        "Cedar sauna for four",
        "Cinema and games room with projector",
        "Premium kitchen with wine fridge and coffee machine",
        "Towels, robes, linen and made-up beds on arrival",
        "Free Wi-Fi throughout the lodge",
        "Parking beside your lodge, set apart for privacy",
        "Welcome hamper on arrival",
      ],
      gallery: [
        { src: "/photos/lodge-exc.jpg", alt: "Exclusive Lodge behind its screen of trees" },
        { src: "/photos/activity-spa.jpg", alt: "Spa treatments, bookable from your lodge" },
        { src: "/photos/hero-forest.jpg", alt: "The private forest setting" },
        { src: "/photos/band-lake.jpg", alt: "Lake Naivasha at golden hour" },
      ],
      rooms: [
        { name: "Living and dining", description: "Double-height living space with a fireplace and doors onto the private deck." },
        { name: "Kitchen", description: "Premium appliances, wine fridge, coffee machine and a proper pantry." },
        { name: "Bedrooms 1 and 2", description: "Two doubles with en-suites, the main with its own deck door." },
        { name: "Bedrooms 3 and 4", description: "A double and a twin sharing the family bathroom." },
        { name: "Cinema and games room", description: "Projector, big sofa, games console and board games." },
        { name: "Sauna", description: "Cedar sauna for four, next to the deck shower." },
        { name: "Deck and hot tub", description: "Private deck with the hot tub, outdoor dining and the braai stand." },
      ],
      goodToKnow: [
        "Check-in from 2pm, check-out by 11am",
        "Breaks start on a Friday or a Monday",
        "One price per lodge, however many of you come (sleeps 8)",
        "Set apart from the village: five minutes by bike to the village heart",
      ],
    },
  },
};

/** Cheapest first - the Center Parcs price ladder. */
export const TIER_ORDER = ["WDL", "FST", "LKV", "EXC"] as const;
