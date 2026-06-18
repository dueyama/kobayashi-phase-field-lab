import './styles.css';
import { PhaseFieldApp } from './app/App';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('Missing #app root element.');
}

const app = new PhaseFieldApp(root);
app.start();
