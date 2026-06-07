import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import z from "zod";

const app = express();
app.use(express.json());

const server = new McpServer(
    {
        name: "weather-server",
        version: "0.1.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

server.registerTool(
    "get_weather",
    {
        description: "Get weather for location",
        inputSchema: {
            location: z.string().describe("Location to get weather for"),
        },
    },
    async ({ location }) => {
        return {
            content: [
                {
                    type: "text",
                    text: `It's always sunny in ${location}`,
                },
            ],
        };
    }
);


// Store transports by session ID to avoid collisions and track active SSE streams
const transports: Record<string, SSEServerTransport> = {};

// This route MUST match the URL in your LangChain client exactly
app.get('/mcp', async (req, res) => {
    try {
        const transport = new SSEServerTransport('/messages', res);
        const sessionId = transport.sessionId;
        transports[sessionId] = transport;

        transport.onclose = () => {
            console.log(`SSE transport closed for session ${sessionId}`);
            delete transports[sessionId];
        };

        await server.connect(transport);
        console.log(`Established SSE stream with session ID: ${sessionId}`);
    } catch (error) {
        console.error('Error establishing SSE stream:', error);
        if (!res.headersSent) {
            res.status(500).send('Error establishing SSE stream');
        }
    }
});

app.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
        res.status(400).send('Missing sessionId parameter');
        return;
    }
    const transport = transports[sessionId];
    if (!transport) {
        res.status(404).send('Session not found');
        return;
    }
    try {
        await transport.handlePostMessage(req, res, req.body);
    } catch (error) {
        console.error('Error handling request:', error);
        if (!res.headersSent) {
            res.status(500).send('Error handling request');
        }
    }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`Weather MCP server running on port ${PORT}`);
});