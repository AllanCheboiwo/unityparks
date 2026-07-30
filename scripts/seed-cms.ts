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
    alt: "A family walking together by the lake",
    creditUrl: "https://www.pexels.com/video/family-walk-by-the-lake-5729004/",
  },
  {
    file: "hero-forest.jpg",
    alt: "A lodge in the forest at the edge of the lake",
    creditUrl: "https://www.pexels.com/photo/cabin-near-lake-in-finland-27869122/",
  },
  {
    file: "activity-pool.jpg",
    alt: "Swimming lagoon",
    creditUrl: "https://www.pexels.com/photo/5626882/",
  },
  {
    file: "activity-boats.jpg",
    alt: "On the water",
    creditUrl: "https://www.pexels.com/photo/33679883/",
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
    alt: "Green season",
    creditUrl: "https://www.pexels.com/photo/25491108/",
  },
  {
    file: "season-rains.jpg",
    alt: "The long rains",
    creditUrl: "https://www.pexels.com/photo/32293234/",
  },
  {
    file: "season-festive.jpg",
    alt: "Festive season",
    creditUrl: "https://www.pexels.com/photo/19737894/",
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
    title: "Swimming lagoon",
    copy: "Warm water all year round, slides for the brave and shallows for the small. The heart of the village, whatever the weather.",
    photo: "activity-pool.jpg",
    displayOrder: 1,
  },
  {
    slug: "on-the-water",
    title: "On the water",
    copy: "Rowing boats, pedalos and calm lake mornings. Life jackets and big smiles provided.",
    photo: "activity-boats.jpg",
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

const SEASONS = [
  {
    slug: "green-season",
    title: "Green season",
    copy: "Bright days, cool forest shade and the village at its liveliest.",
    fromPrice: "from KES 45,000*",
    photo: "season-green.jpg",
    displayOrder: 1,
  },
  {
    slug: "long-rains",
    title: "The long rains",
    copy: "Dramatic skies, quiet trails and the best prices of the year.",
    fromPrice: "from KES 38,500*",
    photo: "season-rains.jpg",
    displayOrder: 2,
  },
  {
    slug: "festive-season",
    title: "Festive season",
    copy: "Lights in the trees, feasts in the lodge and the year's happiest goodbyes.",
    fromPrice: "from KES 62,000*",
    photo: "season-festive.jpg",
    displayOrder: 3,
  },
];

const FAQS = [
  {
    question: "What is included in a Unity Parks break?",
    answer:
      "Your lodge for the whole break, access to the swimming lagoon, parking and the run of the village trails. Activities such as boat hire and the forest spa can be added once you arrive.",
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
      "No. The village sits on the shore of Lake Naivasha and shares it with hippos, giraffes and hundreds of bird species, so pets stay home for everyone's safety, theirs included.",
    displayOrder: 5,
  },
];

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
    copy: "What is new in the village, from lodge upgrades to lagoon opening times.",
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

  for (const faq of FAQS) {
    const existing = await payload.find({
      collection: "faqs",
      where: { question: { equals: faq.question } },
      limit: 1,
    });
    if (existing.docs[0]) {
      await payload.update({ collection: "faqs", id: existing.docs[0].id, data: faq });
    } else {
      await payload.create({ collection: "faqs", data: faq });
    }
  }
  console.log(`faqs: ${FAQS.length} in place`);

  await payload.updateGlobal({
    slug: "home-page",
    data: {
      hero: {
        headingBefore: "For a",
        headingEmphasis: "billion",
        headingAfter: "happy memories",
        subheading: "Your forest break at Lake Naivasha",
        intro:
          "A lodge of your own among the trees, a lagoon to splash in and time together that nobody has to plan. Breaks start every Friday and Monday at Unity Parks Naivasha.",
        urgency: "School holiday breaks are booking fast. Find yours before they fill.",
        ctaLabel: "Find your break",
        video: mediaIds["hero-family-lake.mp4"],
        poster: mediaIds["hero-forest.jpg"],
        videoDescription: "A family walking together by the lake",
      },
      village: {
        heading: "One village, endless memories",
        intro:
          "Unity Parks Naivasha sits in the forest on the shore of Lake Naivasha, Kenya. Every lodge, trail and splash of the lagoon is part of one village built for time together.",
        cardName: "Unity Parks Naivasha",
        locationLine: "Lake Naivasha, Kenya",
        blurb:
          "Lakeside forest, four lodge styles, one swimming lagoon and room for the whole family.",
        mapAlt: "Illustrated map of the Unity Parks Naivasha village",
      },
      sections: {
        lodgesHeading: "Find the lodge that fits",
        lodgesIntro:
          "Every lodge is yours alone for the whole break. One price per lodge, however many of you come.",
        activitiesHeading: "Things to do, together",
        activitiesIntro: "Days in the village fill themselves. Here is where they usually start.",
        seasonsHeading: "A forest for every season",
        seasonsFootnote: "*Lowest lodge price for the season, subject to availability.",
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
