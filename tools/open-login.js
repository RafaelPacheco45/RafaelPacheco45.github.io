import { config } from "../server/config.js";
import { openManualLogin } from "../server/browser.js";

const targets = process.argv.slice(2);
const state = openManualLogin(targets.length ? targets : config.loginTargets);

console.log("Janela de login aberta.");
console.log(`Perfil: ${state.profileDir}`);
console.log("URLs:");
for (const url of state.urls) console.log(`- ${url}`);
console.log("Depois de logar em Mercado Livre, Gemini e Facebook, feche essa janela antes de rodar a automacao.");
