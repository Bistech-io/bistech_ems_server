import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from './database/prisma.service.js';

export const LOGO = String.raw`
██████████████████████████████
 ██████████████████████████████████
   ██████████████████████████████████
    ███████████████████████████████████
      ███████████████████   ███████████
                              █████████
 ███████████████████████       ████████
   ███████████████████         ███████
     ██████████████████████████████
     █████████████████████████████████
    ████████████████████████████████████
  ██████████████████████████████████████
██████████████                 █████████
████████████                    ████████
██████████                     █████████
████████    ████████████████████████████
██████    ██████████████████████████████
████    ████████████████████████████████
██    ███████████████████████████████
█   ████████████████████████████
`;

export function buildBanner(version = '1.0.0'): string {
  const line = '─'.repeat(54);
  return `${LOGO}
  ┌${line}┐
  │  BisTech.io  ::  Employee Management System (EMS)    │
  └${line}┘

  [ OK ]  Server is up and running
  [ OK ]  API status ........ healthy
  [ OK ]  Version ........... v${version}
  [ OK ]  Time .............. ${new Date().toISOString()}

  $ about --bistech
  > BisTech builds software for businesses.
  > This API powers the EMS: employees, attendance & more.
  > Website: https://bistech.io

  $ _
`;
}

@Injectable()
export class AppService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  getHello(): string {
    return buildBanner();
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
