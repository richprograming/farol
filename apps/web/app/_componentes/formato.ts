import { ConvexError } from 'convex/values';

export const brl = (v: number | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const sinal = (v: number) => (v > 0 ? `+${brl(v)}` : brl(v));
export const data = (iso: string) => iso.split('-').reverse().join('/');
export const formatarCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

export const REGIME: Record<string, string> = { normal: 'Regime normal', simples: 'Simples Nacional', mei: 'MEI', desconhecido: '—' };

export const STATUS: Record<string, [string, string]> = {
  revisado: ['Revisado', 'bom'], da_nota: ['Da nota', ''], tabela: ['Tabela', ''], padrao: ['Integral', ''], revisar: ['Revisar', 'alerta'],
};

/** Mensagem legível de um erro vindo do Convex (ConvexError traz o texto em `data`). */
export const mensagemDeErro = (e: unknown) =>
  e instanceof ConvexError ? String(e.data) : e instanceof Error ? e.message : 'Erro inesperado.';
