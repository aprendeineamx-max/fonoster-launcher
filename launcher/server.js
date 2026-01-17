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

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pty = require('node-pty');
const os = require('os');
const fs = require('fs'); // Re-import fs just in case to avoid mix

// Terminal State
let ptyProcess = null;


io.on('connection', (socket) => {
    console.log('Client connected');

    // --- Terminal PTY Logic ---
    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

    if (!ptyProcess) {
        ptyProcess = pty.spawn(shell, [], {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd: PROJECT_ROOT,
            env: process.env
        });

        ptyProcess.onData((data) => {
            io.emit('term-output', data);
        });
    }

    socket.on('term-input', (data) => {
        if (ptyProcess) ptyProcess.write(data);
    });

    socket.on('term-resize', ({ cols, rows }) => {
        if (ptyProcess) ptyProcess.resize(cols, rows);
    });
    // --------------------------

    socket.on('disconnect', () => {
        console.log('Client disconnected');
        // Optional: kill pty if no clients? Keep it alive for persistence for now.
    });
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

// --- File System API for Agent ---
// --- File System API for Agent ---
// const fs = require('fs'); // Already required above
// const path = require('path'); // Already imported as 'path' from 'path'


app.get('/api/fs/tree', (req, res) => {
    // Simple recursive tree or just top level? Let's do recursive limited depth or just request specific dirs.
    // For simplicity, let's just return the directory structure.
    const getDirTree = (dir) => {
        const stats = fs.statSync(dir);
        if (!stats.isDirectory()) return null;

        const items = fs.readdirSync(dir);
        return items.map(item => {
            if (item === 'node_modules' || item === '.git') return { name: item, type: 'directory', children: [] }; // Skip heavy dirs
            const fullPath = path.join(dir, item);
            try {
                const itemStats = fs.statSync(fullPath);
                return {
                    name: item,
                    type: itemStats.isDirectory() ? 'directory' : 'file',
                    path: fullPath,
                    // Recurse for directories? Maybe too heavy. Let's do lazy loading in frontend, 
                    // or just 2 levels? For now, flat list of current dir, frontend requests subdirs?
                    // Let's return just one level and let frontend request recursive.
                    // Actually, Monaco needs a file mapping. 
                    // Let's stick to: Client asks for path, we return listing.
                };
            } catch (e) { return null; }
        }).filter(Boolean);
    };

    // Query param ?path=...
    const reqPath = req.query.path || PROJECT_ROOT;
    try {
        const tree = getDirTree(reqPath);
        res.json({ path: reqPath, items: tree });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/fs/read', (req, res) => {
    const { filePath } = req.body;
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        res.json({ content });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/fs/write', (req, res) => {
    const { filePath, content } = req.body;
    try {
        // Security check: ensure inside project? skipping for "Full Access" request.
        fs.writeFileSync(filePath, content, 'utf8');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// --------------------------------

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

// --- Lifecycle & MCP API ---
app.post('/api/lifecycle/stop', (req, res) => {
    // Stop Docker Services
    const proc = spawn('npm', ['run', 'stop:services'], { cwd: PROJECT_ROOT, shell: true });
    io.emit('log', '\n> Stopping Services (Docker Compose Down)...\n');
    proc.stdout.on('data', d => io.emit('log', d.toString()));
    proc.stderr.on('data', d => io.emit('log', d.toString()));
    proc.on('close', code => {
        io.emit('log', `\n> Services stopped with code ${code}\n`);
        res.json({ success: code === 0 });
    });
});

app.post('/api/lifecycle/uninstall', (req, res) => {
    // Stop then Clean
    io.emit('log', '\n> INICIANDO DESINSTALACIÓN COMPLETA...\n');

    // Chain: Stop -> Clean
    const stop = spawn('npm', ['run', 'stop:services'], { cwd: PROJECT_ROOT, shell: true });
    stop.stdout.on('data', d => io.emit('log', d.toString()));
    stop.on('close', () => {
        io.emit('log', '\n> Services stopped. Cleaning files...\n');
        const clean = spawn('npm', ['run', 'clean'], { cwd: PROJECT_ROOT, shell: true });
        clean.stdout.on('data', d => io.emit('log', d.toString()));
        clean.stderr.on('data', d => io.emit('log', d.toString()));
        clean.on('close', code => {
            io.emit('log', `\n> CLEAN COMPLETE with code ${code}. System reset.\n`);
            res.json({ success: code === 0 });
        });
    });
});

app.post('/api/lifecycle/update', (req, res) => {
    io.emit('log', '\n> CHECKING FOR UPDATES (Git Pull)...\n');
    const pull = spawn('git', ['pull'], { cwd: PROJECT_ROOT, shell: true });
    pull.stdout.on('data', d => io.emit('log', d.toString()));
    pull.stderr.on('data', d => io.emit('log', d.toString()));
    pull.on('close', code => {
        if (code === 0) {
            io.emit('log', '\n> Git Pull Successful. Installing dependencies...\n');
            const install = spawn('npm', ['install'], { cwd: PROJECT_ROOT, shell: true });
            install.stdout.on('data', d => io.emit('log', d.toString()));
            install.on('close', c2 => {
                io.emit('log', `\n> Update finished with code ${c2}\n`);
                res.json({ success: c2 === 0 });
            });
        } else {
            io.emit('log', `\n> Git Pull Failed with code ${code}\n`);
            res.json({ success: false });
        }
    });
});

app.get('/api/mcp/tools', (req, res) => {
    res.json({
        "jsonrpc": "2.0",
        "result": {
            "tools": [
                {
                    "name": "install_repository",
                    "description": "Runs the full installation sequence (npm install, docker up, build, migrate, seed).",
                    "inputSchema": { "type": "object", "properties": {} }
                },
                {
                    "name": "uninstall_repository",
                    "description": "Stops all services and removes all build artifacts/dependencies (Reset).",
                    "inputSchema": { "type": "object", "properties": {} }
                },
                {
                    "name": "update_repository",
                    "description": "Pulls latest code from git and re-installs dependencies.",
                    "inputSchema": { "type": "object", "properties": {} }
                },
                {
                    "name": "stop_services",
                    "description": "Stops running Docker services.",
                    "inputSchema": { "type": "object", "properties": {} }
                }
            ]
        }
    });
});
// ---------------------------


app.post('/api/troubleshoot', async (req, res) => {
    const { logs } = req.body;
    try {
        const response = await client.chat.completions.create({
            model: "Meta-Llama-3.1-8B-Instruct",
            messages: [
                { role: "system", content: "You are the AI Agent for Fonoster Launcher on Windows. \nCONTEXT: User is installing a local stack (Docker, Node, etc.). \nGOAL: Fix installation errors.\n\nRULES:\n1. Be concise. Use Markdown.\n2. If a tool is missing (Docker), suggest installing it explicitly, but note that 'winget' is used automatically.\n3. If you see 'Verification Failed' but 'Installation Success', explain it is likely a PATH issue and they can proceed or restart.\n4. ACTIONABLE: If you know a command to fix the issue (e.g., 'npm install', 'docker start'), output it in a block like this:\n```EXECUTE\n<command>\n```\nThis will trigger an auto-execution button for the user." },
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
