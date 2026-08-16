import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../auth/jwt-auth.guard';

@ApiTags('health')
// Probes are version-neutral: infrastructure must not have to track API versions.
@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process is up. Deliberately does not touch dependencies. */
  @Public()
  @Get('healthz')
  live(): { status: string } {
    return { status: 'ok' };
  }

  /** Readiness: only report ready when the database is actually reachable. */
  @Public()
  @Get('readyz')
  @ApiOperation({ summary: 'Readiness probe including database connectivity' })
  async ready(): Promise<{ status: string; database: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'ok' };
    } catch {
      return { status: 'degraded', database: 'unavailable' };
    }
  }
}
