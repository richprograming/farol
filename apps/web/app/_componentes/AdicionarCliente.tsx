'use client';

import { useAction } from 'convex/react';
import { useState, type FormEvent } from 'react';
import { lerZip, ZipInvalidoError } from '@farol/core/zip';

import { mensagemDeErro } from './formato';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

const LOTE_BYTES = 4 * 1024 * 1024; // abaixo do limite da action (6 MB)

interface ErroArquivo { arquivo: string; erro: string }
interface Relatorio { lidas: number; novas: number; duplicadas: number; erros: ErroArquivo[] }

/** CSV do relatório de erros, para o contador devolver ao cliente o que precisa ser reenviado. */
function csvDeErros(erros: ErroArquivo[]): string {
  const campo = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return '﻿' + ['arquivo;erro', ...erros.map((e) => `${campo(e.arquivo)};${campo(e.erro)}`)].join('\r\n');
}

export function AdicionarCliente({ aoFechar, aoImportar }: { aoFechar: () => void; aoImportar: (id: Id<'clientes'>) => void }) {
  const importar = useAction(api.notas.importar);
  const [status, setStatus] = useState('');
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const arquivos = [...((form.elements.namedItem('arquivos') as HTMLInputElement).files ?? [])];
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    if (!arquivos.length) return;
    setEnviando(true);
    setRelatorio(null);
    let cnpj: string | undefined;
    let clienteId: Id<'clientes'> | null = null;
    const r: Relatorio = { lidas: 0, novas: 0, duplicadas: 0, erros: [] };
    let enviados = 0;
    try {
      let lote: { nome: string; conteudo: string }[] = [];
      let tamanho = 0;
      const mandar = async () => {
        if (!lote.length) return;
        enviados += lote.length;
        setStatus(`Lendo notas… ${enviados} arquivo(s) enviados`);
        const resp = await importar({ xmls: lote, cnpj, email });
        cnpj = resp.cnpj ?? cnpj;
        clienteId = resp.clienteId ?? clienteId;
        r.lidas += resp.lidas; r.novas += resp.novas; r.duplicadas += resp.duplicadas;
        r.erros.push(...resp.erros);
        lote = []; tamanho = 0;
      };
      const juntar = async (nome: string, conteudo: string) => {
        if (conteudo.length > LOTE_BYTES) {
          r.erros.push({ arquivo: nome, erro: 'Arquivo grande demais para ser uma nota fiscal.' });
          return;
        }
        if (tamanho + conteudo.length > LOTE_BYTES) await mandar();
        lote.push({ nome, conteudo });
        tamanho += conteudo.length;
      };
      for (const f of arquivos) {
        if (!f.name.toLowerCase().endsWith('.zip')) {
          await juntar(f.name, await f.text());
          continue;
        }
        // O ZIP é aberto aqui, no navegador: para o servidor vão só os XMLs, como no envio avulso.
        setStatus(`Abrindo ${f.name}…`);
        try {
          const entradas = await lerZip(new Uint8Array(await f.arrayBuffer()));
          if (entradas.length === 0) r.erros.push({ arquivo: f.name, erro: 'O ZIP não tem arquivos .xml.' });
          for (const x of entradas) {
            const nome = `${f.name}/${x.nome}`;
            if (x.dados) await juntar(nome, new TextDecoder().decode(x.dados));
            else r.erros.push({ arquivo: nome, erro: x.erro ?? 'Falha ao ler o arquivo.' });
          }
        } catch (err) {
          r.erros.push({ arquivo: f.name, erro: err instanceof ZipInvalidoError ? err.message : 'Não foi possível abrir o ZIP.' });
        }
      }
      await mandar();
      const partes = [`${r.lidas} nota(s) lida(s), ${r.novas} nova(s)`];
      if (r.duplicadas) partes.push(`${r.duplicadas} já estavam na carteira`);
      if (r.erros.length) partes.push(`${r.erros.length} arquivo(s) com erro`);
      setStatus(`${partes.join(', ')}.`);
      setRelatorio(r);
      if (clienteId) aoImportar(clienteId);
    } catch (err) {
      setStatus(mensagemDeErro(err));
      if (r.erros.length) setRelatorio(r);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="cartao envio" onSubmit={enviar}>
      <h2>Adicionar notas de um cliente</h2>
      <p className="sub">
        Selecione os XMLs de NF-e e NFC-e (vendas e, se tiver, compras) de 3 a 12 meses, soltos ou dentro de um ZIP. O cliente é
        identificado pelo CNPJ que emite as vendas. CPFs de consumidores são mascarados na leitura, e nem o XML nem o ZIP são
        guardados: só os itens.
      </p>
      <label>Arquivos XML ou ZIP <input type="file" name="arquivos" accept=".xml,text/xml,.zip,application/zip" multiple required /></label>
      <label>E-mail do cliente (para avisos) <input type="email" name="email" placeholder="financeiro@cliente.com.br" /></label>
      <div className="acoes">
        <button className="botao" type="submit" disabled={enviando}>{enviando ? 'Lendo…' : 'Ler notas'}</button>
        <button className="botao secundario" type="button" onClick={aoFechar}>Fechar</button>
      </div>
      <p className="sub" role="status">{status}</p>
      {relatorio && relatorio.erros.length > 0 && (
        <details className="relatorio-erros" open={relatorio.erros.length <= 10}>
          <summary>
            {relatorio.erros.length} arquivo(s) não entraram{' '}
            <a download="farol-erros-de-importacao.csv"
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(csvDeErros(relatorio.erros))}`}>baixar relatório (CSV)</a>
          </summary>
          <table className="tabela">
            <thead><tr><th>Arquivo</th><th>Motivo</th></tr></thead>
            <tbody>{relatorio.erros.map((x, i) => <tr key={`${x.arquivo}-${i}`}><td>{x.arquivo}</td><td>{x.erro}</td></tr>)}</tbody>
          </table>
        </details>
      )}
    </form>
  );
}
