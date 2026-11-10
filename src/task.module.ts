import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ResponseInterceptor } from "./Interceptors/response.interceptors.js";
import { ErrorInterceptor } from "./Interceptors/error.interceptors.js";
import { ConfigModule, ConfigService } from "@nestjs/config";
import configuration from "./config/configuration.js";
import { LoggerModule } from "nestjs-pino";
import {MongooseModule} from '@nestjs/mongoose'
import { Task, TaskSchema } from "./schemas/task.schema.js";
import { Comment, CommentSchema } from "./schemas/comment.schema.js";
import { TaskHistory, TaskHistorySchema } from "./schemas/history.schema.js";
import { AuthGuard } from './guards/auth.guard.js'
import { AuthClient } from './auth/auth-client.service.js'
import { GrpcBreaker } from './grpc/grpc-breaker.service.js'
import { TaskService } from "./task.service.js";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { join } from "path";
import { TaskController } from "./task.controllers.js";
import { AiService } from "./ai/ai.service.js";
@Module({
 imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: 'info',
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
          },
        },
      },
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow<string>('mongo.uri'),
      }),
    }),
    MongooseModule.forFeature([
      {
        name: Task.name,
        schema: TaskSchema,
      },
      {
        name: Comment.name,
        schema: CommentSchema,
      },
      {
        name: TaskHistory.name,
        schema: TaskHistorySchema,
      },
    ]),
      ClientsModule.registerAsync([
      {
        name: 'AUTH',
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: 'auth',
            protoPath: join(import.meta.dirname, 'proto/auth.proto'),
            url: configService.getOrThrow<string>('grpc.authUrl'),
            loader: { keepCase: true },
          },
        }),
      },
      {
        name: 'USER',
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: 'user',
            protoPath: join(import.meta.dirname, 'proto/user.proto'),
            url: configService.getOrThrow<string>('grpc.userUrl'),
            loader: { keepCase: true },
          },
        }),
      },
      {
        // asks common-service to send emails (task changes, @mentions)
        name: 'MAIL',
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [configService.getOrThrow<string>('rabbitmq.url')],
            queue: 'mail_events',
            persistent: true,
            queueOptions: { durable: true },
          },
        }),
      },
      {
        name: 'PROJECT',
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: 'project',
            protoPath: join(import.meta.dirname, 'proto/project.proto'),
            url: configService.getOrThrow<string>('grpc.projectUrl'),
            loader: { keepCase: true },
          },
        }),
      },
    ]),
  ],
  controllers: [TaskController],
  providers: [
    AuthClient,
    GrpcBreaker,
    TaskService,
    AiService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ErrorInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard, 
    }

  ],
})

export class TaskModule{}