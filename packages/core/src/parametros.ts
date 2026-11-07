// Parâmetros da transição da reforma tributária (EC 132/2023 e LC 214/2025).
//
// IMPORTANTE: os valores marcados `estimativa: true` NÃO são definitivos.
// As alíquotas de referência da CBS e do IBS ainda serão fixadas; os números
// abaixo servem para a projeção funcionar e devem ser trocados pelos oficiais.
// Toda projeção exibe a versão destes parâmetros para o contador saber a base.

export interface AnoTransicao {
  ano: number;
  cbs: number; // alíquota CBS (fração, 0.009 = 0,9%)
  ibs: number; // alíquota IBS (fração)
  pisCofinsExiste: boolean;
  fracaoIcmsIss: number; // 1 = alíquotas atuais; 0.9 = 90% delas; 0 = extintos
  compensavel: boolean; // 2026: CBS/IBS compensáveis com PIS/Cofins (sem aumento de carga)
  estimativa: boolean;
  nota: string;
}

export const VERSAO_PARAMETROS = '2026-11-07-exemplo';

// Alíquotas de referência usadas a partir de 2027 / 2033. ESTIMATIVAS.
export const CBS_REFERENCIA = 0.088; // 8,8% citado por fontes do setor como referência para 2027
export const IBS_REFERENCIA = 0.177; // estimativa de trabalho; substituir pela oficial

export const TRANSICAO: AnoTransicao[] = [
  { ano: 2026, cbs: 0.009, ibs: 0.001, pisCofinsExiste: true, fracaoIcmsIss: 1, compensavel: true, estimativa: false,
    nota: 'Ano de teste: CBS 0,9% e IBS 0,1% destacados e compensáveis com PIS/Cofins.' },
  { ano: 2027, cbs: CBS_REFERENCIA, ibs: 0.001, pisCofinsExiste: false, fracaoIcmsIss: 1, compensavel: false, estimativa: true,
    nota: 'CBS passa a ser cobrada; PIS/Cofins extintos. IBS segue simbólico.' },
  { ano: 2028, cbs: CBS_REFERENCIA, ibs: 0.001, pisCofinsExiste: false, fracaoIcmsIss: 1, compensavel: false, estimativa: true,
    nota: 'Como 2027.' },
  { ano: 2029, cbs: CBS_REFERENCIA, ibs: IBS_REFERENCIA * 0.1, pisCofinsExiste: false, fracaoIcmsIss: 0.9, compensavel: false, estimativa: true,
    nota: 'ICMS e ISS a 90%; IBS começa a subir.' },
  { ano: 2030, cbs: CBS_REFERENCIA, ibs: IBS_REFERENCIA * 0.2, pisCofinsExiste: false, fracaoIcmsIss: 0.8, compensavel: false, estimativa: true,
    nota: 'ICMS e ISS a 80%.' },
  { ano: 2031, cbs: CBS_REFERENCIA, ibs: IBS_REFERENCIA * 0.3, pisCofinsExiste: false, fracaoIcmsIss: 0.7, compensavel: false, estimativa: true,
    nota: 'ICMS e ISS a 70%.' },
  { ano: 2032, cbs: CBS_REFERENCIA, ibs: IBS_REFERENCIA * 0.4, pisCofinsExiste: false, fracaoIcmsIss: 0.6, compensavel: false, estimativa: true,
    nota: 'ICMS e ISS a 60%.' },
  { ano: 2033, cbs: CBS_REFERENCIA, ibs: IBS_REFERENCIA, pisCofinsExiste: false, fracaoIcmsIss: 0, compensavel: false, estimativa: true,
    nota: 'ICMS e ISS extintos; IBS pleno.' },
];

export function parametrosDoAno(ano: number): AnoTransicao {
  const p = TRANSICAO.find((t) => t.ano === ano);
  if (!p) throw new RangeError(`Sem parâmetros para ${ano} (use 2026 a 2033)`);
  return p;
}

// Premissa do split payment: hoje o tributo sobre a venda é recolhido, em média,
// este número de dias depois do recebimento. Com o split, esse prazo vai a zero.
// Valor editável por cliente; o padrão é uma premissa, não um dado.
export const DIAS_FLOAT_PADRAO = 25;
