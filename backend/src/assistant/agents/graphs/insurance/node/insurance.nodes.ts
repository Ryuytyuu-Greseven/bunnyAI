import { AIMessage, SystemMessage } from '@langchain/core/messages';
import { InsuranceState } from '../state/insurance.state';
import { llmInstance } from '../../../llms/google.llm';
import * as Prompts from '../prompt/insurance.prompts';
import {
  listInsurancePolicies,
  getPoliciesBySumInsured,
  getPolicyDetails,
  formatPolicySummary,
  formatSumInsured,
  parseSumInsuredRange,
} from '../tool/insurance.tools';
import { z } from 'zod';
import { Logger } from '@nestjs/common';

const logger = new Logger('InsuranceNodes');

export async function Semantic_Router_Node(state: InsuranceState) {
  logger.log(`[Router] Analyzing input... Current Node: ${state.currentNode}`);

  const lastMsg = state.messages[state.messages.length - 1];
  if (!state.currentNode && lastMsg?.content === 'SYSTEM_START_CONVERSATION') {
    logger.log(`[Router] Initial connection. Auto-routing to Greeting_Consent_Node.`);
    return { routeDestination: 'Greeting_Consent_Node' };
  }

  const routerLlm = llmInstance.withStructuredOutput(
    z.object({
      routeDestination: z.enum([
        'Greeting_Consent_Node',
        'Policy_Listing_Node',
        'Plan_Presentation_Node',
        'Handoff_Consent_Node',
        'FAQ_RAG_Node',
        'Human_Handoff_Node',
        'Silence_Recovery_Node',
        'Graceful_Rejection_Node',
      ]),
    }),
    { name: 'route_user' },
  );

  const promptText = await Prompts.getPrompt('semantic_router');
  const messages = [
    new SystemMessage(
      promptText +
      `\n\nCurrent Funnel State: ${state.currentNode}` +
      `\nConsent: ${state.customerConsent}` +
      `\nPolicy Selected: ${state.selectedPolicyId ?? 'None'}` +
      `\nPlan Satisfied: ${state.planSatisfied}`,
    ),
    ...state.messages,
  ];

  const result = await routerLlm.invoke(messages);
  logger.log(`[Router] Routed to -> ${result.routeDestination}`);
  return { routeDestination: result.routeDestination };
}

export async function Greeting_Consent_Node(state: InsuranceState) {
  const extractorLlm = llmInstance.withStructuredOutput(
    z.object({
      customerConsent: z
        .boolean()
        .nullable()
        .describe('True if customer gave consent to proceed. False if declined. Null if unclear.'),
      customerName: z
        .string()
        .nullable()
        .describe("Customer's name if mentioned. Null otherwise."),
      responseToUser: z.string().describe('The spoken response to deliver to the customer.'),
    }),
    { name: 'extract_greeting_consent' },
  );

  const promptText = await Prompts.getPrompt('greeting_consent');
  const messages = [
    new SystemMessage(
      promptText +
      `\n\nConsent Status: ${state.customerConsent === null ? 'Not yet obtained' : state.customerConsent ? 'Obtained' : 'Declined'}` +
      `\nCustomer Name: ${state.customerName ?? 'Unknown'}`,
    ),
    ...state.messages,
  ];

  const result = await extractorLlm.invoke(messages);
  logger.log(`[Greeting] Consent extracted: ${result.customerConsent}`);

  const updates: Partial<InsuranceState> & { messages: any[] } = {
    messages: [new AIMessage(result.responseToUser)],
    currentNode: 'Greeting_Consent_Node',
  };

  if (result.customerConsent !== null) updates.customerConsent = result.customerConsent;
  if (result.customerName) updates.customerName = result.customerName;

  return updates;
}

export async function Policy_Listing_Node(state: InsuranceState) {
  // Resolve which policies to show based on any range the customer has given
  let policies = listInsurancePolicies();

  const rangeSource = state.sumInsuredRange ?? (state.expectedCoverAmount
    ? `${state.expectedCoverAmount / 100000} lakh`
    : null);

  if (rangeSource) {
    const parsed = parseSumInsuredRange(rangeSource);
    if (parsed) {
      const filtered = getPoliciesBySumInsured(parsed.min, parsed.max);
      if (filtered.length > 0) policies = filtered;
    }
  }

  const policySummaries = policies.map(formatPolicySummary).join('\n');

  const extractorLlm = llmInstance.withStructuredOutput(
    z.object({
      sumInsuredRange: z
        .string()
        .nullable()
        .describe("The sum insured range the customer mentioned (e.g. '5 to 10 lakh'). Null if not mentioned."),
      expectedCoverAmount: z
        .number()
        .nullable()
        .describe('A single expected cover amount in rupees if the customer gave one number. Null otherwise.'),
      selectedPolicyId: z
        .string()
        .nullable()
        .describe('The exact policy ID the customer selected from the list. Null if not yet selected.'),
      customerName: z.string().nullable().describe("Customer's name if mentioned."),
      customerAge: z.number().nullable().describe("Customer's age if mentioned."),
      customerEmail: z.string().nullable().describe("Customer's email if mentioned."),
      customerEmployer: z.string().nullable().describe('Where the customer works, if mentioned.'),
      healthProblems: z
        .string()
        .nullable()
        .describe('Any health conditions or problems the customer mentioned.'),
      previousHospitalization: z
        .string()
        .nullable()
        .describe('Any previous hospitalization history the customer mentioned.'),
      responseToUser: z.string().describe('The spoken response presenting policies and collecting information.'),
    }),
    { name: 'extract_policy_selection' },
  );

  const promptText = await Prompts.getPrompt('policy_listing');
  const messages = [
    new SystemMessage(
      promptText +
      `\n\nAvailable Plans:\n${policySummaries}` +
      `\nSum Insured Filter Applied: ${rangeSource ?? 'None — showing all plans'}` +
      `\n\nCustomer Profile Collected So Far:` +
      `\n- Name: ${state.customerName ?? 'Not collected'}` +
      `\n- Age: ${state.customerAge ?? 'Not collected'}` +
      `\n- Email: ${state.customerEmail ?? 'Not collected'}` +
      `\n- Employer: ${state.customerEmployer ?? 'Not collected'}` +
      `\n- Health Problems: ${state.healthProblems ?? 'Not collected'}` +
      `\n- Previous Hospitalization: ${state.previousHospitalization ?? 'Not collected'}`,
    ),
    ...state.messages,
  ];

  const result = await extractorLlm.invoke(messages);
  logger.log(`[PolicyListing] Selected policy: ${result.selectedPolicyId}`);

  const updates: any = {
    messages: [new AIMessage(result.responseToUser)],
    currentNode: 'Policy_Listing_Node',
    availablePolicies: policies,
  };

  if (result.sumInsuredRange) updates.sumInsuredRange = result.sumInsuredRange;
  if (result.expectedCoverAmount) updates.expectedCoverAmount = result.expectedCoverAmount;
  if (result.selectedPolicyId) updates.selectedPolicyId = result.selectedPolicyId;
  if (result.customerName) updates.customerName = result.customerName;
  if (result.customerAge) updates.customerAge = result.customerAge;
  if (result.customerEmail) updates.customerEmail = result.customerEmail;
  if (result.customerEmployer) updates.customerEmployer = result.customerEmployer;
  if (result.healthProblems) updates.healthProblems = result.healthProblems;
  if (result.previousHospitalization) updates.previousHospitalization = result.previousHospitalization;

  return updates;
}

export async function Plan_Presentation_Node(state: InsuranceState) {
  const policyDetails =
    state.selectedPolicyDetails ?? getPolicyDetails(state.selectedPolicyId ?? '');

  const detailsContext = policyDetails
    ? `Plan Name: ${policyDetails.name}` +
      `\nSum Insured: ${formatSumInsured(policyDetails.sumInsured)}` +
      `\nMonthly Premium: ${policyDetails.monthlyPremium} rupees per month` +
      `\nAnnual Premium: ${policyDetails.annualPremium} rupees per year` +
      `\nKey Coverage: ${policyDetails.coverageHighlights.join(', ')}` +
      `\nDeductible: ${policyDetails.deductible === 0 ? 'Zero deductible' : policyDetails.deductible + ' rupees'}` +
      `\nWaiting Period: ${policyDetails.waitingPeriod}` +
      `\nAge Eligibility: ${policyDetails.ageLimit}` +
      `\nFamily Cover: ${policyDetails.familyCover ? 'Yes' : 'Individual plan'}`
    : 'Policy details not available';

  const extractorLlm = llmInstance.withStructuredOutput(
    z.object({
      customerName: z.string().nullable().describe("Customer's name if mentioned."),
      customerAge: z.number().nullable().describe("Customer's age if mentioned."),
      customerEmail: z.string().nullable().describe("Customer's email if mentioned."),
      customerEmployer: z.string().nullable().describe('Where the customer works, if mentioned.'),
      healthProblems: z.string().nullable().describe('Any health conditions mentioned.'),
      previousHospitalization: z.string().nullable().describe('Any hospitalization history mentioned.'),
      wantsDetailsAgain: z
        .boolean()
        .nullable()
        .describe('True if the customer asked to hear the plan details again.'),
      planSatisfied: z
        .boolean()
        .nullable()
        .describe('True if customer confirmed they are happy with the plan and ready to proceed.'),
      responseToUser: z.string().describe('The spoken response presenting or re-presenting the plan.'),
    }),
    { name: 'extract_plan_presentation' },
  );

  const promptText = await Prompts.getPrompt('plan_presentation');
  const messages = [
    new SystemMessage(
      promptText +
      `\n\nSelected Plan Details:\n${detailsContext}` +
      `\n\nCustomer Profile Collected So Far:` +
      `\n- Name: ${state.customerName ?? 'Not collected'}` +
      `\n- Age: ${state.customerAge ?? 'Not collected'}` +
      `\n- Email: ${state.customerEmail ?? 'Not collected'}` +
      `\n- Employer: ${state.customerEmployer ?? 'Not collected'}` +
      `\n- Health Problems: ${state.healthProblems ?? 'Not collected'}` +
      `\n- Previous Hospitalization: ${state.previousHospitalization ?? 'Not collected'}`,
    ),
    ...state.messages,
  ];

  const result = await extractorLlm.invoke(messages);
  logger.log(`[PlanPresentation] Satisfied: ${result.planSatisfied}, WantsRepeat: ${result.wantsDetailsAgain}`);

  const updates: any = {
    messages: [new AIMessage(result.responseToUser)],
    currentNode: 'Plan_Presentation_Node',
    selectedPolicyDetails: policyDetails,
  };

  if (result.customerName) updates.customerName = result.customerName;
  if (result.customerAge) updates.customerAge = result.customerAge;
  if (result.customerEmail) updates.customerEmail = result.customerEmail;
  if (result.customerEmployer) updates.customerEmployer = result.customerEmployer;
  if (result.healthProblems) updates.healthProblems = result.healthProblems;
  if (result.previousHospitalization) updates.previousHospitalization = result.previousHospitalization;
  if (result.planSatisfied !== null) updates.planSatisfied = result.planSatisfied;

  return updates;
}

export async function Handoff_Consent_Node(state: InsuranceState) {
  const extractorLlm = llmInstance.withStructuredOutput(
    z.object({
      handoffConsent: z
        .boolean()
        .nullable()
        .describe('True if customer agreed to be transferred to a live agent. False if declined. Null if unclear.'),
      responseToUser: z.string().describe('The spoken response asking for or acknowledging handoff consent.'),
    }),
    { name: 'extract_handoff_consent' },
  );

  const planName = state.selectedPolicyDetails?.name ?? state.selectedPolicyId ?? 'the selected plan';
  const sumInsured = state.selectedPolicyDetails
    ? formatSumInsured(state.selectedPolicyDetails.sumInsured)
    : 'the agreed cover';

  const promptText = await Prompts.getPrompt('handoff_consent');
  const messages = [
    new SystemMessage(
      promptText +
      `\n\nSelected Plan: ${planName}` +
      `\nSum Insured: ${sumInsured}` +
      `\nCustomer Name: ${state.customerName ?? 'the customer'}`,
    ),
    ...state.messages,
  ];

  const result = await extractorLlm.invoke(messages);
  logger.log(`[HandoffConsent] Consent: ${result.handoffConsent}`);

  return {
    messages: [new AIMessage(result.responseToUser)],
    currentNode: 'Handoff_Consent_Node',
    handoffConsent: result.handoffConsent,
  };
}

export async function FAQ_RAG_Node(state: InsuranceState) {
  const promptText = await Prompts.getPrompt('faq_rag');
  const messages = [
    new SystemMessage(promptText),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response] };
}

export async function Human_Handoff_Node(state: InsuranceState) {
  const promptText = await Prompts.getPrompt('human_handoff');
  const messages = [
    new SystemMessage(promptText + `\n\nCustomer Name: ${state.customerName ?? 'the customer'}`),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response] };
}

export async function Silence_Recovery_Node(state: InsuranceState) {
  const promptText = await Prompts.getPrompt('silence');
  return { messages: [new AIMessage(promptText)] };
}

export async function Graceful_Rejection_Node(state: InsuranceState) {
  const promptText = await Prompts.getPrompt('graceful_rejection');
  const messages = [
    new SystemMessage(promptText + `\n\nCustomer Name: ${state.customerName ?? 'the customer'}`),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response] };
}
