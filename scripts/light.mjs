/**
 * Light sources: an item that sheds light and can be turned on or off.
 *
 * Each Light component adds a D&D5e activity ("Light: Torch") to the item. Using it toggles the
 * light; while it is on (and the item is equipped, if it can be), every token of the owner on the
 * map sheds that light. The token's own light is remembered and put back when the light goes out.
 * Changing token light needs Item Builder running; one GM client does it (or the owner, if no GM
 * is online).
 */
import { MODULE_ID } from "./compat.mjs";

export const LIGHT_ACTIVATIONS = { action: "Action", bonus: "Bonus Action", none: "Free (no action)" };
export const DEFAULT_LIGHT = { bright: 20, dim: 40, color: "#ffb347", animation: "torch", activation: "action", startOn: false };

const recordOf = item => {
  try { return JSON.parse(item?.getFlag?.(MODULE_ID, "lights") || "{}"); } catch { return {}; }
};

/** Light components unlocked at the item's tier. */
function lightComponents(item) {
  const f = item?.flags?.[MODULE_ID];
  const tier = Number(f?.currentTier ?? 1) || 1;
  return (f?.components ?? []).filter(c => c.type === "light" && (Number(c.tier) || 1) <= tier);
}

/** Is this light currently on (and the item in use)? */
export function lightIsOn(item, c) {
  const on = item?.getFlag?.(MODULE_ID, `lightOn.${c.id}`);
  const lit = on === undefined ? !!c.startOn : !!on;
  if ( !lit ) return false;
  const sys = item.system ?? {};
  return !("equipped" in sys) || !!sys.equipped;
}

/** Player-facing description line. */
export function lightLine(c) {
  const bright = Number(c.bright) || 0, dim = Math.max(Number(c.dim) || 0, bright);
  const parts = [];
  if ( bright ) parts.push(`bright light in a ${bright} ft. radius`);
  if ( dim > bright ) parts.push(`${bright ? "dim light for an additional" : "dim light in a"} ${dim - bright} ft.${bright ? "" : " radius"}`);
  const act = { action: "an action", bonus: "a bonus action", none: "no action" }[c.activation] ?? "an action";
  return `Sheds ${parts.join(" and ") || "light"}; turn it on or off with ${act} (${c.name || "Light"})`;
}

/** The activity that toggles one light. */
export function lightActivityData(c, id) {
  return {
    _id: id,
    name: c.name || "Light",
    activation: { type: c.activation || "action", value: 1, override: false },
    description: { chatFlavor: "Turns the light on or off." },
    range: { units: "self" },
    target: { affects: { type: "self" }, prompt: false }
  };
}

/** Make the item's light activities match its Light components (spent nothing to keep). */
export async function syncLights(item) {
  if ( !item?.system?.activities ) return;
  const wanted = lightComponents(item);
  const record = recordOf(item);
  if ( !wanted.length && !Object.keys(record).length ) return;
  for ( const rec of Object.values(record) ) {
    if ( item.system.activities.get?.(rec) ) await item.deleteActivity(rec);
  }
  const next = {};
  for ( const c of wanted ) {
    const id = foundry.utils.randomID();
    try { await item.createActivity("utility", lightActivityData(c, id), { renderSheet: false }); next[c.id] = id; }
    catch (err) { console.warn(`${MODULE_ID} | could not add light activity`, err); }
  }
  await item.setFlag(MODULE_ID, "lights", JSON.stringify(next));
  if ( item.parent?.documentName === "Actor" ) scheduleActor(item.parent);
}

/** The light a token should shed for an actor right now, or null. */
export function desiredLight(actor) {
  let best = null;
  for ( const item of actor?.items ?? [] ) {
    for ( const c of lightComponents(item) ) {
      if ( !lightIsOn(item, c) ) continue;
      const dim = Math.max(Number(c.dim) || 0, Number(c.bright) || 0);
      if ( !best || dim > best.dim ) best = { bright: Number(c.bright) || 0, dim, color: c.color || null, animation: c.animation || "" };
    }
  }
  return best;
}

function lightUpdate(l) {
  return {
    bright: l.bright, dim: l.dim, color: l.color, alpha: 0.4, angle: 360,
    animation: { type: l.animation || null, speed: 3, intensity: 3 }
  };
}

async function applyActorLight(actor) {
  const want = desiredLight(actor);
  for ( const token of actor.getActiveTokens?.(false, true) ?? [] ) {
    const doc = token.document ?? token;
    const saved = doc.getFlag?.(MODULE_ID, "savedLight");
    if ( want ) {
      const update = { light: lightUpdate(want) };
      if ( !saved ) update[`flags.${MODULE_ID}.savedLight`] = JSON.stringify(doc.light?.toObject?.() ?? doc.light ?? {});
      const cur = doc.light ?? {};
      if ( saved && cur.bright === want.bright && cur.dim === want.dim && (cur.color ?? null) === (want.color ?? null)
        && (cur.animation?.type ?? null) === (want.animation || null) ) continue;
      await doc.update(update);
    } else if ( saved ) {
      let light = {};
      try { light = JSON.parse(saved); } catch { /* bad record */ }
      await doc.update({ light });
      await doc.unsetFlag(MODULE_ID, "savedLight");
    }
  }
}

const pending = new Map();
function responsibleFor(actor) {
  const gm = game.users?.activeGM;
  if ( gm ) return gm.id === game.user.id;
  return !!actor?.isOwner;
}
export function scheduleActor(actor) {
  if ( !actor || actor.documentName !== "Actor" || !responsibleFor(actor) ) return;
  clearTimeout(pending.get(actor.uuid));
  pending.set(actor.uuid, setTimeout(() => {
    pending.delete(actor.uuid);
    applyActorLight(actor).catch(err => console.warn(`${MODULE_ID} | could not update light for ${actor.name}`, err));
  }, 150));
}

/** Turn a light on or off. */
export async function toggleLight(item, c, state) {
  const next = state ?? !lightIsOn(item, c);
  await item.setFlag(MODULE_ID, `lightOn.${c.id}`, next);
  if ( next && item.system && "equipped" in item.system && !item.system.equipped ) {
    ui.notifications?.info(`${item.name}: equip it to shed light.`);
  }
}

export function registerLightHooks() {
  Hooks.on("dnd5e.postUseActivity", activity => {
    const item = activity?.item;
    const record = recordOf(item);
    const cid = Object.entries(record).find(([, aid]) => aid === activity.id)?.[0];
    if ( !cid ) return;
    const c = lightComponents(item).find(x => x.id === cid);
    if ( c ) toggleLight(item, c);
  });
  const touch = item => { if ( item?.parent?.documentName === "Actor" && item.flags?.[MODULE_ID] ) scheduleActor(item.parent); };
  Hooks.on("updateItem", touch);
  Hooks.on("createItem", touch);
  Hooks.on("deleteItem", touch);
  Hooks.on("createToken", token => { if ( token.actor ) scheduleActor(token.actor); });
}
