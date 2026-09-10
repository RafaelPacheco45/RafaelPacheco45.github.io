# Automacao Achado Agora

Este projeto agora tem uma base Node para operar o site como autoblog de afiliados.

## Comandos

```bash
npm install
npm run sync:products
npm run diagnostics
npm run validate:public
npm run login
npm run dev
```

Site local:

```text
http://127.0.0.1:4177/
```

## Piloto automatico

O fluxo automatico pode ser iniciado pela rota local `POST /api/flow/auto-campaign`. O worker tambem processa automaticamente buscas enfileiradas pelo site.

Esse fluxo cria e roda a fila:

```text
buscar produto -> gerar link afiliado -> gerar conteudo com IA -> publicar post -> gerar public-site -> preparar Facebook -> criar rascunho Meta
```

O anuncio aponta para o blog com UTM. Dentro do blog, o botao de compra aponta para o link afiliado.

Por seguranca, post organico automatico so publica de verdade quando `AUTOBLOG_FACEBOOK_ALLOW_ORGANIC_PUBLISH=1`. Anuncio pago fica como rascunho/revisao; confirme pixel, pagina, conta e gasto antes de publicar.

## Comparativos automaticos

Uma busca sem resultado em `busca.html` enfileira automaticamente a criacao de uma pagina comparando 3 anuncios do Mercado Livre para o termo pesquisado (ex: "fritadeira eletrica 5 litros"):

```text
buscar candidatos no Mercado Livre -> escolher #1 (sempre Mercado Livre, com link de afiliado gerado agora)
  -> escolher #2 e #3 (outros anuncios distintos, sem link de afiliado)
  -> capturar reviews reais de cada um -> gerar texto com Gemini (ou fallback local)
  -> publicar em comparativos/<slug>.html -> atualizar comparativos.html e assets/comparisons-index.json
```

Regra travada no codigo (nao so no prompt): o item #1 e sempre Mercado Livre e nunca mostra "contras"; os itens #2 e #3 so mostram "contras" quando vieram de review real capturada, senao aparece um aviso generico para conferir no checkout. Se o link de afiliado do item #1 falhar ao gerar, a tarefa falha e nada e publicado.

A pagina publica `busca.html` deixa o visitante pesquisar por titulo entre os comparativos ja publicados. Buscas sem resultado ficam registradas em `/api/events` e podem enfileirar um comparativo por `POST /api/search-miss`.

## Motor de busca assistida

O backend Node agora tambem expoe `GET/POST /api/shopping-search`.

Fluxo esperado:

```text
visitante pesquisa -> motor confere cache/comparativos/produtos salvos
  -> se busca ao vivo estiver liberada, consulta o Mercado Livre pelo navegador
  -> ranqueia por loja confiavel, nota, volume de vendas/avaliacoes, preco e link afiliado
  -> tenta gerar link oficial de afiliado para o vencedor Mercado Livre
  -> devolve melhor escolha, menor preco, melhor avaliado e alternativas
```

Regras importantes:

- O ranking nao deve empurrar um afiliado ruim. Produto afiliavel ganha preferencia so quando fica dentro de uma margem razoavel de qualidade e preco.
- A busca ao vivo usa Playwright + perfil `data/chrome-profile`, entao depende do login no Mercado Livre Afiliados e da tela do gerador continuar compativel.
- Em hospedagem estatica pura, `/api/shopping-search` nao existe; a pagina `busca.html` cai automaticamente para os comparativos ja publicados.
- Em backend publico, habilite busca ao vivo explicitamente com `AUTOBLOG_PUBLIC_LIVE_SEARCH=1`. Localmente ela fica ativa por padrao para teste.
- Se a busca nao encontra resultado util, o servidor enfileira um comparativo para gerar depois.

## Configuracao de monetizacao

Os campos publicos de monetizacao ficam em `assets/config.js`. A rota local `POST /api/site-config/monetization` valida os valores e recria `public-site/`:

- `siteUrl`
- `contactEmail`
- `ga4MeasurementId`
- `metaPixelId`
- `adsenseClient`
- `adsenseAdSlot`
- `adsenseSlots.*`
- `mlMattWord`
- `mlMattTool`
- `amazonTag`

Use IDs reais das contas. A API recusa formatos invalidos, mas nao aprova conta, pixel ou site por voce.

## Metricas de campanha

As rotas `/api/metrics` guardam numeros manuais por dia e campanha no banco local: gasto em trafego, visitantes, cliques enviados ao afiliado, comissao do Mercado Livre e receita display quando existir.

A API calcula EPC, custo por clique, RPV e lucro. Continue testando apenas campanhas com lucro positivo ou EPC acima do custo por clique.

Antes de subir uma nova versao publica, rode:

```bash
npm run build:public
npm run verify
```

O validador falha se `public-site/` estiver sem pagina obrigatoria, com arquivo privado, sitemap quebrado ou produto Mercado Livre sem link `meli.la`.

## Fluxo MVP

1. `npm run login`
2. Entrar no Mercado Livre Afiliados, Gemini e Facebook na janela aberta.
3. Fechar a janela de login.
4. Rodar `npm run sync:products` para sincronizar a vitrine atual.
5. Abrir `/busca.html` e pesquisar o termo desejado.
6. Aguardar o worker automatico processar a fila.
7. Consultar `/api/status`, `/api/tasks` e `/api/events` para diagnostico quando necessario.

O worker tenta:

```text
buscar produto -> gerar link afiliado -> gerar conteudo no Gemini -> publicar no site -> criar rascunho Meta
```

## Modo sem API

A automacao usa Playwright com um perfil persistente de Chrome/Edge em `data/chrome-profile`.
Isso evita pedir token/API, mas depende da interface visual dos sites. Se Mercado Livre, Gemini ou Facebook mudarem a tela, a tarefa falha e fica registrada em `/api/events`.

## Anuncios pagos

Por padrao, anuncios pagos viram rascunhos locais. Para permitir fluxo de anuncio vivo no futuro, configure explicitamente:

```text
AUTOBLOG_META_ALLOW_LIVE_ADS=1
AUTOBLOG_META_DAILY_BUDGET_CAP_BRL=20
```

Mesmo com isso ligado, a primeira versao abre o Ads Manager e entrega o rascunho. O clique final de campanha paga deve ser validado depois de pixel, forma de pagamento, pagina e limite de gasto estarem corretos.
