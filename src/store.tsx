import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Command, StudyState, SystemAction, SystemResult } from '../shared/types';

type Store = { state: StudyState; busy: boolean; command: (command: Command, message?: string) => Promise<StudyState | null>; system: (action: SystemAction, payload?: Record<string, string>, message?: string) => Promise<SystemResult | null>; notify: (message: string, error?: boolean) => void };
const Context = createContext<Store | null>(null);
export function StudyProvider({ children }: { children: ReactNode }) {
 const [state, setState] = useState<StudyState | null>(null);
 const [error, setError] = useState('');
 const [pending, setPending] = useState(0);
 const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
 const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
 const loadSeq = useRef(0);
 const notify = useCallback((text: string, isError = false) => { setToast({ text, error: isError }); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(null), isError ? 10000 : 4500); }, []);
 const reload = useCallback(async () => { const seq = ++loadSeq.current; try { const data = await window.caderno.state(); if (seq === loadSeq.current) { setState(data); setError(''); } } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }, []);
 useEffect(() => { if (!window.caderno) return; void reload(); const off = window.caderno.onChange(() => { void reload(); }); const onFocus = () => { void reload(); }; const onVisible = () => { if (!document.hidden) void reload(); }; window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onVisible); return () => { off(); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisible); clearTimeout(timer.current); }; }, [reload]);
 useEffect(() => { document.documentElement.dataset.theme = state?.settings.theme ?? 'light'; }, [state?.settings.theme]);
 const command = useCallback(async (value: Command, message?: string) => { setPending(n => n + 1); try { const data = await window.caderno.command(value); ++loadSeq.current; setState(data); if (message) notify(message); return data; } catch (e) { notify(e instanceof Error ? e.message : String(e), true); return null; } finally { setPending(n => n - 1); } }, [notify]);
 const system = useCallback(async (action: SystemAction, payload?: Record<string, string>, message?: string) => { setPending(n => n + 1); try { const result = await window.caderno.system(action, payload); if (!result.canceled && (message || result.message)) notify(message || result.message!); if (!result.canceled && (action === 'restore' || action === 'importMarkdown' || action === 'importExchange')) await reload(); return result; } catch (e) { notify(e instanceof Error ? e.message : String(e), true); return null; } finally { setPending(n => n - 1); } }, [notify, reload]);
 if (!window.caderno) return <div className="startup"><span className="eyebrow">CADERNO · ENGLISH</span><h1>Seu caderno vive no computador.</h1><p>Abra o aplicativo Caderno pelo atalho da área de trabalho. Esta página precisa da conexão com o aplicativo para acessar seus estudos locais.</p></div>;
 if (!state) return <div className="startup"><span className="eyebrow">CADERNO · ENGLISH</span><h1>{error ? 'Não foi possível abrir o caderno.' : 'Abrindo seu caderno…'}</h1>{error && <><p role="alert">{error}</p><button onClick={() => void reload()}>Tentar novamente</button></>}</div>;
 return <Context.Provider value={{ state, busy: pending > 0, command, system, notify }}>{children}{toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}><span>{toast.text}</span><button aria-label="Fechar aviso" onClick={() => setToast(null)}>×</button></div>}</Context.Provider>;
}
export function useStudy() { const store = useContext(Context); if (!store) throw new Error('StudyProvider ausente'); return store; }
