import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";


const app = express();
app.use(express.json());

const server = new Server(
    {
        name: "math-server",
        version: "0.1.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "add",
                description: "Add two numbers",
                inputSchema: {
                    type: "object",
                    properties: {
                        a: {
                            type: "number",
                            description: "First number",
                        },
                        b: {
                            type: "number",
                            description: "Second number",
                        },
                    },
                    required: ["a", "b"],
                },
            },
            {
                name: "multiply",
                description: "Multiply two numbers",
                inputSchema: {
                    type: "object",
                    properties: {
                        a: {
                            type: "number",
                            description: "First number",
                        },
                        b: {
                            type: "number",
                            description: "Second number",
                        },
                    },
                    required: ["a", "b"],
                },
            },
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {
        case "add": {
            const { a, b } = request.params.arguments as { a: number; b: number };
            return {
                content: [
                    {
                        type: "text",
                        text: String(a + b),
                    },
                ],
            };
        }
        case "multiply": {
            const { a, b } = request.params.arguments as { a: number; b: number };
            return {
                content: [
                    {
                        type: "text",
                        text: String(a * b),
                    },
                ],
            };
        }
        default:
            throw new Error(`Unknown tool: ${request.params.name}`);
    }
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Math MCP server running on stdio");
}

main();

app.post("/mcp", async (req, res) => {
    const transport = new SSEServerTransport("/mcp", res);
    await server.connect(transport);
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`Math MCP server running on port ${PORT}`);
});
