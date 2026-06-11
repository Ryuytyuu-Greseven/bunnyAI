import { AIMessage } from '@langchain/core/messages';
import { creditCardsGraph } from './creditcard.graph';
import { CreditCardState } from '../state/creditcard.state';

// 1. Deep Mock the LLM Instance and Prompts
jest.mock('../../../llms/google.llm', () => ({
  llmInstance: {
    invoke: jest.fn(),
    withStructuredOutput: jest.fn(),
  },
}));

jest.mock('../prompt/creditcard.prompts', () => ({
  getPrompt: jest.fn().mockResolvedValue('Mocked prompt'),
}));

// Import the mocked instance
import { llmInstance } from '../../../llms/google.llm';

describe('Credit Card Agent E2E Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const getInitialState = (): CreditCardState => ({
    messages: [],
    annualIncome: null,
    fullName: null,
    address: null,
    last4SSN: null,
    routeDestination: null,
    preApprovalStatus: null,
    creditLimit: null,
    currentNode: null,
  });

  it('should complete the Happy Path successfully', async () => {
    // Mock Router to go to Greeting first
    const mockRouter = { invoke: jest.fn().mockResolvedValueOnce({ routeDestination: 'Greeting_Pitch_Node' }) };
    
    // Mock Qualification to return 60k
    const mockQualification = {
      invoke: jest.fn().mockResolvedValue({
        annualIncome: 60000,
        responseToUser: 'Great income!',
      }),
    };
    
    // Mock Identity to return all info at once
    const mockIdentity = {
      invoke: jest.fn().mockResolvedValue({
        fullName: 'John Doe',
        address: '123 Main St',
        last4SSN: '1234',
        responseToUser: 'Got your identity!',
      }),
    };

    (llmInstance.withStructuredOutput as jest.Mock).mockImplementation((schema, options) => {
      if (options.name === 'route_user') return mockRouter;
      if (options.name === 'extract_qualification') return mockQualification;
      if (options.name === 'extract_identity') return mockIdentity;
    });

    (llmInstance.invoke as jest.Mock).mockResolvedValue(new AIMessage('Conversational response'));

    let state = getInitialState();

    // 1st Turn: Start -> Router -> Greeting Pitch -> __end__
    state = await creditCardsGraph.invoke(state);
    expect(state.currentNode).toBe('Greeting_Pitch_Node');

    // User speaks, Router analyzes and sends to Qualification
    mockRouter.invoke.mockResolvedValueOnce({ routeDestination: 'Qualification_Node' });
    state.messages.push(new AIMessage('Yes I want the card.'));
    
    // 2nd Turn: Start -> Router -> Qualification -> Identity -> API -> Closing -> __end__
    state = await creditCardsGraph.invoke(state);
    
    expect(state.currentNode).toBe('Closing_Node');
    expect(state.annualIncome).toBe(60000);
    expect(state.fullName).toBe('John Doe');
    expect(state.preApprovalStatus).toBe('approved');
    expect(state.creditLimit).toBe(5000);
  });

  it('should route to Graceful Rejection when income is below 30k', async () => {
    const mockRouter = { invoke: jest.fn().mockResolvedValueOnce({ routeDestination: 'Qualification_Node' }) };
    const mockQualification = {
      invoke: jest.fn().mockResolvedValue({
        annualIncome: 20000, // Below 30k
        responseToUser: 'Got income',
      }),
    };

    (llmInstance.withStructuredOutput as jest.Mock).mockImplementation((schema, options) => {
      if (options.name === 'route_user') return mockRouter;
      if (options.name === 'extract_qualification') return mockQualification;
    });

    (llmInstance.invoke as jest.Mock).mockResolvedValue(new AIMessage('Sorry, rejected.'));

    let state = getInitialState();
    
    // Flow: Start -> Router -> Qualification (20k) -> Graceful Rejection -> __end__
    state = await creditCardsGraph.invoke(state);

    expect(state.annualIncome).toBe(20000);
    expect(state.fullName).toBeNull(); // Should never hit Identity
    expect(state.preApprovalStatus).toBeNull(); // Should never hit API
  });

  it('should loop in Identity Collection until all fields are filled', async () => {
    const mockRouter = { invoke: jest.fn().mockResolvedValue({ routeDestination: 'Identity_Collection_Node' }) };
    
    // First invocation: only Name is given
    const mockIdentity = {
      invoke: jest.fn()
        .mockResolvedValueOnce({
          fullName: 'Alice Smith',
          address: null,
          last4SSN: null,
          responseToUser: 'What is your address?',
        })
        // Second invocation: Address and SSN given
        .mockResolvedValueOnce({
          fullName: null,
          address: '456 Oak St',
          last4SSN: '9876',
          responseToUser: 'Thanks!',
        }),
    };

    (llmInstance.withStructuredOutput as jest.Mock).mockImplementation((schema, options) => {
      if (options.name === 'route_user') return mockRouter;
      if (options.name === 'extract_identity') return mockIdentity;
    });

    (llmInstance.invoke as jest.Mock).mockResolvedValue(new AIMessage('General output'));

    let state = getInitialState();
    
    // Turn 1: Router -> Identity (gets Name) -> Ends because info is missing
    state = await creditCardsGraph.invoke(state);
    
    expect(state.currentNode).toBe('Identity_Collection_Node');
    expect(state.fullName).toBe('Alice Smith');
    expect(state.address).toBeNull(); // Still missing
    expect(state.preApprovalStatus).toBeNull();

    // Turn 2: User gives address and SSN
    state.messages.push(new AIMessage('My address is 456 Oak St and SSN is 9876'));
    state = await creditCardsGraph.invoke(state);

    // Now it should have all info and proceed to API -> Closing
    expect(state.currentNode).toBe('Closing_Node');
    expect(state.address).toBe('456 Oak St');
    expect(state.last4SSN).toBe('9876');
    expect(state.preApprovalStatus).toBe('approved');
  });
});
