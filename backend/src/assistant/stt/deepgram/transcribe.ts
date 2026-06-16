import { DeepgramClient } from "@deepgram/sdk";
import { Logger } from "@nestjs/common";
import { V1Socket } from "node_modules/@deepgram/sdk/dist/cjs/api/resources/listen/resources/v1/client/Socket";

export class DeepGram {

    connections = new Map<string, V1Socket>();
    logger = new Logger(DeepGram.name);

    async openConnection(sessionId: string, activeSession: any) {
        console.log('New Connection')
        const client = new DeepgramClient();
        const connection = await client.listen.v1.connect({
            model: "nova-3",
            language: "en",
            punctuate: "true",
            interim_results: "true",
            encoding: "linear16",
            sample_rate: 16000,
            Authorization: process.env.DEEPGRAM_API_KEY || '',
        });

        connection.on("open", () => console.log("Connection opened", sessionId));

        connection.on("message", (data) => {
            // console.log('This is user audio', data);
            if (data.type === "Results") {
                activeSession.callbacks.onTranscript(data.channel.alternatives[0].transcript);
                console.log(data.channel.alternatives[0].transcript);
            }
        });

        connection.connect();
        await connection.waitForOpen();
        this.connections.set(sessionId, connection);
    }

    async feedAudio(sessionId: string, audioData: Buffer<ArrayBuffer>, activeSession: any) {
        // console.log('This is Deepgram key:', process.env.DEEPGRAM_API_KEY);
        const activeConnection = this.connections.get(sessionId);

        if (!activeConnection) {
        } else {
            // this.logger.log('In Receiver', audioData);
            activeConnection.socket.send(audioData);
        }
    }

    async closeConnection(sessionId: string) {
        const activeConnection = this.connections.get(sessionId);
        if (activeConnection) {
            this.logger.log('Closing connection for: ' + sessionId);
            activeConnection.close();
            this.connections.delete(sessionId);
        }
    }
}
