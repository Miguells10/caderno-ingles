import { useState } from 'react';
import type { ExternalModality } from '../../shared/types';
import { useStudy } from '../store';
import { Button, Field, Modal } from '../ui';

export const externalModalityLabels: Record<ExternalModality, string> = {
  speaking_dialogue: 'Conversa em inglês',
  speaking_monologue: 'Monólogo em inglês',
  listening: 'Escuta em inglês',
};

export function ExternalPractice({ onClose }: { onClose: () => void }) {
  const { command, busy } = useStudy();
  const [modality, setModality] = useState<ExternalModality>('speaking_dialogue');
  const [minutes, setMinutes] = useState('');
  const [chunkApplied, setChunkApplied] = useState('');
  return <Modal title="Registrar prática fora do app" onClose={onClose}>
    <p className="muted">Registre o que realmente fez. Este registro não conclui uma aula nem avalia sua pronúncia.</p>
    <form onSubmit={async event => {
      event.preventDefault();
      const saved = await command({ type: 'recordExternalPractice', modality, minutes: minutes ? Number(minutes) : null, chunkApplied }, 'Prática externa registrada.');
      if (saved) onClose();
    }}>
      <Field label="Tipo de prática"><select value={modality} onChange={event => setModality(event.target.value as ExternalModality)}>{Object.entries(externalModalityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <Field label="Duração real em minutos (opcional)"><input type="number" min={1} max={1440} value={minutes} onChange={event => setMinutes(event.target.value)} /></Field>
      <Field label="Expressão que você usou ou ouviu (opcional)"><input maxLength={500} value={chunkApplied} onChange={event => setChunkApplied(event.target.value)} /></Field>
      <footer className="form-actions"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy}>Registrar prática</Button></footer>
    </form>
  </Modal>;
}
