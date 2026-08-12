import "server-only";
import { getPayload } from "payload";
import config from "@payload-config";
import type { Activity, Faq, HomePage, Media, Season } from "@/cms/payload-types";

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
