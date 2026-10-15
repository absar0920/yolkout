// Node ESM loader hook: maps the browser import-map specifier "yolkout/sim"
// to shared/ref/sim.mjs so web/js/engine/physics.js runs unmodified under Node.
const SIM = new URL("../../../../shared/ref/sim.mjs", import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (specifier === "yolkout/sim") return { url: SIM, shortCircuit: true };
  return next(specifier, context);
}
