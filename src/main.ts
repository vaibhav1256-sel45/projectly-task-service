import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Transport } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true,forbidNonWhitelisted:true,transform:true }));
  const configService = app.get(ConfigService);
  // listens for project events (project.deleted) from RabbitMQ
  app.connectMicroservice({
    transport: Transport.RMQ,
    options: {
      urls: [configService.getOrThrow<string>('rabbitmq.url')],
      queue: 'project_events',
      noAck: false, // a message is acknowledged only after it has been handled
      queueOptions: { durable: true },
    },
  });

  // other services ask this one for task numbers (statistics)
  app.connectMicroservice({
    transport: Transport.GRPC,
    options: {
      package: 'task',
      protoPath: join(import.meta.dirname, './proto/task.proto'),
      url: configService.getOrThrow<string>('grpc.url'),
      loader: { keepCase: true, defaults: true }, // defaults: zero counts and empty lists are sent too
    },
  });

  const config = new DocumentBuilder()
    .setTitle('Project API')
    .setDescription('Project API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup('api', app, SwaggerModule.createDocument(app, config));
   app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization',
  });
  await app.startAllMicroservices();
  // Health check: answered by the HTTP adapter itself, so no auth guard or response wrapper is involved.
  app.getHttpAdapter().get('/health', (_req: any, res: any) =>
    res.status(200).json({ status: 'ok', service: 'task-service', uptime: Math.round(process.uptime()) }),
  );

  // Graceful shutdown: on SIGTERM / SIGINT the app stops taking requests, closes the gRPC and
  // RabbitMQ listeners, and lets the database / Redis connections close before the process exits.
  app.enableShutdownHooks();

  await app.listen(configService.getOrThrow<number>('port'));
}
await bootstrap();
