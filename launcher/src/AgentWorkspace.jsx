import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import io from 'socket.io-client';
import axios from 'axios';
import 'xterm/css/xterm.css';
import './AgentWorkspace.css';

const API_URL = 'http://localhost:3001/api';
const SOCKET_URL = 'http://localhost:3001';

// File Tree Component
const FileTree = ({ path, onSelect }) => {
    const [items, setItems] = useState([]);
    const [expanded, setExpanded] = useState(true);

    useEffect(() => {
        if (expanded) {
            axios.get(`${API_URL}/fs/tree?path=${encodeURIComponent(path)}`)
                .then(res => setItems(res.data.items || []))
                .catch(err => console.error(err));
        }
    }, [expanded, path]);

    return (
        <div className="file-tree-node">
            <div className="node-label" onClick={() => setExpanded(!expanded)}>
                {path.split('\\').pop() || path}
            </div>
            {expanded && (
                <div className="node-children">
                    {items.map(item => (
                        item.type === 'directory' ?
                            <FileTree key={item.path} path={item.path} onSelect={onSelect} /> :
                            <div key={item.path} className="file-item" onClick={() => onSelect(item.path)}>
                                📄 {item.name}
                            </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default function AgentWorkspace({ onExit }) {
    const [currentFile, setCurrentFile] = useState(null);
    const [code, setCode] = useState('// Select a file to edit');
    const terminalRef = useRef(null);
    const socketRef = useRef(null);

    // Terminal Init
    useEffect(() => {
        const socket = io(SOCKET_URL);
        socketRef.current = socket;

        const term = new Terminal({
            theme: { background: '#1e1e1e' },
            cursorBlink: true,
            fontSize: 14
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        if (terminalRef.current) {
            term.open(terminalRef.current);
            setTimeout(() => fitAddon.fit(), 100); // Delay fit to ensure layout
        }

        term.onData(data => {
            socket.emit('term-input', data);
        });

        socket.on('term-output', data => {
            term.write(data);
        });

        // Handle resize
        const handleResize = () => {
            fitAddon.fit();
            socket.emit('term-resize', { cols: term.cols, rows: term.rows });
        };
        window.addEventListener('resize', handleResize);

        return () => {
            socket.disconnect();
            term.dispose();
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    const handleFileSelect = async (filePath) => {
        try {
            const res = await axios.post(`${API_URL}/fs/read`, { filePath });
            setCurrentFile(filePath);
            setCode(res.data.content);
        } catch (e) {
            alert('Error reading file: ' + e.message);
        }
    };

    const handleSave = async () => {
        if (!currentFile) return;
        try {
            await axios.post(`${API_URL}/fs/write`, { filePath: currentFile, content: code });
            alert('Saved!');
        } catch (e) {
            alert('Error saving: ' + e.message);
        }
    };

    return (
        <div className="agent-workspace">
            <div className="workspace-header">
                <button onClick={onExit}>⬅ Back to Launcher</button>
                <span>{currentFile || 'No file selected'}</span>
                <button onClick={handleSave}>💾 Save</button>
            </div>
            <div className="workspace-body">
                <div className="file-explorer">
                    <h3>Explorer</h3>
                    {/* Root is current project, need backend to define root or pass it */}
                    {/* We'll assume backend serves from PROJECT_ROOT. We can ask backend for root? 
                        For now, pass "." or let backend handle default */}
                    <FileTree path="." onSelect={handleFileSelect} />
                </div>
                <div className="editor-pane">
                    <Editor
                        height="60vh"
                        defaultLanguage="javascript"
                        value={code}
                        theme="vs-dark"
                        onChange={(val) => setCode(val)}
                    />
                </div>
            </div>
            <div className="terminal-pane">
                <div className="term-container" ref={terminalRef}></div>
            </div>
        </div>
    );
}
