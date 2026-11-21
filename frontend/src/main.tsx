import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Reliability } from './features/ats-reliability/Reliability.tsx';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="workspace">
      <header className="masthead">
        <div className="brand"><span className="brand-mark" aria-hidden="true">fda</span> Delivery Assurance Lab</div>
        <span className="environment"><span aria-hidden="true" /> Synthetic data</span>
      </header>
      <main>
        <Reliability />
      </main>
      <footer>Independent engineering assessment</footer>
    </div>
  </StrictMode>,
);
