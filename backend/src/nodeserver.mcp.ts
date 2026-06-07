import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import z from "zod";

const app = express();
app.use(express.json());


const client = new MultiServerMCPClient({

    throwOnLoadError: true,
    // Whether to prefix tool names with the server name (optional, default: false)
    prefixToolNameWithServerName: false,
    // Optional additional prefix for tool names (optional, default: "")
    additionalToolNamePrefix: "",

    // Use standardized content block format in tool outputs
    useStandardContentBlocks: true,

    // Behavior when a server fails to connect: "throw" (default) or "ignore"
    onConnectionError: "throw",


    mcpServers: {
        // "filesystem": {
        //     command: "npx",
        //     args: [
        //         "-y",
        //         "@modelcontextprotocol/server-filesystem",
        //     ]
        // },
        "weather-server": {
            transport: 'sse',
            url: "http://localhost:8000/mcp",
            automaticSSEFallback: false,
        },
    },
    defaultToolTimeout: 10000, // 10 seconds
});


app.use('/test', async (_, response) => {
    try {
        const tools = await client.getTools();
        const slowTool = tools.find((t) => t.name.includes("weather"));
        console.log('tools', tools, slowTool);

        return response.json({ tools, slowTool });
    } catch (err) {
        console.error("Error in /test:", err);
        return response.status(500).json({ error: String(err) });
    }
})
const PORT = process.env.PORT || 8001;
app.listen(PORT, () => {
    console.log(`MCP server tools on port ${PORT}`);
});