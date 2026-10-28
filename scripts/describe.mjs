/**
 * Player-facing text for an item's Item Builder properties.
 *
 * The item's description shows what the item does at its current tier ("+1 bonus to attack and
 * damage rolls", "You can cast Misty Step…"), below the GM's own text. Locked tiers are never
 * listed, so tiering an item up adds its new properties to the description automatically.
 * The list is hidden in chat cards (see styles), which keep only the GM's text.
 */
import { MODULE_ID, usesLabel } from "./compat.mjs";
import { RULE_CATEGORIES, ROLL_TARGETS, participantLabels, triggerOptions } from "./rules.mjs";
import { reactionSummary } from "./reactions.mjs";
import { requirementLine } from "./requirements.mjs";
import { lightLine } from "./light.mjs";

const cfg = (path, fallback={}) => foundry.utils.getProperty(globalThis.CONFIG?.DND5E ?? {}, path) ?? fallback;
const loc = (raw, fallback="") => game.i18n.localize(raw?.label ?? raw ?? fallback) || fallback;
const esc = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const MOVE_WORDS = { walk: "walking", fly: "flying", swim: "swimming", climb: "climbing", burrow: "burrowing" };
export function moveWord(key) { return MOVE_WORDS[key] ?? String(key ?? "").toLowerCase(); }

/** "attack rolls", "Athletics checks", "Dexterity saving throws", "initiative rolls"… */
function rollWords(c) {
  const t = c.rollTarget || "attack";
  const ab = c.ability ? loc(cfg("abilities", {})[c.ability], c.ability) : "";
  if ( t === "skill" ) return c.skill ? `${loc(cfg("skills", {})[c.skill], c.skill)} checks` : "skill checks";
  if ( t === "save" ) return ab ? `${ab} saving throws` : "saving throws";
  if ( t === "check" ) return ab ? `${ab} checks` : "ability checks";
  if ( t === "initiative" ) return "initiative rolls";
  return String(ROLL_TARGETS[t] ?? "rolls").toLowerCase();
}

/** Which side of a rule is always the item's own user (its creature filters would only ever test the user). */
export function selfSide(c){
  if(c.ruleCategory==="healing")return null;
  const p=participantLabels(c);
  if(/item user|effect user/i.test(p.source))return "source";
  if(/item user|effect user/i.test(p.target))return "target";
  return null;
}

export function listText(items,joiner="or"){
  if(items.length<2)return items.join("");
  return `${items.slice(0,-1).join(", ")} ${joiner} ${items.at(-1)}`;
}

/**
 * One plain-English sentence describing a rule card. `player: true` gives the wording used in
 * the item's description (no builder notes).
 */
export function ruleSentence(c, { player=false }={}){
  const f=String(c.formula??"").trim()||"?";
  const dt=c.damageType&&c.damageType!=="any"?loc(cfg("damageTypes",{})[c.damageType],c.damageType).toLowerCase():"";
  const ab=c.ability?loc(cfg("abilities",{})[c.ability],c.ability):"";
  const effect={
    extraDamage:`Deals an extra ${f}${dt?` ${dt}`:""} damage`,
    sameTypeDamage:`Deals an extra ${f} damage when the attack deals ${dt||"the chosen"} damage`,
    attackBonus:`+${f} to attack rolls`,
    attackAdvantage:"Advantage on attack rolls",
    reachBonus:`+${f} ft. reach`,
    resistance:`Resistance to ${dt||"all"} damage`,
    immunity:`Immunity to ${dt||"all"} damage`,
    vulnerability:`Vulnerability to ${dt||"all"} damage`,
    acBonus:`+${f} AC`,
    saveBonus:`+${f} to ${ab?`${ab} `:""}saving throws`,
    saveAdvantage:`Advantage on ${ab?`${ab} `:""}saving throws`,
    bonusHealing:`Healing you do restores ${f} more hit points`,
    healingReceived:/^-/.test(f)?`${f} to healing you receive`:`+${f} to healing you receive`,
    temporaryHp:`Grants ${f} temporary hit points`,
    recoveryBonus:`+${f} per Hit Die spent`,
    sizeChange:(()=>{const n=Math.abs(Number(c.sizeSteps)||1);const word=["one","two","three"][n-1]??n;
      if(c.sizeMode==="set")return `${player?"You become":"Becomes"} ${loc(cfg("actorSizes",{})[c.size||"lg"],c.size||"lg")} size${player?"":", with tokens resized to match"}`;
      const shrink=Number(c.sizeSteps)<0||c.sizeMode==="shrink";
      return player?`You ${shrink?"shrink":"grow"} ${word} size${n>1?"s":""} ${shrink?"smaller":"larger"}`:`${shrink?"Shrinks":"Grows"} ${n} size${n===1?"":"s"}, with tokens resized to match`;})(),
    movementControl:`${/^-/.test(f)?f:`+${f}`} ft. ${moveWord(c.ability||"walk")} speed`,
    advantage:`Advantage on ${rollWords(c)}`,
    disadvantage:`Disadvantage on ${rollWords(c)}`
  }[c.effect]??(RULE_CATEGORIES[c.ruleCategory]?.effects?.[c.effect]??"This effect");
  const parts=[effect];
  if(c.ruleCategory==="defensive"){
    const trig=c.trigger||"damage";
    let t;
    if(["saveBonus","saveAdvantage"].includes(c.effect))t={saveAgainstMagic:"against spells and magical effects",saveAgainstSpell:"against spells"}[trig]??"";
    else if(c.effect==="acBonus")t={melee:"against melee attacks",ranged:"against ranged attacks",spell:"against spell attacks"}[trig]??(player?"":"against attacks");
    else t=(player&&trig==="damage")?"":String(triggerOptions(c.effect)[trig]??"").toLowerCase();
    if(t)parts.push(t);
  }
  const types=k=>(c[k]??[]).map(t=>loc(cfg("creatureTypes",{})[t],t).toLowerCase());
  const p=participantLabels(c);
  const who=(label,list,sub)=>{
    const bits=[];if(list.length)bits.push(listText(list));if(sub)bits.push(`${sub} subtype`);
    return bits.length?`the ${label.split(/\s*[/(]/)[0].trim().toLowerCase()} is ${bits.join(", ")}`:"";
  };
  let filters;
  if(player){
    // Players read "only against fiends", "only for attacks named “Bite”".
    const self=selfSide(c);
    const other=self==="source"?"target":"source";
    const list=(c[`${other}Types`]??[]).map(t=>plural(loc(cfg("creatureTypes",{})[t],t).toLowerCase()));
    const sub=c[`${other}Subtype`];
    const kinds=[...list,...(sub?[`${sub} creatures`]:[])];
    filters=[];
    if(kinds.length)filters.push(`${c.ruleCategory==="defensive"?"from":"against"} ${listText(kinds)}`);
    if(String(c.activityName??"").trim())filters.push(`for ${c.ruleCategory==="defensive"?"attacks":"attacks and abilities"} named “${String(c.activityName).trim()}”`);
    let out=parts.join(" ");
    return out+(filters.length?`, only ${filters.join(" and ")}.`:".");
  }
  filters=[who(p.source,types("sourceTypes"),c.sourceSubtype),who(p.target,types("targetTypes"),c.targetSubtype)].filter(Boolean);
  if(String(c.activityName??"").trim())filters.push(`the attack or ability is named “${String(c.activityName).trim()}”`);
  let out=parts.join(" ");
  out+=filters.length?`, only when ${listText(filters,"and")}.`:(player?".":", always.");
  return out;
}



const PLURAL = { undead: "undead", fey: "fey", monstrosity: "monstrosities", swarm: "swarms" };
function plural(word) { return PLURAL[word] ?? (word.endsWith("s") ? word : `${word}s`); }

const ORD = n => ["", "1st", "2nd", "3rd"][n] ?? `${n}th`;
const abilityName = k => loc(cfg("abilities", {})[k], k);
const per = { sr: "short rest", lr: "long rest", day: "day", dawn: "dawn" };

function usesText(c) {
  const u = usesLabel(c, abilityName);
  if ( !u ) return "";
  const count = /^\d+$/.test(u) ? `${u} time${u === "1" ? "" : "s"}` : `a number of times equal to your ${u}`;
  const p = per[c.recovery];
  return ` ${count}${p ? ` per ${p}` : ""}`;
}

/** One description line for a component, or "" if it adds nothing for the player. */
export function componentLine(c, { spellName, names={} }={}) {
  const ft = v => `${Number(v) || 0} ft.`;
  switch ( c.type ) {
    case "movement": {
      const m = moveWord(c.movementType);
      return c.mode === "override" ? `You have a ${m} speed of ${ft(c.value)}` : `Your ${m} speed increases by ${ft(c.value)}`;
    }
    case "sense": {
      if ( c.sense === "devilsSight" ) return `You can see normally in darkness, both magical and nonmagical, out to ${ft(c.value || 120)} (Devil's Sight)`;
      const s = { darkvision: "Darkvision", blindsight: "Blindsight", tremorsense: "Tremorsense", truesight: "Truesight" }[c.sense] ?? c.sense;
      if ( c.mode === "add" ) return `Your ${s.toLowerCase()} range increases by ${ft(c.value)}`;
      if ( c.mode === "override" ) return `Your ${s.toLowerCase()} range becomes ${ft(c.value)}`;
      return `You have ${s.toLowerCase()} out to ${ft(c.value)}`;
    }
    case "ability":
      return c.mode === "override" ? `Your ${abilityName(c.ability)} score becomes ${c.value}` : `+${c.value} to your ${abilityName(c.ability)} score`;
    case "skill": {
      const sk = loc(cfg("skills", {})[c.skill], c.skill);
      return `${String(c.proficiency) === "2" ? "Expertise" : "Proficiency"} in ${sk}${c.ability ? ` (using ${abilityName(c.ability)})` : ""}`;
    }
    case "halfAsi": {
      if ( c.selectionMode === "fixed" ) return `+1 to your ${abilityName(c.ability)} score (maximum 20)`;
      const allowed = (c.allowedAbilities?.length ? c.allowedAbilities : Object.keys(cfg("abilities", {}))).map(abilityName);
      return `+1 to one ability score of your choice${allowed.length < 6 ? ` (${listText(allowed)})` : ""}, to a maximum of 20`;
    }
    case "spell": {
      if ( !spellName ) return "";
      const lvl = Number(c.level);
      return `You can cast ${spellName}${Number.isFinite(lvl) && c.level !== "" && lvl > 0 ? ` at ${ORD(lvl)} level` : ""}${usesText(c) || " at will"}`;
    }
    case "reaction":
      return reactionSummary(c, abilityName).replace(/\.$/, "").replace(/^Reaction —/, `${c.name || "Reaction"} (Reaction) —`);
    case "reference":
      return String(c.text ?? "").trim();
    case "requirement":
      return requirementLine(c);
    case "light":
      return lightLine(c);
    case "fightingStyle": {
      if ( c.mode === "gm" ) return names[c.styleUuid] ? `You gain the ${names[c.styleUuid]} Fighting Style` : "";
      const pool = (c.poolUuids ?? []).map(u => names[u]).filter(Boolean);
      return `You gain a Fighting Style of your choice${pool.length ? ` (${listText(pool)})` : ""}`;
    }
    case "conditional": {
      if ( c.effect === "statusEffect" ) {
        if ( !c.status ) return "";
        const st = (globalThis.CONFIG?.statusEffects ?? []).find(e => e.id === c.status);
        const name = st ? loc(st.name ?? st.label, c.status) : c.status;
        return c.appliesTo === "target"
          ? `Its attacks and effects can make the target ${name.toLowerCase()}`
          : `You are ${name.toLowerCase()} while you have it`;
      }
      if ( c.effect === "activeEffect" ) return "";
      return ruleSentence(c, { player: true }).replace(/\.$/, "");
    }
    default:
      return "";
  }
}

/** The description lines for an item at a tier. */
export function propertyLines(flags, tier, { spellNames={} }={}) {
  const lines = [];
  const bonus = Number(flags?.enhancementBonus) || 0;
  if ( bonus > 0 ) {
    if ( flags.category === "weapon" ) lines.push(`+${bonus} bonus to attack and damage rolls made with this weapon`);
    else if ( flags.category === "armor" ) lines.push(`+${bonus} bonus to AC while you wear it`);
  }
  for ( const c of flags?.components ?? [] ) {
    if ( (Number(c.tier) || 1) > tier ) continue;
    const line = componentLine(c, { spellName: spellNames[c.spellUuid], names: spellNames });
    if ( line ) lines.push(line);
  }
  return lines;
}

const SECTION = /<div[^>]*class="[^"]*ib-properties[^"]*"[^>]*>[\s\S]*?<\/ul>\s*<\/div>/gi;
const FALLBACK = /<h3[^>]*>\s*Item Properties\s*<\/h3>\s*<ul[^>]*>[\s\S]*?<\/ul>/gi;

/** The description without Item Builder's properties list. */
export function withoutProperties(html) {
  return String(html ?? "").replace(SECTION, "").replace(FALLBACK, "").replace(/(\s*<p>\s*<\/p>\s*)+$/i, "").trim();
}

/** HTML for the properties list (empty when there is nothing to list). */
export function propertiesHtml(lines, tierName="") {
  if ( !lines.length ) return "";
  return `<div class="ib-properties"><h3>Item Properties${tierName ? ` <span class="ib-tier">(${esc(tierName)})</span>` : ""}</h3><ul>${
    lines.map(l => `<li>${esc(l.charAt(0).toUpperCase() + l.slice(1))}${/[.!?]$/.test(l) ? "" : "."}</li>`).join("")}</ul></div>`;
}

/**
 * Rebuild the item's description: the GM's text, then what the item does at its current tier.
 * Text the GM edited directly on the item sheet is kept.
 */
export async function refreshItemDescription(item) {
  const flags = item?.flags?.[MODULE_ID];
  if ( !flags ) return;
  const tier = Number(flags.currentTier ?? 1) || 1;
  const spellNames = {};
  for ( const c of flags.components ?? [] ) {
    const uuids = c.type === "spell" ? [c.spellUuid] : c.type === "fightingStyle" ? [c.styleUuid, ...(c.poolUuids ?? [])] : [];
    for ( const u of uuids.filter(Boolean) ) {
      try { spellNames[u] = (await fromUuid(u))?.name ?? ""; } catch { /* missing document */ }
    }
  }
  const tiers = flags.tiers ?? [];
  const tiered = tiers.length > 1 && (flags.components ?? []).some(c => (Number(c.tier) || 1) > 1);
  const tierName = tiered ? (tiers[tier - 1]?.name ?? "") : "";
  const current = item._source?.system?.description?.value ?? "";
  const gm = withoutProperties(current);
  const list = propertiesHtml(propertyLines(flags, tier, { spellNames }), tierName);
  const next = [gm, list].filter(Boolean).join("\n");
  if ( next !== current ) await item.update({ "system.description.value": next });
}
