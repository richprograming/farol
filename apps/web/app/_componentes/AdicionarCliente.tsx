'use client';

import { useAction } from 'convex/react';
import { useState, type FormEvent } from 'react';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

const LOTE_BYTES = 4 * 1024 * 1024; // abaixo do limite da action (6 MB)

export function AdicionarCliente({ aoFechar, aoImportar }: { aoFechar: () => void; aoImportar: (id: Id<'clientes'>) => void }) {
  const importar = useAction(api.notas.importar);
  const [status, setStatus] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const arquivos = [...((form.elements.namedItem('arquivos') as HTMLInputElement).files ?? [])];
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    if (!arquivos.length) return;
    setEnviando(true);
    let cnpj: string | undefined;
    let clienteId: Id<'clientes'> | null = null;
    let lidas = 0, novas = 0, duplicadas = 0;
    const erros: { arquivo: string; erro: string }[] = [];
    try {
      let lote: { nome: string; conteudo: string }[] = [];
      let tamanho = 0;
      const mandar = async () => {
        if (!lote.length) return;
        setStatus(`Lendo notas… ${lidas + lote.length} de ${arquivos.length}`);
        const r = await importar({ xmls: lote, cnpj, email });
        cnpj = r.cnpj ?? cnpj;
        clienteId = r.clienteId ?? clienteId;
        lidas += r.lidas; novas += r.novas; duplicadas += r.duplicadas;
        erros.push(...r.erros);
        lote = []; tamanho = 0;
      };
      for (const f of arquivos) {
        const conteudo = await f.text();
        if (tamanho + conteudo.length > LOTE_BYTES) await mandar();
        lote.push({ nome: f.name, conteudo });
        tamanho += conteudo.length;
      }
      await mandar();
      const partes = [`${lidas} nota(s) lida(s), ${novas} nova(s)`];
      if (duplicadas) partes.push(`${duplicadas} já estavam na carteira`);
      if (erros.length) partes.push(`${erros.length} com erro (${erros.slice(0, 3).map((x) => `${x.arquivo}: ${x.erro}`).join('; ')})`);
      setStatus(`${partes.join(', ')}.`);
      if (clienteId) aoImportar(clienteId);
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="cartao envio" onSubmit={enviar}>
      <h2>Adicionar notas de um cliente</h2>
      <p className="sub">
        Selecione os XMLs de NF-e e NFC-e (vendas e, se tiver, compras) de 3 a 12 meses. O cliente é identificado pelo CNPJ
        que emite as vendas. CPFs de consumidores são mascarados na leitura, e o XML não é guardado: só os itens.
      </p>
      <label>Arquivos XML <input type="file" name="arquivos" accept=".xml,text/xml" multiple required /></label>
      <label>E-mail do cliente (para avisos) <input type="email" name="email" placeholder="financeiro@cliente.com.br" /></label>
      <div className="acoes">
        <button className="botao" type="submit" disabled={enviando}>{enviando ? 'Lendo…' : 'Ler notas'}</button>
        <button className="botao secundario" type="button" onClick={aoFechar}>Fechar</button>
      </div>
      <p className="sub" role="status">{status}</p>
    </form>
  );
}
