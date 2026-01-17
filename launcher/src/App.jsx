import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import './App.css';

const API_URL = 'http://localhost:3001/api';
const SOCKET_URL = 'http://localhost:3001';

const safePhases = [
    { id: 0, name: 'Verificación Sistema', command: 'check-system', args: [] }, // Special command
    { id: 1, name: 'Preparación (Instalar)', command: 'npm', args: ['install'] },
    { id: 2, name: 'Infraestructura (Docker)', command: 'npm', args: ['run', 'start:services'] },
    { id: 3, name: 'Construcción (Build)', command: 'npm', args: ['run', 'build'] },
    { id: 4, name: 'Migración BD', command: 'npm', args: ['run', 'db:migrate'] },
    { id: 5, name: 'Semilla BD', command: 'npm', args: ['run', 'db:seed'] },
    { id: 6, name: 'Iniciar Núcleo', command: 'npm', args: ['run', 'start:apiserver'] },
    { id: 7, name: 'Iniciar Panel', command: 'npm', args: ['run', 'start:dashboard'] },
];

function App() {
    const [logs, setLogs] = useState([]);
    const [currentPhase, setCurrentPhase] = useState(null);
    const [statuses, setStatuses] = useState({});
    const [aiAnalysis, setAiAnalysis] = useState('');
    const [analyzing, setAnalyzing] = useState(false);
    const logEndRef = useRef(null);
    const socketRef = useRef(null);

    useEffect(() => {
        socketRef.current = io(SOCKET_URL);

        socketRef.current.on('connect', () => {
            console.log('Conectado al servidor');
        });

        socketRef.current.on('log', (data) => {
            setLogs((prev) => [...prev, data]);
        });

        // Listeners for phase completion are handled per-call if needed, 
        // or we can update global state here.
        socketRef.current.on('phase-complete', ({ command, code }) => {
            // Global status update
        });

        return () => {
            if (socketRef.current) socketRef.current.disconnect();
        };
    }, []);

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const executePhase = (phase) => {
        return new Promise((resolve, reject) => {
            setCurrentPhase(phase.id);
            setStatuses(prev => ({ ...prev, [phase.id]: 'running' }));

            // Define header
            const header = `\n\n--- Iniciando Fase: ${phase.name} ---\n`;
            setLogs(prev => [...prev, header]);

            if (phase.command === 'check-system') {
                try {
                    const res = await axios.post(`${API_URL}/check-system`);
                    const checks = res.data.checks;
                    const missing = checks.filter(c => c.status !== 'installed');

                    checks.forEach(check => {
                        const icon = check.status === 'installed' ? '✔' : '⚠️';
                        setLogs(prev => [...prev, `${icon} ${check.name}: ${check.status === 'installed' ? check.version : 'NO DETECTADO'}\n`]);
                    });

                    if (missing.length === 0) {
                        setStatuses(prev => ({ ...prev, [phase.id]: 'success' }));
                        setLogs(prev => [...prev, `\n Sistema verificado correctamente.\n`]);
                        resolve();
                        return;
                    }

                    setLogs(prev => [...prev, `\n!!! DETECTADOS COMPONENTES FALTANTES !!!\nIniciando auto-instalación...\n`]);

                    // Attempt auto-install for each missing tool
                    for (const tool of missing) {
                        setLogs(prev => [...prev, `\n--- Instalando ${tool.name} ---\n`]);

                        await new Promise((resolveInst, rejectInst) => {
                            const handler = ({ command, code }) => {
                                if (command === `install-${tool.name}`) {
                                    if (code === 0) {
                                        setLogs(prev => [...prev, `✔ ${tool.name} instalado correctamente.\n`]);
                                        socketRef.current.off('phase-complete', handler);
                                        resolveInst();
                                    } else {
                                        setLogs(prev => [...prev, `❌ Falló la instalación de ${tool.name}.\n`]);
                                        socketRef.current.off('phase-complete', handler);
                                        rejectInst(new Error(`Fallo al instalar ${tool.name}`));
                                    }
                                }
                            };
                            socketRef.current.on('phase-complete', handler);

                            axios.post(`${API_URL}/install-tool`, { tool: tool.name })
                                .catch(err => {
                                    socketRef.current.off('phase-complete', handler);
                                    rejectInst(err);
                                });
                        });
                    }

                    // Double check after install
                    setLogs(prev => [...prev, `\nVerificando instalación...\n`]);
                    const res2 = await axios.post(`${API_URL}/check-system`);
                    const stillMissing = res2.data.checks.filter(c => c.status !== 'installed');

                    if (stillMissing.length === 0) {
                        setStatuses(prev => ({ ...prev, [phase.id]: 'success' }));
                        setLogs(prev => [...prev, `\n Todo listo. Continuando...\n`]);
                        resolve();
                    } else {
                        throw new Error(`Aún faltan herramientas: ${stillMissing.map(c => c.name).join(', ')}`);
                    }

                } catch (err) {
                    setStatuses(prev => ({ ...prev, [phase.id]: 'error' }));
                    setLogs(prev => [...prev, `\nError en verificación/instalación: ${err.message}\n`]);
                    reject(err);
                }
                return;
            }

            // Setup one-time listener for this phase execution
            const completionHandler = ({ command, code }) => {
                // In a robust system we check command ID. Here we assume sequential.
                if (code === 0) {
                    setStatuses(prev => ({ ...prev, [phase.id]: 'success' }));
                    socketRef.current.off('phase-complete', completionHandler);
                    resolve();
                } else {
                    setStatuses(prev => ({ ...prev, [phase.id]: 'error' }));
                    socketRef.current.off('phase-complete', completionHandler);
                    reject(new Error(`Código de salida: ${code}`));
                }
            };

            socketRef.current.on('phase-complete', completionHandler);

            axios.post(`${API_URL}/run-phase`, {
                command: phase.command,
                args: phase.args
            }).catch(err => {
                setStatuses(prev => ({ ...prev, [phase.id]: 'error' }));
                socketRef.current.off('phase-complete', completionHandler);
                reject(err);
            });
        });
    };

    const runFullInstall = async (aiEnabled = false) => {
        setAiAnalysis('');
        setLogs(prev => [...prev, `\n=== COMENZANDO INSTALACIÓN COMPLETA ${aiEnabled ? '(CON IA)' : ''} ===\n`]);

        for (const phase of safePhases) {
            try {
                // If dashboard step, just fire and forget or it will hang forever (as it's a server)
                // Actually start:services is also detached? No, logs stream.
                // start:dashboard runs forever.
                if (phase.name.includes('Iniciar') || phase.name.includes('Docker')) {
                    // For long running processes, we might want to just start them and move on?
                    // Or wait for specific log?
                    // For now, let's assume they return? No, start:apiserver runs forever.
                    // The automation should probably stop at "Start Core" or handle "running" state differently.
                    // Let's assume verifying "Preparation", "Build", "DB" are the blocking ones.
                    // "Start" phases are final.
                }

                // Let's just run them. If it hangs, user stops it?
                // Actually "npm install", "build", "db" terminate.
                // "start:services" (docker) runs detached? `docker compose up -d` is detached.
                // The command in package.json is `docker compose ... -d`. So it exits.
                // "start:apiserver" runs forever (nodemon).
                // "start:dashboard" runs forever.

                // We should only await terminable commands.
                const isLongRunning = phase.command === 'npm' && phase.args.join(' ').includes('start:');
                // start:services uses -d, so it terminates.
                // start:apiserver, start:dashboard, start:authz DO NOT terminate.

                if (phase.args.includes('start:apiserver') || phase.args.includes('start:dashboard')) {
                    // Fire and forget, then maybe delay?
                    setCurrentPhase(phase.id);
                    setStatuses(prev => ({ ...prev, [phase.id]: 'running' }));
                    axios.post(`${API_URL}/run-phase`, { command: phase.command, args: phase.args });
                    setLogs(prev => [...prev, `\n--- Fase iniciada (proceso largo): ${phase.name} ---\n`]);
                    await new Promise(r => setTimeout(r, 3000)); // Wait little bit
                    setStatuses(prev => ({ ...prev, [phase.id]: 'success' }));
                    continue;
                }

                await executePhase(phase);

            } catch (error) {
                setLogs(prev => [...prev, `\n!!! ERROR EN FASE ${phase.name}: ${error.message} !!!\n`]);
                if (aiEnabled) {
                    await troubleshoot();
                }
                break; // Stop functionality
            }
        }
    };

    const runPhase = (phase) => {
        // Wrapper for single click
        setAiAnalysis('');
        executePhase(phase).catch(err => {
            setLogs(prev => [...prev, `Error: ${err.message}\n`]);
        });
    };

    const troubleshoot = async () => {
        setAnalyzing(true);
        setAiAnalysis('Variables IA analizando...');
        try {
            const logText = logs.join('');
            const response = await axios.post(`${API_URL}/troubleshoot`, {
                logs: logText.slice(-5000)
            });
            setAiAnalysis(response.data.analysis);
        } catch (error) {
            const errMsg = error.response?.data?.error || error.message;
            setAiAnalysis(`Error IA: ${errMsg}`);
        } finally {
            setAnalyzing(false);
        }
    };

    return (
        <div className="container">
            <div className="sidebar">
                <h2>Lanzador Fonoster</h2>

                <div className="full-controls">
                    <button className="full-btn" onClick={() => runFullInstall(false)}>
                        Instalación Completa
                    </button>
                    <button className="full-btn ai-mode" onClick={() => runFullInstall(true)}>
                        Instalación Completa + IA
                    </button>
                </div>

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
                        <span>Logs de Control de Misión</span>
                        <button className="ai-btn" onClick={troubleshoot} disabled={analyzing}>
                            {analyzing ? 'Analizando...' : 'Solucionar con IA'}
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
                        <h3>Resultado de Análisis IA</h3>
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
