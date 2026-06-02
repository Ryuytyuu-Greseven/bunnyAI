import { Module } from '@nestjs/common';
import { AssistantGateway } from './gateways/assistant.gateway';
import { AssistantLiveGateway } from './gateways/assistant-live.gateway';
import { RecordingTesterService } from './recording-tester.service';
import { AssistantService } from './services/assistant.service';
import { GeminiService } from './services/gemini.service';
import { OpenAiService } from './services/openai.service';
import { SharedAiService } from './services/shared-ai.service';

@Module({
  providers: [
    AssistantGateway,
    AssistantLiveGateway,
    RecordingTesterService,
    AssistantService,
    GeminiService,
    OpenAiService,
    SharedAiService,
  ],
  exports: [
    AssistantGateway,
    AssistantLiveGateway,
    RecordingTesterService,
    AssistantService,
    GeminiService,
    OpenAiService,
    SharedAiService,
  ],
})
export class AssistantModule { }
