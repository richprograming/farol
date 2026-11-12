// Tarefas agendadas.

import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

// Agente Vigia: confere a tabela oficial de cClassTrib todo dia às 6h de Brasília (9h UTC).
crons.daily('vigia: tabela oficial de cClassTrib', { hourUTC: 9, minuteUTC: 0 }, internal.vigia.verificarDiario, {});

export default crons;
