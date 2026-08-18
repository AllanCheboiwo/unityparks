import "server-only";
import { getPayload } from "payload";
import config from "@payload-config";
import type {
  Activity,
  Campaign,
  Faq,
  HomePage,
  Media,
  Season,
  SiteSetting,
} from "@/cms/payload-types";

/**
 * The only door to CMS content. Server components call these functions and
 * pass plain props down to client components; nothing else imports Payload.
 */

export type HomeContent = {
  home: HomePage;
  activities: Activity[];
  seasons: Season[];
  faqs: Faq[];
};

export async function getHomeContent(): Promise<HomeContent> {
  const payload = await getPayload({ config });
  const [home, activities, seasons, faqs] = await Promise.all([
    payload.findGlobal({ slug: "home-page" }),
    payload.find({ collection: "activities", sort: "displayOrder", pagination: false }),
    payload.find({ collection: "seasons", sort: "displayOrder", pagination: false }),
    payload.find({ collection: "faqs", sort: "displayOrder", pagination: false }),
  ]);

  if (!home?.hero?.headingBefore || activities.docs.length === 0) {
    throw new Error(
      "CMS content is missing from this database. Seed it first: npm run seed:cms"
    );
  }

  return {
    home,
    activities: activities.docs,
    seasons: seasons.docs,
    faqs: faqs.docs,
  };
}

/** The season cards, for pages beyond the homepage (breaks, village). */
export async function getSeasons(): Promise<Season[]> {
  const payload = await getPayload({ config });
  const result = await payload.find({
    collection: "seasons",
    sort: "displayOrder",
    pagination: false,
  });
  return result.docs;
}

/** The activity cards, for the things-to-do landing. */
export async function getActivities(): Promise<Activity[]> {
  const payload = await getPayload({ config });
  const result = await payload.find({
    collection: "activities",
    sort: "displayOrder",
    pagination: false,
  });
  return result.docs;
}

/**
 * The site-wide banner (the campaign slot), or null when the global has not
 * been seeded yet. The layout keeps a built-in fallback line, so a fresh
 * database renders a working header before its first seed.
 */
export async function getSiteBanner(): Promise<SiteSetting["banner"] | null> {
  const payload = await getPayload({ config });
  try {
    const settings = await payload.findGlobal({ slug: "site-settings" });
    return settings?.banner?.text ? settings.banner : null;
  } catch {
    return null;
  }
}

/** One evergreen campaign page by slug (/breaks/<slug>), or null. */
export async function getCampaign(slug: string): Promise<Campaign | null> {
  const payload = await getPayload({ config });
  const result = await payload.find({
    collection: "campaigns",
    where: { slug: { equals: slug } },
    limit: 1,
  });
  return result.docs[0] ?? null;
}

/**
 * Narrows a Payload upload relation to a usable url + alt pair. Relations
 * are populated objects at the default query depth; a bare id here means a
 * query asked for depth 0 somewhere it should not have.
 */
export function mediaRef(value: number | Media | null | undefined): {
  url: string;
  alt: string;
} {
  if (!value || typeof value === "number" || !value.url) {
    throw new Error("Media relation was not populated; check the query depth.");
  }
  return { url: value.url, alt: value.alt };
}
