/**
 * Recharge: an item feature that restores uses of the holder's class abilities (Channel Divinity,
 * Wild Shape, Rage, Bardic Inspiration, Focus Points…) or an expended spell slot.
 *
 * Every recharge is written onto the item as a native D&D5e activity, so it shows on the character
 * sheet with its own limited uses and recovery. Recharges the player uses (an action or bonus action)
 * run when the activity is used. Recharges that happen on their own (after a rest, at dawn, when you
 * roll initiative, at the start of your turn, on a critical hit) are run by Item Builder's hooks and
 * spend the activity's uses, so "once per long rest" limits work for those too.
 */
import { MODULE_ID, usesFormula, usesLabel } from "./compat.mjs";
import { grantActive } from "./feats.mjs";

/** What a recharge restores. */
export const RECHARGE_TARGETS = {
  feature: "A Specific Class Ability",
  choice: "Player's Choice of a Limited-Use Ability",
  spellSlot: "An Expended Spell Slot"
};

/** When a recharge happens. The first three are used by the player; the rest happen on their own. */
export const RECHARGE_TRIGGERS = {
  action: "As an Action",
  bonus: "As a Bonus Action",
  reaction: "As a Reaction",
  shortRest: "When You Finish a Short Rest",
  longRest: "When You Finish a Long Rest",
  anyRest: "When You Finish a Short or Long Rest",
  dawn: "At Dawn (Each New Day)",
  initiative: "When You Roll Initiative",
  turnStart: "At the Start of Each of Your Turns",
  critical: "When You Score a Critical Hit"
};
export const ACTIVE_TRIGGERS = new Set(["action", "bonus", "reaction"]);

/** Class abilities with limited uses, offered as suggestions (2024 and 2014 names). */
export const CLASS_ABILITY_SUGGESTIONS = [
  "Action Surge", "Monk's Focus", "Font of Magic", "Arcane Recovery", "Bardic Inspiration", "Channel Divinity", "Divine Sense", "Focus Points", "Ki Points",
  "Indomitable", "Innate Sorcery", "Lay on Hands", "Magical Cunning", "Natural Recovery", "Rage", "Second Wind",
  "Sorcery Points", "Superiority Dice", "Wild Shape", "Wholeness of Body", "Tactical Mind", "Favored Enemy",
  "Harness Divine Power", "Font of Magic", "Mystic Arcanum", "Healing Light", "Wrath of the Storm", "War Priest",
  "Guided Strike", "Relentless Rage", "Uncanny Metabolism", "Cunning Strike", "Beguiling Magic", "Wild Companion"
];

/** Other names a class resource goes by (what players say → what the feature is called). */
const ALIASES = {
  "focus points": ["monk's focus", "focus", "ki"], "focus point": ["monk's focus", "focus", "ki"], "focus": ["monk's focus", "ki"],
  "ki points": ["ki", "monk's focus"], "ki point": ["ki", "monk's focus"], "ki": ["monk's focus"],
  "sorcery points": ["font of magic", "sorcery points"], "sorcery point": ["font of magic", "sorcery points"],
  "superiority dice": ["combat superiority", "superiority dice"], "superiority die": ["combat superiority", "superiority dice"],
  "rages": ["rage"], "wild shapes": ["wild shape"], "channel divinities": ["channel divinity"],
  "bardic inspirations": ["bardic inspiration"], "lay on hands pool": ["lay on hands"], "luck points": ["lucky"]
};

const ORD = n => ["", "1st", "2nd", "3rd"][n] ?? `${n}th`;
const isNumber = f => /^\s*\d+\s*$/.test(String(f ?? ""));

/** "one use", "1d4 uses", "all uses", "one 3rd-level-or-lower spell slot". */
export function rechargeAmountText(c) {
  if ( c.target === "spellSlot" ) {
    const n = String(c.amount || "1").trim();
    const lvl = Math.max(1, Math.min(9, Number(c.slotLevel) || 1));
    const count = n === "1" ? "one" : n;
    return `${count} expended spell slot${n === "1" ? "" : "s"} of ${ORD(lvl)} level or lower`;
  }
  if ( c.all ) return "all expended uses";
  const n = String(c.amount || "1").trim();
  return n === "1" ? "one expended use" : `${n} expended uses`;
}

/** "Channel Divinity", "a limited-use ability of your choice". */
export function rechargeTargetText(c) {
  if ( c.target === "choice" ) return "a class ability of your choice";
  if ( c.target === "spellSlot" ) return "";
  return String(c.featureName ?? "").trim() || "the chosen ability";
}

/** The trigger as a sentence opening: "When you roll initiative". */
export function rechargeTriggerText(c) {
  return {
    action: "As an action", bonus: "As a bonus action", reaction: "As a reaction",
    shortRest: "When you finish a short rest", longRest: "When you finish a long rest",
    anyRest: "When you finish a short or long rest", dawn: "At dawn each day",
    initiative: "When you roll initiative", turnStart: "At the start of each of your turns",
    critical: c.thisItemOnly ? "When you score a critical hit with this item" : "When you score a critical hit"
  }[c.trigger] ?? "When you finish a long rest";
}

/** Player-facing sentence, e.g. "Once per long rest, as a bonus action, you can regain one expended use of Channel Divinity." */
export function rechargeSummary(c, abilityLabel=k => k) {
  const uses = usesLabel(c, abilityLabel);
  const per = { sr: "short rest", lr: "long rest", day: "day", dawn: "dawn" }[c.recovery];
  let limit = "";
  if ( uses ) {
    const count = /^\d+$/.test(uses) ? (uses === "1" ? "Once" : uses === "2" ? "Twice" : `${uses} times`) : `A number of times equal to your ${uses}`;
    limit = `${count}${per ? ` per ${per}` : ""}`;
  }
  const what = rechargeAmountText(c);
  const trig = rechargeTriggerText(c);
  const active = ACTIVE_TRIGGERS.has(c.trigger);
  const lead = limit ? `${limit}, ${trig.charAt(0).toLowerCase()}${trig.slice(1)}` : trig;
  const verb = active ? "can regain" : "regain";
  if ( c.target === "spellSlot" ) return `${lead}, you ${verb} ${what}.`;
  if ( c.onlyIfEmpty && c.target === "choice" ) return `${lead}, you ${verb} ${what} of a class ability of your choice that has no uses left.`;
  if ( c.onlyIfEmpty ) {
    const name = rechargeTargetText(c);
    // "When you roll initiative and have no uses of X left" / "As a bonus action, if you have no uses of X left,"
    const cond = /^When you /.test(trig) && !limit ? ` and have no uses of ${name} left` : `, if you have no uses of ${name} left`;
    return `${lead}${cond}, you ${verb} ${what} of it.`;
  }
  return `${lead}, you ${verb} ${what} of ${rechargeTargetText(c)}.`;
}

/** The native activity for a recharge: `{ type, data }`. */
export function rechargeActivityData(c, { id, spent=0 }={}) {
  const active = ACTIVE_TRIGGERS.has(c.trigger);
  const data = {
    _id: id,
    name: c.name || "Recharge",
    activation: {
      type: active ? c.trigger : "special", value: active ? 1 : null,
      condition: active ? "" : rechargeTriggerText(c), override: false
    },
    description: { chatFlavor: rechargeSummary(c) },
    range: { units: "self" },
    target: { affects: { type: "self" }, prompt: false },
    effects: []
  };
  const uses = usesFormula(c);
  if ( uses ) {
    const period = ["sr", "lr", "day", "dawn"].includes(c.recovery) ? c.recovery : "";
    data.uses = { max: uses, spent: Number(spent) || 0, recovery: period ? [{ period, type: "recoverAll" }] : [] };
    data.consumption = { targets: [{ type: "activityUses", target: "", value: "1" }], spellSlot: false };
  }
  return { type: "utility", data };
}

/* -------------------------------------------- */
/*  Finding what to recharge                    */
/* -------------------------------------------- */

const usesOf = item => {
  const u = item?.system?.uses;
  const max = Number(u?.max) || 0;
  const spent = Number(u?.spent) || 0;
  return { max, spent, value: Math.max(0, max - spent) };
};

/** Items whose uses this recharge could restore (with uses, excluding the source item itself). */
export function rechargeCandidates(actor, c, sourceItem) {
  const items = [...(actor?.items ?? [])].filter(i => i !== sourceItem && i.id !== sourceItem?.id && usesOf(i).max > 0);
  if ( c.target === "feature" ) {
    const want = String(c.featureName ?? "").trim().toLowerCase();
    if ( !want ) return [];
    const names = [want, ...(ALIASES[want] ?? [])];
    for ( const n of names ) {
      const exact = items.filter(i => i.name.toLowerCase() === n);
      if ( exact.length ) return exact;
    }
    // "Channel Divinity" also finds "Channel Divinity (Paladin)".
    const loose = items.filter(i => names.some(n => i.name.toLowerCase().includes(n) || (n.length > 3 && n.includes(i.name.toLowerCase()))));
    return loose.filter(i => i.type === "feat").length ? loose.filter(i => i.type === "feat") : loose;
  }
  if ( c.target === "choice" ) {
    // Class, subclass, species and feat features: not other magic items or consumables.
    return items.filter(i => i.type === "feat");
  }
  return [];
}

/** Spell slot levels that can be restored, as [{ key, level, value, max }]. */
export function slotCandidates(actor, c) {
  const top = Math.max(1, Math.min(9, Number(c.slotLevel) || 1));
  const spells = actor?.system?.spells ?? {};
  const out = [];
  for ( let l = 1; l <= top; l++ ) {
    const s = spells[`spell${l}`];
    if ( s && Number(s.max) > 0 && Number(s.value) < Number(s.max) ) out.push({ key: `spell${l}`, level: l, value: Number(s.value), max: Number(s.max) });
  }
  const p = spells.pact;
  if ( p && Number(p.max) > 0 && Number(p.value) < Number(p.max) && Number(p.level) <= top ) out.push({ key: "pact", level: Number(p.level), value: Number(p.value), max: Number(p.max), pact: true });
  return out;
}

/** Is there anything to recharge right now? (Cheap, so it can run before an activity is used.) */
export function canRecharge(actor, c, sourceItem) {
  if ( c.target === "spellSlot" ) return slotCandidates(actor, c).length > 0;
  return rechargeCandidates(actor, c, sourceItem).some(i => {
    const u = usesOf(i);
    return u.spent > 0 && (!c.onlyIfEmpty || u.value === 0);
  });
}

async function chooseOne(title, label, options) {
  if ( options.length <= 1 ) return options[0]?.value ?? null;
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if ( !DialogV2 ) return options[0].value;
  const esc = s => foundry.utils.escapeHTML?.(String(s)) ?? String(s);
  const html = `<div class="form-group"><label>${esc(label)}</label><div class="form-fields"><select name="pick">${
    options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("")}</select></div></div>`;
  try {
    return await DialogV2.prompt({ window: { title }, content: html, rejectClose: false,
      ok: { label: "Regain", callback: (event, button) => button.form.elements.pick.value } });
  } catch { return null; }
}

async function amountOf(actor, c, max) {
  if ( c.all && c.target !== "spellSlot" ) return { n: max, roll: null };
  const f = String(c.amount || "1").trim();
  if ( isNumber(f) ) return { n: Number(f), roll: null };
  try {
    const roll = await new Roll(f, actor.getRollData?.() ?? {}).evaluate();
    return { n: Math.max(0, Math.floor(roll.total)), roll };
  } catch (err) {
    console.warn(`${MODULE_ID} | recharge amount "${f}" could not be rolled`, err);
    return { n: 1, roll: null };
  }
}

/**
 * Restore uses for one recharge component. `interactive` lets the player pick when there is a choice.
 * Returns a short description of what was restored, or "" if nothing was.
 */
export async function performRecharge(actor, c, sourceItem, { interactive=true }={}) {
  if ( !actor ) return "";
  const source = sourceItem?.name ?? "Item";
  if ( c.target === "spellSlot" ) {
    const slots = slotCandidates(actor, c);
    if ( !slots.length ) return "";
    const pickKey = interactive
      ? await chooseOne(`${source}: Regain a Spell Slot`, "Spell slot", slots.sort((a, b) => b.level - a.level)
        .map(s => ({ value: s.key, label: `${s.pact ? "Pact Magic" : ORD(s.level) + " level"} (${s.value}/${s.max})` })))
      : slots.sort((a, b) => b.level - a.level)[0].key;
    const slot = slots.find(s => s.key === pickKey);
    if ( !slot ) return "";
    const { n, roll } = await amountOf(actor, c, slot.max);
    const value = Math.min(slot.max, slot.value + n);
    if ( value === slot.value ) return "";
    await actor.update({ [`system.spells.${slot.key}.value`]: value });
    return `${slot.pact ? "Pact Magic slots" : `${ORD(slot.level)}-level spell slots`}: ${slot.value} → ${value} of ${slot.max}${roll ? ` (rolled ${roll.total})` : ""}`;
  }
  let items = rechargeCandidates(actor, c, sourceItem).filter(i => usesOf(i).spent > 0);
  if ( c.onlyIfEmpty ) items = items.filter(i => usesOf(i).value === 0);
  if ( !items.length ) return "";
  const id = interactive
    ? await chooseOne(`${source}: Regain Uses`, "Ability", items.map(i => { const u = usesOf(i); return { value: i.id, label: `${i.name} (${u.value}/${u.max})` }; }))
    : items[0].id;
  const target = items.find(i => i.id === id);
  if ( !target ) return "";
  const u = usesOf(target);
  const { n, roll } = await amountOf(actor, c, u.max);
  const spent = Math.max(0, u.spent - n);
  if ( spent === u.spent ) return "";
  await target.update({ "system.uses.spent": spent });
  return `${target.name}: ${u.value} → ${u.max - spent} of ${u.max} uses${roll ? ` (rolled ${roll.total})` : ""}`;
}

async function announce(actor, sourceItem, c, text) {
  if ( !text ) return;
  const esc = s => foundry.utils.escapeHTML?.(String(s)) ?? String(s);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="item-builder-5e-recharge"><strong>${esc(sourceItem?.name ?? "")}${c.name ? ` — ${esc(c.name)}` : ""}</strong><br>${esc(text)}</div>`,
    flags: { [MODULE_ID]: { recharge: c.id } }
  });
}

/* -------------------------------------------- */
/*  Item data                                   */
/* -------------------------------------------- */

function readRecord(item) {
  try {
    const raw = item.getFlag?.(MODULE_ID, "recharges");
    return typeof raw === "string" ? JSON.parse(raw || "{}") : (raw ?? {});
  } catch { return {}; }
}

/** The item's recharge components that are unlocked at its current tier. */
function currentRecharges(item) {
  const comps = item?.getFlag?.(MODULE_ID, "components") ?? item?.flags?.[MODULE_ID]?.components ?? [];
  const tier = Number(item?.getFlag?.(MODULE_ID, "currentTier") ?? item?.flags?.[MODULE_ID]?.currentTier ?? 1);
  return comps.filter(c => c.type === "recharge" && (Number(c.tier) || 1) <= tier);
}

/** Make the item's recharge activities match its recharge components at the current tier. Spent uses are kept. */
export async function syncRecharges(item) {
  if ( !item?.system?.activities ) return;
  const record = readRecord(item);
  const wanted = currentRecharges(item);
  if ( !Object.keys(record).length && !wanted.length ) return;
  const spent = {};
  for ( const [cid, actId] of Object.entries(record) ) {
    const act = item.system.activities.get?.(actId);
    if ( act ) { spent[cid] = act.uses?.spent ?? 0; await item.deleteActivity(actId); }
  }
  const next = {};
  for ( const c of wanted ) {
    const id = foundry.utils.randomID();
    const { type, data } = rechargeActivityData(c, { id, spent: spent[c.id] });
    try {
      await item.createActivity(type, data, { renderSheet: false });
      next[c.id] = id;
    } catch (err) {
      console.error(`${MODULE_ID} | could not create recharge "${c.name}"`, err);
      ui.notifications?.error(`${item.name}: recharge "${c.name}" could not be added.`);
    }
  }
  await item.setFlag(MODULE_ID, "recharges", JSON.stringify(next));
}

/** The recharge component an activity belongs to, or null. */
function componentForActivity(activity) {
  const item = activity?.item;
  if ( !item ) return null;
  const record = readRecord(item);
  const cid = Object.keys(record).find(k => record[k] === activity.id);
  return cid ? (currentRecharges(item).find(c => c.id === cid) ?? null) : null;
}

/* -------------------------------------------- */
/*  Running recharges                           */
/* -------------------------------------------- */

/** One client runs automatic recharges: an active player who owns the actor, else the active GM. */
function isResponsible(actor) {
  const owners = game.users.filter(u => u.active && !u.isGM && actor.testUserPermission?.(u, "OWNER"));
  if ( owners.length ) return owners.sort((a, b) => a.id.localeCompare(b.id))[0].id === game.user.id;
  return game.users.activeGM?.id === game.user.id;
}

/** The actor's recharge components with this trigger, ready to run: [{ item, c, activity }]. */
function rechargesFor(actor, triggers) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    if ( !item.flags?.[MODULE_ID] ) continue;
    const record = readRecord(item);
    for ( const c of currentRecharges(item) ) {
      if ( !triggers.includes(c.trigger) || !grantActive(item, c) ) continue;
      out.push({ item, c, activity: item.system?.activities?.get?.(record[c.id]) ?? null });
    }
  }
  return out;
}

/** Run an automatic recharge, spending one of its own uses if it has a limit. */
async function runAutomatic(actor, { item, c, activity }) {
  if ( !canRecharge(actor, c, item) ) return;
  const limited = activity && Number(activity.uses?.max) > 0;
  if ( limited && Number(activity.uses.value ?? (activity.uses.max - activity.uses.spent)) <= 0 ) return;
  const text = await performRecharge(actor, c, item, { interactive: true });
  if ( !text ) return;
  if ( limited ) await activity.update({ "uses.spent": (Number(activity.uses.spent) || 0) + 1 });
  await announce(actor, item, c, text);
}

let registered = false;
export function registerRechargeHooks() {
  if ( registered ) return;
  registered = true;

  // Recharges the player uses: stop before the activity spends its use if there is nothing to regain.
  Hooks.on("dnd5e.preUseActivity", activity => {
    const c = componentForActivity(activity);
    if ( !c ) return;
    const actor = activity.item?.actor;
    if ( !actor ) return;
    if ( !grantActive(activity.item, c) ) {
      ui.notifications?.warn(`${activity.item.name} must be ${c.activation === "attuned" ? "attuned" : "equipped"} to use ${c.name || "this"}.`);
      return false;
    }
    if ( !canRecharge(actor, c, activity.item) ) {
      ui.notifications?.warn(`${activity.item.name}: nothing to regain right now${c.onlyIfEmpty ? " (it only works when no uses are left)" : ""}.`);
      return false;
    }
  });
  Hooks.on("dnd5e.postUseActivity", async activity => {
    const c = componentForActivity(activity);
    if ( !c ) return;
    const actor = activity.item?.actor;
    try { await announce(actor, activity.item, c, await performRecharge(actor, c, activity.item)); }
    catch (err) { console.error(`${MODULE_ID} | recharge failed`, err); }
  });

  // Rests and dawn. The hook runs only on the client that took the rest.
  Hooks.on("dnd5e.restCompleted", async (actor, result, config) => {
    const type = result?.type ?? config?.type;
    const triggers = [];
    if ( type === "short" ) triggers.push("shortRest", "anyRest");
    if ( type === "long" ) triggers.push("longRest", "anyRest");
    if ( result?.newDay ?? config?.newDay ) triggers.push("dawn");
    for ( const r of rechargesFor(actor, triggers) ) {
      try { await runAutomatic(actor, r); } catch (err) { console.error(`${MODULE_ID} | recharge failed`, err); }
    }
  });

  // Initiative: any way it is rolled (sheet, tracker, Roll All) ends in a combatant getting a number.
  Hooks.on("preUpdateCombatant", (combatant, changes, options) => {
    if ( ("initiative" in changes) && changes.initiative !== null && combatant.initiative === null ) options[`${MODULE_ID}-rolled`] = true;
  });
  Hooks.on("updateCombatant", async (combatant, changes, options) => {
    if ( !options?.[`${MODULE_ID}-rolled`] ) return;
    const actor = combatant.actor;
    if ( !actor || !isResponsible(actor) ) return;
    for ( const r of rechargesFor(actor, ["initiative"]) ) {
      try { await runAutomatic(actor, r); } catch (err) { console.error(`${MODULE_ID} | recharge failed`, err); }
    }
  });

  // Start of the actor's turn.
  Hooks.on("combatTurnChange", async combat => {
    const actor = combat?.combatant?.actor;
    if ( !actor || !isResponsible(actor) ) return;
    for ( const r of rechargesFor(actor, ["turnStart"]) ) {
      try { await runAutomatic(actor, r); } catch (err) { console.error(`${MODULE_ID} | recharge failed`, err); }
    }
  });

  // Critical hits. The hook runs on the client that rolled the attack.
  Hooks.on("dnd5e.rollAttack", async (rolls, data) => {
    if ( !rolls?.some?.(r => r?.isCritical) ) return;
    const subject = data?.subject;
    const actor = subject?.actor ?? subject?.item?.actor;
    if ( !actor ) return;
    for ( const r of rechargesFor(actor, ["critical"]) ) {
      if ( r.c.thisItemOnly && subject?.item?.id !== r.item.id ) continue;
      try { await runAutomatic(actor, r); } catch (err) { console.error(`${MODULE_ID} | recharge failed`, err); }
    }
  });
}
