import { AIMessage } from '@langchain/core/messages';
import { salesGraph } from './sales.graph';
import { SalesState } from '../state/sales.state';

// 1. Deep Mock the LLM Instance and Prompts
jest.mock('../../../llms/google.llm', () => ({
  llmInstance: {
    invoke: jest.fn(),
    withStructuredOutput: jest.fn(),
  },
}));

jest.mock('../prompt/sales.prompts', () => ({
  getPrompt: jest.fn().mockResolvedValue('Mocked prompt'),
}));

// Import the mocked instance
import { llmInstance } from '../../../llms/google.llm';

describe('Sales Agent E2E Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const getInitialState = (): SalesState => ({
    messages: [],
    companyName: null,
    industry: null,
    painPoints: null,
    routeDestination: '',
    budget: null,
    meetingScheduled: null,
    currentNode: null,
  });

  it('should complete the Happy Path successfully', async () => {
    // Mock Router to go to Greeting first
    const mockRouter = { invoke: jest.fn().mockResolvedValueOnce({ routeDestination: 'Greeting_Pitch_Node' }) };

    // Mock Discovery to return all info at once
    const mockDiscovery = {
      invoke: jest.fn().mockResolvedValue({
        companyName: 'Tech Corp',
        industry: 'Software',
        painPoints: 'Slow deployments',
        responseToUser: 'Got it. Let me present.',
      }),
    };

    // Mock Closing to return meeting scheduled
    const mockClosing = {
      invoke: jest.fn().mockResolvedValue({
        meetingScheduled: true,
        responseToUser: 'Meeting scheduled!',
      }),
    };

    (llmInstance.withStructuredOutput as jest.Mock).mockImplementation((schema, options) => {
      if (options.name === 'route_user') return mockRouter;
      if (options.name === 'extract_discovery') return mockDiscovery;
      if (options.name === 'extract_closing') return mockClosing;
    });

    (llmInstance.invoke as jest.Mock).mockResolvedValue(new AIMessage('Conversational response'));

    let state = getInitialState();

    // 1st Turn: Start -> Router -> Greeting Pitch -> __end__
    state = await salesGraph.invoke(state, { configurable: { thread_id: 'test' } });
    expect(state.currentNode).toBe('Greeting_Pitch_Node');

    // User speaks, Router analyzes and sends to Discovery
    mockRouter.invoke.mockResolvedValueOnce({ routeDestination: 'Discovery_Node' });
    state.messages.push(new AIMessage('Tell me more.'));

    // 2nd Turn: Start -> Router -> Discovery -> Presentation -> __end__
    state = await salesGraph.invoke(state, { configurable: { thread_id: 'test' } });

    expect(state.currentNode).toBe('Presentation_Node');
    expect(state.companyName).toBe('Tech Corp');
    expect(state.industry).toBe('Software');
    expect(state.painPoints).toBe('Slow deployments');

    // 3rd Turn: User asks a question, goes to Closing Node
    mockRouter.invoke.mockResolvedValueOnce({ routeDestination: 'Closing_Node' });
    state.messages.push(new AIMessage('Sounds good, lets meet.'));

    state = await salesGraph.invoke(state, { configurable: { thread_id: 'test' } });

    expect(state.currentNode).toBe('Closing_Node');
    expect(state.meetingScheduled).toBe(true);
  });

  it('should loop in Discovery until all fields are filled', async () => {
    const mockRouter = { invoke: jest.fn().mockResolvedValue({ routeDestination: 'Discovery_Node' }) };

    // First invocation: only Company is given
    const mockDiscovery = {
      invoke: jest.fn()
        .mockResolvedValueOnce({
          companyName: 'Acme Inc',
          industry: null,
          painPoints: null,
          responseToUser: 'What industry are you in?',
        })
        // Second invocation: Industry and Pain Points given
        .mockResolvedValueOnce({
          companyName: null,
          industry: 'Manufacturing',
          painPoints: 'Supply chain delays',
          responseToUser: 'Got it. Presenting...',
        }),
    };

    (llmInstance.withStructuredOutput as jest.Mock).mockImplementation((schema, options) => {
      if (options.name === 'route_user') return mockRouter;
      if (options.name === 'extract_discovery') return mockDiscovery;
    });

    (llmInstance.invoke as jest.Mock).mockResolvedValue(new AIMessage('General output'));

    let state = getInitialState();

    // Turn 1: Router -> Discovery (gets Company) -> Ends because info is missing
    state = await salesGraph.invoke(state, { configurable: { thread_id: 'test2' } });

    expect(state.currentNode).toBe('Discovery_Node');
    expect(state.companyName).toBe('Acme Inc');
    expect(state.industry).toBeNull(); // Still missing

    // Turn 2: User gives industry and pain points
    state.messages.push(new AIMessage('Manufacturing, supply chain is slow.'));
    state = await salesGraph.invoke(state, { configurable: { thread_id: 'test2' } });

    // Now it should have all info and proceed to Presentation
    expect(state.currentNode).toBe('Presentation_Node');
    expect(state.industry).toBe('Manufacturing');
    expect(state.painPoints).toBe('Supply chain delays');
  });

  it('should route to Graceful Rejection when meeting is not scheduled', async () => {
    const mockRouter = { invoke: jest.fn().mockResolvedValueOnce({ routeDestination: 'Closing_Node' }) };
    const mockClosing = {
      invoke: jest.fn().mockResolvedValue({
        meetingScheduled: false, // User said no
        responseToUser: 'Okay, maybe next time.',
      }),
    };

    (llmInstance.withStructuredOutput as jest.Mock).mockImplementation((schema, options) => {
      if (options.name === 'route_user') return mockRouter;
      if (options.name === 'extract_closing') return mockClosing;
    });

    (llmInstance.invoke as jest.Mock).mockResolvedValue(new AIMessage('Sorry to hear that, goodbye.'));

    let state = getInitialState();

    // Flow: Start -> Router -> Closing (false) -> Graceful Rejection -> __end__
    state = await salesGraph.invoke(state, { configurable: { thread_id: 'test3' } });

    expect(state.meetingScheduled).toBe(false);
    expect(state.currentNode).toBe('Closing_Node'); // The last node it recorded in its updates was Closing Node, but it routed through Rejection
    // The Graceful Rejection node just returns { messages: [response] }, it doesn't update currentNode in the credit card example
  });
});
