# Achado Agora — MVP de afiliados

Site estático editorial para testar a tese:

**Meta Ads → landing/vitrine → display + clique de afiliado → marketplace**

Os botões **já abrem ofertas reais** (Mercado Livre, Amazon, Shopee). Comissão só entra quando você preencher as tags em `assets/config.js`.

## Colocar no ar com GitHub Pages

O projeto completo fica no repositorio. O GitHub Pages publica somente `public-site/`, sem expor `.env`, banco, cookies ou perfil do navegador.

1. Gere e valide a pasta publica:

```bash
npm run build:public
npm run verify
```

2. Envie a branch `main` ao GitHub. O workflow `.github/workflows/deploy-pages.yml` publica `public-site/` automaticamente.
3. Quando o dominio estiver pronto, configure-o em **Settings > Pages > Custom domain** e gere novamente o site com a URL definitiva.
4. Em `assets/config.js`:
   - `siteUrl`
   - `contactEmail` / dados legais nas páginas
   - `ga4MeasurementId` e `metaPixelId`
   - `adsenseClient` no formato `ca-pub-0000000000000000` quando o AdSense liberar seu codigo de verificacao
   - `adsenseAdSlot` para slot padrão ou `adsenseSlots.*` para blocos manuais por posição; deixe vazio para Auto Ads
   - `affiliates.mlMattTool` + `mlMattWord` (Mercado Livre)
   - `affiliates.amazonTag` (Amazon Associados)
5. Troque produtos, preços e URLs no mesmo arquivo. O grid, a página `oferta.html?id=...` e o comparativo leem daí.

## URLs de anúncio

Use landings específicas, não só a home. O build público gera páginas canônicas por produto em `/ofertas/`:

```
https://SEUDOMINIO/ofertas/britania-bfr50.html?utm_source=meta&utm_medium=cpc&utm_campaign=airfryer
https://SEUDOMINIO/ofertas/kingston-nv3.html?utm_source=meta&utm_medium=cpc&utm_campaign=ssd
https://SEUDOMINIO/artigo.html?utm_source=meta&utm_medium=cpc&utm_campaign=comparativo
```

O clique `affiliate_click` vai para `dataLayer` (e GA4/Pixel, se configurados), com o UTM da sessão. Em páginas de produto, o Pixel também recebe `ViewContent` e o clique de afiliado envia `Lead`; no GA4, a página envia `view_item` e o clique envia `select_item`.

## Checklist de renda

- Mercado Livre: manter links gerados pelo portal oficial (`meli.la`) e conferir comissoes pelo painel de Afiliados.
- Meta Ads: instalar `metaPixelId`, testar `PageView`, `ViewContent` e `Lead` no Events Manager antes de aumentar verba.
- GA4: instalar `ga4MeasurementId` para medir cliques enviados por campanha.
- AdSense: preencher `adsenseClient` só depois de aprovação; o build cria `ads.txt` automaticamente quando houver `ca-pub-...`.
- Escala: comprar tráfego só enquanto `receita de afiliado / cliques enviados` for maior que o custo por clique.

## Fechamento rapido

Antes de subir nova versao ou comprar trafego:

```bash
npm run build:public
npm run verify
```

O `verify` checa sintaxe, banco local, links oficiais Mercado Livre, paginas geradas, arquivos privados fora do pacote publico e avisos de monetizacao. Avisos de GA4, Pixel, AdSense, Amazon e metricas nao quebram o build porque dependem de contas externas, mas bloqueiam escala de anuncio pago.

## O que o MVP já faz

- Vitrine com busca, filtro e oferta em destaque
- Página de conversão por produto
- Comparativo editorial de air fryer
- Cookies/LGPD, privacidade, termos e divulgação de afiliado
- `rel="sponsored nofollow noopener"`
- Slots de publicidade visuais, Auto Ads do AdSense e `ads.txt` gerado no build quando `adsenseClient` estiver configurado

## Display ads por visualizacao

Para anúncios que pagam por visualização/impressão, crie uma conta no AdSense e adicione este site em:

```
https://www.google.com/adsense/start/
```

Quando o AdSense mostrar seu ID `ca-pub-...`, preencha `adsenseClient` em `assets/config.js` e rode o build público. O arquivo `ads.txt` e a meta `google-adsense-account` serão criados automaticamente no domínio publicado. Os anúncios só começam a aparecer e contar receita depois que a conta/site forem aprovados pela rede.

Slots manuais preparados:

| Campo | Posição |
| --- | --- |
| `adsenseSlots.homeRailLeft` | lateral esquerda da home |
| `adsenseSlots.homeTop` | horizontal depois do comparativo da home |
| `adsenseSlots.homeAfterTrust` | horizontal depois dos selos de confiança |
| `adsenseSlots.homeRailRight` | lateral direita da home |
| `adsenseSlots.homeMobile` | horizontal da home mobile |
| `adsenseSlots.articleTop` | artigos/posts |
| `adsenseSlots.offerTop` | páginas de oferta |
| `adsenseSlots.comparisonTop` | topo dos comparativos |
| `adsenseSlots.comparisonMiddle` | meio dos comparativos |
| `adsenseSlots.comparisonBottom` | final dos comparativos |

## Regra de teste de mídia

`receita média por visitante > custo médio por visitante`

Não envie tráfego incentivado nem redirecione automático.

Na pratica, escale so quando o painel mostrar lucro positivo ou quando o EPC de afiliado ficar acima do custo por clique enviado ao marketplace.

## Automacao local

O MVP tem um backend Node que serve o site local e processa a fila automatica:

```bash
npm install
npm run sync:products
npm run diagnostics
npm run login
npm run dev
```

Depois de iniciar, abra:

```
http://127.0.0.1:4177/
```

O worker processa automaticamente as tarefas enfileiradas pelo motor de busca:

```
busca no Mercado Livre -> link afiliado -> post no blog -> rascunho Meta -> post Facebook
```

O destino do anuncio e sempre uma URL do blog com UTM. O clique final para compra continua indo pelo link afiliado dentro do post/pagina. A configuracao publica de monetizacao fica em `assets/config.js` e pode ser atualizada pela API local `/api/site-config/monetization`.

Com o backend Node ativo, `busca.html` tambem tenta usar `/api/shopping-search`: o motor consulta cache/produtos salvos e, quando permitido, faz busca ao vivo no Mercado Livre pelo navegador persistente. O ranking considera confiabilidade, nota, volume e preco sem usar afiliacao no score; somente depois de escolher a melhor opcao o motor tenta gerar o link `meli.la` dela. No pacote estatico sem Node, a busca continua usando apenas comparativos publicados.

Para expor a busca sem publicar o painel, banco ou perfil do navegador, rode o gateway separado:

```bash
npm run public-search
```

Ele escuta apenas em `127.0.0.1:4178`, aceita `POST /api/shopping-search`, restringe a origem, limita buscas por IP, reaproveita resultados por 15 minutos e serializa o navegador. Publique essa porta por um proxy/tunel HTTPS confiavel e defina `searchApiBase` no `assets/config*.js` ou `AUTOBLOG_PUBLIC_SEARCH_API_URL` durante o build.

Para tirar esse processo do PC, use o pacote Docker em `compose.backend.yml`. O passo a passo de VPS, volume persistente, healthcheck e Cloudflare Tunnel esta em `docs/BACKEND-VPS.md`; chaves e tokens ficam somente no `.env.backend` ignorado pelo Git.

As metricas de teste continuam disponiveis na API local `/api/metrics`, que calcula receita, lucro, EPC, custo por clique e RPV.

Fluxo do worker:

```
buscar produto -> gerar link afiliado -> gerar conteudo no Gemini -> publicar no site -> criar rascunho Meta
```

Detalhes em `docs/AUTOMATION.md`.

## Preparar site publico gratis

Para subir sem dominio pago, gere uma pasta limpa:

```bash
npm run build:public
```

Ou no Windows:

```bat
preparar-site-publico.bat
```

O repositorio guarda o projeto completo, mas o workflow do GitHub Pages publica somente `public-site/`.
Detalhes em `docs/HOSPEDAGEM-GRATIS.md`.

## Local estatico

```bash
python -m http.server 8080
```

Abra `http://localhost:8080`.
