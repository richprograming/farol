# Farol

**A reforma tributária, cliente por cliente.** O Farol lê as notas fiscais dos clientes de um escritório contábil, acompanha as mudanças normativas e mostra quais clientes cada mudança afeta, quanto muda em reais e qual aviso mandar. O contador aprova antes de qualquer envio.

Projeto do Hack Brasil 2026. [English version](README.en.md) · [Roteiro da demo de 3 minutos](docs/roteiro-demo.md)

> **Protótipo.** Os dados de demonstração (`packages/core/src/sinteticos.ts`) são sintéticos e são calculados com uma tabela de cClassTrib de EXEMPLO (`packages/core/src/tabela-exemplo.ts`, códigos `EX…`). Clientes reais usam a tabela oficial (veja abaixo). As alíquotas a partir de 2027 em `packages/core/src/parametros.ts` são estimativas. Nada aqui é orientação tributária.

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
npm test           # 45 testes do core (node:test) + 20 das funções do Convex (convex-test)
npm run build      # build do Next.js
```

Sem conta no Convex, o `convex dev` roda um back-end local (dados em `apps/web/.convex/`). Em ambiente não interativo, use `CONVEX_AGENT_MODE=anonymous npm run convex`.

Variáveis de ambiente das funções do Convex (`npx convex env set NOME valor`, em `apps/web`):

| Variável | Efeito |
| --- | --- |
| `WORKOS_CLIENT_ID` | Obrigatória: o Convex só aceita tokens emitidos para este client (`convex/auth.config.ts`) |
| `RESEND_API_KEY`, `FAROL_REMETENTE` | Envia os avisos de verdade pelo Resend; sem elas, o envio é simulado e fica registrado como tal. `FAROL_REMETENTE` é o endereço do domínio verificado no Resend, ex.: `Farol <avisos@seudominio.com.br>` |
| `RESEND_WEBHOOK_SECRET` | Segredo (`whsec_…`) do webhook do Resend, para marcar entrega, abertura e devolução dos avisos |
| `FAROL_URL` | Endereço do app, citado no resumo diário |
| `FAROL_IA_URL`, `FAROL_IA_MODELO`, `FAROL_IA_CHAVE` | Opcionais: ligam a sugestão por LLM (qualquer API compatível com a de chat da OpenAI, inclusive modelo local). Sem elas, a sugestão é por comparação de texto, sem custo |
| `ABACATEPAY_API_KEY`, `ABACATEPAY_PRODUTO_ID`, `ABACATEPAY_WEBHOOK_SECRET` | Cobrança do plano pela AbacatePay (API v2). Sem elas, a página Plano avisa que a cobrança não está configurada |
| `FIRECRAWL_API_KEY` | Reservada para vigiar fontes em texto livre (`packages/core/src/integracoes/firecrawl.ts`; ainda não ligado) |

Webhooks (o endereço é o `NEXT_PUBLIC_CONVEX_SITE_URL` do `.env.local`; precisam de um back-end acessível pela internet, ou seja, de uma conta no Convex):

- Resend: `POST <site>/resend/webhook`, eventos `email.delivered`, `email.opened`, `email.bounced`, `email.complained` e `email.failed`.
- AbacatePay: `POST <site>/abacatepay/webhook?webhookSecret=<segredo>`, webhook v2, evento `checkout.completed`.

## Tabela oficial de cClassTrib

A tabela vem do Portal da Conformidade Fácil (SVRS), página [Classificação Tributária](https://dfe-portal.svrs.rs.gov.br/DFE/ClassificacaoTributaria). Ela traz os CSTs, os cClassTrib com percentual de redução e link da LC 214/2025 e, por código, os NCMs dos anexos com condição, exceções e vigência. O botão "Exportar para JSON" do portal perde os anexos, então o importador lê a própria página.

```bash
npm run tabela:oficial -w @farol/core                  # baixa a página agora
npm run tabela:oficial -w @farol/core -- pagina.html   # ou usa uma cópia salva
```

O comando gera `packages/core/src/tabela-oficial.ts`, que vai para o git, com a versão (`oficial-<publicação mais recente>-<sha256>`), a data do download e o sha256 dos dados extraídos. Escritórios novos começam nessa versão. Uma versão nova não troca a tabela de quem já está usando outra.

Como o Farol usa a tabela (decisões de produto; código em `packages/core/src/oficial.ts`):

- **Entram só os códigos que valem para NF-e/NFC-e** e ainda estão vigentes.
- **NCM listado em anexo sempre vai para revisão.** As opções são a tributação integral (`000001`) e os códigos do anexo. A redução depende de o produto se enquadrar no item do anexo; pão francês e bolo têm o mesmo NCM, por exemplo. Até o contador decidir, a conta usa a integral, e ele vê o texto oficial de cada item.
- **Ressalva para mecânicas que a conta não modela.** Códigos de diferimento, suspensão, monofásica, imunidade etc. recebem uma ressalva e também vão para revisão, porque a conta só modela redução de alíquota.
- **A importação falha em vez de escolher.** Se a fonte trouxer reduções diferentes para IBS e CBS, ou um tipo de permissão desconhecido, a importação para.

## Sugestão de classificação

Para cada produto na fila de revisão, o contador pode pedir uma sugestão de cClassTrib (botão no detalhe do cliente). A sugestão mostra o código, o trecho oficial do anexo em que se apoia e de onde veio. Ela fica numa tabela separada que o motor não lê: **a conta só muda quando o contador confirma**.

- **Padrão, sem custo:** comparação entre as palavras da descrição do produto e o texto oficial dos itens de anexo daquele NCM (`packages/core/src/sugestor.ts`). É determinística. Quando o texto não decide (nenhuma palavra em comum, ou empate entre dois códigos), não sugere nada e diz por quê. O percentual exibido é a aderência ao texto, não uma probabilidade.
- **Opcional, LLM:** com `FAROL_IA_URL` e `FAROL_IA_MODELO`, o pedido vai para um serviço compatível com a API de chat da OpenAI. Vão só NCM, descrição do produto e os textos oficiais. A resposta é descartada se o código não estiver entre os candidatos ou se o trecho citado não existir, letra por letra, no texto enviado; nesse caso vale a comparação de texto.
- **Cache:** por produto (NCM + descrição normalizada) e versão da tabela, dentro do escritório.

Medir o acerto com um conjunto-ouro rotulado por contador (CSV `ncm;descricao;cclasstrib`):

```bash
npm run avaliar -w @farol/core -- ouro.csv          # comparação de texto
npm run avaliar -w @farol/core -- ouro.csv --llm    # LLM configurado nas variáveis FAROL_IA_*
```

O repositório não traz conjunto-ouro: os rótulos têm de vir de um contador.

## Agente Vigia

Todo dia às 6h (Brasília) o Convex baixa a página oficial de cClassTrib, converte com o mesmo código do importador e compara com a tabela de cada escritório (`apps/web/convex/vigia.ts`, `packages/core/src/vigia.ts`). Se houver diferença, cria uma mudança no Radar, **não confirmada**, com o resumo do que mudou (reduções alteradas, códigos novos ou encerrados, NCMs que entraram ou saíram dos anexos). A mudança é a diferença exata entre as duas tabelas, sem IA. A partir daí vale o fluxo do Radar: confirmar, ver clientes afetados, aprovar avisos, incorporar.

- **Verificar agora:** botão no Radar.
- **Reprocessar:** `npx convex run vigia:reprocessar` refaz as mudanças a partir dos últimos dados guardados, sem baixar de novo. Só troca mudanças que o contador ainda não confirmou.
- Escritórios em demonstração (tabela de exemplo) ficam de fora.

## Fluxo da demo

1. **Carteira:** clientes ordenados pela variação mensal estimada em 2027. Clique num cliente para ver a projeção 2026–2033, o efeito do split payment e cada produto com seu tratamento e base legal.
2. **Revisão:** produtos cujo NCM admite mais de um tratamento aparecem como "Revisar". A conta usa o tratamento mais conservador até o contador confirmar; ao confirmar, a carteira se recalcula e a tela se atualiza sozinha.
3. **Adicionar cliente:** suba XMLs de NF-e/NFC-e, soltos ou num ZIP (o ZIP é aberto no navegador; para o servidor vão só os XMLs). Arquivos que não entraram aparecem numa lista com o motivo, que pode ser baixada em CSV. O cliente é o CNPJ que aparece em mais notas (emitente das vendas ou destinatário das compras). CPFs de consumidores são mascarados na leitura, o XML não é guardado (só os itens) e notas repetidas são ignoradas pela chave.
4. **Radar:** mudanças normativas (na demo, duas fictícias). Confirme a leitura e o Farol mostra os clientes afetados, a variação em reais e o rascunho do aviso. **Aprovar e enviar** grava a aprovação e manda pelo Resend, com o nome do escritório no remetente e resposta para quem aprovou; a tela mostra quando o aviso foi entregue e aberto. **Incorporar à tabela do escritório** cria uma nova versão da tabela (ex.: `exemplo-0.2+exemplo-fraldas`), que passa a aparecer em cada cálculo.

**Carregar carteira de demonstração** passa o escritório para a tabela de exemplo, porque as mudanças fictícias usam códigos `EX…`. **Recomeçar demonstração** apaga tudo e volta para a oficial. As duas ações só funcionam sem clientes reais. Enquanto a demonstração está carregada, o upload de clientes reais é recusado, para que dados reais nunca sejam calculados com a tabela de exemplo.

## Arquitetura

```
packages/core/          @farol/core: regras e contas, sem IA, sem dependências (TypeScript puro, roda no Node)
  src/xml.ts            parser XML mínimo
  src/nfe.ts            leitura de NF-e/NFC-e + máscara de CPF
  src/zip.ts            leitor de ZIP (roda no navegador)
  src/classificar.ts    cClassTrib: revisão do contador > nota > tabela > fila de revisão
  src/sugestor.ts       sugestão para a fila de revisão (texto do anexo; LLM opcional), validação e avaliação
  src/vigia.ts          diferença entre duas versões da tabela → mudança para o Radar
  src/analise.ts        projeção 2026–2033, split payment, ranking da carteira
  src/mudancas.ts       mudança normativa → clientes afetados (Agente Impacto)
  src/aviso.ts          rascunho do aviso ao cliente (Comunicador)
  src/parametros.ts     alíquotas e calendário da transição (ESTIMATIVAS marcadas)
  src/tabela.ts         formato da tabela (expandida para as contas, compacta para guardar)
  src/oficial.ts        conversão da página oficial de cClassTrib → tabela do Farol
  src/tabela-oficial.ts GERADO por scripts/importar-cclasstrib.ts (versão, fonte, sha256)
  src/tabela-exemplo.ts tabela de classificação de EXEMPLO (só a demonstração)
  src/integracoes/      resend.ts (envio e webhook), abacatepay.ts (cobrança), firecrawl.ts (fontes em texto livre, não ligado)
  scripts/              importar-cclasstrib.ts (tabela oficial), avaliar.ts (conjunto-ouro), gerar-xmls.ts (fixtures)
  src/sinteticos.ts     gerador de NF-e sintéticas (usado pelas fixtures dos testes e pela demo)
apps/web/               Next.js (App Router) + Convex
  convex/schema.ts      escritórios, usuários, membros, clientes, notas (itens, sem XML), revisões, mudanças, envios,
                        versões de tabela e de parâmetros; analises e impactos (resultados do motor)
  convex/auth.config.ts aceita os tokens do WorkOS AuthKit
  convex/escritorio.ts  escritorioAtual(): único ponto que decide o escritório (usuário do token → vínculo em `membros`)
  convex/conta.ts       sessão e 1º acesso (cria o escritório; o usuário vira dono)
  convex/demo.ts        carteira de demonstração sintética dentro do escritório do usuário
  convex/tabelas.ts     versões base da tabela (oficial para todos; exemplo só na demonstração)
  convex/motor.ts       recalcula com o core quando notas, revisões, tabela ou mudanças mudam
  convex/notas.ts       entrada de XMLs
  convex/carteira.ts    carteira, detalhe e revisão
  convex/radar.ts       confirmar, incorporar, aprovar e enviar; eventos de entrega
  convex/sugestoes.ts   sugestões de classificação (nunca lidas pelo motor)
  convex/vigia.ts       verificação diária da tabela oficial, reprocessar
  convex/resumo.ts      resumo diário das pendências para o dono do escritório
  convex/plano.ts       plano do escritório (AbacatePay)
  convex/http.ts        webhooks do Resend e da AbacatePay
  convex/crons.ts       tarefas diárias (Vigia e resumo)
  proxy.ts              toda página exige login (AuthKit); /callback recebe o retorno
  app/                  telas: Carteira (com detalhe do cliente), Radar e Plano
```

Princípio: **a máquina lê, sugere e vigia; o motor faz as contas; o contador aprova.** Nenhum número exibido sai de um LLM: o Convex só executa as funções de `@farol/core` e guarda o resultado com as versões da tabela e dos parâmetros usados.

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
- [x] Importador da tabela oficial de cClassTrib, versionado e com fonte (tarefa 4); escritórios novos usam a oficial
- [x] Avisar quando sair versão nova da tabela oficial e deixar o escritório trocar: Agente Vigia (tarefa 6)
- [ ] Modelar as mecânicas com ressalva (diferimento, monofásica, suspensão, imunidade); hoje vão para revisão
- [ ] Serviços (NBS) e NFS-e: o importador hoje só usa os NCMs dos anexos
- [ ] Guardar a análise por produto em documentos separados: um cliente com milhares de produtos não cabe num documento só (limite de 1 MB do Convex)
- [ ] Trocar `parametros.ts` pelas alíquotas oficiais quando publicadas
- [x] Sugestão de classificação sem custo (texto do anexo), LLM opcional, validação do trecho citado, cache e `scripts/avaliar.ts` (tarefa 5)
- [ ] Conjunto-ouro rotulado por contador, para medir o acerto da sugestão (o script está pronto; faltam os rótulos)
- [ ] Testar a sugestão por LLM com um serviço de verdade (hoje só com serviço simulado nos testes)
- [x] Agente Vigia para a tabela oficial: tarefa diária, mudança por diferença exata, modo "reprocessar" (tarefa 6)
- [ ] Vigia de fontes em texto livre (notícias, informes técnicos): precisa das URLs exatas e de um extrator por LLM
- [x] Resend: remetente com o nome do escritório, resposta para quem aprovou, webhook de entrega/abertura, resumo diário (tarefa 7)
- [ ] Resend em produção: verificar o domínio, definir `RESEND_API_KEY`, `FAROL_REMETENTE` e `RESEND_WEBHOOK_SECRET` (testado só com serviço simulado)
- [x] Upload de ZIP e relatório de erros por arquivo (tarefa 8)
- [x] Cobrança com AbacatePay: checkout do plano, confirmação na API, webhook (tarefa 9)
- [ ] AbacatePay em produção: criar o produto (plano) no painel, definir as três variáveis e decidir o que o plano libera (hoje não bloqueia nada; testado só com serviço simulado)
- [x] Roteiro de demo e README em inglês (tarefa 10)
- [ ] Demonstração da sugestão sem cliente real: a carteira sintética usa a tabela de exemplo, que não tem texto de anexo
- [ ] Recálculo de carteiras grandes: hoje cada cliente é recalculado inteiro numa action; com dezenas de milhares de notas por cliente, guardar agregados por produto e mês
