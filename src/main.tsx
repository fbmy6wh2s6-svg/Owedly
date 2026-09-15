import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './styles.css';
import './modules.css';
import './customer-detail.css';
import './conversion.css';
import './invoice-detail.css';
import './mobile-nav.css';
import './change-orders.css';
import './customer-approval.css';
import './office-dashboard.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing root element');

createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </React.StrictMode>,
);

import './commerce.css';
