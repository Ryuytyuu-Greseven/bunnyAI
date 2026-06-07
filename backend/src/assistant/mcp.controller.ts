import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getHrPolicyTool, getUserLeaveBalanceTool } from './agents/tools/hr-tool.js';

@Controller('mcp')
export class McpController {
  private server: Server;
  private transport: SSEServerTransport | null = null;

  constructor() {
    this.server = new Server(
      {
        name: 'lyre-ai-hr-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    // Register the List Tools handler to declare available tools to the MCP client
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'getHrPolicy',
            description: 'Retrieve official company policies on holidays, payroll, payslips, leaves, benefits, and workplace guidelines.',
            inputSchema: {
              type: 'object',
              properties: {
                policyName: {
                  type: 'string',
                  description: 'The name or keyword of the policy to retrieve (e.g. leave, payroll, payslip, benefits)',
                },
              },
              required: ['policyName'],
            },
          },
          {
            name: 'getUserLeaveBalance',
            description: 'Retrieve the current user leave balances (annual leave, sick leave, unpaid leave).',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      };
    });

    // Register the Call Tool handler to execute tools requested by the MCP client
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      console.log(`[MCP NestJS Controller] Executing tool call: ${name} with args:`, args);

      try {
        if (name === 'getHrPolicy') {
          const policyName = String(args?.policyName || '');
          const result = await getHrPolicyTool.invoke({ policyName });
          return {
            content: [
              {
                type: 'text',
                text: String(result),
              },
            ],
          };
        } else if (name === 'getUserLeaveBalance') {
          const result = await getUserLeaveBalanceTool.invoke({});
          const resultStr = typeof result === 'object' ? JSON.stringify(result) : String(result);
          return {
            content: [
              {
                type: 'text',
                text: resultStr,
              },
            ],
          };
        }
        throw new Error(`Tool not found: ${name}`);
      } catch (error: any) {
        console.error(`[MCP NestJS Controller] Error executing tool ${name}:`, error);
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error executing tool: ${error.message || error}`,
            },
          ],
        };
      }
    });
  }

  @Get('sse')
  async establishSse(@Req() req: Request, @Res() res: Response) {
    console.log('[MCP NestJS Controller] Client connecting via SSE...');
    
    // Set up the SSE Server Transport using the response object and redirect post messages to /mcp/messages
    this.transport = new SSEServerTransport('/mcp/messages', res);
    
    await this.server.connect(this.transport);
  }

  @Post('messages')
  async handleMessages(@Req() req: Request, @Res() res: Response) {
    console.log('[MCP NestJS Controller] handleMessages POST body:', req.body);
    if (this.transport) {
      await this.transport.handlePostMessage(req, res, req.body);
    } else {
      res.status(400).send('Transport not initialized');
    }
  }
}
