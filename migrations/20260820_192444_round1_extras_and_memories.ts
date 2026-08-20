import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "payload"."extras_more" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar NOT NULL,
  	"body" varchar NOT NULL
  );
  
  CREATE TABLE "payload"."extras" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"service_code" varchar NOT NULL,
  	"photo_id" integer,
  	"noun" varchar,
  	"display_order" numeric DEFAULT 0 NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload"."home_page" ALTER COLUMN "hero_heading_after" DROP NOT NULL;
  ALTER TABLE "payload"."payload_locked_documents_rels" ADD COLUMN "extras_id" integer;
  ALTER TABLE "payload"."extras_more" ADD CONSTRAINT "extras_more_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "payload"."extras"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload"."extras" ADD CONSTRAINT "extras_photo_id_media_id_fk" FOREIGN KEY ("photo_id") REFERENCES "payload"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "extras_more_order_idx" ON "payload"."extras_more" USING btree ("_order");
  CREATE INDEX "extras_more_parent_id_idx" ON "payload"."extras_more" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "extras_service_code_idx" ON "payload"."extras" USING btree ("service_code");
  CREATE INDEX "extras_photo_idx" ON "payload"."extras" USING btree ("photo_id");
  CREATE INDEX "extras_updated_at_idx" ON "payload"."extras" USING btree ("updated_at");
  CREATE INDEX "extras_created_at_idx" ON "payload"."extras" USING btree ("created_at");
  ALTER TABLE "payload"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_extras_fk" FOREIGN KEY ("extras_id") REFERENCES "payload"."extras"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_extras_id_idx" ON "payload"."payload_locked_documents_rels" USING btree ("extras_id");
  ALTER TABLE "payload"."home_page" DROP COLUMN "memories_caption";
  ALTER TABLE "payload"."home_page" DROP COLUMN "memories_explainer";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload"."extras_more" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "payload"."extras" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "payload"."extras_more" CASCADE;
  DROP TABLE "payload"."extras" CASCADE;
  ALTER TABLE "payload"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_extras_fk";
  
  DROP INDEX "payload"."payload_locked_documents_rels_extras_id_idx";
  ALTER TABLE "payload"."home_page" ALTER COLUMN "hero_heading_after" SET NOT NULL;
  ALTER TABLE "payload"."home_page" ADD COLUMN "memories_caption" varchar NOT NULL;
  ALTER TABLE "payload"."home_page" ADD COLUMN "memories_explainer" varchar NOT NULL;
  ALTER TABLE "payload"."payload_locked_documents_rels" DROP COLUMN "extras_id";`)
}
