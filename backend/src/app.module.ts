import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AssistantModule } from './assistant/assistant.module';

@Module({
  imports: [
    // Load environment variables from .env globally
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AssistantModule,
  ],
})
export class AppModule { }
