import { useEffect, useState } from 'react';
import { BookOpen, CalendarDays, Layers2, Library, ChartNoAxesCombined, Settings2, Laptop, ArrowUpRight, Mic } from 'lucide-react';
import { StudyProvider, useStudy } from './store';
import { Home } from './pages/Home';
import { Lessons } from './pages/Lessons';
import { Review } from './pages/Review';
import { LibraryPage } from './pages/Library';
import { Evolution } from './pages/Evolution';
import { SettingsPage } from './pages/Settings';
import { ExternalPractice } from './pages/ExternalPractice';
import { Warmup } from './pages/Warmup';
import { today } from './helpers';
import { getWarmupCard } from '../core/metrics';
import { UpdateBanner } from './update';

export type Page = 'home' | 'lessons' | 'review' | 'library' | 'evolution' | 'settings';
const nav = [
  { id: 'home', label: 'Hoje', icon: CalendarDays },
  { id: 'lessons', label: 'Aulas', icon: BookOpen },
  { id: 'review', label: 'Revisar', icon: Layers2 },
  { id: 'library', label: 'Biblioteca', icon: Library },
  { id: 'evolution', label: 'Evolução', icon: ChartNoAxesCombined },
  { id: 'settings', label: 'Ajustes', icon: Settings2 },
] as const;

function Notebook() {
  const { state, system } = useStudy();
  const [page, setPage] = useState<Page>('home');
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [pendingLesson, setPendingLesson] = useState<string | null>(null);
  const [externalOpen, setExternalOpen] = useState(false);
  const dueCards = state.cards.filter(card => !card.archived && card.dueDate <= today()).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt));
  const warmupCard = getWarmupCard(state);

  useEffect(() => {
    if (pendingLesson && !warmupCard) {
      setLessonId(pendingLesson);
      setPendingLesson(null);
    }
  }, [pendingLesson, warmupCard]);

  function openLesson(id: string) {
    setPage('lessons');
    if (warmupCard) {
      setLessonId(null);
      setPendingLesson(id);
    } else {
      setLessonId(id);
      setPendingLesson(null);
    }
    document.querySelector('main')?.scrollTo(0, 0);
  }

  function navigate(nextPage: Page, lesson?: string) {
    if (nextPage === 'lessons' && lesson) { openLesson(lesson); return; }
    setPage(nextPage);
    setLessonId(null);
    setPendingLesson(null);
    document.querySelector('main')?.scrollTo(0, 0);
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate('home')} aria-label="Caderno — início">
        <span className="brand-mark"><BookOpen size={25} strokeWidth={1.5} /></span>
        <span>Caderno<small>YOUR ENGLISH, IN PROGRESS</small></span>
      </button>
      <div className="sidebar-section-label">MEU ESPAÇO</div>
      <nav aria-label="Navegação principal">{nav.map(({ id, label, icon: Icon }) =>
        <button key={id} className={page === id ? 'nav-item active' : 'nav-item'} aria-current={page === id ? 'page' : undefined} onClick={() => navigate(id)} data-testid={'nav-' + id}>
          <Icon size={19} strokeWidth={1.6} /><span>{label}</span>{id === 'review' && dueCards.length > 0 && <span className="nav-count">{dueCards.length}</span>}
        </button>
      )}</nav>
      <div className="sidebar-bottom">
        <div className="tutor-note">
          <span className="eyebrow">UMA CONVERSA DE CADA VEZ</span>
          <p>Seu tutor continua no chat.</p>
          <button onClick={() => void system('copyTutorPrompt', { lessonId: lessonId ?? '' })} className="text-arrow">Levar contexto <ArrowUpRight size={16} /></button>
          <button onClick={() => setExternalOpen(true)} className="text-arrow external-shortcut"><Mic size={16} /> Registrar prática externa</button>
        </div>
        <div className="profile"><span className="avatar">{state.settings.name.charAt(0).toUpperCase() || 'M'}</span><div><strong>{state.settings.name || 'Meu caderno'}</strong><span><Laptop size={12} /> Salvo neste computador</span></div></div>
      </div>
    </aside>
    <main id="main-content">
      <div className="topbar"><span>CADERNO PESSOAL DE INGLÊS</span><span className="local-status"><i /> Uso local · offline</span></div>
      <UpdateBanner />
      <div className="page-content">
        {page === 'home' && <Home navigate={navigate} onExternal={() => setExternalOpen(true)} />}
        {page === 'lessons' && <Lessons selectedId={lessonId} onSelect={id => id ? openLesson(id) : setLessonId(null)} />}
        {page === 'review' && <Review />}
        {page === 'library' && <LibraryPage />}
        {page === 'evolution' && <Evolution />}
        {page === 'settings' && <SettingsPage />}
      </div>
    </main>
    {pendingLesson && warmupCard && <Warmup key={warmupCard.id} card={warmupCard} onCancel={() => setPendingLesson(null)} onFinished={() => { setLessonId(pendingLesson); setPendingLesson(null); }} />}
    {externalOpen && <ExternalPractice onClose={() => setExternalOpen(false)} />}
  </div>;
}

export default function App() { return <StudyProvider><Notebook /></StudyProvider>; }
