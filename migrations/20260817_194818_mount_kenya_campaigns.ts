import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "payload"."campaigns_highlights" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"copy" varchar NOT NULL,
  	"photo_id" integer NOT NULL
  );
  
  CREATE TABLE "payload"."campaigns_faqs" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"question" varchar NOT NULL,
  	"answer" varchar NOT NULL
  );
  
  CREATE TABLE "payload"."campaigns" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"slug" varchar NOT NULL,
  	"name" varchar NOT NULL,
  	"window" varchar NOT NULL,
  	"strapline" varchar NOT NULL,
  	"intro" varchar NOT NULL,
  	"hero_id" integer NOT NULL,
  	"from_price" varchar NOT NULL,
  	"from_note" varchar NOT NULL,
  	"cta_label" varchar DEFAULT 'Find your break' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload"."site_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"banner_text" varchar NOT NULL,
  	"banner_link_label" varchar NOT NULL,
  	"banner_link_href" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "payload"."payload_locked_documents_rels" ADD COLUMN "campaigns_id" integer;
  ALTER TABLE "payload"."campaigns_highlights" ADD CONSTRAINT "campaigns_highlights_photo_id_media_id_fk" FOREIGN KEY ("photo_id") REFERENCES "payload"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload"."campaigns_highlights" ADD CONSTRAINT "campaigns_highlights_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "payload"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload"."campaigns_faqs" ADD CONSTRAINT "campaigns_faqs_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "payload"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload"."campaigns" ADD CONSTRAINT "campaigns_hero_id_media_id_fk" FOREIGN KEY ("hero_id") REFERENCES "payload"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "campaigns_highlights_order_idx" ON "payload"."campaigns_highlights" USING btree ("_order");
  CREATE INDEX "campaigns_highlights_parent_id_idx" ON "payload"."campaigns_highlights" USING btree ("_parent_id");
  CREATE INDEX "campaigns_highlights_photo_idx" ON "payload"."campaigns_highlights" USING btree ("photo_id");
  CREATE INDEX "campaigns_faqs_order_idx" ON "payload"."campaigns_faqs" USING btree ("_order");
  CREATE INDEX "campaigns_faqs_parent_id_idx" ON "payload"."campaigns_faqs" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "campaigns_slug_idx" ON "payload"."campaigns" USING btree ("slug");
  CREATE INDEX "campaigns_hero_idx" ON "payload"."campaigns" USING btree ("hero_id");
  CREATE INDEX "campaigns_updated_at_idx" ON "payload"."campaigns" USING btree ("updated_at");
  CREATE INDEX "campaigns_created_at_idx" ON "payload"."campaigns" USING btree ("created_at");
  ALTER TABLE "payload"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_campaigns_fk" FOREIGN KEY ("campaigns_id") REFERENCES "payload"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_campaigns_id_idx" ON "payload"."payload_locked_documents_rels" USING btree ("campaigns_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload"."campaigns_highlights" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "payload"."campaigns_faqs" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "payload"."campaigns" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "payload"."site_settings" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "payload"."campaigns_highlights" CASCADE;
  DROP TABLE "payload"."campaigns_faqs" CASCADE;
  DROP TABLE "payload"."campaigns" CASCADE;
  DROP TABLE "payload"."site_settings" CASCADE;
  ALTER TABLE "payload"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_campaigns_fk";
  
  DROP INDEX "payload"."payload_locked_documents_rels_campaigns_id_idx";
  ALTER TABLE "payload"."payload_locked_documents_rels" DROP COLUMN "campaigns_id";`)
}
