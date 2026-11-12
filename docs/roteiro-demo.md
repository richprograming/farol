# Roteiro da demo (3 minutos)

Para quem vai apresentar o Farol no Hack Brasil. O tempo de cada bloco está entre parênteses. As falas são sugestões; os cliques são os que funcionam hoje.

## Antes de subir ao palco

1. `npm run convex` e `npm run dev` rodando; login feito em `http://localhost:3000`.
2. Carteira vazia. Se houver demonstração carregada, clique em **Recomeçar demonstração**.
3. Tenha à mão um ZIP com XMLs de NF-e/NFC-e de um cliente que autorizou o uso (para o bloco 4). Sem esse ZIP, pule o bloco 4 e use o tempo no bloco 3.
4. Abra a aba **Radar** uma vez e clique em **Verificar agora**, para a linha "Tabela oficial verificada em…" já aparecer.

## 1. O problema (0:00 a 0:25)

> "Um escritório contábil tem centenas de clientes. A reforma tributária muda a carga de cada um de um jeito diferente, de 2026 a 2033, e as regras ainda estão sendo publicadas. Hoje o contador descobre o efeito cliente por cliente, na planilha. O Farol faz isso a partir das notas fiscais que o escritório já tem."

## 2. A carteira (0:25 a 1:05)

- Clique em **Carregar carteira de demonstração**. Diga que os dados são sintéticos e que a faixa no topo avisa isso.
- Mostre a lista: clientes ordenados por quanto a estimativa de tributos muda em 2027.
- Clique no primeiro cliente. Mostre o gráfico 2026 a 2033 e o cartão do split payment.

> "Cada número vem de uma conta que dá para refazer: está escrito com qual versão da tabela e de quais alíquotas ele foi calculado. As alíquotas de 2027 em diante ainda são estimativas e aparecem em cinza."

- Desça até **Produtos**. Mostre um item com a pílula **Revisar**.

> "Quando o NCM admite mais de um tratamento, o Farol não escolhe. Usa o mais conservador e espera o contador."

- Escolha um tratamento e clique em **Confirmar**. A carteira se recalcula sozinha.

## 3. O Radar (1:05 a 2:00)

- Vá para **Radar**. Há duas mudanças fictícias (o título diz "EXEMPLO FICTÍCIO").
- Clique em **Leitura correta: calcular impacto** na das fraldas.

> "Uma mudança só gera impacto depois que o contador confirma que a leitura está certa."

- Aparecem os clientes afetados, a variação em reais por mês e o rascunho do aviso.
- Edite uma palavra do texto e clique em **Aprovar e enviar**.

> "Nenhum aviso sai sem esse clique, e o clique fica gravado. O e-mail sai com o nome do escritório, e a tela mostra quando foi entregue e aberto."

  (Sem a chave do Resend, a tela diz "Envio simulado". Diga isso.)

- Aponte a linha **Tabela oficial verificada em…** no topo do Radar.

> "Todo dia o Farol baixa a tabela oficial de classificação e compara com a do escritório. Se algo mudar, aparece aqui como uma mudança para conferir. É uma comparação exata entre duas tabelas, não uma leitura por IA."

## 4. Cliente real e sugestão (2:00 a 2:40)

- Volte para **Carteira**, clique em **Recomeçar demonstração** e depois em **Adicionar cliente**.
- Selecione o ZIP e clique em **Ler notas**.

> "O ZIP é aberto no navegador. O servidor guarda só os itens das notas: nem o XML, nem o CPF do consumidor."

- No detalhe do cliente, clique em **Sugerir classificação para os N em revisão**.
- Mostre uma sugestão: o código, a aderência e o trecho do anexo.

> "A sugestão cita o texto oficial em que se apoia e não entra na conta. Quando o texto não decide, o Farol diz que não sabe. Quem decide é o contador."

## 5. Fecho (2:40 a 3:00)

> "O Farol lê as notas, vigia a tabela oficial e sugere. O motor faz as contas, com versão e fonte em cada número. O contador aprova tudo. O próximo passo é medir a sugestão com um conjunto de produtos rotulado por contadores e trocar as alíquotas estimadas pelas oficiais quando saírem."

## Se algo der errado

| O que aconteceu | O que fazer |
| --- | --- |
| "Sessão não reconhecida" | Clique em **Sair** e entre de novo. |
| A carteira fica em "Calculando…" | O `npm run convex` parou. Suba de novo; a tela se atualiza sozinha. |
| **Verificar agora** mostra falha | O portal oficial está fora do ar ou sem internet. Diga que a verificação é diária e siga. |
| O upload recusa cliente real | A demonstração ainda está carregada. Clique em **Recomeçar demonstração** antes. |
| A sugestão diz que a tabela não traz o texto do anexo | O cliente está na carteira de demonstração (tabela de exemplo). A sugestão usa a tabela oficial: faça o bloco 4. |

## O que não dizer

- Não diga que as alíquotas de 2027 em diante são oficiais: são estimativas.
- Não diga que a IA classifica: ela sugere, e por padrão a sugestão nem usa LLM.
- Não diga que a cobrança ou o e-mail estão em produção se as chaves não estiverem configuradas.
