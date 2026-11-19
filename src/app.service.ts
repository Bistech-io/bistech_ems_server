import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from './database/prisma.service.js';

@Injectable()
export class AppService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  getHello(): string {
    return 'Hello World!';
  }

  async checkDatabase(): Promise<{ status: string; database: string; user: string }> {
    if (!this.prisma) {
      return { status: 'disconnected', database: 'none', user: 'none' };
    }
    const result = await this.prisma.$queryRawUnsafe<
      Array<{ current_database: string; current_user: string }>
    >('SELECT current_database(), current_user');
    return {
      status: 'connected',
      database: result[0]?.current_database ?? 'unknown',
      user: result[0]?.current_user ?? 'unknown',
    };
  }
}
