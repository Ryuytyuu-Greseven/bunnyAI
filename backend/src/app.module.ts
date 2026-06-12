import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AssistantModule } from './assistant/assistant.module';
import { TwilioModule } from './twilio/twilio.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AssistantModule,
    TwilioModule,
  ],
})
export class AppModule {}
