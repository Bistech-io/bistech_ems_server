import { Controller, Get, Header, HttpCode, HttpStatus } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/plain; charset=utf-8')
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health/db')
  async checkDb() {
    return this.appService.checkDatabase();
  }
}
