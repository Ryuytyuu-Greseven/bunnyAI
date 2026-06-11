export interface CustomerDueRecord {
  customerId: string;
  customerName: string;
  dueType: 'Home Loan' | 'Credit Card' | 'Personal Loan' | 'Recurring Deposit';
  dueAmount: number;
  dueDate: string;
  accountLastFour: string;
}

const MOCK_CUSTOMER_DUES: Record<string, CustomerDueRecord> = {
  CUST001: {
    customerId: 'CUST001',
    customerName: 'Rajesh Kumar',
    dueType: 'Credit Card',
    dueAmount: 15420,
    dueDate: '15 June 2026',
    accountLastFour: '4821',
  },
  CUST002: {
    customerId: 'CUST002',
    customerName: 'Priya Sharma',
    dueType: 'Home Loan',
    dueAmount: 42500,
    dueDate: '10 June 2026',
    accountLastFour: '2234',
  },
  CUST003: {
    customerId: 'CUST003',
    customerName: 'Anand Verma',
    dueType: 'Personal Loan',
    dueAmount: 8750,
    dueDate: '20 June 2026',
    accountLastFour: '9901',
  },
  CUST004: {
    customerId: 'CUST004',
    customerName: 'Sunita Patel',
    dueType: 'Recurring Deposit',
    dueAmount: 5000,
    dueDate: '5 June 2026',
    accountLastFour: '3317',
  },
};

export function getCustomerDueDetails(customerId: string): CustomerDueRecord | null {
  return MOCK_CUSTOMER_DUES[customerId] ?? null;
}

export function formatDueAmount(amount: number): string {
  if (amount >= 100000) return `${(amount / 100000).toFixed(1)} lakh rupees`;
  if (amount >= 1000) return `${amount.toLocaleString('en-IN')} rupees`;
  return `${amount} rupees`;
}

export function buildDueContext(record: CustomerDueRecord): string {
  return (
    `Customer Name: ${record.customerName}` +
    `\nDue Type: ${record.dueType}` +
    `\nAmount Due: ${formatDueAmount(record.dueAmount)}` +
    `\nDue Date: ${record.dueDate}` +
    `\nAccount ending: ${record.accountLastFour}`
  );
}
