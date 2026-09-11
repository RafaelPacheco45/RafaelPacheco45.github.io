// Match the requested item before comparing price. Marketplace searches also
// match descriptions, which otherwise lets a cheap spare part win a whole item.
function normalized(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/(\d)\s+(tb|gb|mb|litros|l)\b/g, "$1$2").trim();
}

const FAMILIES = [
  ["geladeira", /\b(geladeiras?|refrigeradores?|refrigerador|frigobar)\b/],
  ["notebook", /\b(notebooks?|laptops?)\b/],
  ["televisao", /\b(televisores?|televisor|televisao|televisoes|tvs?|smarttv)\b/],
  ["celular", /\b(celulares?|celular|smartphones?|iphones?)\b/],
  ["fone", /\b(fones?|headphones?|headsets?|earbuds?)\b/],
  ["lavadora", /\b(lavadoras?|maquina de lavar|lava e seca)\b/],
  ["arcondicionado", /\b(ar condicionado|split)\b/],
  ["fritadeira", /\b(fritadeiras?|air fryer|airfryer)\b/],
  ["console", /\b(consoles?|playstation|ps[45]|xbox|nintendo switch)\b/],
  ["monitor", /\b(monitores?|monitor)\b/],
  ["teclado", /\b(teclados?)\b/],
  ["ssd", /\b(ssd)\b/],
  ["microondas", /\b(microondas|micro ondas)\b/],
  ["aspirador", /\b(aspiradores?|aspirador)\b/],
  ["cafeteira", /\b(cafeteiras?)\b/],
  ["fogao", /\b(fogao|fogoes|cooktops?)\b/]
];
const ACCESSORY = /\b(acabamento|adesivo|adaptador|armario|balcao|bandeja|base|bolsa|borracha|botao|cabo|caixa|capacitor|capa|capinha|carregador|case|casinha|cesto|compressor|conserto|controle|curso|display|dobradica|enfeite|evaporador|filtro|forma|fusivel|gabinete|gaveta|grade|ima|iman|infantil|kit|lampada|manual|miniatura|modulo|mochila|motor|nicho|organizador|painel|peca|pecas|pegador|pelicula|placa|playset|porta|portas|pote|prateleira|protetor|puxador|recipiente|refil|rele|reparo|resistencia|rodizio|sensor|suporte|tapete|tampa|tampas|termostato|timer|ventoinha|brinquedo|barbie|boneca)\b/g;
const ACCESSORY_CONTEXT = /\b(compativel|reposicao|avulso|universal)\b|\b(para|p|de|da)\s+(?:a\s+)?(?:geladeiras?|refrigeradores?)\b/;
const PORTABLE_FRIDGE = /\b(mini|portatil|automotiva|caminhao|motorhome|onibus|van|barco|camping|12v|24v|frigobar)\b/;
const FRIDGE_DOOR_PRODUCT = /^porta\s+(?:de\s+)?(?:geladeiras?|refrigeradores?)\b/;
const STOP = new Set(["a", "o", "as", "os", "um", "uma", "de", "do", "da", "dos", "das", "e", "em", "para", "com", "melhor", "melhores", "barato", "barata", "preco", "comprar", "quero", "qual"]);

function tokens(value) {
  const result = new Set(normalized(value).split(" ").filter((token) => token && !STOP.has(token)));
  if (result.has("wireless") || result.has("bluetooth")) {
    result.add("sem");
    result.add("fio");
  }
  return [...result];
}

export function isRelevantCandidate(candidate, query) {
  const request = normalized(query);
  const title = normalized(candidate?.title);
  if (!request || !title) return false;
  if (/\bsem fio\b/.test(request) && /\b(com fio|cabeado|cabo)\b/.test(title)) return false;
  if (/\bcom fio\b/.test(request) && /\b(sem fio|wireless|bluetooth)\b/.test(title)) return false;
  const family = FAMILIES.find(([, pattern]) => pattern.test(request));
  const requestedAccessories = new Set(request.match(ACCESSORY) || []);
  const titleAccessories = title.match(ACCESSORY) || [];
  const familyPosition = family ? title.search(family[1]) : -1;
  if (family && familyPosition < 0) return false;
  // Accessories explicitly requested ("placa para geladeira") remain searchable.
  if (!requestedAccessories.size) {
    for (const accessory of titleAccessories) {
      const position = title.search(new RegExp(`\\b${accessory}\\b`));
      if (familyPosition < 0 || position < familyPosition || /^(barbie|boneca|brinquedo|miniatura)$/.test(accessory)) return false;
    }
    if (family?.[0] === "geladeira") {
      const wordsBeforeFamily = title.slice(0, familyPosition).trim().split(/\s+/).filter(Boolean).length;
      if (ACCESSORY_CONTEXT.test(title) || wordsBeforeFamily > 4) return false;
      if (!PORTABLE_FRIDGE.test(request) && PORTABLE_FRIDGE.test(title)) return false;
      if (!FRIDGE_DOOR_PRODUCT.test(request) && FRIDGE_DOOR_PRODUCT.test(title)) return false;
      if (!/\b(mini|skincare|cosmeticos|portatil)\b/.test(request)
        && (/\b(skincare|cosmeticos)\b/.test(title) || /\b[1-9]\s*l\b/.test(title))) return false;
    }
  }
  const expand = (value) => family ? value.replace(family[1], (match) =>
    /iphone|playstation|ps[45]|xbox|nintendo/.test(match) ? `${family[0]} ${match}` : family[0]) : value;
  const expandedRequest = expand(request);
  const expandedTitle = expand(title);
  const haystack = new Set(tokens(expandedTitle));
  return tokens(expandedRequest).every((token) => haystack.has(token)
    || (token.endsWith("s") && haystack.has(token.slice(0, -1)))
    || haystack.has(`${token}s`));
}

export function filterRelevantCandidates(candidates, query) {
  return candidates.filter((candidate) => isRelevantCandidate(candidate, query));
}
