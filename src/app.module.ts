import { Module } from '@nestjs/common';
import { TaskModule } from './task.module.js';


@Module({
  imports: [
   TaskModule
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
