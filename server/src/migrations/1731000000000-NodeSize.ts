import { MigrationInterface, QueryRunner } from 'typeorm';

export class NodeSize1731000000000 implements MigrationInterface {
  name = 'NodeSize1731000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "graph_nodes" ADD COLUMN IF NOT EXISTS "width" double precision
    `);
    await queryRunner.query(`
      ALTER TABLE "graph_nodes" ADD COLUMN IF NOT EXISTS "height" double precision
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "graph_nodes" DROP COLUMN IF EXISTS "height"`);
    await queryRunner.query(`ALTER TABLE "graph_nodes" DROP COLUMN IF EXISTS "width"`);
  }
}
