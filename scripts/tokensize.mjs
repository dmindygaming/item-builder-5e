/**
 * Keeps tokens on the map the right size when an Item Builder "Change Size" rule turns on or off.
 * D&D5e changes the actor's size itself (the rule is an Active Effect on the item); this only
 * resizes the tokens, so it needs Item Builder running. One GM client does the work.
 */
import { MODULE_ID, isDnd5e6 } from "./compat.mjs";
import { syncRuleEffects } from "./rules.mjs";

const pending = new Map();

/** Grid size of a token for a D&D5e size key. */
export function tokenDimension(size) {
  const cfg = globalThis.CONFIG?.DND5E?.actorSizes?.[size];
  return cfg?.token ?? 1;
}

function hasSizeRule(item) {
  return (item?.flags?.[MODULE_ID]?.components ?? []).some(c => c.type === "conditional" && c.effect === "sizeChange");
}

function actorHasSizeRule(actor) {
  return [...(actor?.items ?? [])].some(hasSizeRule);
}

function isResponsibleGM() {
  return game.user?.isGM && (game.users?.activeGM?.id ?? game.user.id) === game.user.id;
}

/** What the actor's tokens should be resized to now, or null to leave them alone. */
export function plannedTokenSize(actor) {
  const current = actor?.system?.traits?.size;
  if ( !current ) return null;
  const last = actor.getFlag?.(MODULE_ID, "tokenSize") ?? null;
  const ruled = actorHasSizeRule(actor);
  if ( !ruled && !last ) return null;          // Not ours: never touch other tokens.
  if ( current === last ) return null;          // Already sized.
  return current;
}

async function resizeTokens(actor) {
  const size = plannedTokenSize(actor);
  if ( !size ) return;
  const dim = tokenDimension(size);
  const updates = [];
  for ( const token of actor.getActiveTokens?.(false, true) ?? [] ) {
    const doc = token.document ?? token;
    if ( doc.width === dim && doc.height === dim ) continue;
    updates.push(doc.update({ width: dim, height: dim }));
  }
  await Promise.allSettled(updates);
  const base = actor.isToken ? null : actor;
  if ( base && (base.prototypeToken?.width !== dim || base.prototypeToken?.height !== dim) ) {
    await base.update({ "prototypeToken.width": dim, "prototypeToken.height": dim }, { [MODULE_ID]: { tokenSize: true } });
  }
  // Remember the size we set; forget it once no size rule is left and the actor is back to normal.
  if ( actorHasSizeRule(actor) ) await actor.setFlag(MODULE_ID, "tokenSize", size);
  else await actor.unsetFlag(MODULE_ID, "tokenSize");
}

function schedule(actor) {
  if ( !actor || actor.documentName !== "Actor" || !isResponsibleGM() ) return;
  const key = actor.uuid;
  clearTimeout(pending.get(key));
  pending.set(key, setTimeout(() => {
    pending.delete(key);
    resizeTokens(actor).catch(err => console.warn(`${MODULE_ID} | could not resize tokens for ${actor.name}`, err));
  }, 150));
}

/** On D&D5e 5.3 a "grow" rule stores the resulting size, so rebuild it when the base size changes. */
async function refreshLegacyGrowth(actor) {
  if ( isDnd5e6() || !isResponsibleGM() ) return;
  for ( const item of actor?.items ?? [] ) {
    const comps = item.flags?.[MODULE_ID]?.components ?? [];
    if ( comps.some(c => c.type === "conditional" && c.effect === "sizeChange" && c.sizeMode !== "set") ) await syncRuleEffects(item);
  }
}

const actorOf = doc => {
  if ( !doc ) return null;
  if ( doc.documentName === "Actor" ) return doc;
  if ( doc.parent?.documentName === "Actor" ) return doc.parent;
  if ( doc.parent?.parent?.documentName === "Actor" ) return doc.parent.parent;  // Effect on an owned item.
  return null;
};

export function registerTokenSizeHooks() {
  for ( const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "createItem", "updateItem", "deleteItem"] ) {
    Hooks.on(hook, doc => schedule(actorOf(doc)));
  }
  Hooks.on("updateActor", (actor, changes, options) => {
    if ( options?.[MODULE_ID]?.tokenSize ) return;
    if ( foundry.utils.hasProperty(changes, "system.traits.size") ) refreshLegacyGrowth(actor);
    schedule(actor);
  });
  Hooks.on("createItem", item => {
    if ( !isDnd5e6() && item.parent?.documentName === "Actor" && hasSizeRule(item) && isResponsibleGM() ) {
      syncRuleEffects(item).catch(() => {});
    }
  });
  // A token dropped on the map for an actor that is currently enlarged.
  Hooks.on("createToken", token => schedule(token.actor));
}
