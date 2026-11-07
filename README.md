# Farol

**A reforma tributária, cliente por cliente.** O Farol lê as notas fiscais dos clientes de um escritório contábil, acompanha as mudanças normativas e mostra quais clientes cada mudança afeta, quanto muda em reais e qual aviso mandar. O contador aprova antes de qualquer envio.

Projeto do Hack Brasil 2026.

> **Protótipo.** Os dados em `fixtures/` são sintéticos. A tabela de cClassTrib em `src/core/tabela-exemplo.ts` é um exemplo (códigos `EX…`), não a oficial. As alíquotas a partir de 2027 em `src/core/parametros.ts` são estimativas. Nada aqui é orientação tributária.

## Rodar

Requer Node 22.18 ou mais recente (roda TypeScript direto, sem build). Não há dependências de runtime.

```bash
npm run fixtures   # gera XMLs sintéticos de 4 clientes em fixtures/
npm start          # http://localhost:3000
npm test           # 13 testes (node:test)
npm install && npm run typecheck   # opcional: checagem de tipos
```

Variáveis opcionais:

| Variável | Efeito |
| --- | --- |
| `PORT` | Porta do servidor (padrão 3000) |
| `FAROL_DEMO=0` | Começa com a carteira vazia |
| `FAROL_ESCRITORIO` | Nome do escritório que assina os avisos |
| `RESEND_API_KEY`, `FAROL_REMETENTE` | Envia os avisos de verdade pelo Resend; sem elas, o envio é simulado |
| `FIRECRAWL_API_KEY` | Usada pelo Agente Vigia (`src/integracoes/firecrawl.ts`) |

## Fluxo da demo

1. **Carteira:** clientes ordenados pela variação mensal estimada em 2027. Clique num cliente para ver a projeção 2026–2033, o efeito do split payment e cada produto com seu tratamento e base legal.
2. **Revisão:** produtos cujo NCM admite mais de um tratamento aparecem como "Revisar". A conta usa o tratamento mais conservador até o contador confirmar.
3. **Adicionar cliente:** suba XMLs de NF-e/NFC-e. O cliente é identificado pelo CNPJ que emite as vendas; CPFs de consumidores são mascarados na leitura.
4. **Radar:** mudanças normativas (na demo, duas fictícias). Confirme a leitura e o Farol mostra os clientes afetados, a variação em reais e o rascunho do aviso. **Aprovar e enviar** manda pelo Resend.

## Arquitetura

```
src/core/            regras e contas, sem IA, sem dependências
  xml.ts             parser XML mínimo
  nfe.ts             leitura de NF-e/NFC-e + máscara de CPF
  classificar.ts     cClassTrib: revisão do contador > nota > tabela > fila de revisão; hook SugestorIA
  analise.ts         projeção 2026–2033, split payment, ranking da carteira
  mudancas.ts        mudança normativa → clientes afetados (Agente Impacto)
  aviso.ts           rascunho do aviso ao cliente (Comunicador)
  parametros.ts      alíquotas e calendário da transição (ESTIMATIVAS marcadas)
  tabela-exemplo.ts  tabela de classificação de EXEMPLO
src/integracoes/
  firecrawl.ts       Agente Vigia: change tracking da API v2 + interface ExtratorMudanca
  resend.ts          envio de avisos aprovados
src/server/          servidor node:http de demonstração, estado em memória
public/              interface em JavaScript puro
scripts/gerar-xmls.ts  gerador de XMLs sintéticos
test/                testes
```

Princípio: **a IA lê, classifica, vigia e redige; o motor faz as contas; o contador aprova.** Nenhum número exibido sai de um LLM.

### Premissas da projeção

- Base de CBS/IBS = valor do item (vProd − vDesc).
- Crédito de CBS/IBS só sobre as compras com nota enviadas.
- ICMS de hoje = destacado nas vendas − destacado nas compras; PIS/Cofins cumulativos, sem crédito.
- ISS fora da conta (não aparece em NF-e de mercadorias).
- Simples Nacional/MEI: o DAS não está nas notas, então a projeção só simula o regime regular para avaliar a opção.
- Split payment: o débito de CBS/IBS deixa de ficar ~25 dias no caixa (premissa editável por cliente).

## Próximos passos

- [ ] Trocar `tabela-exemplo.ts` pela tabela oficial de cClassTrib e pelos anexos da LC 214/2025, com versão
- [ ] Trocar `parametros.ts` pelas alíquotas oficiais quando publicadas
- [ ] Implementar `SugestorIA` (LLM + RAG nos anexos da LC 214) e medir no conjunto-ouro
- [ ] Implementar `ExtratorMudanca` (LLM extrai a `Mudanca` do diff do Firecrawl) e definir as URLs exatas das fontes
- [ ] Migrar estado para Convex (tabelas: escritórios, clientes, notas, revisões, mudanças, envios; tarefa agendada diária do Vigia)
- [ ] Login com WorkOS; cobrança com AbacatePay
- [ ] Aceitar ZIP de XMLs e leitura de SPED
