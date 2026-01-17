import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Allow Vite dev server
        methods: ["GET", "POST"]
    }
});

// SambaNova Client
const client = new OpenAI({
    apiKey: "6dd9f418-4f79-46c4-8bb8-70bb43f903d0",
    baseURL: "https://api.sambanova.ai/v1",
});

const PROJECT_ROOT = path.resolve(__dirname, '..');

let activeProcess = null;

io.on('connection', (socket) => {
    console.log('Client connected');

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

app.post('/api/run-phase', (req, res) => {
    const { command, args } = req.body;

    if (activeProcess) {
        // Optional: kill existing? Or reject?
        // For now, let's allow running parallel or just notify
        // activeProcess.kill(); 
    }

    console.log(`Running: ${command} ${args.join(' ')}`);
    io.emit('log', `\n> Executing: ${command} ${args.join(' ')}\n`);

    // Use shell: true for npm commands on Windows
    const proc = spawn(command, args, {
        cwd: PROJECT_ROOT,
        shell: true,
        env: { ...process.env, FORCE_COLOR: 'true' }
    });

    activeProcess = proc;

    proc.stdout.on('data', (data) => {
        io.emit('log', data.toString());
    });

    proc.stderr.on('data', (data) => {
        io.emit('log', data.toString());
    });

    proc.on('close', (code) => {
        io.emit('log', `\n> Process exited with code ${code}\n`);
        io.emit('phase-complete', { command, code });
        activeProcess = null;
    });

    res.json({ status: 'started' });
});

app.post('/api/troubleshoot', async (req, res) => {
    const { logs } = req.body;

    try {
        const response = await client.chat.completions.create({
            model: "Meta-Llama-3.1-70B-Instruct", // Typical SambaNova model
            messages: [
                { role: "system", content: "You are a helpful expert software engineer. Analyze the following error logs from a build/deployment process and provide a specific, actionable solution. Be concise." },
                { role: "user", content: logs.slice(-2000) } // Send last 2000 chars to avoid token limits
            ],
            temperature: 0.1,
            top_p: 0.1
        });

        res.json({ analysis: response.choices[0].message.content });
    } catch (error) {
        console.error("AI Error:", error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = 3001;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
