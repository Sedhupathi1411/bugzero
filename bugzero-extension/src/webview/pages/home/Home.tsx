import React, { useEffect, useState } from 'react';
import Button from '../../components/Button';

interface FileEntry {
    name: string;
    type: 'file' | 'directory';
}

interface Problem {
    id: string;
    lang: string;
    code: string;
    level: string;
    testcases: { input: string; output: string }[];
}

const Home = () => {
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [auth, setAuth] = useState('');
    const [error, setError] = useState('');
    const [submittedFiles, setSubmittedFiles] = useState<Record<string, string>>({});
    const [problemsData, setProblemsData] = useState<Problem[]>([]);
    const [activeFile, setActiveFile] = useState<string | null>(null);
    const [runResults, setRunResults] = useState<Record<string, any>>({});
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const [submittingProblem, setSubmittingProblem] = useState<string | null>(null);

    // @ts-ignore
    const vscode = React.useMemo(() => acquireVsCodeApi(), []);

    useEffect(() => {
        // Check for persisted login state on mount only
        vscode.postMessage({ command: 'checkLogin' });
    }, [vscode]);

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'files':
                    setFiles(message.value);
                    break;
                case 'loginResponse':
                    setIsLoggingIn(false);
                    if (message.success) {
                        setIsLoggedIn(true);
                        setAuth(message.auth);
                        setUsername(message.username);
                        if (message.user && message.user.submissions) {
                            const submitted: Record<string, string> = {};
                            message.user.submissions.forEach((s: any) => {
                                if (submitted[s.problemId] !== 'PASSED') {
                                    submitted[s.problemId] = s.status;
                                }
                            });
                            setSubmittedFiles(submitted);
                        }
                        if (message.problems) {
                            setProblemsData(message.problems);
                        }
                        vscode.postMessage({ command: 'getFiles' });
                    } else {
                        setError(message.error);
                    }
                    break;
                case 'logoutSuccess':
                    setIsLoggedIn(false);
                    setAuth('');
                    setUsername('');
                    setPassword('');
                    setSubmittedFiles({});
                    setProblemsData([]);
                    break;
                case 'submissionResponse':
                    if (message.success) {
                        setSubmittingProblem(null);
                    }
                    break;
                case 'activeFile':
                    setActiveFile(message.fileName);
                    break;
                case 'runResult':
                    const resultKey = `${message.problemId}-${message.testCaseIndex}`;
                    setRunResults(prev => {
                        const next = { ...prev, [resultKey]: message };
                        
                        // Check if we were waiting for this run to finish a submission
                        if (submittingProblem === message.problemId) {
                            const problem = problemsData.find(p => p.id === message.problemId);
                            if (problem) {
                                const allResults = problem.testcases.map((tc, idx) => {
                                    if (idx === message.testCaseIndex) return message;
                                    return next[`${problem.id}-${idx}`];
                                });
                                
                                const allFinished = allResults.every(r => r && !r.loading);
                                if (allFinished) {
                                    const allPassed = allResults.every(r => r && r.success);
                                    const status = allPassed ? 'PASSED' : 'FAILED';
                                    const fileName = `${problem.id}.${problem.lang}`;
                                    
                                    vscode.postMessage({ 
                                        command: 'submit', 
                                        value: { fileName, auth, status } 
                                    });
                                    
                                    setSubmittedFiles(prevSub => ({ ...prevSub, [problem.id]: status }));
                                }
                            }
                        }
                        return next;
                    });
                    break;
                case 'pullSuccess':
                    if (message.problems) {
                        setProblemsData(message.problems);
                    }
                    break;
            }
        };

        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [vscode, submittingProblem, problemsData, auth]);

    const handleLogin = () => {
        if (!username || !password) {
            setError('Please enter both username and password.');
            return;
        }
        console.log("Attempting login in webview for:", username);
        setError('');
        setIsLoggingIn(true);
        vscode.postMessage({ command: 'login', value: { username, password } });
    };

    const handleLogout = () => {
        vscode.postMessage({ command: 'logout' });
    };

    const handleSubmit = (fileName: string) => {
        const problemId = fileName.split('.')[0];
        const problem = problemsData.find(p => p.id === problemId);
        if (!problem) return;

        console.log(`Starting submission for ${problemId}...`);
        setSubmittingProblem(problemId);
        handleRunAll(problem);
    };

    const handleOpenFile = (fileName: string) => {
        vscode.postMessage({ command: 'openFile', value: { fileName } });
    };

    const handleRun = (fileName: string, input: string, output: string, problemId: string, testCaseIndex: number) => {
        const resultKey = `${problemId}-${testCaseIndex}`;
        setRunResults(prev => ({ ...prev, [resultKey]: { loading: true } }));
        vscode.postMessage({ 
            command: 'run', 
            value: { fileName, input, expectedOutput: output, problemId, testCaseIndex } 
        });
    };

    const handleRunAll = (problem: Problem) => {
        const fileName = `${problem.id}.${problem.lang}`;
        problem.testcases.forEach((tc, idx) => {
            handleRun(fileName, tc.input, tc.output, problem.id, idx);
        });
    };

    if (!isLoggedIn) {
        return (
            <div style={{ padding: '20px' }}>
                <h2>Login to BugZero</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <input 
                        type="text" 
                        placeholder="Username" 
                        value={username} 
                        disabled={isLoggingIn}
                        onChange={e => setUsername(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleLogin()}
                        style={{ padding: '5px', background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)', border: '1px solid var(--vscode-input-border)' }}
                    />
                    <input 
                        type="password" 
                        placeholder="Password" 
                        value={password} 
                        disabled={isLoggingIn}
                        onChange={e => setPassword(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleLogin()}
                        style={{ padding: '5px', background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)', border: '1px solid var(--vscode-input-border)' }}
                    />
                    <Button 
                        label={isLoggingIn ? "Logging in..." : "Login"} 
                        onClick={handleLogin} 
                        disabled={isLoggingIn}
                    />
                    {error && <p style={{ color: 'var(--vscode-errorForeground)' }}>{error}</p>}
                </div>
            </div>
        );
    }

    const problems = files
        .filter(f => f.type === 'file' && (f.name.endsWith('.c') || f.name.endsWith('.py')))
        .sort((a, b) => {
            const levelOrder: Record<string, number> = { easy: 1, medium: 2, hard: 3 };
            const problemA = problemsData.find(p => p.id === a.name.split('.')[0]);
            const problemB = problemsData.find(p => p.id === b.name.split('.')[0]);
            const levelA = levelOrder[problemA?.level?.toLowerCase() || ''] || 99;
            const levelB = levelOrder[problemB?.level?.toLowerCase() || ''] || 99;
            return levelA - levelB;
        });

    const activeProblem = problemsData.find(p => activeFile === `${p.id}.${p.lang}`);

    const formatName = (name: string) => {
        return name
            .split(/[_-]/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
            {/* Top Half: Problems List */}
            <div style={{ flex: '1 1 50%', overflowY: 'auto', padding: '10px', borderBottom: '1px solid var(--vscode-panel-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '10px', marginBottom: '10px' }}>
                    <div>
                        <h2 style={{ margin: 0 }}>Problems</h2>
                        <span style={{ fontSize: '0.8em', opacity: 0.8 }}>Hi, {username}</span>
                    </div>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--vscode-panel-border)' }}>
                            <th style={{ padding: '5px' }}>Type</th>
                            <th style={{ padding: '5px' }}>Name</th>
                            <th style={{ padding: '5px' }}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {problems.map((file, index) => {
                            const isPython = file.name.endsWith('.py');
                            const problemId = file.name.split('.')[0];
                            const displayName = `${index + 1}. ${formatName(problemId)}`;
                            const status = submittedFiles[problemId];
                            const isActive = activeFile === file.name;
                            const problemInfo = problemsData.find(p => p.id === problemId);
                            const isSubmitting = submittingProblem === problemId;
                            
                            return (
                                <tr key={file.name} style={{ borderBottom: '1px solid var(--vscode-panel-border)', background: isActive ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent' }}>
                                    <td style={{ padding: '5px', fontSize: '1.2em' }}>
                                        {isPython ? '🐍' : 'C'}
                                    </td>
                                    <td style={{ padding: '5px' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                            <span 
                                                onClick={() => handleOpenFile(file.name)}
                                                style={{ cursor: 'pointer', color: isActive ? 'var(--vscode-list-activeSelectionForeground)' : 'var(--vscode-textLink-foreground)' }}
                                                title="Click to open file"
                                            >
                                                {displayName}
                                            </span>
                                            {problemInfo && <LevelChip level={problemInfo.level} />}
                                        </div>
                                    </td>
                                    <td style={{ padding: '5px' }}>
                                        <ActionButton 
                                            status={status} 
                                            isSubmitting={isSubmitting}
                                            onClick={() => handleSubmit(file.name)} 
                                        />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {problems.length === 0 && <p style={{ marginTop: '10px', opacity: 0.7 }}>No .c or .py files found.</p>}
            </div>

            {/* Bottom Half: Test Cases */}
            <div style={{ flex: '1 1 50%', overflowY: 'auto', background: 'var(--vscode-sideBar-background)' }}>
                {activeProblem ? (
                    <div>
                        <div style={{ 
                            padding: '12px 10px', 
                            borderBottom: '1px solid var(--vscode-panel-border)',
                            background: 'var(--vscode-sideBar-sectionHeader-background)',
                            position: 'sticky',
                            top: 0,
                            zIndex: 10,
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center' 
                        }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <h3 style={{ margin: 0, fontSize: '0.9em', fontWeight: 'bold', textTransform: 'uppercase', opacity: 0.8 }}>Test Cases</h3>
                                    <LevelChip level={activeProblem.level} />
                                </div>
                                <div style={{ fontSize: '1.1em', fontWeight: '500' }}>{formatName(activeProblem.id)}</div>
                            </div>
                            <button 
                                onClick={() => handleRunAll(activeProblem)}
                                style={{ 
                                    background: 'var(--vscode-button-background)',
                                    color: 'var(--vscode-button-foreground)',
                                    border: 'none',
                                    padding: '6px 12px',
                                    borderRadius: '2px',
                                    cursor: 'pointer',
                                    fontSize: '0.85em',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}
                            >
                                <span>▶</span> Run All
                            </button>
                        </div>
                        <div style={{ padding: '10px' }}>
                            {activeProblem.testcases.map((tc, index) => {
                                const resultKey = `${activeProblem.id}-${index}`;
                                const result = runResults[resultKey];
                                return (
                                    <div key={index} style={{ marginBottom: '15px', padding: '10px', background: 'var(--vscode-editor-background)', border: '1px solid var(--vscode-panel-border)', borderRadius: '4px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                            <strong style={{ fontSize: '0.9em', opacity: 0.9 }}>Case {index + 1}</strong>
                                            <button 
                                                onClick={() => handleRun(`${activeProblem.id}.${activeProblem.lang}`, tc.input, tc.output, activeProblem.id, index)}
                                                disabled={result?.loading}
                                                style={{ 
                                                    background: 'var(--vscode-button-secondaryBackground)',
                                                    color: 'var(--vscode-button-secondaryForeground)',
                                                    border: '1px solid var(--vscode-button-border)',
                                                    padding: '2px 10px',
                                                    borderRadius: '2px',
                                                    cursor: 'pointer',
                                                    fontSize: '0.8em',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px'
                                                }}
                                            >
                                                {result?.loading ? '...' : <span>▶</span>}
                                                {result?.loading ? 'Running' : 'Run'}
                                            </button>
                                        </div>
                                        <div style={{ fontSize: '0.9em', opacity: 0.8 }}>
                                            <div style={{ marginBottom: '2px' }}>Input: <code style={{ background: 'var(--vscode-textCodeBlock-background)', padding: '0 4px', borderRadius: '2px' }}>{tc.input}</code></div>
                                            <div>Expected: <code style={{ background: 'var(--vscode-textCodeBlock-background)', padding: '0 4px', borderRadius: '2px' }}>{tc.output}</code></div>
                                        </div>
                                        {result && !result.loading && (
                                            <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px dashed var(--vscode-panel-border)' }}>
                                                <div style={{ 
                                                    color: result.success ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-errorForeground)', 
                                                    fontWeight: 'bold',
                                                    fontSize: '0.9em',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px'
                                                }}>
                                                    {result.success ? '✓' : '✗'} {result.success ? 'PASSED' : 'FAILED'}
                                                </div>
                                                {!result.success && (
                                                    <div style={{ fontSize: '0.85em', marginTop: '5px' }}>
                                                        {result.stderr ? (
                                                            <pre style={{ 
                                                                color: 'var(--vscode-errorForeground)', 
                                                                whiteSpace: 'pre-wrap', 
                                                                margin: '4px 0 0 0',
                                                                padding: '6px',
                                                                background: 'rgba(255,0,0,0.05)',
                                                                borderRadius: '2px'
                                                            }}>{result.stderr}</pre>
                                                        ) : (
                                                            <div style={{ marginTop: '4px' }}>Actual: <code style={{ color: 'var(--vscode-errorForeground)', fontWeight: 'bold' }}>{result.actualOutput || '(empty)'}</code></div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <div style={{ height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', opacity: 0.5 }}>
                        <p>Select a problem to view test cases</p>
                    </div>
                )}
            </div>
        </div>
    );
};

const LevelChip = ({ level }: { level: string }) => {
    const colors: Record<string, string> = {
        easy: '#4caf50',
        medium: '#ff9800',
        hard: '#f44336'
    };

    return (
        <span style={{
            fontSize: '0.7em',
            padding: '1px 6px',
            borderRadius: '10px',
            backgroundColor: colors[level.toLowerCase()] || 'gray',
            color: 'white',
            width: 'fit-content',
            textTransform: 'capitalize'
        }}>
            {level}
        </span>
    );
};

const ActionButton = ({ status, isSubmitting, onClick }: { status?: string, isSubmitting?: boolean, onClick: () => void }) => {
    const [isHovered, setIsHovered] = useState(false);

    if (isSubmitting) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '2px 8px', fontSize: '0.85em', opacity: 0.7 }}>
                ...
            </div>
        );
    }

    if (status && !isHovered) {
        return (
            <div 
                onMouseEnter={() => setIsHovered(true)}
                style={{ 
                    display: 'flex', 
                    justifyContent: 'center', 
                    alignItems: 'center',
                    padding: '2px 8px',
                    color: status === 'PASSED' ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-errorForeground)',
                    fontSize: '1.2em',
                    fontWeight: 'bold'
                }}
            >
                {status === 'PASSED' ? '✓' : '✗'}
            </div>
        );
    }

    return (
        <button 
            onClick={onClick}
            onMouseLeave={() => setIsHovered(false)}
            style={{ 
                background: 'var(--vscode-button-secondaryBackground)', 
                color: 'var(--vscode-button-secondaryForeground)',
                border: 'none',
                padding: '2px 8px',
                cursor: 'pointer',
                width: '100%',
                fontSize: '0.85em'
            }}
        >
            {status ? 'Retry' : 'Submit'}
        </button>
    );
};

export default Home;
