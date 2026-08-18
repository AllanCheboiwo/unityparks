/**
 * Seeds the CMS with the initial homepage content and media.
 *
 * Idempotent: finds existing docs by filename, slug, or question and updates
 * them, so re-running is always safe. This script is the bootstrap for any
 * fresh database (new clone, new dev machine, wiped local db):
 *
 *   npm run seed:cms
 *
 * The copy below is the canonical initial content, lifted from the old
 * content/home.ts at cutover. After seeding, editors own it in the admin.
 * Credit URLs come from public/photos/CREDITS.md and are required by the
 * Media collection; see that file for the sourcing rules.
 *
 * Several media files are Naivasha-era placeholders awaiting the Mount
 * Kenya media sweep (docs/mount-kenya-sweep.md, stage C3). Their alts stay
 * honest about the pixels without asserting a place they cannot show.
 */
import path from "path";
import { fileURLToPath } from "url";
import { getPayload } from "payload";
import config from "../payload.config";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(dirname, "../public");

const PEXELS_LICENSE = "Pexels License";

const MEDIA = [
  {
    file: "hero-family-lake.mp4",
    alt: "A family walking together",
    creditUrl: "https://www.pexels.com/video/family-walk-by-the-lake-5729004/",
  },
  {
    file: "hero-forest.jpg",
    alt: "Mist through the forest at first light",
    creditUrl: "https://www.pexels.com/photo/green-pine-trees-on-mountain-area-10762369/",
  },
  {
    file: "activity-pool.jpg",
    alt: "Warm water in the Water Garden",
    creditUrl: "https://www.pexels.com/photo/5626882/",
  },
  {
    file: "activity-cycle.jpg",
    alt: "Cycle trails",
    creditUrl: "https://www.pexels.com/photo/9225938/",
  },
  {
    file: "activity-spa.jpg",
    alt: "Forest spa",
    creditUrl: "https://www.pexels.com/photo/6667430/",
  },
  {
    file: "season-green.jpg",
    alt: "The forest turning green in the short rains",
    creditUrl: "https://www.pexels.com/photo/25491108/",
  },
  {
    file: "season-rains.jpg",
    alt: "Storm clouds building over the forest in the long rains",
    creditUrl: "https://www.pexels.com/photo/32293234/",
  },
  {
    file: "season-festive.jpg",
    alt: "Lights in the trees at festive time",
    creditUrl: "https://www.pexels.com/photo/19737894/",
  },
  {
    file: "season-cool.jpg",
    alt: "Mist drifting through the forest at dawn",
    creditUrl: "https://www.pexels.com/video/lake-in-forest-13075768/",
  },
  {
    file: "band-lake.jpg",
    alt: "Golden evening light over the forest",
    creditUrl: "https://www.pexels.com/photo/scenic-view-of-pine-trees-in-the-forest-10195041/",
  },
  {
    file: "discover-groups.jpg",
    alt: "Group bookings",
    creditUrl: "https://www.pexels.com/photo/34408249/",
  },
  {
    file: "discover-gift.jpg",
    alt: "Gift a break",
    creditUrl: "https://www.pexels.com/photo/6332412/",
  },
  {
    file: "discover-news.jpg",
    alt: "Village news",
    creditUrl: "https://www.pexels.com/photo/8516647/",
  },
];

const ACTIVITIES = [
  {
    slug: "swimming-lagoon",
    title: "The Water Garden",
    copy: "Warm water under a glass roof, looking at the mountain. Slides for the brave, shallows for the small, and it is included in every break, whatever the sky does.",
    photo: "activity-pool.jpg",
    displayOrder: 1,
  },
  {
    // Slug kept from the Naivasha era on purpose: it is the upsert key, and
    // changing it would duplicate the card on existing databases.
    slug: "on-the-water",
    title: "Guided forest walk",
    copy: "Mornings with a village guide, from birdsong to the big cedars, at a pace the smallest legs can manage.",
    photo: "hero-forest.jpg",
    displayOrder: 2,
  },
  {
    slug: "cycle-trails",
    title: "Cycle trails",
    copy: "Shaded forest loops for every pace, from balance bikes to big rides. Hire a bike or bring your own.",
    photo: "activity-cycle.jpg",
    displayOrder: 3,
  },
  {
    slug: "forest-spa",
    title: "Forest spa",
    copy: "Steam, stillness and birdsong. A grown-up pause while the rest of the family plays.",
    photo: "activity-spa.jpg",
    displayOrder: 4,
  },
];

// The four Kenyan seasons per docs/content-strategy.md. Festive is a
// campaign inside sunshine season, not a season card. From-prices are the
// real seasonal floors: a 3-night Cedar Lodge 2 bedroom (WDL) break at
// 3 x round500(28,000 x season multiplier), matching the rates the
// provisioning project writes into Apaleo. The WDL floor deliberately
// survived the Mount Kenya reprice, so these numbers did too. If the
// multipliers or the WDL base ever change, recompute these the same day.
const SEASONS = [
  {
    slug: "sunshine-season",
    title: "Sunshine season",
    months: "December to February",
    copy: "Hot clear days, cold nights and the peaks out at breakfast. Long golden evenings, with the festive weeks in the middle.",
    fromPrice: "from KES 109,500*",
    photo: "band-lake.jpg",
    displayOrder: 1,
  },
  {
    slug: "long-rains",
    title: "Long rains",
    months: "March to May",
    copy: "Storms in the afternoon, clear mornings, the forest at its greenest and the best prices of the year.",
    fromPrice: "from KES 84,000*",
    photo: "season-rains.jpg",
    displayOrder: 2,
  },
  {
    slug: "cool-season",
    title: "Cool season",
    months: "June to September",
    copy: "Mist to the knees at dawn, fires lit by five and the Water Garden steaming. The August holidays land right in the middle.",
    fromPrice: "from KES 96,000*",
    photo: "season-cool.jpg",
    displayOrder: 3,
  },
  {
    slug: "short-rains",
    title: "Short rains",
    months: "October to November",
    copy: "Light afternoon showers, a forest turning green again and good value before the festive rush.",
    fromPrice: "from KES 90,000*",
    photo: "season-green.jpg",
    displayOrder: 4,
  },
];

// `oldQuestion` is the Naivasha-era question text: the question is the
// upsert key, so a renamed question needs its old key to update in place
// rather than duplicate on existing databases.
const FAQS: Array<{
  question: string;
  answer: string;
  displayOrder: number;
  oldQuestion?: string;
}> = [
  {
    question: "What is included in a Unity Parks break?",
    answer:
      "Your lodge for the whole break, the Water Garden and the outdoor pool, parking beside your lodge and the run of the forest trails. Extras such as the Forest Spa and cycle hire can be added to your break.",
    displayOrder: 1,
  },
  {
    question: "Who are Unity Parks breaks for?",
    answer:
      "Anyone who wants time together. Families, grandparents, friends, couples. Every lodge is self-contained, so the whole party stays under one roof at one price per lodge.",
    displayOrder: 2,
  },
  {
    question: "How do breaks work?",
    answer:
      "Breaks start on a Friday or a Monday. A weekend break runs Friday to Monday, a midweek break runs Monday to Friday, and a full week is seven nights. Pick your dates and lodge, tell us who is coming, and the village does the rest.",
    displayOrder: 3,
  },
  {
    question: "How do payments work in this demo?",
    answer:
      "Unity Parks is currently a demonstration. Checkout runs against sandbox systems, so no real money moves and no real card details are needed. Everything else, from availability to your confirmation, works exactly as it will on the real village.",
    displayOrder: 4,
  },
  {
    question: "Can I bring my dog?",
    answer:
      "No. The village sits against the Mount Kenya forest: colobus monkeys, bushbuck and tree hyrax live in it, and elephant and buffalo move through the trees beyond our fence. Pets stay home for everyone's safety, theirs included.",
    displayOrder: 5,
  },
  {
    question: "When is the best time to visit?",
    answer:
      "There is no bad time at 2,100 metres. Sunshine season (December to February) brings hot clear days, cold nights and the peaks out at breakfast. The long rains (March to May) mean clear mornings, afternoon storms and the best prices of the year. The cool season (June to September) is mist, fires lit by five and the Water Garden steaming, and the short rains (October to November) turn the forest green again.",
    displayOrder: 6,
  },
  {
    question: "How do we get to Unity Parks?",
    oldQuestion: "How do we get to Unity Parks Naivasha?",
    answer:
      "The village is at Naro Moru, on the western slopes of Mount Kenya: about 180 km from Nairobi on the A2, two and a half to three hours, tarmac the whole way. Flying? Nanyuki airstrip is 30 km away. Parking at your lodge is included, and because we take your number plate at booking, the gate simply opens when you arrive.",
    displayOrder: 7,
  },
];

// Evergreen campaign pages (/breaks/<slug>), per the direction doc's two
// named moments of the year. The window line is what an editor changes; the
// page itself never dates. From-prices are real seasonal floors for a
// three-night WDL break: cool season 3 x round500(28,000 x 1.15) = 96,000,
// festive 3 x round500(28,000 x 1.5) = 126,000.
const CAMPAIGNS = [
  {
    slug: "august-by-the-fire",
    name: "August by the fire",
    window: "June to September, at its best in the August holidays",
    strapline: "The break the coast cannot copy",
    intro:
      "The cool season is the mountain at its most honest: mist to the knees at dawn, fires lit by five, and the Water Garden steaming under its glass roof while the forest drips outside. Bring a jumper and the right people; the stove and the tub do the rest.",
    hero: "season-cool.jpg",
    fromPrice: "from KES 96,000*",
    fromNote:
      "*Lowest price for a three-night Cedar Lodge 2 bedroom break in the cool season, subject to availability.",
    ctaLabel: "Find your cool-season break",
    highlights: [
      {
        title: "The Water Garden, steaming",
        copy: "Warm water under glass, looking at the mountain. Included in every break, and never better than on a misty morning.",
        photo: "activity-pool.jpg",
      },
      {
        title: "Fires lit by five",
        copy: "Every lodge has its own wood-burning stove, Cedar and Signature alike. Firewood and braai packs are stocked at the village shop.",
        photo: "hero-forest.jpg",
      },
      {
        title: "The Forest Spa",
        copy: "On a cold mountain a spa sells heat: hot pools, steam and quiet, ten minutes uphill through the trees.",
        photo: "activity-spa.jpg",
      },
    ],
    faqs: [
      {
        question: "How cold does it get?",
        answer:
          "Properly cold, and that is the point. At 2,100 metres, cool-season nights drop low enough for fires and hot water to feel earned. Days stay mild; pack a jumper and you are dressed for all of it.",
      },
      {
        question: "Do breaks work the same in the cool season?",
        answer:
          "Exactly the same. Breaks start on a Friday or a Monday, the Water Garden is included every day, and the whole village is a ten-minute walk end to end.",
      },
    ],
  },
  {
    slug: "the-festive-break",
    name: "The festive break",
    window: "Mid-December to early January",
    strapline: "Cold nights, warm water, the peaks at breakfast",
    intro:
      "The festive weeks are the village at full hum: the sunshine season's hot clear days, cold starlit nights, and a Friday or Monday start that covers Christmas or New Year. These are the first breaks to sell out every year; book early and let December plan itself.",
    hero: "season-festive.jpg",
    fromPrice: "from KES 126,000*",
    fromNote:
      "*Lowest price for a three-night Cedar Lodge 2 bedroom break in the festive weeks, subject to availability.",
    ctaLabel: "Find your festive break",
    highlights: [
      {
        title: "The Water Garden",
        copy: "Warm water under glass on the hottest day and the coldest night alike. Included in every break.",
        photo: "activity-pool.jpg",
      },
      {
        title: "The peaks at breakfast",
        copy: "December brings the year's clearest mornings, and the mountain shows itself at dawn. An early breakfast is an event.",
        photo: "hero-forest.jpg",
      },
      {
        title: "An hour to yourselves",
        copy: "The Forest Spa takes the grown-ups; the stove keeps the lodge warm for your return.",
        photo: "activity-spa.jpg",
      },
    ],
    faqs: [
      {
        question: "When should we book?",
        answer:
          "Early. The festive weeks are the busiest of the year, and Friday starts covering Christmas Day go first.",
      },
      {
        question: "Which dates count as festive?",
        answer:
          "Mid-December to early January. Festive pricing applies inside that window, and the season cards show the sunshine-season price either side of it.",
      },
    ],
  },
];

// The teal banner is the campaign slot: rotate it for every break or
// campaign, pointing at /breaks/<slug> or /#search when nothing is running.
const SITE_SETTINGS = {
  banner: {
    text: "August by the fire: the cool season is here, and the Water Garden is steaming.",
    linkLabel: "Explore the break",
    linkHref: "/breaks/august-by-the-fire",
  },
};

const DISCOVER_CARDS = [
  {
    title: "Group bookings",
    copy: "Book several lodges together and keep the whole clan in one corner of the forest.",
    photo: "discover-groups.jpg",
  },
  {
    title: "Gift a break",
    copy: "Give someone a forest break to look forward to. Memories beat wrapping paper.",
    photo: "discover-gift.jpg",
  },
  {
    title: "Village news",
    copy: "What is new in the village, from lodge upgrades to Water Garden opening times.",
    photo: "discover-news.jpg",
  },
];

async function main() {
  const payload = await getPayload({ config });

  // Media first, so everything else can reference the ids.
  const mediaIds: Record<string, number> = {};
  for (const item of MEDIA) {
    const data = {
      alt: item.alt,
      creditUrl: item.creditUrl,
      license: PEXELS_LICENSE,
    };
    const existing = await payload.find({
      collection: "media",
      where: { filename: { equals: item.file } },
      limit: 1,
    });
    if (existing.docs[0]) {
      const updated = await payload.update({
        collection: "media",
        id: existing.docs[0].id,
        data,
      });
      mediaIds[item.file] = updated.id;
    } else {
      const subdir = item.file.endsWith(".mp4") ? "videos" : "photos";
      const created = await payload.create({
        collection: "media",
        data,
        filePath: path.resolve(publicDir, subdir, item.file),
      });
      mediaIds[item.file] = created.id;
    }
  }
  console.log(`media: ${MEDIA.length} in place`);

  for (const activity of ACTIVITIES) {
    const data = { ...activity, photo: mediaIds[activity.photo] };
    const existing = await payload.find({
      collection: "activities",
      where: { slug: { equals: activity.slug } },
      limit: 1,
    });
    if (existing.docs[0]) {
      await payload.update({ collection: "activities", id: existing.docs[0].id, data });
    } else {
      await payload.create({ collection: "activities", data });
    }
  }
  console.log(`activities: ${ACTIVITIES.length} in place`);

  for (const season of SEASONS) {
    const data = { ...season, photo: mediaIds[season.photo] };
    const existing = await payload.find({
      collection: "seasons",
      where: { slug: { equals: season.slug } },
      limit: 1,
    });
    if (existing.docs[0]) {
      await payload.update({ collection: "seasons", id: existing.docs[0].id, data });
    } else {
      await payload.create({ collection: "seasons", data });
    }
  }
  console.log(`seasons: ${SEASONS.length} in place`);

  for (const { oldQuestion, ...faq } of FAQS) {
    let existing = await payload.find({
      collection: "faqs",
      where: { question: { equals: faq.question } },
      limit: 1,
    });
    if (!existing.docs[0] && oldQuestion) {
      // Renamed question: find it under its old text and rewrite in place.
      existing = await payload.find({
        collection: "faqs",
        where: { question: { equals: oldQuestion } },
        limit: 1,
      });
    }
    if (existing.docs[0]) {
      await payload.update({ collection: "faqs", id: existing.docs[0].id, data: faq });
    } else {
      await payload.create({ collection: "faqs", data: faq });
    }
  }
  console.log(`faqs: ${FAQS.length} in place`);

  for (const campaign of CAMPAIGNS) {
    const data = {
      ...campaign,
      hero: mediaIds[campaign.hero],
      highlights: campaign.highlights.map((h) => ({ ...h, photo: mediaIds[h.photo] })),
    };
    const existing = await payload.find({
      collection: "campaigns",
      where: { slug: { equals: campaign.slug } },
      limit: 1,
    });
    if (existing.docs[0]) {
      await payload.update({ collection: "campaigns", id: existing.docs[0].id, data });
    } else {
      await payload.create({ collection: "campaigns", data });
    }
  }
  console.log(`campaigns: ${CAMPAIGNS.length} in place`);

  await payload.updateGlobal({ slug: "site-settings", data: SITE_SETTINGS });
  console.log("site-settings global in place");

  await payload.updateGlobal({
    slug: "home-page",
    data: {
      hero: {
        headingBefore: "For a",
        headingEmphasis: "billion",
        headingAfter: "happy memories",
        subheading: "Your forest break on Mount Kenya",
        intro:
          "A lodge of your own among the cedars, warm water whatever the weather and time together that nobody has to plan. Breaks start every Friday and Monday at Unity Parks Mount Kenya.",
        urgency: "School holiday breaks are booking fast. Find yours before they fill.",
        ctaLabel: "Find your break",
        video: mediaIds["hero-family-lake.mp4"],
        poster: mediaIds["hero-forest.jpg"],
        videoDescription: "A family walking together",
      },
      village: {
        heading: "One village, endless memories",
        intro:
          "Unity Parks Mount Kenya is a car-free forest village at Naro Moru, on the western slopes of the mountain, two and a half hours from Nairobi. Every lodge, lane and warm pool is part of one village built for time together.",
        cardName: "Unity Parks Mount Kenya",
        locationLine: "Naro Moru, Mount Kenya",
        blurb:
          "Mountain forest, two lodge grades at two sizes, warm water under glass and room for the whole family.",
        mapAlt: "Illustrated map of the Unity Parks Mount Kenya village",
      },
      sections: {
        lodgesHeading: "Find the lodge that fits",
        lodgesIntro:
          "Every lodge is yours alone for the whole break. One price per lodge, however many of you come.",
        activitiesHeading: "Things to do, together",
        activitiesIntro: "Days in the village fill themselves. Here is where they usually start.",
        seasonsHeading: "A forest for every season",
        seasonsFootnote: "*Lowest price for a three-night Cedar Lodge 2 bedroom break in the season, subject to availability.",
        discoverHeading: "More from Unity Parks",
        faqsHeading: "Questions, answered",
      },
      discoverCards: DISCOVER_CARDS.map((card) => ({
        title: card.title,
        copy: card.copy,
        photo: mediaIds[card.photo],
      })),
      memories: {
        caption: "memories made so far, counting our way to a billion",
        explainer: "One memory is one guest, one stay in the forest.",
      },
    },
  });
  console.log("home-page global in place");

  console.log("Seed complete.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
