import { MigrationInterface, QueryRunner } from 'typeorm';

export class KanbanSchema1730000000000 implements MigrationInterface {
  name = 'KanbanSchema1730000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'goals'
        ) THEN
          ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "scaleStart" date;
          UPDATE "goals"
          SET "scaleStart" = COALESCE("deadline", ("createdAt")::date, CURRENT_DATE)
          WHERE "scaleStart" IS NULL;
          ALTER TABLE "goals" ALTER COLUMN "scaleStart" SET NOT NULL;
        END IF;
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'graph_nodes'
        ) THEN
          ALTER TABLE "graph_nodes" ADD COLUMN IF NOT EXISTS "progress" integer;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "boards" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "nodeId" character varying NOT NULL,
        CONSTRAINT "PK_boards" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_boards_nodeId" UNIQUE ("nodeId")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cards" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "boardId" character varying NOT NULL,
        "columnKey" character varying NOT NULL,
        "position" integer NOT NULL,
        "title" character varying NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "priority" character varying NOT NULL DEFAULT 'medium',
        "dueDate" date,
        CONSTRAINT "PK_cards" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "card_assignees" (
        "cardId" character varying NOT NULL,
        "userId" character varying NOT NULL,
        CONSTRAINT "PK_card_assignees" PRIMARY KEY ("cardId", "userId")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "checklist_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "cardId" character varying NOT NULL,
        "text" text NOT NULL,
        "done" boolean NOT NULL DEFAULT false,
        "position" integer NOT NULL,
        CONSTRAINT "PK_checklist_items" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "comments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "cardId" character varying NOT NULL,
        "authorId" character varying NOT NULL,
        "text" text NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_comments" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "time_entries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "cardId" character varying NOT NULL,
        "userId" character varying NOT NULL,
        "minutes" integer NOT NULL,
        "note" text NOT NULL DEFAULT '',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_time_entries" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "timers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "cardId" character varying NOT NULL,
        "userId" character varying NOT NULL,
        "startedAt" timestamptz NOT NULL,
        CONSTRAINT "PK_timers" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_timers_card_user" UNIQUE ("cardId", "userId")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "card_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "cardId" character varying NOT NULL,
        "actorId" character varying NOT NULL,
        "type" character varying NOT NULL,
        "payload" jsonb NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_card_events" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "card_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "timers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "time_entries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "comments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "checklist_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "card_assignees"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cards"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "boards"`);
    await queryRunner.query(
      `ALTER TABLE "graph_nodes" DROP COLUMN IF EXISTS "progress"`,
    );
    await queryRunner.query(
      `ALTER TABLE "goals" DROP COLUMN IF EXISTS "scaleStart"`,
    );
  }
}
