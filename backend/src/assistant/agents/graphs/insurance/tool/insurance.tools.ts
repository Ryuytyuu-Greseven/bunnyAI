export interface InsurancePolicy {
  id: string;
  name: string;
  sumInsured: number;
  monthlyPremium: number;
  annualPremium: number;
  coverageHighlights: string[];
  deductible: number;
  waitingPeriod: string;
  ageLimit: string;
  familyCover: boolean;
}

const MOCK_POLICIES: InsurancePolicy[] = [
  {
    id: 'hs-basic',
    name: 'HealthShield Basic',
    sumInsured: 300000,
    monthlyPremium: 499,
    annualPremium: 5499,
    coverageHighlights: [
      'In-patient hospitalization',
      'Day-care procedures',
      'Pre-hospitalization 30 days',
      'Post-hospitalization 60 days',
    ],
    deductible: 5000,
    waitingPeriod: '30 days general, 2 years pre-existing conditions',
    ageLimit: '18 to 65 years',
    familyCover: false,
  },
  {
    id: 'hs-plus',
    name: 'HealthShield Plus',
    sumInsured: 500000,
    monthlyPremium: 799,
    annualPremium: 8799,
    coverageHighlights: [
      'In-patient hospitalization',
      'Day-care procedures',
      'Pre-hospitalization 60 days',
      'Post-hospitalization 90 days',
      'Ambulance cover up to ₹2,000',
      'AYUSH treatment',
    ],
    deductible: 3000,
    waitingPeriod: '30 days general, 1 year pre-existing conditions',
    ageLimit: '18 to 65 years',
    familyCover: false,
  },
  {
    id: 'hs-premium',
    name: 'HealthShield Premium',
    sumInsured: 1000000,
    monthlyPremium: 1299,
    annualPremium: 14299,
    coverageHighlights: [
      'In-patient hospitalization with ICU coverage',
      'Day-care procedures',
      'Pre-hospitalization 90 days',
      'Post-hospitalization 180 days',
      'Ambulance cover up to ₹5,000',
      'AYUSH and mental health treatment',
      'Domiciliary hospitalization',
    ],
    deductible: 0,
    waitingPeriod: '30 days general, 1 year pre-existing conditions',
    ageLimit: '18 to 70 years',
    familyCover: false,
  },
  {
    id: 'hs-family',
    name: 'HealthShield Family Floater',
    sumInsured: 1500000,
    monthlyPremium: 1799,
    annualPremium: 19799,
    coverageHighlights: [
      'Covers 2 adults and up to 3 children under one plan',
      'Maternity benefit after 2 years',
      'Newborn baby cover from day one',
      'ICU and hospitalization',
      'Ambulance cover',
      'AYUSH treatment',
    ],
    deductible: 0,
    waitingPeriod: '30 days general, 2 years maternity, 1 year pre-existing',
    ageLimit: 'Primary insured 18 to 65, children up to 25 years',
    familyCover: true,
  },
  {
    id: 'hs-elite',
    name: 'HealthShield Elite',
    sumInsured: 2500000,
    monthlyPremium: 2499,
    annualPremium: 27499,
    coverageHighlights: [
      'Unlimited sum insured restoration',
      'International emergency hospitalization',
      'OPD and diagnostic coverage',
      'Mental health and chronic disease management',
      'Annual preventive health check-up',
      'Zero deductible and zero co-payment',
      'No room rent sub-limits',
    ],
    deductible: 0,
    waitingPeriod: 'No waiting period for accidents. 30 days general, 1 year pre-existing.',
    ageLimit: '18 to 75 years',
    familyCover: true,
  },
];

export function listInsurancePolicies(): InsurancePolicy[] {
  return MOCK_POLICIES;
}

export function getPoliciesBySumInsured(minAmount: number, maxAmount: number): InsurancePolicy[] {
  return MOCK_POLICIES.filter(
    (p) => p.sumInsured >= minAmount && p.sumInsured <= maxAmount,
  );
}

export function getPolicyDetails(policyId: string): InsurancePolicy | null {
  return MOCK_POLICIES.find((p) => p.id === policyId) ?? null;
}

export function formatSumInsured(amount: number): string {
  if (amount >= 10000000) return `${amount / 10000000} crore rupees`;
  if (amount >= 100000) return `${amount / 100000} lakh rupees`;
  return `${amount / 1000} thousand rupees`;
}

export function formatPolicySummary(policy: InsurancePolicy): string {
  return (
    `${policy.name} (ID: ${policy.id}): ${formatSumInsured(policy.sumInsured)} cover ` +
    `at ${policy.monthlyPremium} rupees per month. ` +
    `Key benefits: ${policy.coverageHighlights.slice(0, 3).join(', ')}.`
  );
}

/**
 * Parses a natural-language sum insured range string into min/max rupee values.
 * Handles formats like "5 to 10 lakh", "5L-10L", "500000 to 1000000".
 * Returns null if the string cannot be parsed.
 */
export function parseSumInsuredRange(range: string): { min: number; max: number } | null {
  const lakhPattern = /(\d+(?:\.\d+)?)\s*(?:to|-)\s*(\d+(?:\.\d+)?)\s*lakh/i;
  const lakhMatch = range.match(lakhPattern);
  if (lakhMatch) {
    return {
      min: parseFloat(lakhMatch[1]) * 100000,
      max: parseFloat(lakhMatch[2]) * 100000,
    };
  }

  const crorePattern = /(\d+(?:\.\d+)?)\s*(?:to|-)\s*(\d+(?:\.\d+)?)\s*crore/i;
  const croreMatch = range.match(crorePattern);
  if (croreMatch) {
    return {
      min: parseFloat(croreMatch[1]) * 10000000,
      max: parseFloat(croreMatch[2]) * 10000000,
    };
  }

  const numericPattern = /(\d{5,})\s*(?:to|-)\s*(\d{5,})/;
  const numericMatch = range.match(numericPattern);
  if (numericMatch) {
    return {
      min: parseInt(numericMatch[1]),
      max: parseInt(numericMatch[2]),
    };
  }

  return null;
}
