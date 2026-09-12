# Backend do Achado Agora em VPS

O Git continua sendo a fonte do projeto. O site estatico fica no GitHub Pages; somente a API de busca e o gerador diario rodam continuamente na VPS.

## O que esta preparado

- container Node sem painel administrativo exposto;
- Chromium para consultar marketplaces;
- volume persistente para banco, cache e comparativos;
- busca limitada pela origem e pelo rate limit do servidor;
- seis comparativos diarios, publicados somente quando cada um tiver tres ofertas relevantes e afiliadas;
- healthcheck em `GET /healthz`;
- Cloudflare Tunnel opcional, sem abrir a porta 4178 para a internet.

## Requisitos

- Linux com Docker Engine e Docker Compose 2.24 ou superior;
- acesso SSH ao servidor;
- chave da API Lomadee/SocialSoul com permissao de busca e encurtamento;
- para o subdominio publico, um Cloudflare Tunnel e seu token.

## Implantar

```bash
git clone URL_DO_REPOSITORIO achado-agora
cd achado-agora
cp .env.backend.example .env.backend
chmod 600 .env.backend
```

Edite `.env.backend` e preencha `AUTOBLOG_LOMADEE_API_KEY`. Sem essa chave, a busca ainda pode consultar o Mercado Livre, mas a geracao automatica de links afiliados dependera de um perfil de navegador autenticado.

Suba primeiro apenas a API privada:

```bash
docker compose -f compose.backend.yml up -d --build backend
docker compose -f compose.backend.yml ps
curl http://127.0.0.1:4178/healthz
```

## Publicar com Cloudflare Tunnel

No painel da Cloudflare, crie ou abra um tunnel gerenciado remotamente, configure o hostname `api.achadoagora.blog.br` apontando para o servico HTTP `http://backend:4178` e copie o token. Guarde-o somente em `.env.backend`:

```text
TUNNEL_TOKEN=cole_o_token_aqui
```

Depois inicie o perfil do tunnel:

```bash
docker compose -f compose.backend.yml --profile tunnel up -d --build
curl https://api.achadoagora.blog.br/healthz
```

O token permite executar o tunnel e deve ser tratado como senha. Para trocar uma credencial vazada, rotacione-a no painel da Cloudflare e atualize `.env.backend` no servidor.

## Atualizar

```bash
git pull --ff-only
docker compose -f compose.backend.yml --profile tunnel up -d --build
docker compose -f compose.backend.yml ps
```

## Diagnostico e copia de seguranca

```bash
docker compose -f compose.backend.yml logs --tail=200 backend
docker compose -f compose.backend.yml logs --tail=100 cloudflared
docker run --rm -v achado-agora-backend-data:/data -v "$PWD":/backup alpine tar czf /backup/achado-agora-data.tgz -C /data .
```

O backup pode conter banco, links e perfil do navegador. Nao o envie ao Git nem o compartilhe publicamente.
