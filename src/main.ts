import './styles.css';
import { inject } from '@vercel/analytics';
import { PhaseFieldApp } from './app/App';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('Missing #app root element.');
}

const app = new PhaseFieldApp(root);
app.start();
inject();
