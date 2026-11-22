import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import express from 'express';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from '../dist/app.module.js';
import { HttpExceptionFilter } from '../dist/common/filters/http-exception.filter.js';

let cachedServer;

async function bootstrapServer() {
  const expressApp = express();
  const adapter = new ExpressAdapter(expressApp);
  const app = await NestFactory.create(AppModule, adapter);

  app.use(cookieParser());
  app.setGlobalPrefix('api/v1', { exclude: ['/'] });
  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableCors({
    origin: (origin, callback) => {
      // Allow localhost, vercel deployments, or direct server-to-server calls
      if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1') || origin.endsWith('.vercel.app')) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-Id'],
  });

  await app.init();
  return expressApp;
}

export default async function handler(req, res) {
  if (!cachedServer) {
    cachedServer = await bootstrapServer();
  }
  return cachedServer(req, res);
}
