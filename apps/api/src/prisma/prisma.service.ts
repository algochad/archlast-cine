import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATABASE_URL, PRISMA_AUTO_PUSH } from '../common/env';

/**
 * Single PrismaClient for the whole app. `$connect` is attempted eagerly so
 * misconfiguration surfaces in the log, but a failure is not fatal: the service
 * still boots and /v1/health reports `db: false` (dev orchestrator guidance
 * assumes the DB may not be up yet).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ datasourceUrl: DATABASE_URL });
  }

  async onModuleInit(): Promise<void> {
    if (PRISMA_AUTO_PUSH) await this.pushSchema();
    try {
      await this.$connect();
      this.logger.log('Connected to Postgres');
    } catch (error) {
      this.logger.warn(
        `Postgres unreachable (${describe(error)}). Start it with: docker compose up -d db redis`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect().catch(() => undefined);
  }

  /** True when `SELECT 1` succeeds. */
  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Dev-parity schema sync before serving traffic (the Postgres analogue of
   * TypeORM's `synchronize: true`). Failures are logged, never fatal.
   */
  private async pushSchema(): Promise<void> {
    // Resolved from the compiled file so the CLI works regardless of the
    // process cwd (docker /app, dev orchestrator, or an installed dist).
    const schema = join(__dirname, '..', '..', 'prisma', 'schema.prisma');
    if (!existsSync(schema)) {
      this.logger.warn(`Prisma schema not found at ${schema}; skipping db push`);
      return;
    }
    try {
      const prismaCli = require.resolve('prisma/build/index.js');
      const result = spawnSync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate', '--schema', schema], {
        env: { ...process.env, DATABASE_URL },
        cwd: dirname(schema),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (result.status === 0) {
        this.logger.log('Applied Prisma schema (db push)');
      } else {
        this.logger.warn(
          `prisma db push failed (${result.status}): ${result.stderr?.toString().trim() || 'unknown error'}`,
        );
      }
    } catch (error) {
      this.logger.warn(`prisma db push unavailable (${describe(error)})`);
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message.split('\n')[0];
  return String(error);
}
