import { errorTypeLabels } from '../errorTypes';
import { dateLabel } from '../helpers';
import { useStudy } from '../store';
import { externalModalityLabels } from './ExternalPractice';

export function ExternalHistory() {
  const { state } = useStudy();
  const logs = [...state.externalLogs].sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
  return <section className="writing-evidence external-history"><div className="section-title"><div><h2>Práticas fora do app</h2><p className="muted">Registros avulsos que você confirmou; sem nota de fala ou pronúncia.</p></div></div>
    {logs.length ? <div className="external-history-list">{logs.slice(0, 20).map(log => <div key={log.id}><strong>{externalModalityLabels[log.modality]}</strong><span>{dateLabel(log.loggedAt, true)} · {log.minutes === null ? 'tempo não informado' : `${log.minutes} min`}</span>{log.chunkApplied && <small>Expressão: {log.chunkApplied}</small>}</div>)}</div> : <p className="muted">Nenhuma prática avulsa registrada ainda.</p>}
  </section>;
}

export function ErrorPatterns() {
  const { state } = useStudy();
  const tagged = state.feedback.filter(feedback => state.feedbackErrorTypes[feedback.id]);
  return <section className="writing-evidence error-patterns"><div className="section-title"><div><h2>Padrões para observar</h2><p className="muted">Categorias confirmadas nas correções, sem estimar nível ou desempenho.</p></div></div>
    {tagged.length ? <div className="error-pattern-list">{Object.entries(errorTypeLabels).map(([type, label]) => {
      const items = tagged.filter(feedback => state.feedbackErrorTypes[feedback.id] === type);
      if (!items.length) return null;
      return <details key={type}><summary>{label} · {items.length} {items.length === 1 ? 'registro' : 'registros'}</summary>{items.map(feedback => {
        const attempt = state.attempts.find(item => item.id === feedback.attemptId);
        return <div key={feedback.id} className="error-example"><span className="eyebrow">{attempt ? dateLabel(attempt.createdAt, true) : 'Correção'}</span>{attempt && <p lang="en">Sua frase: {attempt.text}</p>}{feedback.correctedText && <p lang="en">Versão corrigida: {feedback.correctedText}</p>}<p>{feedback.text}</p></div>;
      })}</details>;
    })}</div> : <p className="muted">Quando você confirmar uma categoria em uma correção, ela aparecerá aqui com a frase original.</p>}
  </section>;
}

export function TutorInsights() {
  const { state } = useStudy();
  const explanations = state.feedback.filter(item => item.kind === 'correction' && (item.ruleExplanation?.trim() || item.targetChunk?.trim()));
  return <section className="writing-evidence"><div className="section-title"><div><h2>Regras e expressões trabalhadas</h2><p className="muted">Orientações registradas pelo tutor. Estar nesta lista ainda não significa domínio.</p></div></div>
    {explanations.length ? <div className="error-pattern-list">{[...explanations].reverse().slice(0, 20).map(item => {
      const attempt = state.attempts.find(answer => answer.id === item.attemptId);
      const activity = state.activities.find(task => task.id === attempt?.activityId);
      return <div className="error-example" key={item.id}><span className="eyebrow">{dateLabel(item.createdAt, true)}{activity ? ` · ${activity.title}` : ''}</span>{item.targetChunk && <p lang="en"><strong>Expressão:</strong> {item.targetChunk}</p>}{item.ruleExplanation && <p><strong>Por quê:</strong> {item.ruleExplanation}</p>}</div>;
    })}</div> : <p className="muted">Quando o tutor registrar uma explicação ou expressão alvo, ela aparecerá aqui.</p>}
  </section>;
}
