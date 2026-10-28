import { useState, type ReactNode } from 'react';
import type { Attempt } from '../../shared/types';
import { useStudy } from '../store';
import { dateLabel } from '../helpers';

const CONNECTORS = ['given that', 'in order to', 'as far as', 'although', 'because', 'since', 'however', 'therefore', 'and', 'but', 'so'];
function escapePattern(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function HighlightedText({ text, chunks }: { text: string; chunks: string[] }) {
  const expressions = [...new Set([...chunks, ...CONNECTORS].map(item => item.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!expressions.length) return <>{text}</>;
  const pattern = new RegExp('\\b(?:' + expressions.map(escapePattern).join('|') + ')\\b', 'gi');
  const parts: ReactNode[] = [];
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > start) parts.push(text.slice(start, index));
    const chunk = chunks.some(item => item.toLocaleLowerCase() === match[0].toLocaleLowerCase());
    parts.push(<mark key={index} className={chunk ? 'highlight-chunk' : 'highlight-connector'} title={chunk ? 'Expressão salva em cartão' : 'Conectivo'}>{match[0]}</mark>);
    start = index + match[0].length;
  }
  parts.push(text.slice(start));
  return <>{parts}</>;
}

export function WritingComparison() {
  const { state } = useStudy();
  const [firstId, setFirstId] = useState('');
  const [secondId, setSecondId] = useState('');
  const samples = [...state.attempts].filter(attempt => attempt.stage === 'initial' && state.activities.some(activity => activity.id === attempt.activityId && activity.kind !== 'external')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const distinctActivities = new Set(samples.map(sample => sample.activityId));
  const chunks = state.cards.filter(card => !card.archived && card.targetChunk?.trim()).map(card => card.targetChunk!.trim());
  const first = samples.find(sample => sample.id === firstId);
  const second = samples.find(sample => sample.id === secondId);

  function label(attempt: Attempt) {
    const activity = state.activities.find(item => item.id === attempt.activityId);
    const lesson = state.lessons.find(item => item.id === activity?.lessonId);
    return `${dateLabel(attempt.createdAt, true)} · ${lesson?.title ?? 'Aula'} · ${activity?.title ?? 'Resposta'}`;
  }

  return <section className="writing-evidence comparison-section">
    <div className="section-title"><div><h2>Compare suas primeiras respostas</h2><p className="muted">Escolha duas tarefas parecidas. Os destaques mostram palavras usadas; não são uma nota de inglês.</p></div></div>
    {distinctActivities.size < 2 ? <p className="muted">Duas primeiras respostas em atividades diferentes são necessárias para esta comparação.</p> : <>
      <div className="form-grid comparison-selectors">
        <label className="field"><span>Primeiro texto</span><select value={firstId} onChange={event => {
          const nextId = event.target.value;
          setFirstId(nextId);
          const nextActivityId = samples.find(sample => sample.id === nextId)?.activityId;
          if (samples.find(sample => sample.id === secondId)?.activityId === nextActivityId) setSecondId('');
        }}><option value="">Escolha uma resposta</option>{samples.map(sample => <option key={sample.id} value={sample.id}>{label(sample)}</option>)}</select></label>
        <label className="field"><span>Segundo texto</span><select value={secondId} onChange={event => setSecondId(event.target.value)}><option value="">Escolha outra resposta</option>{samples.filter(sample => sample.activityId !== first?.activityId).map(sample => <option key={sample.id} value={sample.id}>{label(sample)}</option>)}</select></label>
      </div>
      {first && second && first.id !== second.id && <div className="comparison-pair">
        {[first, second].map(sample => <article key={sample.id}><p className="eyebrow">{label(sample)}</p><p lang="en"><HighlightedText text={sample.text} chunks={chunks} /></p></article>)}
      </div>}
      <p className="muted small">Azul: conectivos. Verde: expressões alvo cadastradas nos cartões. Compare clareza e adequação ao contexto com o tutor.</p>
    </>}
  </section>;
}
