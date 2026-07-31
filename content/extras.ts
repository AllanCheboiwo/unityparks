/**
 * Marketing content for each extra, keyed by Apaleo service code. Apaleo owns
 * the price and the short description it returns on the offer; this file owns
 * the card photo, the unit noun for quantity items, and the longer "More
 * information" copy that opens under the card. Swap the image paths for real
 * photography when it exists, nothing else needs to change.
 */

export type ExtraContentSection = { heading: string; body: string };

export type ExtraContent = {
  /** Card photo. Left empty falls back to a plain icon tile. */
  image: string;
  /** Singular unit noun for quantity items, e.g. "bike". Absent = one-off. */
  noun?: string;
  /** Sections shown when "More information" is opened. */
  more: ExtraContentSection[];
};

export const EXTRAS: Record<string, ExtraContent> = {
  CYCLE: {
    image: "/photos/activity-cycle.jpg",
    noun: "bike",
    more: [
      {
        heading: "Adult cycles",
        body: "Quality mountain bikes with seven gears, front and rear lights, a cushioned saddle and a stand. A helmet and lock are included free with every hire.",
      },
      {
        heading: "Getting the right fit",
        body: "Our Cycle Centre team sizes every rider on arrival, so you leave on a bike that fits. Trailers, tag-alongs and child seats are available at the centre too.",
      },
      {
        heading: "Good to know",
        body: "Cycle hire runs from your arrival day through to departure. Over 15 km of car-free forest trails start right outside your lodge, and they ride best in the dry months from December to February.",
      },
    ],
  },
  SPA: {
    image: "/photos/activity-spa.jpg",
    noun: "pass",
    more: [
      {
        heading: "Your day at the spa",
        body: "A full day pass to the Unity Spa: sauna, steam room, hydrotherapy pool and a quiet relaxation lounge. Towels and robes are provided. Sweetest on a misty cool-season morning, June to September.",
      },
      {
        heading: "Good to know",
        body: "One pass covers one guest for the day. Guests must be 16 or over to use the thermal spa. Book a treatment on arrival to make a morning of it.",
      },
    ],
  },
  EARLY: {
    image: "/photos/lodge-fst.jpg",
    more: [
      {
        heading: "Start your break sooner",
        body: "Get into your lodge from 10 am instead of the standard 2 pm check-in, so the whole of the first day is yours.",
      },
      {
        heading: "Good to know",
        body: "One early check-in covers your whole lodge, however many of you are staying. Availability is limited, so add it now to be sure of it.",
      },
    ],
  },
  FIREWOOD: {
    image: "/photos/season-festive.jpg",
    more: [
      {
        heading: "For evenings on the deck",
        body: "Seasoned hardwood logs, charcoal, firelighters and a selection of meat for a proper braai under the trees. Best of all in the cool season, June to September, when the nights ask for a fire.",
      },
      {
        heading: "Good to know",
        body: "One pack is set up at your lodge ready for your first evening. Everything you need to light up and cook is included.",
      },
    ],
  },
  GROCERY: {
    // Stand-in photo: swap for a groceries or lodge-kitchen shot when one exists.
    image: "/photos/discover-gift.jpg",
    more: [
      {
        heading: "Ready and waiting",
        body: "A curated pack of fresh essentials: bread, eggs, milk, fruit, coffee and the basics, stocked in your lodge before you arrive.",
      },
      {
        heading: "Good to know",
        body: "One pack is delivered to your lodge for your arrival. Some items may contain allergens; ask us if you have any questions.",
      },
    ],
  },
};
