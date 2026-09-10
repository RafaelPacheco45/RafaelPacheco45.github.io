# Hospedagem do Achado Agora no GitHub Pages

O repositorio guarda o projeto completo. O GitHub Pages publica apenas a pasta `public-site/`.

```text
GitHub: codigo-fonte, paginas publicas e historico
GitHub Pages: somente public-site/
Seu PC: Node, Playwright, banco SQLite e perfil autenticado do navegador
```

## Publicacao automatica

O arquivo `.github/workflows/deploy-pages.yml` valida e publica `public-site/` a cada envio para a branch `main`.

Antes de enviar uma nova versao:

```bash
npm run build:public
npm run verify
git push
```

## Dominio proprio

Quando o DNS estiver preparado:

1. Abra o repositorio no GitHub.
2. Entre em **Settings > Pages**.
3. Informe o dominio em **Custom domain**.
4. Aguarde a verificacao do DNS e ative **Enforce HTTPS** quando estiver disponivel.
5. Gere novamente `public-site/` usando a URL definitiva e envie a alteracao.

## Arquivos privados

Estes dados permanecem fora do Git por meio do `.gitignore`:

```text
.env
data/*.db
data/runtime/
data/chrome-profile/
data/manual-login.json
node_modules/
dist/
```

Nunca envie cookies, senhas, tokens, banco local ou o perfil autenticado do navegador.
