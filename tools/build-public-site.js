import { buildPublicSite } from "../server/staticExport.js";

let siteUrl = "";
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--url=")) siteUrl = arg.slice("--url=".length);
}

const result = buildPublicSite({ siteUrl });
console.log(`Site publico gerado em: ${result.outputDir}`);
console.log(`Arquivos raiz: ${result.copied.length}`);
console.log(`URLs no sitemap: ${result.urls.length}`);
if (result.siteUrl) {
  console.log(`Base publica: ${result.siteUrl}`);
} else {
  console.log("Base publica vazia. Depois que tiver a URL pages.dev, rode de novo com --url=https://seu-site.pages.dev");
}
