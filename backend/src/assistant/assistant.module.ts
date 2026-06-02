import { Module } from '@nestjs/common';
import { AssistantGateway } from './assistant.gateway';
import { AssistantLiveGateway } from './assistant-live.gateway';
import { RecordingTesterService } from './recording-tester.service';

@Module({
  providers: [AssistantGateway, AssistantLiveGateway, RecordingTesterService],
  exports: [AssistantGateway, AssistantLiveGateway, RecordingTesterService],
})
export class AssistantModule {}
