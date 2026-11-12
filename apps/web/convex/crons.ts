// Tarefas agendadas.

import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

// Agente Vigia: confere a tabela oficial de cClassTrib todo dia às 6h de Brasília (9h UTC).
crons.daily('vigia: tabela oficial de cClassTrib', { hourUTC: 9, minuteUTC: 0 }, internal.vigia.verificarDiario, {});

// Resumo diário das pendências para o dono de cada escritório, às 7h30 de Brasília (só com Resend configurado).
crons.daily('resumo diário das pendências', { hourUTC: 10, minuteUTC: 30 }, internal.resumo.enviarDiario, {});

export default crons;
