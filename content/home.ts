/**
 * Homepage marketing content. Words and picture paths only, no behaviour.
 * The page (app/page.tsx) owns layout; edit copy here without touching JSX.
 */

export type ActivityCard = {
  title: string;
  copy: string;
  image: string;
};

export type SeasonCard = {
  title: string;
  copy: string;
  /** Placeholder "from" price line, already formatted. */
  price: string;
  image: string;
};

export type DiscoverCard = {
  title: string;
  copy: string;
  image: string;
};

export type FaqItem = {
  question: string;
  answer: string;
};

export const ACTIVITIES: ActivityCard[] = [
  {
    title: "Swimming lagoon",
    copy: "Warm water all year round, slides for the brave and shallows for the small. The heart of the village, whatever the weather.",
    image: "/photos/activity-pool.jpg",
  },
  {
    title: "On the water",
    copy: "Rowing boats, pedalos and calm lake mornings. Life jackets and big smiles provided.",
    image: "/photos/activity-boats.jpg",
  },
  {
    title: "Cycle trails",
    copy: "Shaded forest loops for every pace, from balance bikes to big rides. Hire a bike or bring your own.",
    image: "/photos/activity-cycle.jpg",
  },
  {
    title: "Forest spa",
    copy: "Steam, stillness and birdsong. A grown-up pause while the rest of the family plays.",
    image: "/photos/activity-spa.jpg",
  },
];

export const SEASONS: SeasonCard[] = [
  {
    title: "Green season",
    copy: "Bright days, cool forest shade and the village at its liveliest.",
    price: "from KES 45,000*",
    image: "/photos/season-green.jpg",
  },
  {
    title: "The long rains",
    copy: "Dramatic skies, quiet trails and the best prices of the year.",
    price: "from KES 38,500*",
    image: "/photos/season-rains.jpg",
  },
  {
    title: "Festive season",
    copy: "Lights in the trees, feasts in the lodge and the year's happiest goodbyes.",
    price: "from KES 62,000*",
    image: "/photos/season-festive.jpg",
  },
];

export const DISCOVER: DiscoverCard[] = [
  {
    title: "Group bookings",
    copy: "Book several lodges together and keep the whole clan in one corner of the forest.",
    image: "/photos/discover-groups.jpg",
  },
  {
    title: "Gift a break",
    copy: "Give someone a forest break to look forward to. Memories beat wrapping paper.",
    image: "/photos/discover-gift.jpg",
  },
  {
    title: "Village news",
    copy: "What is new in the village, from lodge upgrades to lagoon opening times.",
    image: "/photos/discover-news.jpg",
  },
];

export const FAQS: FaqItem[] = [
  {
    question: "What is included in a Unity Parks break?",
    answer:
      "Your lodge for the whole break, access to the swimming lagoon, parking and the run of the village trails. Activities such as boat hire and the forest spa can be added once you arrive.",
  },
  {
    question: "Who are Unity Parks breaks for?",
    answer:
      "Anyone who wants time together. Families, grandparents, friends, couples. Every lodge is self-contained, so the whole party stays under one roof at one price per lodge.",
  },
  {
    question: "How do breaks work?",
    answer:
      "Breaks start on a Friday or a Monday. A weekend break runs Friday to Monday, a midweek break runs Monday to Friday, and a full week is seven nights. Pick your dates and lodge, tell us who is coming, and the village does the rest.",
  },
  {
    question: "How do payments work in this demo?",
    answer:
      "Unity Parks is currently a demonstration. Checkout runs against sandbox systems, so no real money moves and no real card details are needed. Everything else, from availability to your confirmation, works exactly as it will on the real village.",
  },
  {
    question: "Can I bring my dog?",
    answer:
      "No. The village sits on the shore of Lake Naivasha and shares it with hippos, giraffes and hundreds of bird species, so pets stay home for everyone's safety, theirs included.",
  },
];
