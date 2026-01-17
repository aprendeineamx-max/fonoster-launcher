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
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const client = new OpenAI({
    apiKey: "6dd9f418-4f79-46c4-8bb8-70bb43f903d0",
    baseURL: "https://api.sambanova.ai/v1",
});

const PROJECT_ROOT = path.resolve(__dirname, '..');

let activeProcess = null;

io.on('connection', (socket) => {
    console.log('Client connected');
    socket.on('disconnect', () => { console.log('Client disconnected'); });
});

app.post('/api/check-system', (req, res) => {
    const tools = [
        { name: 'Node.js', command: 'node --version' },
        { name: 'NPM', command: 'npm --version' },
        { name: 'Docker', command: 'docker --version' }
    ];

    let results = [];
    let hasError = false;

    // Use a simple promise chain or logic to check all
    // We can't use spawn for simple checks easily without callbacks, 
    // let's use exec for these simple checks.
    import('child_process').then(({ exec }) => {
        const checkTool = (tool) => {
            return new Promise(resolve => {
                exec(tool.command, (error, stdout, stderr) => {
                    const status = error ? 'missing' : 'installed';
                    const version = stdout.trim() || stderr.trim();
                    resolve({ name: tool.name, status, version });
                });
            });
        };

        Promise.all(tools.map(checkTool)).then(checks => {
            res.json({ checks });
        });
    });
});

app.post('/api/install-tool', (req, res) => {
    const { tool } = req.body;
    let command = '';

    switch (tool) {
        case 'Docker':
            command = 'winget install Docker.DockerDesktop --accept-package-agreements --accept-source-agreements';
            break;
        case 'Node.js':
            command = 'winget install OpenJS.NodeJS --accept-package-agreements --accept-source-agreements';
            break;
        case 'NPM':
            // NPM comes with Node usually, but maybe update?
            command = 'npm install -g npm';
            break;
        default:
            return res.status(400).json({ error: 'Unknown tool' });
    }

    console.log(`Installing: ${tool} via ${command}`);
    io.emit('log', `\n> Auto-Installing ${tool}...\n> Command: ${command}\n> PLEASE ACCEPT UAC PROMPT IF ASKED.\n`);

    // We use spawn to stream properly
    const proc = spawn(command, [], {
        cwd: PROJECT_ROOT,
        shell: true,
        env: { ...process.env, FORCE_COLOR: 'true' }
    });

    activeProcess = proc;

    proc.stdout.on('data', (data) => { io.emit('log', data.toString()); });
    proc.stderr.on('data', (data) => { io.emit('log', data.toString()); });

    proc.on('close', (code) => {
        io.emit('log', `\n> Installation of ${tool} finished with code ${code}\n`);
        io.emit('phase-complete', { command: `install-${tool}`, code });
        activeProcess = null;
    });

    res.json({ status: 'installing' });
});

app.post('/api/run-phase', (req, res) => {
    const { command, args } = req.body;
    if (activeProcess) {
        // Optional: kill existing
    }

    console.log(`Running: ${command} ${args.join(' ')}`);
    io.emit('log', `\n> Executing: ${command} ${args.join(' ')}\n`);

    const proc = spawn(command, args, {
        cwd: PROJECT_ROOT,
        shell: true,
        env: { ...process.env, FORCE_COLOR: 'true' }
    });

    activeProcess = proc;

    proc.stdout.on('data', (data) => { io.emit('log', data.toString()); });
    proc.stderr.on('data', (data) => { io.emit('log', data.toString()); });

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
            model: "Meta-Llama-3.1-8B-Instruct",
            messages: [
                { role: "system", content: "You are an expert software engineer helper for a Windows-based launcher. Analyze the logs. Provide the solution in clean Markdown. Use valid Windows (PowerShell/CMD) commands in code blocks. Do not use Linux commands (no sudo/apt). Be concise and direct." },
                { role: "user", content: logs.slice(-2000) }
            ],
            temperature: 0.1,
            top_p: 0.1
        });
        res.json({ analysis: response.choices[0].message.content });
    } catch (error) {
        console.error("AI Error:", error);
        const errorMessage = error.response?.data || error.message;
        res.status(500).json({ error: errorMessage });
    }
});

const PORT = 3001;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
