import { Module } from '@nestjs/common';
import { AssistantGateway } from './gateways/assistant.gateway';
import { AssistantLiveGateway } from './gateways/assistant-live.gateway';
import { RecordingTesterService } from './recording-tester.service';
import { AssistantService } from './services/assistant.service';
import { AudioDriverService } from './services/audio-driver.service';
import { GeminiService } from './services/gemini.service';
import { OpenAiService } from './services/openai.service';
import { SharedAiService } from './services/shared-ai.service';
import { AgentService } from './agents/agent.service';
import { McpController } from './mcp.controller';
import { DeepGram } from './stt/deepgram/transcribe';

@Module({
  controllers: [
    McpController,
  ],
  providers: [
    AssistantGateway,
    AssistantLiveGateway,
    RecordingTesterService,
    AssistantService,
    AudioDriverService,
    GeminiService,
    OpenAiService,
    SharedAiService,
    AgentService,
    DeepGram,
  ],
  exports: [
    AssistantGateway,
    AssistantLiveGateway,
    RecordingTesterService,
    AssistantService,
    AudioDriverService,
    GeminiService,
    OpenAiService,
    SharedAiService,
    AgentService,
    DeepGram,
  ],
})
export class AssistantModule { }
