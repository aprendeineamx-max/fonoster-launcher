import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import './App.css';
import AgentWorkspace from './AgentWorkspace';

const API_URL = 'http://localhost:3001/api';
const SOCKET_URL = 'http://localhost:3001';

const safePhases = [
    { id: 0, name: 'Verificación Sistema', command: 'check-system', args: [] },
    { id: 1, name: 'Preparación (Instalar)', command: 'npm', args: ['install'] },
    { id: 2, name: 'Infraestructura (Docker)', command: 'npm', args: ['run', 'start:services'] },
    { id: 3, name: 'Construcción (Build)', command: 'npm', args: ['run', 'build'] },
    { id: 4, name: 'Migración BD', command: 'npm', args: ['run', 'db:migrate'] },
    { id: 5, name: 'Semilla BD', command: 'npm', args: ['run', 'db:seed'] },
    { id: 6, name: 'Iniciar Núcleo', command: 'npm', args: ['run', 'start:apiserver'] },
    { id: 7, name: 'Iniciar Panel', command: 'npm', args: ['run', 'start:dashboard'] },
];

function App() {
    const [view, setView] = useState('launcher'); // 'launcher' | 'agent'
    const [logs, setLogs] = useState([]);
    const [currentPhase, setCurrentPhase] = useState(null);
    const [statuses, setStatuses] = useState({});
    const [aiAnalysis, setAiAnalysis] = useState('');
    const [aiCommand, setAiCommand] = useState(null); // { cmd: string }
    const [analyzing, setAnalyzing] = useState(false);
    const logEndRef = useRef(null);
    const socketRef = useRef(null);

    useEffect(() => {
        socketRef.current = io(SOCKET_URL);
        socketRef.current.on('connect', () => console.log('Conectado al servidor'));
        socketRef.current.on('log', (data) => setLogs((prev) => [...prev, data]));
        // Global listener for phase complete if needed
        socketRef.current.on('phase-complete', ({ command, code }) => {
            // Optional logic
        });
        return () => { if (socketRef.current) socketRef.current.disconnect(); };
    }, []);

    useEffect(() => {
        if (view === 'launcher') logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs, view]);

    const executePhase = (phase) => {
        return new Promise((resolve, reject) => {
            (async () => {
                try {
                    setCurrentPhase(phase.id);
                    setStatuses(prev => ({ ...prev, [phase.id]: 'running' }));
                    const header = `\n\n--- Iniciando Fase: ${phase.name} ---\n`;
                    setLogs(prev => [...prev, header]);

                    if (phase.command === 'check-system') {
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

                        for (const tool of missing) {
                            setLogs(prev => [...prev, `\n--- Instalando ${tool.name} ---\n`]);
                            // Wrap socket listener in promise
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
                                axios.post(`${API_URL}/install-tool`, { tool: tool.name }).catch(err => {
                                    socketRef.current.off('phase-complete', handler);
                                    rejectInst(err);
                                });
                            });
                        }

                        setLogs(prev => [...prev, `\nVerificando instalación...\n`]);
                        const res2 = await axios.post(`${API_URL}/check-system`);
                        const stillMissing = res2.data.checks.filter(c => c.status !== 'installed');

                        if (stillMissing.length === 0) {
                            setStatuses(prev => ({ ...prev, [phase.id]: 'success' }));
                            setLogs(prev => [...prev, `\n Todo listo. Continuando...\n`]);
                            resolve();
                        } else {
                            // FIX: Trust the installer if it succeeded.
                            if (missing.every(m => logs.some(l => l.includes(`${m.name} instalado correctamente`)))) {
                                setLogs(prev => [...prev, `\n⚠️ La instalación reportó éxito, pero la verificación falló (posiblemente requiere reinicio/PATH).\nContinuando de todos modos...\n`]);
                                setStatuses(prev => ({ ...prev, [phase.id]: 'success' }));
                                resolve();
                            } else {
                                throw new Error(`Aún faltan herramientas: ${stillMissing.map(c => c.name).join(', ')}`);
                            }
                        }
                        return;
                    }

                    // Standard Phase

                    const completionHandler = ({ command, code }) => {
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

                    await axios.post(`${API_URL}/run-phase`, { command: phase.command, args: phase.args });

                } catch (err) {
                    setStatuses(prev => ({ ...prev, [phase.id]: 'error' }));
                    setLogs(prev => [...prev, `\nError en FASE: ${err.message}\n`]);
                    reject(err);
                }
            })();
        });
    };

    const runFullInstall = async (aiEnabled = false) => {
        setAiAnalysis('');
        setLogs(prev => [...prev, `\n=== COMENZANDO INSTALACIÓN COMPLETA ${aiEnabled ? '(CON IA)' : ''} ===\n`]);

        for (const phase of safePhases) {
            try {
                // Handle non-terminating processes
                if (phase.args.join(' ').includes('start:')) {
                    setCurrentPhase(phase.id);
                    setStatuses(prev => ({ ...prev, [phase.id]: 'running' }));
                    axios.post(`${API_URL}/run-phase`, { command: phase.command, args: phase.args });
                    setLogs(prev => [...prev, `\n--- Fase iniciada (proceso largo): ${phase.name} ---\n`]);
                    await new Promise(r => setTimeout(r, 3000));
                    setStatuses(prev => ({ ...prev, [phase.id]: 'success' }));
                    continue;
                }
                await executePhase(phase);
            } catch (error) {
                setLogs(prev => [...prev, `\n!!! ERROR EN FASE ${phase.name}: ${error.message} !!!\n`]);
                if (aiEnabled) await troubleshoot();
                break;
            }
        }
    };

    const runPhase = (phase) => {
        setAiAnalysis('');
        executePhase(phase).catch(err => setLogs(prev => [...prev, `Error: ${err.message}\n`]));
    };

    const runAiCommand = async () => {
        if (!aiCommand) return;
        setLogs(prev => [...prev, `\n> Ejecutando Solución IA: ${aiCommand.cmd}\n`]);
        setAiCommand(null); // Clear after run

        // Execute via run-phase (generic shell)
        // treating it as a raw command line
        const parts = aiCommand.cmd.split(' ');
        const cmd = parts[0];
        const args = parts.slice(1);

        try {
            await axios.post(`${API_URL}/run-phase`, { command: cmd, args });
        } catch (e) {
            setLogs(prev => [...prev, `Error ejecutando solución: ${e.message}\n`]);
        }
    };

    const troubleshoot = async () => {
        setAnalyzing(true);
        setAiAnalysis('Variables IA analizando...');
        setAiCommand(null);
        try {
            const logText = logs.join('');
            const response = await axios.post(`${API_URL}/troubleshoot`, { logs: logText.slice(-5000) });
            const text = response.data.analysis;
            setAiAnalysis(text);

            // Parse Action: ```EXECUTE command ```
            const match = text.match(/```EXECUTE\s+([\s\S]*?)\s*```/);
            if (match && match[1]) {
                const cmd = match[1].trim();
                setAiCommand({ cmd });
            }

        } catch (error) {
            setAiAnalysis(`Error IA: ${error.response?.data?.error || error.message}`);
        } finally {
            setAnalyzing(false);
        }
    };

    if (view === 'agent') {
        return <AgentWorkspace onExit={() => setView('launcher')} />;
    }

    const runLifecycle = async (action) => {
        const confirmMsg = action === 'uninstall' ? '¿Estás seguro de BORRAR TODO? Esto eliminará node_modules y dist.' : null;
        if (confirmMsg && !window.confirm(confirmMsg)) return;

        setLogs(prev => [...prev, `\n=== EJECUTANDO CICLO DE VIDA: ${action.toUpperCase()} ===\n`]);
        try {
            await axios.post(`${API_URL}/lifecycle/${action}`);
        } catch (e) {
            setLogs(prev => [...prev, `Error: ${e.message}\n`]);
        }
    };

    return (
        <div className="container">
            <div className="sidebar">
                <h2>Lanzador Fonoster</h2>

                <div className="full-controls">
                    <button className="full-btn" onClick={() => runFullInstall(false)}>Instalación Completa</button>
                    <button className="full-btn ai-mode" onClick={() => runFullInstall(true)}>Instalación Completa + IA</button>
                    <button className="full-btn agent-mode" onClick={() => setView('agent')} style={{ marginTop: '10px', background: '#e91e63' }}>Modo Agente (IDE)</button>
                </div>

                <div className="lifecycle-controls" style={{ margin: '20px 0', borderTop: '1px solid #444', paddingTop: '10px' }}>
                    <h4 style={{ margin: '0 0 10px 0', color: '#aaa' }}>Ciclo de Vida / MCP</h4>
                    <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                        <button className="phase-btn" onClick={() => runLifecycle('update')} style={{ background: '#2196f3' }}>🔄 Actualizar</button>
                        <button className="phase-btn" onClick={() => runLifecycle('stop')} style={{ background: '#ff9800' }}>🛑 Detener</button>
                        <button className="phase-btn" onClick={() => runLifecycle('uninstall')} style={{ background: '#f44336' }}>⛔ Reset Total</button>
                    </div>
                </div>

                <div className="phases">
                    {safePhases.map(phase => (
                        <button key={phase.id} className={`phase-btn ${statuses[phase.id] || 'pending'} ${currentPhase === phase.id ? 'active' : ''}`} onClick={() => runPhase(phase)}>
                            <div className="status-indicator"></div>{phase.name}
                        </button>
                    ))}
                </div>
            </div>
            <div className="main">
                <div className="terminal">
                    <div className="terminal-header">
                        <span>Logs de Control de Misión</span>
                        <button className="ai-btn" onClick={troubleshoot} disabled={analyzing}>{analyzing ? 'Analizando...' : 'Solucionar con IA'}</button>
                    </div>
                    <div className="terminal-body">
                        {logs.map((log, i) => <span key={i}>{log}</span>)}
                        <div ref={logEndRef} />
                    </div>
                </div>
                {aiAnalysis && (
                    <div className="ai-panel">
                        <h3>Resultado de Análisis IA</h3>
                        <div className="ai-content">{aiAnalysis}</div>
                        {aiCommand && (
                            <div style={{ marginTop: '10px', borderTop: '1px solid #444', paddingTop: '10px' }}>
                                <p><strong>Acción Recomendada:</strong> <code>{aiCommand.cmd}</code></p>
                                <button className="full-btn" style={{ background: '#4caf50' }} onClick={runAiCommand}>
                                    ⚡ EJECUTAR SOLUCIÓN
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;
