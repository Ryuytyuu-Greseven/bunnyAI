import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const getHrPolicyTool = tool(
  async ({ policyName }) => {
    const allPolicies = `
    'HR Policy Info: Employees receive 25 days of annual leave. Submit applications through "Me" -> "Time and Absence".'
    'HR Policy Info: Payslips are published on the 28th of every month. View online under "Me" -> "Pay" -> "My Payslips".'
    'HR Policy Info: Medical benefits coverage begins on the first day of employment. Select options in Benefits Portal.'
    `;
    return allPolicies;
  },
  {
    name: 'getHrPolicy',
    description: 'Retrieve official company policies on holidays, payroll, payslips, leaves, benefits, and workplace guidelines.',
    schema: z.object({
      policyName: z.string().describe('The name or keyword of the policy to retrieve (e.g. leave, payroll, payslip, benefits)'),
    }),
  }
);

export const getUserLeaveBalanceTool = tool(
  async () => {
    return {
      annualLeave: 25,
      sickLeave: 14,
      unpaidLeave: 0,
    };
  },
  {
    name: 'getUserLeaveBalance',
    description: 'Retrieve user leave balance',
    schema: z.object({}),
  }
);