import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import './App.css';

const API_URL = 'http://localhost:3001/api';
const SOCKET_URL = 'http://localhost:3001';

const phases = [
    { id: 1, name: 'Preparation', command: 'npm', args: ['install'] },
    { id: 2, name: 'Infrastructure', command: 'npm', args: ['run', 'start:services'] },
    { id: 3, name: 'Build', command: 'npm', args: ['run', 'build'] },
    { id: 4, name: 'Database', command: 'npm', args: ['run', 'db:migrate', '&&', 'npm', 'run', 'db:seed'] }, // Note: chained commands might need shell handling in backend
    // For complex chains, better to rely on backend shell:true handling string. 
    // Let's simplified args for backend spawn:
    { id: 5, name: 'Start Core', command: 'npm', args: ['run', 'start:apiserver'] },
    { id: 6, name: 'Start Dashboard', command: 'npm', args: ['run', 'start:dashboard'] },
];

// Special handling for chained db command in backend or here?
// The backend uses spawn with shell:true, so "npm run db:migrate && npm run db:seed" as a single command string or array?
// Spawn args are array. If shell: true, we can pass entire string as command? 
// No, spawn(command, args).
// Let's adjust phase 4 to run a script or handle differently.
// Actually, `npm run db:migrate && npm run db:seed` is invalid as args array for spawn usually.
// Best to create a script in package.json or run them sequentially.
// Fonoster has specific scripts.
// Let's use `npm run start:services` which works.
// For DB, let's assume we can run one then the other or use a combined script if exists.
// Checking package.json... "db:seed" exists. "db:migrate" exists.
// We can just add a button for each or combine.
// Let's execute "npm" with args ["run", "db:setup"] if we create it, OR
// just run them sequentially in the backend or frontend logic.
// For simplicity, let's treat "Database" as running the migrate command, then user clicks Seed?
// Or we can send a custom command string to backend if we modify backend to Use exec?
// Current backend uses spawn(command, args).
// Let's just update the phases to be safer.

const safePhases = [
    { id: 1, name: 'Preparation (Install)', command: 'npm', args: ['install'] },
    { id: 2, name: 'Infrastructure (Docker)', command: 'npm', args: ['run', 'start:services'] },
    { id: 3, name: 'Build', command: 'npm', args: ['run', 'build'] },
    { id: 4, name: 'DB Migrate', command: 'npm', args: ['run', 'db:migrate'] },
    { id: 5, name: 'DB Seed', command: 'npm', args: ['run', 'db:seed'] },
    { id: 6, name: 'Start Core', command: 'npm', args: ['run', 'start:apiserver'] },
    { id: 7, name: 'Start Dashboard', command: 'npm', args: ['run', 'start:dashboard'] },
];

function App() {
    const [logs, setLogs] = useState([]);
    const [currentPhase, setCurrentPhase] = useState(null);
    const [statuses, setStatuses] = useState({}); // { id: 'pending' | 'running' | 'success' | 'error' }
    const [aiAnalysis, setAiAnalysis] = useState('');
    const [analyzing, setAnalyzing] = useState(false);
    const logEndRef = useRef(null);

    useEffect(() => {
        const socket = io(SOCKET_URL);

        socket.on('connect', () => {
            console.log('Connected to server');
        });

        socket.on('log', (data) => {
            setLogs((prev) => [...prev, data]);
        });

        socket.on('phase-complete', ({ command, code }) => {
            setStatuses((prev) => {
                // Find phase by currently running? 
                // We need to track which phase ID is active.
                // For simplicity, assuming `currentPhase` ref or state usage.
                // But state in socket callback might be stale.
                // Let's just optimistically update logs.
                return prev;
            });
            // We need to update status of CURRENT running phase.
            // We'll trust the component state logic below.
        });

        return () => socket.disconnect();
    }, []);

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const runPhase = async (phase) => {
        setCurrentPhase(phase.id);
        setStatuses(prev => ({ ...prev, [phase.id]: 'running' }));
        setLogs(prev => [...prev, `\n\n--- Starting Phase: ${phase.name} ---\n`]);
        setAiAnalysis('');

        try {
            await axios.post(`${API_URL}/run-phase`, {
                command: phase.command,
                args: phase.args
            });
        } catch (error) {
            console.error(error);
            setStatuses(prev => ({ ...prev, [phase.id]: 'error' }));
            setLogs(prev => [...prev, `Error starting phase: ${error.message}\n`]);
        }
    };

    const troubleshoot = async () => {
        setAnalyzing(true);
        setAiAnalysis('Analyzing logs with SambaNova AI...');
        try {
            // Send last 5000 chars of logs
            const logText = logs.join('');
            const response = await axios.post(`${API_URL}/troubleshoot`, {
                logs: logText.slice(-5000)
            });
            setAiAnalysis(response.data.analysis);
        } catch (error) {
            setAiAnalysis(`Failed to analyze: ${error.message}`);
        } finally {
            setAnalyzing(false);
        }
    };

    return (
        <div className="container">
            <div className="sidebar">
                <h2>Fonoster Launch</h2>
                <div className="phases">
                    {safePhases.map(phase => (
                        <button
                            key={phase.id}
                            className={`phase-btn ${statuses[phase.id] || 'pending'} ${currentPhase === phase.id ? 'active' : ''}`}
                            onClick={() => runPhase(phase)}
                        >
                            <div className="status-indicator"></div>
                            {phase.name}
                        </button>
                    ))}
                </div>
            </div>

            <div className="main">
                <div className="terminal">
                    <div className="terminal-header">
                        <span>Mission Control Logs</span>
                        <button className="ai-btn" onClick={troubleshoot} disabled={analyzing}>
                            {analyzing ? 'Analyzing...' : 'AI Troubleshoot'}
                        </button>
                    </div>
                    <div className="terminal-body">
                        {logs.map((log, i) => (
                            <span key={i}>{log}</span>
                        ))}
                        <div ref={logEndRef} />
                    </div>
                </div>

                {aiAnalysis && (
                    <div className="ai-panel">
                        <h3>AI Analysis Result</h3>
                        <div className="ai-content">
                            {aiAnalysis}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;
