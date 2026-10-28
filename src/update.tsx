import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { UpdateAction, UpdateStatus } from '../shared/types';
import { Button } from './ui';

const initial: UpdateStatus = { phase: 'idle', currentVersion: '' };

export function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatus>(initial);
  useEffect(() => {
    const off = window.caderno.onUpdate(setStatus);
    void window.caderno.update('status').then(setStatus).catch(() => setStatus({ phase: 'error', currentVersion: '', message: 'Não foi possível ler o estado da atualização.' }));
    return off;
  }, []);
  const act = async (action: UpdateAction) => {
    try { setStatus(await window.caderno.update(action)); }
    catch { setStatus(previous => ({ ...previous, phase: 'error', message: 'A atualização falhou. Tente novamente.' })); }
  };
  return { status, act };
}

export function UpdateBanner() {
  const { status, act } = useUpdateStatus();
  if (!['available', 'downloading', 'ready'].includes(status.phase)) return null;
  return <section className="update-banner" role="status" aria-live="polite">
    <RefreshCw size={18} /><span><strong>{status.phase === 'ready' ? 'Atualização pronta' : status.phase === 'downloading' ? 'Baixando atualização' : 'Atualização disponível'}</strong><small>{status.message}</small></span>
    {status.phase === 'available' && <Button onClick={() => void act('download')}>Baixar versão {status.availableVersion}</Button>}
    {status.phase === 'ready' && <Button onClick={() => void act('install')}>Reiniciar e atualizar</Button>}
  </section>;
}

export function UpdateSettings() {
  const { status, act } = useUpdateStatus();
  return <section className="settings-card"><div className="settings-heading"><i><RefreshCw size={18}/></i><div><h2>Atualizações</h2><p>Verifique e instale novas versões sem repetir a instalação manual.</p></div></div>
    <p className="muted small">Versão atual: {status.currentVersion || 'carregando…'}</p>
    {status.message && <p className="muted small" role="status">{status.message}</p>}
    <div className="action-stack">
      <Button variant="secondary" disabled={status.phase === 'checking' || status.phase === 'downloading'} onClick={() => void act('check')}>Verificar atualizações</Button>
      {status.phase === 'available' && <Button onClick={() => void act('download')}>Baixar versão {status.availableVersion}</Button>}
      {status.phase === 'ready' && <Button onClick={() => void act('install')}>Reiniciar e atualizar</Button>}
    </div>
    <p className="muted small">Para versões privadas, entre com sua conta pelo GitHub CLI neste computador. A versão portátil não recebe atualizações automáticas.</p>
  </section>;
}
