import { AIMessage } from '@langchain/core/messages';
import { salesGraph } from './sales.graph';
import { SalesState } from '../state/sales.state';

jest.mock('../../../llms/google.llm', () => ({
  llmInstance: {
    invoke: jest.fn(),
    withStructuredOutput: jest.fn(),
  },
}));

jest.mock('../prompt/sales.prompts', () => ({
  getPrompt: jest.fn().mockResolvedValue('Mocked prompt'),
}));

jest.mock('../tool/sales.tools', () => ({
  listPropertiesByBudget: jest.fn().mockReturnValue([
    {
      id: 'prop_001',
      name: 'Sunrise Valley Residences',
      location: 'Whitefield, Bangalore',
      price: 8_500_000,
      type: '3BHK Apartment',
      bedrooms: 3,
      bathrooms: 2,
      sqft: 1850,
      highlights: ['Pool', 'Clubhouse'],
      shortPitch: 'A 3BHK at 85 lakhs in Whitefield.',
      fullDescription: 'A premium gated community apartment.',
    },
    {
      id: 'prop_002',
      name: 'Green Crest Villas',
      location: 'Sarjapur, Bangalore',
      price: 12_500_000,
      type: '4BHK Villa',
      bedrooms: 4,
      bathrooms: 4,
      sqft: 2800,
      highlights: ['Private garden', 'EV charging'],
      shortPitch: 'A 4BHK villa at 1.25 crore in Sarjapur.',
      fullDescription: 'An independent villa with a private garden.',
    },
  ]),
  formatPrice: jest.fn((price: number) => `${price} INR`),
}));

import { llmInstance } from '../../../llms/google.llm';

describe('Sales Agent E2E Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const getInitialState = (): Partial<SalesState> => ({
    messages: [],
    customerName: null,
    budgetMin: null,
    budgetMax: null,
    properties: [],
    currentPropertyIndex: 0,
    purchaseIntentPropertyId: null,
    currentNode: '',
    routeDestination: '',
  });

  it('should greet customer on initial connection', async () => {
    const mockRouter = {
      invoke: jest.fn().mockResolvedValueOnce({ routeDestination: 'Greeting_Pitch_Node' }),
    };

    (llmInstance.withStructuredOutput as jest.Mock).mockImplementation((_, options) => {
      if (options.name === 'route_sales_user') return mockRouter;
    });
    (llmInstance.invoke as jest.Mock).mockResolvedValue(new AIMessage('Hello! I am calling from XYZ Properties.'));

    const state = await salesGraph.invoke(getInitialState(), { configurable: { thread_id: 'test_1' } });

    expect(state.currentNode).toBe('Greeting_Pitch_Node');
  });

  it('should complete Happy Path: Greeting → Budget Discovery → Property Listing → Detail → Handoff', async () => {
    const mockRouter = { invoke: jest.fn() };
    const mockBudget = { invoke: jest.fn() };
    const mockDetail = { invoke: jest.fn() };

    (llmInstance.withStructuredOutput as jest.Mock).mockImplementation((_, options) => {
      if (options.name === 'route_sales_user') return mockRouter;
      if (options.name === 'extract_budget') return mockBudget;
      if (options.name === 'extract_property_detail') return mockDetail;
    });
    (llmInstance.invoke as jest.Mock).mockResolvedValue(new AIMessage('Conversational response'));

    // Turn 1: Start → Greeting
    mockRouter.invoke.mockResolvedValueOnce({ routeDestination: 'Greeting_Pitch_Node' });
    let state = await salesGraph.invoke(getInitialState(), { configurable: { thread_id: 'test_2' } });
    expect(state.currentNode).toBe('Greeting_Pitch_Node');

    // Turn 2: Customer says yes → Budget Discovery → (budget captured) → Property Listing
    mockRouter.invoke.mockResolvedValueOnce({ routeDestination: 'Budget_Discovery_Node' });
    mockBudget.invoke.mockResolvedValueOnce({
      budgetMin: 5_000_000,
      budgetMax: 10_000_000,
      customerName: 'Ravi',
      responseToUser: 'Great, let me pull up properties in that range.',
    });
    state.messages.push(new AIMessage('Yes, I am looking for something around 50 to 1 crore.'));
    state = await salesGraph.invoke(state, { configurable: { thread_id: 'test_2' } });

    // Budget discovered → chains into Property_Listing_Node in same turn
    expect(state.currentNode).toBe('Property_Listing_Node');
    expect(state.budgetMin).toBe(5_000_000);
    expect(state.budgetMax).toBe(10_000_000);
    expect(state.customerName).toBe('Ravi');
    expect(state.properties.length).toBeGreaterThan(0);

    // Turn 3: Customer asks for details → Property Detail → (purchase intent) → Human Handoff
    mockRouter.invoke.mockResolvedValueOnce({ routeDestination: 'Property_Detail_Node' });
    mockDetail.invoke.mockResolvedValueOnce({
      requestedIndex: 0,
      purchaseIntent: true,
      responseToUser: 'Sunrise Valley is a fantastic choice. Let me connect you.',
    });
    state.messages.push(new AIMessage('Tell me about the first one. I want to book a visit.'));
    state = await salesGraph.invoke(state, { configurable: { thread_id: 'test_2' } });

    // Purchase intent → chains into Human_Handoff_Node in same turn
    expect(state.currentNode).toBe('Human_Handoff_Node');
    expect(state.purchaseIntentPropertyId).toBe('prop_001');
  });

  it('should stay in Budget_Discovery loop until budget is provided', async () => {
    const mockRouter = { invoke: jest.fn().mockResolvedValue({ routeDestination: 'Budget_Discovery_Node' }) };
    const mockBudget = {
      invoke: jest.fn()
        .mockResolvedValueOnce({
          budgetMin: null,
          budgetMax: null,
          customerName: null,
          responseToUser: 'What is your budget range?',
        })
        .mockResolvedValueOnce({
          budgetMin: 3_000_000,
          budgetMax: 7_000_000,
          customerName: 'Priya',
          responseToUser: 'Perfect, pulling up properties now.',
        }),
    };

    (llmInstance.withStructuredOutput as jest.Mock).mockImplementation((_, options) => {
      if (options.name === 'route_sales_user') return mockRouter;
      if (options.name === 'extract_budget') return mockBudget;
    });
    (llmInstance.invoke as jest.Mock).mockResolvedValue(new AIMessage('Here are the properties.'));

    // Turn 1: Budget node, no budget extracted → __end__
    let state = await salesGraph.invoke(getInitialState(), { configurable: { thread_id: 'test_3' } });
    expect(state.currentNode).toBe('Budget_Discovery_Node');
    expect(state.budgetMin).toBeNull();

    // Turn 2: Budget provided → chains into Property_Listing_Node
    state.messages.push(new AIMessage('Around 30 to 70 lakhs.'));
    state = await salesGraph.invoke(state, { configurable: { thread_id: 'test_3' } });
    expect(state.budgetMin).toBe(3_000_000);
    expect(state.budgetMax).toBe(7_000_000);
    expect(state.customerName).toBe('Priya');
    expect(state.currentNode).toBe('Property_Listing_Node');
  });

  it('should route to Graceful Rejection when customer is not interested', async () => {
    const mockRouter = {
      invoke: jest.fn().mockResolvedValueOnce({ routeDestination: 'Graceful_Rejection_Node' }),
    };

    (llmInstance.withStructuredOutput as jest.Mock).mockImplementation((_, options) => {
      if (options.name === 'route_sales_user') return mockRouter;
    });
    (llmInstance.invoke as jest.Mock).mockResolvedValue(new AIMessage('Thank you for your time. Goodbye!'));

    const initial = { ...getInitialState(), currentNode: 'Greeting_Pitch_Node' };
    const state = await salesGraph.invoke(initial, { configurable: { thread_id: 'test_4' } });

    expect(state.currentNode).toBe('Graceful_Rejection_Node');
  });

  it('should allow property switching via Property_Detail_Node', async () => {
    const mockRouter = { invoke: jest.fn().mockResolvedValue({ routeDestination: 'Property_Detail_Node' }) };
    const mockDetail = {
      invoke: jest.fn()
        .mockResolvedValueOnce({
          requestedIndex: 1, // switched to property 2
          purchaseIntent: false,
          responseToUser: 'Sure, let me tell you about Green Crest Villas.',
        }),
    };

    (llmInstance.withStructuredOutput as jest.Mock).mockImplementation((_, options) => {
      if (options.name === 'route_sales_user') return mockRouter;
      if (options.name === 'extract_property_detail') return mockDetail;
    });
    (llmInstance.invoke as jest.Mock).mockResolvedValue(new AIMessage('General response'));

    const initial: Partial<SalesState> = {
      ...getInitialState(),
      currentNode: 'Property_Listing_Node',
      budgetMin: 5_000_000,
      budgetMax: 15_000_000,
      properties: [
        {
          id: 'prop_001', name: 'Sunrise Valley Residences', location: 'Whitefield',
          price: 8_500_000, type: '3BHK', bedrooms: 3, bathrooms: 2, sqft: 1850,
          highlights: [], shortPitch: '', fullDescription: '',
        },
        {
          id: 'prop_002', name: 'Green Crest Villas', location: 'Sarjapur',
          price: 12_500_000, type: '4BHK', bedrooms: 4, bathrooms: 4, sqft: 2800,
          highlights: [], shortPitch: '', fullDescription: '',
        },
      ],
      currentPropertyIndex: 0,
    };

    initial.messages = [new AIMessage('What about the second property?')];
    const state = await salesGraph.invoke(initial, { configurable: { thread_id: 'test_5' } });

    expect(state.currentNode).toBe('Property_Detail_Node');
    expect(state.currentPropertyIndex).toBe(1);
    expect(state.purchaseIntentPropertyId).toBeNull();
  });
});
