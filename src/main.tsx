import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/app.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<App />);
