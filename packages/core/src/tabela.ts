// Tabela de classificação (cClassTrib) usada nas contas.
//
// Duas formas:
//   - TabelaClassificacao: a que as contas usam (regras por NCM, cada uma com seus tratamentos).
//   - TabelaCompacta: a que é guardada (tratamentos uma vez só, regras apontando por código e
//     textos sem repetição). A tabela oficial tem ~1.700 NCMs e não caberia num documento
//     do banco na forma expandida.

export interface Tratamento {
  cClassTrib: string;
  descricao: string;
  reducao: number; // fração da alíquota reduzida (0.6 = redução de 60%; 1 = alíquota zero)
  baseLegal: string; // texto curto + referência, exibido como citação
  /** A conta do Farol não modela a mecânica deste código (diferimento, monofásica…): o item vai para revisão. */
  ressalva?: string;
}

export interface RegraClassificacao {
  ncmPrefixo: string; // casa com o início do NCM (2, 4, 6 ou 8 dígitos)
  tratamentos: Tratamento[]; // mais de um = depende do produto → revisão
  criterio?: string; // o que decide entre os tratamentos (mostrado ao contador)
}

export interface TabelaClassificacao {
  /** Usado quando o NCM não está em nenhuma regra (tributação integral). */
  padrao: Tratamento;
  regras: RegraClassificacao[];
  /** Códigos válidos que não dependem de NCM: aceitos quando vêm na nota ou na revisão. */
  avulsos: Tratamento[];
}

export interface TabelaCompacta {
  padrao: string;
  tratamentos: Tratamento[];
  textos: string[];
  regras: { ncm: string; codigos: string[]; textos?: number[] }[];
}

export function compactarTabela(t: TabelaClassificacao): TabelaCompacta {
  const tratamentos = new Map<string, Tratamento>();
  const guardar = (x: Tratamento) => {
    const ja = tratamentos.get(x.cClassTrib);
    if (ja && JSON.stringify(ja) !== JSON.stringify(x)) {
      throw new Error(`cClassTrib ${x.cClassTrib} aparece com dois conteúdos diferentes na tabela.`);
    }
    tratamentos.set(x.cClassTrib, x);
  };
  guardar(t.padrao);
  const textos: string[] = [];
  const indiceTexto = new Map<string, number>();
  const regras = t.regras.map((r) => {
    r.tratamentos.forEach(guardar);
    const regra: TabelaCompacta['regras'][number] = { ncm: r.ncmPrefixo, codigos: r.tratamentos.map((x) => x.cClassTrib) };
    if (r.criterio !== undefined) {
      // Linha a linha: na tabela oficial os critérios de NCMs diferentes repetem as mesmas linhas.
      regra.textos = r.criterio.split('\n').map((linha) => {
        let i = indiceTexto.get(linha);
        if (i === undefined) {
          i = textos.push(linha) - 1;
          indiceTexto.set(linha, i);
        }
        return i;
      });
    }
    return regra;
  });
  t.avulsos.forEach(guardar);
  return { padrao: t.padrao.cClassTrib, tratamentos: [...tratamentos.values()], textos, regras };
}

export function expandirTabela(c: TabelaCompacta): TabelaClassificacao {
  const porCodigo = new Map(c.tratamentos.map((t) => [t.cClassTrib, t]));
  const pegar = (codigo: string) => {
    const t = porCodigo.get(codigo);
    if (!t) throw new Error(`Tabela inconsistente: a regra cita o cClassTrib ${codigo}, que não está na lista.`);
    return t;
  };
  const usados = new Set<string>([c.padrao]);
  const regras = c.regras.map((r): RegraClassificacao => {
    r.codigos.forEach((x) => usados.add(x));
    const regra: RegraClassificacao = { ncmPrefixo: r.ncm, tratamentos: r.codigos.map(pegar) };
    if (r.textos) regra.criterio = r.textos.map((i) => c.textos[i]).join('\n');
    return regra;
  });
  return { padrao: pegar(c.padrao), regras, avulsos: c.tratamentos.filter((t) => !usados.has(t.cClassTrib)) };
}

interface Indice {
  porPrefixo: Map<string, RegraClassificacao>;
  conhecidos: Map<string, Tratamento>;
}

// As contas consultam a tabela uma vez por item de nota; o índice é montado uma vez por tabela.
const indices = new WeakMap<TabelaClassificacao, Indice>();

function indice(t: TabelaClassificacao): Indice {
  let i = indices.get(t);
  if (!i) {
    const porPrefixo = new Map<string, RegraClassificacao>();
    for (const r of t.regras) porPrefixo.set(r.ncmPrefixo, r);
    i = { porPrefixo, conhecidos: todosTratamentos(t) };
    indices.set(t, i);
  }
  return i;
}

/** Regra de prefixo mais longo que casa com o NCM. */
export function regraDoNcm(ncm: string, t: TabelaClassificacao): RegraClassificacao | undefined {
  const { porPrefixo } = indice(t);
  for (let n = ncm.length; n > 0; n--) {
    const r = porPrefixo.get(ncm.slice(0, n));
    if (r) return r;
  }
  return undefined;
}

export function todosTratamentos(t: TabelaClassificacao): Map<string, Tratamento> {
  const m = new Map<string, Tratamento>([[t.padrao.cClassTrib, t.padrao]]);
  for (const r of t.regras) for (const x of r.tratamentos) m.set(x.cClassTrib, x);
  for (const x of t.avulsos) m.set(x.cClassTrib, x);
  return m;
}

export function tratamentoConhecido(t: TabelaClassificacao, cClassTrib: string): Tratamento | undefined {
  return indice(t).conhecidos.get(cClassTrib);
}

/** Linhas do critério da regra que vale para o NCM, direto da forma compacta (sem expandir a tabela). */
export function criterioDoNcm(c: TabelaCompacta, ncm: string): string[] {
  let melhor: TabelaCompacta['regras'][number] | undefined;
  for (const r of c.regras) {
    if (ncm.startsWith(r.ncm) && (!melhor || r.ncm.length > melhor.ncm.length)) melhor = r;
  }
  return (melhor?.textos ?? []).map((i) => c.textos[i]);
}
