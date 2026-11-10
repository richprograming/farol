# Farol

**A reforma tributária, cliente por cliente.** O Farol lê as notas fiscais dos clientes de um escritório contábil, acompanha as mudanças normativas e mostra quais clientes cada mudança afeta, quanto muda em reais e qual aviso mandar. O contador aprova antes de qualquer envio.

Projeto do Hack Brasil 2026.

> **Protótipo.** Os dados de demonstração (`packages/core/src/sinteticos.ts`) são sintéticos. A tabela de cClassTrib em `packages/core/src/tabela-exemplo.ts` é um exemplo (códigos `EX…`), não a oficial. As alíquotas a partir de 2027 em `packages/core/src/parametros.ts` são estimativas. Nada aqui é orientação tributária.

## Rodar

Requer Node 22.18 ou mais recente.

1. **WorkOS (login).** No painel do WorkOS, em *Redirects*, cadastre `http://localhost:3000/callback` como Redirect URI e `http://localhost:3000` como Sign-out URI. Depois crie `apps/web/.env.local` com:

   ```sh
   WORKOS_CLIENT_ID=client_...
   WORKOS_API_KEY=sk_test_...
   WORKOS_COOKIE_PASSWORD=...   # 32+ caracteres: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback
   ```

2. **Subir:**

   ```bash
   npm install
   npm run convex     # terminal 1: back-end Convex (na 1ª vez, escolha rodar localmente sem conta; grava NEXT_PUBLIC_CONVEX_URL no .env.local)
   cd apps/web && npx convex env set WORKOS_CLIENT_ID client_...   # uma vez: o Convex valida o token do WorkOS
   npm run dev        # terminal 2: http://localhost:3000
   ```

3. **Entrar.** O 1º login pede o nome do escritório e cria o escritório com você como dono. Com a carteira vazia, **Carregar carteira de demonstração** traz 4 clientes sintéticos e 2 mudanças fictícias; **Recomeçar demonstração** apaga tudo (só se a carteira for 100% sintética).

Checagens (as mesmas do CI):

```bash
npm run typecheck  # core + Next.js + funções do Convex
npm test           # 15 testes do core (node:test) + 10 das funções do Convex (convex-test)
npm run build      # build do Next.js
```

Sem conta no Convex, o `convex dev` roda um back-end local (dados em `apps/web/.convex/`). Em ambiente não interativo, use `CONVEX_AGENT_MODE=anonymous npm run convex`.

Variáveis de ambiente das funções do Convex (`npx convex env set NOME valor`, em `apps/web`):

| Variável | Efeito |
| --- | --- |
| `WORKOS_CLIENT_ID` | Obrigatória: o Convex só aceita tokens emitidos para este client (`convex/auth.config.ts`) |
| `RESEND_API_KEY`, `FAROL_REMETENTE` | Envia os avisos de verdade pelo Resend; sem elas, o envio é simulado e fica registrado como tal |
| `FIRECRAWL_API_KEY` | Usada pelo Agente Vigia (`packages/core/src/integracoes/firecrawl.ts`; ainda não agendado) |

## Fluxo da demo

1. **Carteira:** clientes ordenados pela variação mensal estimada em 2027. Clique num cliente para ver a projeção 2026–2033, o efeito do split payment e cada produto com seu tratamento e base legal.
2. **Revisão:** produtos cujo NCM admite mais de um tratamento aparecem como "Revisar". A conta usa o tratamento mais conservador até o contador confirmar; ao confirmar, a carteira se recalcula e a tela se atualiza sozinha.
3. **Adicionar cliente:** suba XMLs de NF-e/NFC-e. O cliente é o CNPJ que aparece em mais notas (emitente das vendas ou destinatário das compras). CPFs de consumidores são mascarados na leitura, o XML não é guardado (só os itens) e notas repetidas são ignoradas pela chave.
4. **Radar:** mudanças normativas (na demo, duas fictícias). Confirme a leitura e o Farol mostra os clientes afetados, a variação em reais e o rascunho do aviso. **Aprovar e enviar** grava a aprovação e manda pelo Resend. **Incorporar à tabela do escritório** cria uma nova versão da tabela (ex.: `exemplo-0.1+exemplo-fraldas`), que passa a aparecer em cada cálculo.

## Arquitetura

```
packages/core/          @farol/core: regras e contas, sem IA, sem dependências (TypeScript puro, roda no Node)
  src/xml.ts            parser XML mínimo
  src/nfe.ts            leitura de NF-e/NFC-e + máscara de CPF
  src/classificar.ts    cClassTrib: revisão do contador > nota > tabela > fila de revisão; hook SugestorIA
  src/analise.ts        projeção 2026–2033, split payment, ranking da carteira
  src/mudancas.ts       mudança normativa → clientes afetados (Agente Impacto)
  src/aviso.ts          rascunho do aviso ao cliente (Comunicador)
  src/parametros.ts     alíquotas e calendário da transição (ESTIMATIVAS marcadas)
  src/tabela-exemplo.ts tabela de classificação de EXEMPLO
  src/integracoes/      firecrawl.ts (Agente Vigia) e resend.ts (envio de avisos aprovados)
  src/sinteticos.ts     gerador de NF-e sintéticas (usado pelas fixtures dos testes e pela demo)
apps/web/               Next.js (App Router) + Convex
  convex/schema.ts      escritórios, usuários, membros, clientes, notas (itens, sem XML), revisões, mudanças, envios,
                        versões de tabela e de parâmetros; analises e impactos (resultados do motor)
  convex/auth.config.ts aceita os tokens do WorkOS AuthKit
  convex/escritorio.ts  escritorioAtual(): único ponto que decide o escritório (usuário do token → vínculo em `membros`)
  convex/conta.ts       sessão e 1º acesso (cria o escritório; o usuário vira dono)
  convex/demo.ts        carteira de demonstração sintética dentro do escritório do usuário
  convex/motor.ts       recalcula com o core quando notas, revisões, tabela ou mudanças mudam
  convex/notas.ts       entrada de XMLs
  convex/carteira.ts    carteira, detalhe e revisão
  convex/radar.ts       confirmar, incorporar, aprovar e enviar
  proxy.ts              toda página exige login (AuthKit); /callback recebe o retorno
  app/                  telas: Carteira (com detalhe do cliente) e Radar
```

Princípio: **a IA lê, classifica, vigia e redige; o motor faz as contas; o contador aprova.** Nenhum número exibido sai de um LLM: o Convex só executa as funções de `@farol/core` e guarda o resultado com as versões da tabela e dos parâmetros usados.

### Premissas da projeção

- Base de CBS/IBS = valor do item (vProd − vDesc).
- Crédito de CBS/IBS só sobre as compras com nota enviadas.
- ICMS de hoje = destacado nas vendas − destacado nas compras; PIS/Cofins cumulativos, sem crédito.
- ISS fora da conta (não aparece em NF-e de mercadorias).
- Simples Nacional/MEI: o DAS não está nas notas, então a projeção só simula o regime regular para avaliar a opção.
- Split payment: o débito de CBS/IBS deixa de ficar ~25 dias no caixa (premissa editável por cliente).

## Próximos passos

- [x] Repositório público, CI (typecheck, testes, build)
- [x] Migrar para Next.js + Convex, com o núcleo em `packages/core`
- [x] Login com WorkOS AuthKit; cada usuário vinculado a um escritório; todas as consultas filtradas pelo escritório do token
- [ ] Convidar outros membros para o escritório (a tabela `membros` já comporta)
- [ ] Criar conta no Convex para a demo pública (hoje o back-end roda local, sem conta)
- [ ] Importador da tabela oficial de cClassTrib, versionado e com fonte (tarefa 4) — aguarda o arquivo oficial do time
- [ ] Trocar `parametros.ts` pelas alíquotas oficiais quando publicadas
- [ ] `SugestorIA` (LLM + RAG nos anexos da LC 214/2025) e `scripts/avaliar.ts` com o conjunto-ouro (tarefa 5)
- [ ] `ExtratorMudanca`, tarefa diária no Convex e modo "reprocessar" (tarefa 6) — aguarda as URLs exatas das fontes
- [ ] Resend de verdade: domínio, marca do escritório, webhook de entrega/abertura, resumo diário (tarefa 7)
- [ ] Upload de ZIP, relatório de erros por arquivo (tarefa 8)
- [ ] Cobrança com AbacatePay (tarefa 9); roteiro de demo e README em inglês (tarefa 10)
- [ ] Recálculo de carteiras grandes: hoje cada cliente é recalculado inteiro numa action; com dezenas de milhares de notas por cliente, guardar agregados por produto e mês
