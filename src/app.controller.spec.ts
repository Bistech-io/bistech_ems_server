import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService, LOGO } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return the BisTech EMS welcome banner', () => {
      const response = appController.getHello();
      expect(response).toContain(LOGO);
      expect(response).toContain('BisTech.io  ::  Employee Management System (EMS)');
      expect(response).toContain('[ OK ]  Server is up and running');
    });
  });
});
