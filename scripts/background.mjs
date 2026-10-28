/**
 * 2024 backgrounds, written the way D&D5e's own backgrounds are:
 *   - Ability Score Improvement advancement over three abilities (+2/+1 or +1/+1/+1, max 20)
 *   - Trait advancement for two skill proficiencies and a tool proficiency (a set tool, or the
 *     player's choice from a category such as Artisan's Tools)
 *   - Item Grant advancement for the Origin feat
 *   - Trait advancement for languages (Common plus two Standard languages of the player's choice)
 *   - starting gold in D&D5e's Wealth field
 * D&D5e runs all of it when the background is dropped on a character, Item Builder or not.
 */
import { MODULE_ID } from "./compat.mjs";
import { advancementObject } from "./asi.mjs";

export const DEFAULT_BACKGROUND = { abilities: [], skills: ["", ""], tool: "", languages: true, featUuid: "", wealth: "50" };

export function backgroundSettings(bg) {
  const b = { ...DEFAULT_BACKGROUND, ...(bg ?? {}) };
  b.abilities = [...new Set((b.abilities ?? []).filter(Boolean))].slice(0, 3);
  b.skills = [...(b.skills ?? []), "", ""].slice(0, 2);
  return b;
}

/** Tool proficiency options as [{ key, label, depth }], e.g. "tool:art:*" = any Artisan's Tools. */
export async function toolChoices() {
  const Trait = globalThis.dnd5e?.documents?.Trait;
  const out = [];
  try {
    const choices = await Trait?.choices?.("tool", { prefixed: true, any: true });
    const walk = (obj, depth) => {
      for ( const [key, v] of Object.entries(obj ?? {}) ) {
        if ( key === "tool:*" ) continue;
        // A group heading (e.g. "tool:art") would grant every tool in it; offer its "Any …" entry instead.
        if ( key.endsWith(":*") || (v?.selectable !== false && !v?.children) ) out.push({ key, label: String(v?.label ?? key), depth });
        if ( v?.children ) walk(v.children, depth + 1);
      }
    };
    walk(choices?.toObject?.() ?? choices, 0);
  } catch (err) { console.warn(`${MODULE_ID} | could not list tools`, err); }
  return out;
}

const ASI_TITLE = "Background Ability Score Improvement";

/** The advancement a background needs, keyed by role. */
export function backgroundAdvancementData(bg, abilityKeys) {
  const b = backgroundSettings(bg);
  const out = {};
  if ( b.abilities.length ) {
    const names = b.abilities;
    out.asi = {
      type: "AbilityScoreImprovement", level: 0, title: ASI_TITLE,
      hint: `Increase one of these scores by 2 and a different one by 1, or increase all three by 1. None of these increases can raise a score above 20.`,
      configuration: { cap: 2, points: 3, fixed: Object.fromEntries(abilityKeys.map(k => [k, 0])), locked: abilityKeys.filter(k => !names.includes(k)) }
    };
  }
  const grants = [...b.skills.filter(Boolean).map(s => `skills:${s}`)];
  const choices = [];
  if ( b.tool ) {
    if ( b.tool.endsWith(":*") ) choices.push({ count: 1, pool: [b.tool] });
    else grants.push(b.tool);
  }
  if ( grants.length || choices.length ) {
    out.prof = { type: "Trait", level: 0, title: "Background Proficiencies", hint: "",
      configuration: { mode: "default", allowReplacements: false, grants, choices } };
  }
  if ( b.featUuid ) {
    out.feat = { type: "ItemGrant", level: 0, title: "Background Feat", hint: "",
      configuration: { items: [{ uuid: b.featUuid, optional: false }], optional: false, spell: null } };
  }
  if ( b.languages ) {
    out.lang = { type: "Trait", level: 0, title: "Choose Languages",
      hint: "Your character knows at least three languages: Common plus two Standard languages you choose.",
      configuration: { mode: "default", allowReplacements: false, grants: ["languages:standard:common"], choices: [{ count: 2, pool: ["languages:standard:*"] }] } };
  }
  return out;
}

/**
 * Write the background's advancement into item data, reusing earlier advancement IDs so choices
 * already made on characters stay linked. Returns { ids, removed }.
 */
export function applyBackgroundAdvancement(data, bg, abilityKeys, randomId) {
  data.system ??= {};
  const adv = advancementObject(data.system.advancement);
  const prev = { ...(data.flags?.[MODULE_ID]?.nativeBackgroundIds ?? {}) };
  const next = {};
  for ( const [role, a] of Object.entries(backgroundAdvancementData(bg, abilityKeys)) ) {
    const id = prev[role] && (prev[role] in adv) ? prev[role] : (prev[role] || randomId());
    const old = adv[id];
    const keep = old?.type === a.type ? (old.value ?? {}) : (a.type === "Trait" ? { chosen: [] } : {});
    adv[id] = { _id: id, ...a, value: keep };
    next[role] = id;
  }
  const removed = Object.values(prev).filter(id => !Object.values(next).includes(id) && (id in adv));
  for ( const id of removed ) delete adv[id];
  data.system.advancement = adv;
  data.system.wealth = String(backgroundSettings(bg).wealth ?? "").trim();
  return { ids: next, removed };
}

/** Player-facing description lines. `label(key)` names a trait key; `names[uuid]` names a feat. */
export function backgroundLines(bg, { ability = k => k, skill = k => k, tool = k => k, names = {} }={}) {
  const b = backgroundSettings(bg);
  const list = a => a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`;
  const lines = [];
  if ( b.abilities.length ) lines.push(`Ability Scores: ${list(b.abilities.map(ability))}`);
  const skills = b.skills.filter(Boolean).map(skill);
  if ( skills.length ) lines.push(`Skill Proficiencies: ${list(skills)}`);
  if ( b.tool ) lines.push(`Tool Proficiency: ${b.tool.endsWith(":*") ? `one kind of ${tool(b.tool.replace(/:\*$/, ""))} of your choice` : tool(b.tool)}`);
  if ( b.featUuid && names[b.featUuid] ) lines.push(`Feat: ${names[b.featUuid]}`);
  if ( b.languages ) lines.push("Languages: Common and two Standard languages of your choice");
  if ( Number(b.wealth) ) lines.push(`Starting Gold: ${Number(b.wealth)} GP`);
  return lines;
}
