import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { DemoActorGuard } from './common/demo-actor.guard';
import { UsersModule } from './users/users.module';
import { GoalsModule } from './goals/goals.module';
import { GraphModule } from './graph/graph.module';
import { KanbanModule } from './kanban/kanban.module';
import { KanbanSchema1730000000000 } from './migrations/1730000000000-KanbanSchema';
import { NodeSize1731000000000 } from './migrations/1731000000000-NodeSize';
import { SeedService } from './seed/seed.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DATABASE_HOST', '127.0.0.1'),
        port: Number(config.get('DATABASE_PORT', 5432)),
        username: config.get('DATABASE_USER', 'visualtask'),
        password: config.get('DATABASE_PASSWORD', 'visualtask'),
        database: config.get('DATABASE_NAME', 'visualtask'),
        autoLoadEntities: true,
        synchronize: true,
        migrations: [KanbanSchema1730000000000, NodeSize1731000000000],
        migrationsRun: true,
      }),
    }),
    UsersModule,
    GoalsModule,
    GraphModule,
    KanbanModule,
  ],
  controllers: [HealthController],
  providers: [SeedService, { provide: APP_GUARD, useClass: DemoActorGuard }],
})
export class AppModule {}
