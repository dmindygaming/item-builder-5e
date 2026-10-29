/**
 * "Describe It": turns a GM's plain-English item description into Item Builder components.
 *
 * Runs entirely offline. It reads the phrases item write-ups usually use ("+1 longsword",
 * "resistance to fire damage", "darkvision out to 60 feet", "cast misty step once per long rest",
 * "sheds bright light in a 20-foot radius", ...) and suggests the matching components. Nothing is
 * added until the GM reviews and accepts the suggestions. Sentences it cannot read are handed back
 * so the GM can keep them as description text.
 *
 * This file has no Foundry dependencies: everything it needs to know about the world (spell names,
 * damage types, skills...) is passed in as `ctx`.
 */

const NUM_WORDS = { a: 1, an: 1, one: 1, once: 1, two: 2, twice: 2, three: 3, thrice: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = w => { const n = Number(w); return Number.isFinite(n) ? n : (NUM_WORDS[String(w).toLowerCase()] ?? null); };
const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const word = w => `(?<![a-z])${w}(?![a-z])`;
const NUMBER = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten)";

const SIZE_WORDS = { tiny: "tiny", small: "sm", medium: "med", large: "lg", huge: "huge", gargantuan: "grg" };
const RARITY_WORDS = [["very rare", "veryRare"], ["uncommon", "uncommon"], ["legendary", "legendary"], ["artifact", "artifact"], ["common", "common"], ["rare", "rare"]];
const MOVE_WORDS = { fly: "fly", flying: "fly", swim: "swim", swimming: "swim", climb: "climb", climbing: "climb", burrow: "burrow", burrowing: "burrow", walk: "walk", walking: "walk" };
const DEFENSE_EFFECTS = new Set(["resistance", "immunity", "vulnerability"]);
const MOVE_LABELS = { fly: "Flying", swim: "Swimming", climb: "Climbing", burrow: "Burrowing", walk: "Walking" };
const SENSES =["darkvision", "blindsight", "tremorsense", "truesight"];
const DEFAULT_TIER_WORDS = ["dormant", "awakened", "exalted"];

/** Split text into sentences, remembering which tier each belongs to. */
function sentences(text, tierNames) {
  const names = tierNames.map(n => String(n ?? "").trim().toLowerCase()).filter(Boolean);
  const tierOf = label => {
    const l = label.trim().toLowerCase();
    const m = l.match(/^tier\s*(\d+)$/);
    if ( m ) return Number(m[1]);
    const i = names.indexOf(l);
    if ( i >= 0 ) return i + 1;
    const d = DEFAULT_TIER_WORDS.indexOf(l);
    return d >= 0 ? d + 1 : null;
  };
  const headRe = new RegExp(`^\\s*(tier\\s*\\d+|${[...names, ...DEFAULT_TIER_WORDS].map(reEsc).join("|")})(?:\\s*\\(([^)]*)\\))?\\s*(?:[:\\-–—.]\\s*(.*))?$`, "i");
  const out = [];
  let tier = 1;
  for ( const raw of String(text ?? "").split(/\r?\n/) ) {
    let line = raw.trim().replace(/^[-*•]\s*/, "");
    if ( !line ) continue;
    const head = line.match(headRe);
    if ( head ) {
      const t = tierOf(head[1]);
      if ( t ) { tier = t; line = (head[3] ?? "").trim(); if ( !line ) continue; }
    }
    const parts = line.split(/(?<=[.!?;])\s+(?=[A-Z("'+\d])/);
    for ( const p of parts ) {
      const s = p.trim();
      if ( !s ) continue;
      let t = tier;
      const inline = s.match(new RegExp(`\\b(?:at|from|starting at|once it reaches|when it reaches|upon reaching|in its|in the)\\s+(?:the\\s+)?(tier\\s*\\d+|${[...names, ...DEFAULT_TIER_WORDS].map(reEsc).join("|")})(?:\\s+(?:tier|state|form))?\\b`, "i"))
        ?? s.match(/\(\s*(tier\s*\d+)\s*\)/i);
      if ( inline ) t = tierOf(inline[1]) ?? t;
      out.push({ text: s, tier: t });
    }
  }
  return out;
}

/** Normalised lower-case copy used for matching. */
function norm(s) {
  return String(s).toLowerCase()
    .replace(/[’‘]/g, "'").replace(/[“”]/g, "\"").replace(/[–—]/g, "-")
    .replace(/(\d+)\s*-?\s*(?:foot|feet|ft\.?)(?![a-z])/g, "$1 feet")
    .replace(/\bsaves\b/g, "saving throws")
    .replace(/\bvs\.?(?=\s)/g, "against").replace(/\bw\/(?=\s)/g, "with")
    .replace(/\bdisadv\b\.?/g, "disadvantage").replace(/\badv\b\.?/g, "advantage")
    .replace(/\bhp\b/g, "hit points").replace(/\b(?:pb|prof bonus)\b/g, "proficiency bonus")
    .replace(/\b(str|dex|con|int|wis|cha)\b\.?(?=\s*(?:\(|save|saving|check|mod|modifier|score|\+|\d))/g, (_m, a) => ({ str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma" })[a])
    .replace(/\s+/g, " ").trim();
}

/* -------------------------------------------- */
/*  Vocabulary                                  */
/* -------------------------------------------- */

/** Nouns that say what kind of item it is. */
const ITEM_NOUNS = {
  consumable: "potion|potions|elixir|philter|philtre|draught|tonic|brew|oil|salve|ointment|balm|scroll|dust|powder|ammunition|arrows?|bolts?|bullets?|needles?|bomb|grenade|vial",
  equipment: "wondrous item|ring|amulet|necklace|neckguard|neckband|choker|gorget|pendant|periapt|medallion|talisman|amulet|brooch|pin|badge|cloak|cape|mantle|robes?|vestments?|boots|slippers|shoes|sandals|belt|girdle|sash|gloves|gauntlets|bracers|bracelet|bangle|armband|helm|helmet|hat|cap|hood|circlet|crown|tiara|headband|diadem|goggles|lenses|spectacles|monocle|eyes of|mask|bag|pouch|sack|backpack|quiver|rope|figurine|statuette|gem|jewel|stone|ioun|orb|crystal|horn|lyre|lute|drum|flute|pipes|harp|instrument|wand|rod|staff|lantern|lamp|candle|coin|token|deck|cube|carpet|broom|mirror|book|tome|manual|censer|chime|bell|compass|key|charm|totem|idol|trinket|earrings?|tattoo|cauldron|bottle|flask|jug|greaves|vambraces|pauldrons|sabatons|wraps|bandolier|scarf|shawl|veil|collar|anklet|locket|scarab|phylactery|effigy|emblem|insignia|signet|loop|feather|shell|skull|tooth|claw|cord|chain(?! mail| shirt)|spurs|saddle|horseshoes|banner|flag|sigil|rune",
  armor: "armor|armour|breastplate|chain shirt|chainmail|mail|scale mail|hauberk|cuirass|brigandine",
  weapon: "sword|blade|axe|bow|crossbow|hammer|mace|spear|dagger|knife|club|whip|lance|scythe|sickle|flail|staff of striking|hilt|pommel|haft|crossguard|quillons|arrowhead|weapon"
};
/** Words that make a clause a rule rather than flavor. */
const CLAUSE_RULE = /\b(regain|hit points|breathe|can't|cannot|immune|advantage|disadvantage|reroll|teleport|cast|charges?|once per|per day|you can|lets you|allows you|ignore|maximi[sz]e|critical|instead|equal to)\b/i;
const CATEGORY_LABELS = { consumable: "Consumable", equipment: "Other Equipment", armor: "Armor", weapon: "Weapon" };

/** Condition words and their common synonyms. */
const CONDITION_WORDS = [
  ["charmed", /\bcharm(?:ed|s|ing)?\b/], ["frightened", /\bfright(?:en(?:ed|ing|s)?|ful)\b|\bfear(?:s|ful)?\b|\bscared\b|\bterrif\w*|\bterror\b/],
  ["poisoned", /\bpoisoned\b|\bpoison\b(?!\s+damage)/], ["paralyzed", /\bparaly[sz]\w*/], ["stunned", /\bstun(?:ned|s)?\b/],
  ["blinded", /\bblind(?:ed|ness)?\b/], ["deafened", /\bdeaf(?:ened|ness)?\b/], ["petrified", /\bpetrif\w*/],
  ["restrained", /\brestrain(?:ed|s)?\b/], ["grappled", /\bgrappl(?:ed|e|es|ing)\b/], ["prone", /\bprone\b/],
  ["incapacitated", /\bincapacitated\b/], ["unconscious", /\bunconscious\b|\bmagical sleep\b|\bput to sleep\b/],
  ["exhaustion", /\bexhaust\w*/], ["invisible", /\binvisib\w*/]
];
/** Creature subtypes Item Builder can match by subtype or name. */
const SUBTYPE_WORDS = { vampire: "vampire", demon: "demon", devil: "devil", angel: "angel", lycanthrope: "shapechanger", werewolf: "shapechanger", shapechanger: "shapechanger", yugoloth: "yugoloth", titan: "titan", goblinoid: "goblinoid", goblin: "goblinoid", gnoll: "gnoll", kobold: "kobold", orc: "orc", gith: "gith", lich: "lich", hag: "hag", dragon: "" };

/** Lookup tables built from the world's configuration. */
function tables(ctx) {
  const entries = o => Object.entries(o ?? {}).map(([k, v]) => [k, String(v || k).toLowerCase().trim()]).filter(([, l]) => l);
  const damage = entries(ctx.damageTypes);
  const abilities = entries(ctx.abilities);
  const skills = entries(ctx.skills).sort((a, b) => b[1].length - a[1].length);
  const creatures = entries(ctx.creatureTypes);
  const conditions = entries(ctx.conditions);
  const classes = entries(ctx.classes);
  return { damage, abilities, skills, creatures, conditions, classes };
}

function damageTypesIn(phrase, T) {
  if ( /\ball (?:types of )?damage\b|\bdamage of all types\b/.test(phrase) ) return ["any"];
  return T.damage.filter(([k, l]) => new RegExp(word(reEsc(l))).test(phrase) || new RegExp(word(reEsc(k))).test(phrase)).map(([k]) => k);
}
/** Damage types listed right after `idx`: "fire, cold, and lightning damage". */
function damageRun(s, idx, T) {
  const tokens = s.slice(idx).split(/[.;:]/)[0].split(/(\s+|,)/).filter(t => t && !/^\s+$/.test(t) && t !== ",");
  const words = [];
  for ( const t of tokens ) {
    if ( /^(?:and|or|damage|all|types?|of|from|nonmagical|the)$/.test(t) || T.damage.some(([k, l]) => l === t || k === t) ) words.push(t);
    else break;
  }
  return damageTypesIn(words.join(" "), T);
}
function abilityIn(phrase, T) {
  for ( const [k, l] of T.abilities ) if ( new RegExp(word(reEsc(l))).test(phrase) || new RegExp(`(?<![a-z])${k}(?![a-z])`).test(phrase) && /save|check|score/.test(phrase) ) return k;
  return "";
}
function skillsIn(phrase, T) {
  const found = [];
  let rest = phrase;
  for ( const [k, l] of T.skills ) {
    const re = new RegExp(word(reEsc(l)));
    const at = rest.search(re);
    if ( at >= 0 ) { found.push([at, k]); rest = rest.replace(re, m => " ".repeat(m.length)); }
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, k]) => k);
}
/** "sleight of hand" -> "Sleight of Hand". */
const titled = t => String(t).replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/\b(Of|And|The|In)\b/g, w => w.toLowerCase()).replace(/^./, c => c.toUpperCase());
function creaturesIn(phrase, T) {
  return T.creatures.filter(([k, l]) => {
    const stem = l.replace(/y$/, "(?:y|ies)");
    return new RegExp(`(?<![a-z])${stem}(?:s|es)?(?![a-z])`).test(phrase);
  }).map(([k]) => k);
}
/** "undead" and "fey" stay as they are; "monstrosity" -> "monstrosities"; others add "s". */
const plural = w => /^(?:undead|fey)$/.test(w) ? w : w.endsWith("y") ? `${w.slice(0, -1)}ies` : w.endsWith("s") ? w : `${w}s`;
function conditionsIn(phrase, T) {
  const ids = new Set(T.conditions.map(([k]) => k));
  return CONDITION_WORDS.filter(([id, re]) => (!ids.size || ids.has(id)) && re.test(phrase)).map(([id]) => id);
}
function subtypesIn(phrase) {
  const out = [];
  for ( const [w, sub] of Object.entries(SUBTYPE_WORDS) ) if ( sub && new RegExp(`(?<![a-z])${w}s?(?![a-z])`).test(phrase) && !out.includes(sub) ) out.push(sub);
  return out;
}
function classesIn(phrase, T) {
  return T.classes.filter(([k, l]) => new RegExp(`(?<![a-z])${reEsc(l)}s?(?![a-z])`).test(phrase)).map(([k]) => k);
}
const formulaRe = "(\\d*d\\d+(?:\\s*[+-]\\s*\\d+)?|\\d+)";

/** How many uses, from phrases like "once per long rest" or "3 charges ... regains all at dawn". */
function usesIn(s, T) {
  let mode = "", count = "1", ability = "", recovery = "lr";
  let m;
  if ( /\bat will\b/.test(s) ) return { usesMode: "unlimited" };
  if ( (m = s.match(/(?:a number of times equal to|times equal to|uses equal to)\s+(?:your )?proficiency bonus/)) || /proficiency bonus times/.test(s) ) mode = "prof";
  else if ( (m = s.match(/(?:a number of times equal to|times equal to)\s+(?:your )?(\w+) modifier/)) ) { mode = "ability"; ability = abilityIn(m[1], T) || "cha"; }
  else if ( (m = s.match(/\b(\d+)\s*\/\s*(?:day|dawn|long rest|short rest|rest|lr|sr)\b/)) ) { mode = "fixed"; count = m[1]; }
  else if ( (m = s.match(new RegExp(`\\b(once|twice|thrice|${NUMBER}\\s+times?)\\b(?! (?:the|your|its|their|as))`))) ) { mode = "fixed"; count = String(num(m[1].split(" ")[0]) ?? 1); }
  else if ( (m = s.replace(/(?:expend|spend|use|uses|using) (?:\d+|one|two|three) (?:of its )?charges?/g, "").match(new RegExp(`${NUMBER}\\s+charges?`))) ) { mode = "fixed"; count = String(num(m[1]) ?? 1); }
  if ( !mode ) return null;
  if ( /short (?:or long )?rest|\/\s*sr\b/.test(s) ) recovery = "sr";
  else if ( /\bdawn\b/.test(s) ) recovery = "dawn";
  else if ( /\b(?:per|each|a) day\b|\bdaily\b|\/\s*day\b/.test(s) ) recovery = "day";
  else if ( /long rest/.test(s) ) recovery = "lr";
  const out = { usesMode: mode, usesCount: count, recovery };
  if ( ability ) out.usesAbility = ability;
  return out;
}

const PERIOD = { lr: "long rest", sr: "short rest", dawn: "dawn", day: "day" };
function usesNote(u) {
  if ( !u || u.usesMode === "unlimited" ) return "";
  const per = PERIOD[u.recovery] ?? "long rest";
  if ( u.usesMode === "fixed" ) return ` (${u.usesCount}/${per})`;
  if ( u.usesMode === "prof" ) return ` (proficiency bonus/${per})`;
  return ` (ability modifier/${per})`;
}


/**
 * Parse a description.
 * @param {string} text
 * @param {object} ctx  { category, tiers:[names], spells:[{uuid,name}], weapons, armor, shields,
 *                        fightingStyles, abilities, skills, damageTypes, creatureTypes, conditions, classes }
 * @returns {{findings: object[], leftovers: {text:string,tier:number}[]}}
 *   Each finding: { label, tier, sentence, component?:{type, ...fields}, basics?:{...} }
 */
export function parseDescription(text, ctx={}) {
  const T = tables(ctx);
  const findings = [];
  const leftovers = [];
  let category = ctx.category ?? "";
  const list = sentences(text, ctx.tiers ?? []);

  // Base items: "longsword", "long sword", "long-sword" all match Longsword; the earliest mention wins.
  const SPLITS = /(sword|axe|bow|hammer|pick|star|staff|spear|blade|mail|plate|crossbow)$/;
  const nameRe = n => {
    const forms = new Set([n]);
    const m = n.match(SPLITS);
    if ( m && !n.includes(" ") && n.length > m[1].length + 2 ) forms.add(`${n.slice(0, -m[1].length)}[ -]?${m[1]}`);
    forms.add(n.replace(/ /g, "[ -]?"));
    return new RegExp(`(?<![a-z])(?:${[...forms].map(f => f.includes("[") ? f : reEsc(f)).join("|")})(?:s|es)?(?![a-z])`);
  };
  const findBase = s => {
    const pools = [["weapon", ctx.weapons ?? []], ["armor", ctx.armor ?? []], ["shield", ctx.shields ?? []]];
    let best = null;
    for ( const [kind, pool] of pools ) for ( const e of pool ) {
      const n = String(e.name ?? "").toLowerCase();
      if ( n.length < 3 ) continue;
      const hit = s.match(nameRe(n));
      if ( !hit ) continue;
      // Earliest mention wins; for the same spot, the longer name ("hand crossbow" over "crossbow").
      if ( !best || hit.index < best.at || (hit.index === best.at && n.length > best.n.length) ) best = { kind, e, n, at: hit.index };
    }
    return best;
  };

  let titleBase = null;
  // "Longsword." on its own is the base item, not the name.
  const isJustBase = t => {
    const b = findBase(norm(t));
    const letters = x => String(x).toLowerCase().replace(/^(?:an?|the)\s+/, "").replace(/[^a-z]/g, "").replace(/e?s$/, "");
    return !!b && letters(norm(t)) === letters(b.n);
  };

  // A short first line with no rules in it is the item's name.
  const first = list[0]?.text.replace(/[.:]$/, "").trim() ?? "";
  const words = first.split(/\s+/);
  const minor = /^(?:of|the|a|an|and|or|in|on|to|with)$/i;
  const capitalised = words.filter(w => !minor.test(w)).filter(w => /^[A-Z]/.test(w)).length;
  if ( !ctx._clause && list.length > 1 && first && words.length <= 6 && capitalised >= Math.ceil(words.filter(w => !minor.test(w)).length / 2)
    && !/\d|\b(?:cast|you|your|has|have|is|are|can|named|called|known as)\b|[(),+:]/i.test(first) && !isJustBase(first) ) {
    findings.push({ label: `Name: ${first}`, tier: 1, sentence: list[0].text, basics: { name: first } });
    list.shift();
    titleBase = findBase(norm(first));
  }
  let pendingUses = null;   // "The cloak has 3 charges..." waiting for the spells that use them.

  // What kind of item is it? The first item noun in the name or opening sentence ("Ring of…",
  // "A magical neckguard…", "Potion of…"). A base item found later (longsword, plate armor) wins.
  let inferred = null;
  if ( !ctx._clause ) {
    const opening = norm([findings.find(f => f.basics?.name)?.basics.name, list[0]?.text, list[1]?.text].filter(Boolean).join(". "));
    let best = null;
    for ( const [cat, words] of Object.entries(ITEM_NOUNS) ) {
      const hit = opening.match(new RegExp(`(?<![a-z])(?:${words})(?![a-z])`));
      if ( hit && (!best || hit.index < best.at) ) best = { cat, at: hit.index, word: hit[0] };
    }
    const base = findBase(opening);
    if ( best && /^quarterstaff/.test(opening.slice(best.at)) ) best = null;
    if ( best && !(base && base.at <= best.at) && !(best.cat === "weapon" && base) ) inferred = best;
  }
  // "Sentinel Shield", "Flame Tongue Longsword": a base item named in the title.
  if ( titleBase && !/staff$/.test(titleBase.n) ) {
    const cat = titleBase.kind === "weapon" ? "weapon" : "armor";
    findings.push({ label: `Base item: ${titleBase.e.name}`, tier: 1, sentence: findings.find(f => f.basics?.name)?.sentence ?? "",
      basics: { category: cat, baseUuid: titleBase.e.uuid, ...(cat === "armor" ? { armorType: titleBase.kind === "shield" ? "shield" : (titleBase.e.armorType || "") } : {}) } });
    inferred = null;
    category = cat;
  }
  if ( inferred ) category = inferred.cat;



  for ( const { text: original, tier } of list ) {
    const s = norm(original);
    const found = [];
    const add = (label, component, basics) => found.push({ label, tier, sentence: original, ...(component ? { component } : {}), ...(basics ? { basics } : {}) });
    let m;

    // --- Follow-up sentences that refine the previous suggestion ---
    const lastUsable = [...findings].reverse().find(f => ["reaction", "spell"].includes(f.component?.type));
    if ( lastUsable && /\b(?:use|cast) (?:this|the|that|it|these) (?:reaction|ability|feature|property|spell|way)\b|\bthis (?:reaction|ability|property|feature)\b|\bthis way\b|\bcan't (?:do so|use it) again\b/.test(s) ) {
      const u = usesIn(s, T);
      if ( u ) {
        Object.assign(lastUsable.component, u);
        lastUsable.label = lastUsable.label.replace(/ \([^)]*\)$/, m => /^ \(\d+\)$/.test(m) ? m : "") + usesNote(u);
        lastUsable.sentence += " " + original;
        continue;
      }
    }
    const lastLight = [...findings].reverse().find(f => f.component?.type === "light");
    if ( lastLight && /\b(?:extinguish|relight|douse|snuff|ignite|turn (?:it|the light) (?:on|off)|light or extinguish)\b/.test(s) ) {
      lastLight.component.activation = /bonus action/.test(s) ? "bonus" : /\bno action\b|\bfree\b/.test(s) ? "none" : "action";
      lastLight.sentence += " " + original;
      continue;
    }

    // --- Item type line: "Weapon (longsword), rare (requires attunement by a paladin)" ---
    const rarity = RARITY_WORDS.find(([w]) => new RegExp(`(?<![a-z])${w}(?![a-z])\\s*(?:\\(|,|$|magic item|item|\\.|rarity)`).test(s)
      || new RegExp(`rarity[^a-z]+(?:is\\s+)?${w}(?![a-z])`).test(s));
    if ( rarity && tier === 1 && !/\bcast|resist|advantage\b/.test(s) ) add(`Rarity: ${cap(rarity[0])}`, null, { rarity: rarity[1] });
    else if ( rarity && tier > 1 && /\b(?:becomes?|is now|rarity)\b/.test(s) ) add(`Tier ${tier} rarity: ${cap(rarity[0])}`, null, { tierRarity: { tier, rarity: rarity[1] } });

    // --- "Origin Feat named Martial Savant", "General feat (requires level 4)" ---
    const featMatch = tier === 1 && category !== "background" && !/^(?:an? )?(?:origin |general )?feat\s*:/.test(s) && s.match(/^(?:an? |this is an? |this )?(origin|general|epic boon|fighting style)?\s*(?:feat|feature)\b(?! of your choice)/);
    const featLine = featMatch && !/\b(?:gain|gains|adds?|grants?|gives?|lets?|choose|choice)\b/.test(s.split(/\b(?:named|called)\b/)[0]) ? featMatch : null;
    if ( featLine ) {
      const featType = { origin: "origin", general: "general", "epic boon": "epicBoon", "fighting style": "fightingStyle" }[featLine[1] ?? ""] ?? "";
      category = "feat";
      add(`Category: ${featType ? featLine[1].split(" ").map(cap).join(" ") + " " : ""}Feat`, null, { category: "feat", ...(featType ? { featType } : {}) });
    }
    // --- Backgrounds: "Background named Sellsword", then its parts ---
    if ( tier === 1 && category !== "background" && /^(?:an? |this is an? |this |the )?background\b/.test(s) ) {
      category = "background";
      add("Category: Background", null, { category: "background" });
    }
    if ( category === "background" ) {
      let bgHit = false;
      if ( (m = s.match(/ability scores?:?\s*([^.;]+)/)) || (m = s.match(/increase (?:your )?((?:[a-z]+,? )+(?:and|or) [a-z]+)(?: scores?)?/)) ) {
        const picks = T.abilities.filter(([, l]) => new RegExp(`(?<![a-z])${reEsc(l)}(?![a-z])`).test(m[1])).map(([k]) => k).slice(0, 3);
        if ( picks.length ) { add(`Ability scores: ${picks.map(k => cap(T.abilities.find(([a]) => a === k)[1])).join(", ")}`, null, { bgAbilities: picks }); bgHit = true; }
      }
      if ( /skill proficienc|proficien(?:cy|t) in/.test(s) ) {
        const sk = skillsIn(s.replace(/tool proficienc[^.;]*/, ""), T).slice(0, 2);
        if ( sk.length ) { add(`Skill proficiencies: ${sk.map(k => titled(T.skills.find(([a]) => a === k)[1])).join(", ")}`, null, { bgSkills: sk }); bgHit = true; }
      }
      if ( (m = s.match(/tool proficienc(?:y|ies):?\s*([^.;]+)|proficien(?:cy|t) with (?:an? |the )?([^.;]+)/)) ) {
        const phrase = (m[1] ?? m[2]).replace(/[’]/g, "'");
        const tools = (ctx.tools ?? []).filter(t => !t.key.endsWith(":*"));
        const groups = (ctx.tools ?? []).filter(t => t.key.endsWith(":*"));
        const choice = /\b(?:one kind of|any|of your choice|choose|a type of)\b/.test(phrase);
        const norm2 = l => l.toLowerCase().replace(/^any\s+/, "").replace(/[’]/g, "'");
        const hit = (choice ? groups : []).concat(tools).find(t => phrase.includes(norm2(t.label)) || phrase.includes(norm2(t.label).replace(/s$/, "")));
        if ( hit ) { add(`Tool proficiency: ${hit.label}`, null, { bgTool: hit.key }); bgHit = true; }
      }
      if ( (m = s.match(/(?:origin )?feat:\s*([^.;]+)/)) || (m = s.match(/\b(?:gain|gains|grants?|gives?)\s+(?:you\s+)?the\s+([^.;]+?)\s+feat\b/)) ) {
        const phrase = m[1];
        const f = (ctx.feats ?? []).filter(x => phrase.includes(String(x.name).toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0];
        if ( f ) { add(`Origin feat: ${f.name}`, null, { bgFeat: f.uuid }); bgHit = true; }
      }
      if ( /\d+\s*gp\b/.test(s) && /equipment|gold|wealth|starting/.test(s) ) {
        // "…and 15 GP; or 50 GP": the gold-only alternative is the starting wealth.
        const alt = s.match(/\bor\s*(?:\(b\)\s*)?(\d+)\s*gp\b/);
        const all = [...s.matchAll(/(\d+)\s*gp\b/g)].map(x => x[1]);
        const gp = alt?.[1] ?? all.at(-1);
        add(`Starting gold: ${gp} GP`, null, { bgWealth: gp }); bgHit = true;
      }
      if ( /\blanguages?\b/.test(s) ) { add("Languages: Common + two of the player's choice", null, { bgLanguages: true }); bgHit = true; }
      if ( bgHit ) { findings.push(...found); continue; }
    }

    // Feat prerequisites: "Prerequisite: level 4", "Prerequisite: Strength 13 or higher", "requires level 4".
    if ( category === "feat" || featLine ) {
      if ( (m = s.match(/(?:requires?|prerequisites?:?)\s+(?:character )?level (\d+)|level (\d+)\+?\s*(?:required|prerequisite)|prerequisites?:?[^.;]*?(\d+)(?:st|nd|rd|th) level/)) ) add(`Required level ${m[1] ?? m[2] ?? m[3]}`, null, { levelRequirement: m[1] ?? m[2] ?? m[3] });
      if ( (m = s.match(/prerequisites?:?\s*(?:an? )?(strength|dexterity|constitution|intelligence|wisdom|charisma)(?: score)?(?: of)? (\d+)/)) ) {
        add(`Required ${cap(m[1])} ${m[2]}`, null, { requirementAbility: abilityIn(m[1], T), requirementScore: m[2] });
      }
    }

    const typed = s.match(/\b(weapon|armor|armour|shield)\s*\(([^)]+)\)/);
    const enh = s.match(/\+\s*([1-3])\s+([a-z' -]+)/);
    const named = original.match(/\b(?:named|called|known as)\s+["“']?([A-Z][\w'’-]*(?:\s+(?:of|the|and|[A-Z][\w'’-]*))*)/);
    if ( named && tier === 1 && !findings.some(f => f.basics?.name) ) {
      const nm = named[1].replace(/\s+(?:of|the|and)$/i, "");
      add(`Name: ${nm}`, null, { name: nm });
    }
    const baseKnown = () => [...findings, ...found].some(f => f.basics?.baseUuid);
    // "Greataxe named Sun Cleaver" / "A flaming longsword": the base item named at the start of the description.
    // Otherwise the first base item mentioned anywhere (tier 1), ignoring comparisons such as "like a dagger".
    const plain = s.replace(/\b(?:like|as|than|resembl\w*|shaped like)\s+(?:an?|the)\s+[a-z' -]+?(?=[,.;]|$)/g, " ");
    const anyBase = tier === 1 && !baseKnown() && !["equipment", "consumable"].includes(inferred?.cat) ? findBase(plain) : null;
    // "+1 longsword" / "+2 magic dagger": the base item right after the bonus, not one mentioned later.
    const enhBase = enh ? findBase(enh[2]) : null;
    const base = typed ? findBase(typed[2]) : (enhBase && enhBase.at <= 12 ? enhBase : null) ?? anyBase;
    if ( base ) {
      const cat = base.kind === "weapon" ? "weapon" : "armor";
      category = cat;
      add(`Base item: ${base.e.name}`, null, { category: cat, baseUuid: base.e.uuid, ...(cat === "armor" ? { armorType: base.kind === "shield" ? "shield" : (base.e.armorType || "") } : {}) });
    }
    // "Battle axe +1." — a bare +N right after (or before) the base item.
    const bare = !enh && base && !found.some(f => f.basics?.enhancementBonus) ? s.match(/\+\s*([1-3])\s*(?=[.,;!)]|$)/) : null;
    if ( bare ) add(`+${bare[1]} enhancement bonus`, null, { enhancementBonus: bare[1] });
    if ( enh && (base || /^(?:magic(?:al)? )?(?:weapon|armor|armour|shield)\b/.test(enh[2].trim())) ) {
      if ( !base && !baseKnown() ) {
        const kind = enh[2].trim().replace(/^magic(?:al)? /, "");
        category = kind === "weapon" ? "weapon" : "armor";
        if ( ctx.category !== category ) add(`Category: ${kind === "weapon" ? "Weapon" : "Armor"}`, null, { category, ...(kind === "shield" ? { armorType: "shield" } : {}) });
      }
      add(`+${enh[1]} enhancement bonus`, null, { enhancementBonus: enh[1] });
    }

    if ( /requires? attunement/.test(s) ) {
      add("Requires attunement", null, { attunement: "required" });
      const by = s.match(/requires? attunement by (?:an? )?([^)\].;]+)/);
      const cls = by ? classesIn(by[1], T) : [];
      if ( cls.length ) add(`Attunement only by ${cls.map(cap).join(" or ")}`, { type: "requirement", name: "Attunement Requirement", requireKind: "class", classes: cls, penalty: "blockAttune" });
    }

    // --- Reactions are read as a whole sentence so their numbers don't become passive bonuses ---
    if ( /\breaction\b/.test(s) && !/\bbonus action\b.*\blight\b/.test(s) ) {
      const r = { type: "reaction", name: "Reaction" };
      if ( /\b(?:hits? you|you are hit|you're hit)\b/.test(s) ) r.trigger = "hit";
      else if ( /\btargets? you\b|\byou are targeted\b/.test(s) ) r.trigger = "targeted";
      else if ( /\bally\b/.test(s) ) r.trigger = "ally";
      else if ( /\bleaves? your reach\b/.test(s) ) r.trigger = "leaves";
      else if ( /\b(?:you )?take damage\b|\byou are damaged\b/.test(s) ) r.trigger = "damaged";
      else if ( /\bsaving throw\b/.test(s) && /\byou (?:must )?make\b|\byou fail\b/.test(s) ) r.trigger = "save";
      else { const w = original.match(/\b(when|whenever)\b([^,]+)/i); r.trigger = "custom"; r.triggerText = w ? cap(`${w[1]}${w[2]}`.trim()) : ""; }
      if ( (m = s.match(/\+\s*(\d+)\s*(?:bonus )?to (?:your )?(?:ac|armor class)/)) || (m = s.match(/(?:ac|armor class) (?:increases )?by (\d+)/)) ) Object.assign(r, { reactionEffect: "acBonus", formula: m[1] });
      else if ( (m = s.match(new RegExp(`reduce (?:the |that )?damage(?: you take)? by ${formulaRe}`))) ) Object.assign(r, { reactionEffect: "reduceDamage", formula: m[1].replace(/\s+/g, " ") });
      else if ( /resistance to (?:the |that )?(?:triggering )?damage/.test(s) ) Object.assign(r, { reactionEffect: "resistance", damageType: "any" });
      else if ( (m = s.match(/dc (\d+) (\w+) saving throw/)) && (m2(s)) ) {
        const d = m2(s);
        Object.assign(r, { reactionEffect: "saveAttacker", saveDC: m[1], saveAbility: abilityIn(m[2], T) || "dex", formula: d.f, damageType: d.t || "force", onSave: /half as much|half damage/.test(s) ? "half" : "none" });
      }
      else if ( (m = s.match(new RegExp(`${formulaRe} (\\w+) damage`))) && /attacker|the creature|that creature|it takes/.test(s) ) Object.assign(r, { reactionEffect: "damageAttacker", formula: m[1], damageType: damageTypesIn(m[2], T)[0] || "force" });
      else if ( (m = s.match(new RegExp(`${formulaRe}(?: \\+ (?:your )?proficiency bonus)? temporary hit points`))) ) Object.assign(r, { reactionEffect: "tempHp", formula: m[1] + (/temporary hit points/.test(s) && /proficiency bonus temporary/.test(s) ? " + @prof" : "") });
      else if ( (m = s.match(new RegExp(`regains? ${formulaRe}(?: \\+ (?:your )?proficiency bonus)? hit points`))) ) Object.assign(r, { reactionEffect: "healSelf", formula: m[1] + (/proficiency bonus hit points/.test(s) ? " + @prof" : "") });
      else if ( (m = s.match(/\+\s*(\d+)\s*(?:bonus )?to (?:your )?saving throws/)) ) Object.assign(r, { reactionEffect: "saveBonus", formula: m[1] });
      else Object.assign(r, { reactionEffect: "description", text: original });
      const u = usesIn(s, T); if ( u ) Object.assign(r, u);
      add(`Reaction: ${r.reactionEffect === "description" ? "rules text" : r.reactionEffect.replace(/([A-Z])/g, " $1").toLowerCase()}${r.formula ? ` (${r.formula})` : ""}`, r);
      findings.push(...found);
      continue;
    }

    // --- Use requirements (checked before ability scores, which use the same words) ---
    let requirementSentence = false;
    if ( /\b(?:only|can't|cannot|unless|must|requires?|without|isn't|aren't|not a|who (?:is|are) not|other than|lower than|less than|below)\b/.test(s) && !/requires? attunement by/.test(s) ) {
      const penalty = (() => {
        if ( (m = s.match(new RegExp(`takes? ${formulaRe} (\\w+) damage`))) ) return { penalty: "damage", formula: m[1], damageType: damageTypesIn(m[2], T)[0] || "psychic", blocks: /\b(?:can't|cannot|fails?)\b/.test(s) };
        if ( (m = s.match(/speed (?:is )?(?:reduced|decreases?) by (\d+)/)) ) return { penalty: "speed", formula: m[1] };
        if ( /disadvantage on attack rolls/.test(s) ) return { penalty: "disAttacks" };
        if ( /disadvantage on (?:\w+ )?(?:ability checks|checks|saving throws)/.test(s) ) return { penalty: "disChecks", penaltyAbility: abilityIn(s.split("disadvantage")[1] ?? "", T) };
        if ( /attune/.test(s) ) return { penalty: "blockAttune" };
        return { penalty: "blockEquip" };
      })();
      const abil = s.match(/(strength|dexterity|constitution|intelligence|wisdom|charisma)(?: score)? (?:of )?(\d+) or (?:higher|more|greater)|(strength|dexterity|constitution|intelligence|wisdom|charisma) (?:score )?(?:of )?(?:at least |lower than |less than |below |under )?(\d+)/);
      const lvl = s.match(/(\d+)(?:st|nd|rd|th) level|level (\d+) or higher/);
      const cls = /\b(?:by an? |only an? |a creature that is(?:n't| not) an? |non-)\w+/.test(s) ? classesIn(s, T) : [];
      if ( abil && /\b(?:only|unless|must|requires?|without|lower|less|below|under|at least|or higher)\b/.test(s) ) {
        const ab = abilityIn(abil[1] ?? abil[3], T);
        add(`Requires ${cap(abil[1] ?? abil[3])} ${abil[2] ?? abil[4]}`, { type: "requirement", name: "Ability Requirement", requireKind: "ability", ability: ab, minimum: abil[2] ?? abil[4], ...penalty });
        requirementSentence = true;
      } else if ( lvl && /\b(?:only|unless|must|requires?|at least|or higher)\b/.test(s) ) {
        add(`Requires level ${lvl[1] ?? lvl[2]}`, { type: "requirement", name: "Level Requirement", requireKind: "level", minimum: lvl[1] ?? lvl[2], ...penalty });
        requirementSentence = true;
      } else if ( cls.length ) {
        add(`Only usable by ${cls.map(cap).join(" or ")}`, { type: "requirement", name: "Class Requirement", requireKind: "class", classes: cls, ...penalty });
        requirementSentence = true;
      }
    }

    // --- Light ---
    if ( /\b(?:sheds?|emits?|gives? off|casts?|radiates?|produces?|creates?) (?:[a-z]+ ){0,2}light\b|\bglows?\b|\bas a light source\b|\b(?:bright|dim) light (?:in |out to |within |of |for )?(?:an? )?\d+/.test(s) && !/\bthe light is\b|\bin dim light or darkness\b|\bdim light or darkness\b/.test(s) ) {
      const bright = Number(s.match(/bright light (?:in |out to |within |of |for |to )?(?:an? )?(\d+)/)?.[1] ?? 0);
      const extra = s.match(/dim(?: light)? (?:for |out to |to )?(?:an? )?(?:additional|another|further|extra) (\d+)|(\d+) feet (?:of )?dim light beyond/);
      const dimTotal = s.match(/dim(?: light)? (?:in |out to |within |of |for |to )?(?:an? )?(\d+)/);
      const b = bright || (dimTotal ? 0 : 20);
      const dim = extra ? b + Number(extra[1] ?? extra[2]) : dimTotal ? Math.max(Number(dimTotal[1]), b) : b * 2;
      const activation = /bonus action/.test(s) ? "bonus" : /\bno action\b|\bfree\b|\bat will\b/.test(s) ? "none" : "action";
      add(`Light: ${b} ft. bright, ${dim} ft. dim`, { type: "light", name: "Light", bright: String(b), dim: String(dim), activation, startOn: /\balways\b|\bconstantly\b/.test(s) });
    }

    // --- Spells ---
    // The item casts it ("you can cast", "casts", "scroll of"), not a spell merely mentioned
    // ("the curse ends if Remove Curse is cast on you", "an Identify spell reveals…").
    const castWord = (/\bcasts?\b|\bcasting\b|\bcantrip\b|\bknow the\b|\bscroll of\b|\bspell scroll\b|\bspells? (?:from|stored)\b/.test(s)
      || /\b(?:grants?|gives?|has|have) (?:the (?:effects?|benefits?) of )?(?:the |an? )?[a-z' ]+ spell\b/.test(s))
      && !/\b(?:is|are|was|been|be|being) cast\b|\bcast (?:on|upon|targeting) (?:you|it|them|the (?:item|wearer|wielder|armor|weapon))\b|\bunless\b[^.;]*\bcast\b/.test(s);
    if ( (castWord || usesIn(s, T)) && (ctx.spells ?? []).length ) {
      let rest = s;
      const spells = [];
      for ( const sp of [...ctx.spells].sort((a, b) => b.name.length - a.name.length) ) {
        const n = String(sp.name).toLowerCase();
        if ( n.length < 3 || (!castWord && (n.length < 7 || !n.includes(" "))) ) continue;
        const re = new RegExp(`(?<![a-z])${reEsc(n)}(?![a-z])`);
        if ( re.test(rest) ) { spells.push(sp); rest = rest.replace(re, " "); }
      }
      const u = usesIn(s, T);
      const lvl = s.match(/(?:at|as an?) (\d)(?:st|nd|rd|th)[- ]level/);
      for ( const sp of spells ) {
        add(`Spell: ${sp.name}${usesNote(u)}`,
          { type: "spell", name: sp.name, spellUuid: sp.uuid, ...(lvl ? { level: lvl[1] } : {}), ...(u ?? {}) });
      }
    }

    // --- Fighting Style ---
    if ( /fighting style/.test(s) && !/fighting style (?:feat|feature)\b/.test(s) ) {
      const styles = (ctx.fightingStyles ?? []).filter(st => {
        const n = String(st.name).toLowerCase().replace(/^fighting style:\s*/, "");
        return new RegExp(`(?<![a-z])${reEsc(n)}(?![a-z])`).test(s);
      });
      const gmPick = /\b(?:gm|dm|game master)(?:'s)? (?:picks?|chooses?|choice)\b/.test(s);
      if ( !gmPick && (/\b(?:of (?:your|their|the player's) choice|(?:your|their|player's|players'|the player's) choice|you choose|(?:player|they) chooses?|choose (?:a|one)|choice of (?:a|one|any))\b/.test(s) || !styles.length) ) {
        add(`Fighting Style: player's choice${styles.length > 1 ? ` (${styles.map(st => st.name).join(", ")})` : ""}`, { type: "fightingStyle", name: "Fighting Style", mode: "player", poolUuids: styles.length > 1 ? styles.map(st => st.uuid) : [] });
      } else if ( styles.length ) {
        add(`Fighting Style: ${styles[0].name}`, { type: "fightingStyle", name: `Fighting Style: ${styles[0].name.replace(/^fighting style:\s*/i, "")}`, mode: "gm", styleUuid: styles[0].uuid });
      }
    }

    // --- Granted feats: "you gain the Alert feat", "an Origin feat of your choice" ---
    if ( /\bfeats?\b/.test(s) && !featLine && !/fighting style/.test(s) ) {
      const named = (ctx.feats ?? []).filter(f => {
        const n = String(f.name).toLowerCase();
        return n.length >= 3 && new RegExp(`(?<![a-z])${reEsc(n)}(?: feat)?(?![a-z])`).test(s);
      }).sort((a, b) => b.name.length - a.name.length);
      const choiceRe = /\b(?:(origin|general|epic boon)\s+)?feats?\s+of\s+(?:your|their|the player's)\s+choice|\bchoose\s+(?:an?|one)\s+(?:(origin|general|epic boon)\s+)?feat\b|\b(?:player's|your)\s+choice\s+of\s+(?:an?\s+)?(?:(origin|general|epic boon)\s+)?feat\b/;
      if ( (m = s.match(choiceRe)) ) {
        const kind = m[1] ?? m[2] ?? m[3] ?? "";
        const poolType = { origin: "origin", general: "general", "epic boon": "epicBoon" }[kind] ?? "any";
        const listed = named.length > 1 ? named : [];
        add(`Feat: player's choice of ${listed.length ? listed.map(f => f.name).join(", ") : kind ? `any ${cap(kind)} feat` : "any feat"}`,
          { type: "grantFeat", name: "Feat", mode: "player", poolType: listed.length ? "list" : poolType, poolUuids: listed.map(f => f.uuid) });
      } else if ( named.length && /\b(?:gain|gains|grants?|gives?|have|has|learn|learns|adds?)\b/.test(s) ) {
        add(`Feat: ${named[0].name}`, { type: "grantFeat", name: named[0].name, mode: "gm", featUuid: named[0].uuid, poolType: "origin", poolUuids: [] });
      }
    }

    // --- Initiative: "+2 to initiative", "add your proficiency bonus to initiative" ---
    {
      let init = null;
      if ( (m = s.match(/\+\s*(\d+)\s*(?:bonus )?(?:to |on )?(?:your )?initiative|initiative (?:rolls? )?(?:\+\s*|(?:increases |bonus )?(?:by |of )\+?)(\d+)/)) ) init = { bonusMode: "fixed", value: m[1] ?? m[2] };
      else if ( /\badd(?:s)? (?:your )?proficiency bonus (?:to|on) (?:your )?initiative/.test(s) ) {
        const ab = s.match(/proficiency bonus (?:plus|and) (?:your )?([a-z]+) modifier/);
        init = ab && abilityIn(ab[1], T) ? { bonusMode: "profAbility", ability: abilityIn(ab[1], T) } : { bonusMode: "prof" };
      } else if ( (m = s.match(/\badd(?:s)? (?:your )?([a-z]+) modifier (?:to|on) (?:your )?initiative/)) && abilityIn(m[1], T) ) init = { bonusMode: "ability", ability: abilityIn(m[1], T) };
      if ( init && !requirementSentence ) {
        const adv = /advantage on (?:your )?initiative/.test(s);
        const f = { fixed: `+${init.value}`, prof: "+ proficiency bonus", ability: `+ ${cap(T.abilities.find(([k]) => k === init.ability)?.[1] ?? "")} modifier`, profAbility: "+ proficiency bonus + ability modifier" }[init.bonusMode];
        add(`Initiative ${f}${adv ? " and advantage" : ""}`, { type: "initiative", name: "Initiative", value: "2", ability: "dex", advantage: adv, ...init });
        found.initiativeAdv = adv;
      }
    }

    // --- Senses ---
    for ( const sense of SENSES ) {
      if ( (m = s.match(new RegExp(`${sense}(?: out)?(?: to)?(?: a range of)?(?: with a range of)? (\\d+)`))) || (m = s.match(new RegExp(`(\\d+) feet (?:of )?${sense}`))) ) {
        const more = new RegExp(`${sense}[^.;]*(?:increases?|extends?|additional|more)|(?:increases?|extends?) (?:your |its )?(?:range of )?${sense}`).test(s);
        add(`${cap(sense)} ${more ? "+" : ""}${m[1]} ft.`, { type: "sense", name: cap(sense), sense, mode: more ? "add" : "upgrade", value: m[1] });
      } else if ( new RegExp(`(?:gain|have|grants?|gives?) ${sense}`).test(s) ) {
        add(`${cap(sense)} 60 ft.`, { type: "sense", name: cap(sense), sense, mode: "upgrade", value: "60" });
      }
    }
    if ( !found.some(f => f.component?.type === "sense") && (m = s.match(/see (?:normally )?in (magical )?darkness[^.;]*?(\d+)/)) ) {
      if ( m[1] ) add(`Devil's Sight ${m[2]} ft.`, { type: "sense", name: "Devil's Sight", sense: "devilsSight", mode: "upgrade", value: m[2] });
      else add(`Darkvision ${m[2]} ft.`, { type: "sense", name: "Darkvision", sense: "darkvision", mode: "upgrade", value: m[2] });
    }
    if ( /devil'?s sight/.test(s) ) {
      const r = s.match(/devil'?s sight[^.;]*?(\d+)/)?.[1] ?? "120";
      add(`Devil's Sight ${r} ft.`, { type: "sense", name: "Devil's Sight", sense: "devilsSight", mode: "upgrade", value: r });
    }

    // --- Movement ---
    {
      const seen = new Set();
      const re = /(flying|fly|swimming|swim|climbing|climb|burrowing|burrow) speed (?:of |equal to )?(\d+)/g;
      while ( (m = re.exec(s)) ) {
        const t = MOVE_WORDS[m[1]]; if ( seen.has(t) ) continue; seen.add(t);
        const label = MOVE_LABELS[t];
        add(`${label} speed ${m[2]} ft.`, { type: "movement", name: `${label} Speed`, movementType: t, mode: "override", value: m[2] });
      }
      const inc = s.match(/(?:(walking|flying|swimming|climbing|burrowing) )?speed (?:increases|is increased|improves) by (\d+)|\+\s*(\d+) feet to (?:your )?(?:(walking|flying|swimming|climbing) )?speed|(\d+) (?:extra|additional) feet of (?:(walking|flying|swimming|climbing) )?(?:movement|speed)/);
      if ( (m = s.match(/\b(fly|swim|climb|burrow)\s+(?:at\s+|up to\s+|with a speed of\s+)?(\d+) feet/)) && !seen.has(MOVE_WORDS[m[1]]) ) {
        const t = MOVE_WORDS[m[1]]; seen.add(t);
        add(`${MOVE_LABELS[t]} speed ${m[2]} ft.`, { type: "movement", name: `${MOVE_LABELS[t]} Speed`, movementType: t, mode: "override", value: m[2] });
      }
      const inc3 = s.match(/(\d+) feet of (?:extra|additional|bonus) (?:walking )?(?:speed|movement)/);
      const inc2 = inc || inc3 ? null : s.match(/(?:(walking|flying|swimming|climbing|burrowing) )?speed\s*\+\s*(\d+)|\+\s*(\d+) (?:feet )?(?:to |of )?(?:your )?(?:(walking|flying|swimming|climbing) )?(?:speed|movement)/);
      if ( inc2 && !requirementSentence ) {
        const t = MOVE_WORDS[inc2[1] ?? inc2[4] ?? "walking"] ?? "walk";
        const v = inc2[2] ?? inc2[3];
        add(`Speed +${v} ft.${t !== "walk" ? ` (${t})` : ""}`, { type: "movement", name: "Speed Bonus", movementType: t, mode: "add", value: v });
      }
      if ( inc3 && !inc && !requirementSentence ) add(`Speed +${inc3[1]} ft.`, { type: "movement", name: "Speed Bonus", movementType: "walk", mode: "add", value: inc3[1] });
      if ( inc && !requirementSentence ) {
        const t = MOVE_WORDS[inc[1] ?? inc[4] ?? inc[6] ?? "walking"] ?? "walk";
        const v = inc[2] ?? inc[3] ?? inc[5];
        add(`Speed +${v} ft.${t !== "walk" ? ` (${t})` : ""}`, { type: "movement", name: "Speed Bonus", movementType: t, mode: "add", value: v });
      }
    }

    // --- 2024 feat ability increase: "+1 to one ability score of your choice", "Increase your Strength or Dexterity by 1" ---
    let halfAsi = false;
    if ( !requirementSentence && (m = s.match(/increase (?:one )?(?:of )?(?:your )?ability scores? (?:of your choice )?by 1|\+\s*1 to (?:one|an|any) ability score(?: of your choice)?|one ability score of your choice (?:increases )?by 1/)) ) {
      add("Ability increase +1: player's choice of any ability", { type: "halfAsi", name: "Ability Score Increase", selectionMode: "choice", allowedAbilities: T.abilities.map(([k]) => k) });
      halfAsi = true;
    } else if ( !requirementSentence && (m = s.match(/increase (?:your )?((?:[a-z]+,? )+(?:or [a-z]+ )?)(?:score )?by 1\b/)) ) {
      const picks = T.abilities.filter(([, l]) => new RegExp(`(?<![a-z])${reEsc(l)}(?![a-z])`).test(m[1])).map(([k]) => k);
      if ( picks.length > 1 || (picks.length === 1 && (category === "feat" || /maximum of 20|max(?:imum)? 20/.test(s))) ) {
        const names = picks.map(k => cap(T.abilities.find(([a]) => a === k)[1]));
        add(picks.length > 1 ? `Ability increase +1: player picks ${names.join(" or ")}` : `Ability increase +1: ${names[0]}`,
          picks.length > 1 ? { type: "halfAsi", name: "Ability Score Increase", selectionMode: "choice", allowedAbilities: picks }
            : { type: "halfAsi", name: `${names[0]} +1`, selectionMode: "fixed", ability: picks[0], allowedAbilities: T.abilities.map(([k]) => k) });
        halfAsi = true;
      }
    }

    // --- Ability scores ---
    if ( !requirementSentence && !halfAsi ) {
      for ( const [k, l] of T.abilities ) {
        const L = reEsc(l);
        if ( (m = s.match(new RegExp(`^(?:your )?${L}(?: score)?:? (\\d{2})\\b(?! or)(?![^.;]*\\b(?:or higher|at least|minimum|required)\\b)|${L} (?:score )?(?:is|becomes|changes to|is set to|equals) (\\d+)|(?:sets? |set )(?:your )?${L}(?: score)? to (\\d+)|your ${L}(?: score)? to (\\d+)|${L} (?:score )?of (\\d+)(?! or)`))) ) {
          const v = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
          add(`${cap(l)} becomes ${v}`, { type: "ability", name: `${cap(l)} ${v}`, ability: k, mode: "override", value: v });
        } else if ( (m = s.match(new RegExp(`${L}(?: score)? increases by (\\d+)|increases? (?:your )?${L}(?: score)? by (\\d+)|\\+\\s*(\\d+) (?:bonus )?(?:to )?(?:your )?${L}(?! saving| check)|(?<![a-z])${L}(?: score)? \\+\\s*(\\d+)`))) ) {
          const v = m[1] ?? m[2] ?? m[3] ?? m[4];
          add(`${cap(l)} +${v}`, { type: "ability", name: `${cap(l)} +${v}`, ability: k, mode: "add", value: v });
        }
      }
    }

    // --- Skills ---
    for ( const clause of s.split(/(?=\b(?:proficien(?:cy|t)|expertise)\b)/).filter(c => /^(?:proficien|expertise)/.test(c)) ) {
      const expert = /^expertise|double (?:your )?proficiency/.test(clause);
      for ( const k of skillsIn(clause.split(/[.;]/)[0], T) ) {
        const label = T.skills.find(([key]) => key === k)[1];
        add(`${expert ? "Expertise" : "Proficiency"}: ${titled(label)}`, { type: "skill", name: `${titled(label)} ${expert ? "Expertise" : "Training"}`, skill: k, proficiency: expert ? "2" : "1" });
      }
    }

    // --- Advantage / disadvantage ---
    // Every "advantage on/against …" clause: what kind of roll, and against what (conditions such
    // as charm or fear, creature types or subtypes such as undead or vampires, spells or magic).
    if ( !requirementSentence ) {
      const advRe = /\b(advantage|disadvantage)\s+(?:on|against|to|when|for|with|in)\s+([^.;]+?)(?=[.;]|,\s*(?:and\s+)?(?:you|it|the|while|but|plus)\b|\s+and\s+(?:you|it|the wearer|the wielder|gains?|has|have|can)\b|$)/g;
      // "advantage on initiative and Perception checks" is two rolls; "against being charmed or frightened" is one.
      const kindOf = p => /\binitiative\b/.test(p) ? "initiative" : /\bconcentration\b/.test(p) ? "concentration" : /\battack/.test(p) ? "attack"
        : skillsIn(p, T).length ? "skill" : /\bsaving throws?\b/.test(p) ? "save" : /\bchecks?\b/.test(p) ? "check" : "";
      const clauses = [];
      for ( const am of s.matchAll(advRe) ) {
        // Not ours to automate: "no disadvantage", "creatures have disadvantage on attack rolls against you",
        // "disadvantage … with weapons other than this bow".
        const before = s.slice(Math.max(0, am.index - 60), am.index);
        if ( /\b(?:no|no longer|without|don't|doesn't|do not|does not|not|never|ignores?|suffers? no|lose|loses)\s+(?:longer\s+)?(?:have\s+|has\s+)?$/.test(before) ) continue;
        if ( /\b(?:creatures?|attackers?|enemies|foes|they|targets?|anyone|others?|each (?:creature|enemy))\b[^.;,]{0,25}\b(?:have|has|gets?|suffers?|makes?|rolls?)\s+$/.test(before) && !/\byou\s+(?:have|gain)\s+$/.test(before) ) continue;
        if ( /\bagainst you\b|\bother than\b|\bother weapons\b|\bexcept\b/.test(am[2]) || /\bwhile your (?!item|weapon|armor)\w+ (?:lives|is alive|exists)\b/.test(s) ) continue;
        const parts = am[2].split(/,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+/);
        const kinds = parts.map(kindOf).filter(Boolean);
        if ( new Set(kinds).size > 1 ) {
          let carry = "";
          for ( const part of parts ) { const k = kindOf(part); if ( k ) carry = k; clauses.push([am[1], k ? part : `${part} ${carry === "skill" ? "checks" : carry === "save" ? "saving throws" : carry}`]); }
        } else clauses.push([am[1], am[2]]);
      }
      for ( const [kind, p] of clauses ) {
        const conds = conditionsIn(p, T).filter(c => !(c === "invisible" && /\binvisible creatures?\b/.test(p)));
        const types = creaturesIn(p, T), subs = subtypesIn(p);
        const magic = /\bspells?\b|\bmagic(?:al)?\b/.test(p) && !/spell attack/.test(p);
        const ab = abilityIn(p, T);
        const sk = skillsIn(p, T);
        const who = [...types.map(plural), ...subs.map(plural)].join(", ");
        const filter = { ...(types.length ? { sourceTypes: types } : {}), ...(subs.length ? { sourceSubtype: subs[0] } : {}) };
        const Kind = cap(kind);
        let rollKind = /\binitiative\b/.test(p) ? "initiative" : /\bconcentration\b/.test(p) ? "concentration"
          : /\battack(?:s| rolls?)?\b/.test(p) ? "attack" : sk.length ? "skill"
          : /\bsaving throws?\b|\bresist(?:ing)?\b|\bavoid\w*\b|\beffects?\b|\bbeing\b/.test(p) || conds.length || magic ? "save"
          : /\bchecks?\b/.test(p) || ab ? "check" : (types.length || subs.length) ? "save" : "";
        if ( rollKind === "initiative" ) {
          if ( !(found.initiativeAdv && kind === "advantage") ) add(`${Kind} on initiative`, { type: "utility", effect: kind, name: `${Kind}: Initiative`, rollTarget: "initiative" });
        } else if ( rollKind === "concentration" ) add(`${Kind} on concentration saves`, { type: "utility", effect: kind, name: `${Kind}: Concentration`, rollTarget: "concentration" });
        else if ( rollKind === "attack" ) {
          if ( kind === "advantage" ) add(`Advantage on attack rolls${who ? ` against ${who}` : ""}`, { type: "offensive", effect: "attackAdvantage", name: "Attack Advantage", targetTypes: types, ...(subs.length ? { targetSubtype: subs[0] } : {}) });
          else add("Disadvantage on attack rolls", { type: "utility", effect: "disadvantage", name: "Disadvantage: Attacks", rollTarget: "attack" });
        } else if ( rollKind === "skill" ) {
          for ( const k of sk ) {
            const label = titled(T.skills.find(([key]) => key === k)[1]);
            add(`${Kind} on ${label} checks`, { type: "utility", effect: kind, name: `${Kind}: ${label}`, rollTarget: "skill", skill: k });
          }
        } else if ( rollKind === "save" ) {
          const abName = ab ? `${cap(T.abilities.find(([k]) => k === ab)[1])} ` : "";
          if ( kind === "advantage" && conds.length ) {
            for ( const c of conds ) {
              const cName = cap(T.conditions.find(([k]) => k === c)?.[1] ?? c);
              add(`Advantage on ${abName}saves against ${cName}${who ? ` (from ${who})` : ""}`, { type: "defensive", effect: "saveAdvantage", name: `Resist ${cName}`, trigger: "saveAgainstCondition", status: c, ability: ab, ...filter });
            }
          } else if ( kind === "advantage" && magic ) {
            const both = /magical effects|\bmagic(?:al)?\b/.test(p);
            add(`Advantage on ${abName}saves against spells${both ? " and magic" : ""}${who ? ` (from ${who})` : ""}`, { type: "defensive", effect: "saveAdvantage", name: "Magic Resistance", trigger: both ? "saveAgainstMagic" : "saveAgainstSpell", ability: ab, ...filter });
          } else if ( kind === "advantage" && who ) {
            add(`Advantage on ${abName}saves against ${who}`, { type: "defensive", effect: "saveAdvantage", name: `Resist ${who}`, trigger: "damage", ability: ab, ...filter });
          } else add(`${Kind} on ${abName}saving throws`, { type: "utility", effect: kind, name: `${Kind}: Saves`, rollTarget: "save", ability: ab });
        } else if ( rollKind === "check" ) {
          const abName = ab ? `${cap(T.abilities.find(([k]) => k === ab)[1])} ` : "";
          add(`${Kind} on ${abName}ability checks`, { type: "utility", effect: kind, name: `${Kind}: Checks`, rollTarget: "check", ability: ab });
        }
      }
    }

    // --- AC, saves and attack bonuses ---
    const acM = s.match(/\+\s*(\d+)\s*(?:bonus )?(?:to )?(?:your |the )?(?:ac|armor class)(?![a-z])|(?:ac|armor class) (?:increases|is increased) by (\d+)|bonus to (?:your )?(?:ac|armor class) (?:of|equal to) \+?(\d+)|(?<![a-z])(?:ac|armor class)\s*\+\s*(\d+)/);
    if ( acM && !requirementSentence ) {
      const v = acM[1] ?? acM[2] ?? acM[3] ?? acM[4];
      if ( category === "armor" && !found.some(f => f.basics?.enhancementBonus) && Number(v) <= 3 ) add(`+${v} armor enhancement`, null, { enhancementBonus: v });
      else if ( category !== "armor" ) add(`+${v} AC`, { type: "defensive", effect: "acBonus", name: `+${v} AC`, formula: v, trigger: "struck" });
    }
    const saveM = s.match(/\+\s*(\d+)\s*(?:bonus )?(?:to |on )?(?:all )?(?:your )?(?:(\w+) )?(?:saving throws|saves(?![a-z]))|(?:ac|armor class) and (?:saving throws|saves(?![a-z]))/);
    if ( saveM && !requirementSentence ) {
      const v = saveM[1] ?? acM?.[1] ?? acM?.[2] ?? "1";
      const ab = saveM[2] ? abilityIn(saveM[2], T) : "";
      add(`+${v} to ${ab ? cap(T.abilities.find(([k]) => k === ab)[1]) + " " : ""}saving throws`, { type: "defensive", effect: "saveBonus", name: `+${v} Saving Throws`, formula: v, trigger: "damage", ability: ab });
    }
    const atk = s.match(/\+\s*(\d+)\s*(?:bonus )?(?:to )?(?:its |your )?(?:attack(?: rolls?)?|hit(?! points| dice| die))(?: and damage(?: rolls?)?)?(?![a-z])/);
    if ( atk && !/spell attack/.test(s) ) {
      const both = /and damage/.test(atk[0]);
      if ( both && category === "weapon" && !found.some(f => f.basics?.enhancementBonus) && Number(atk[1]) <= 3 ) add(`+${atk[1]} weapon enhancement`, null, { enhancementBonus: atk[1] });
      else if ( !both ) add(`+${atk[1]} to attack rolls`, { type: "offensive", effect: "attackBonus", name: `+${atk[1]} Attack`, formula: atk[1] });
      else if ( ["equipment"].includes(category) ) {
        add(`+${atk[1]} to attack rolls`, { type: "offensive", effect: "attackBonus", name: `+${atk[1]} Attack`, formula: atk[1] });
        add(`+${atk[1]} to weapon damage rolls`, { type: "utility", effect: "activeEffect", name: `+${atk[1]} Weapon Damage`, activeEffectKey: "system.bonuses.mwak.damage", activeEffectMode: "2", activeEffectValue: atk[1] });
      }
      else if ( category !== "consumable" && !found.some(f => f.basics?.enhancementBonus) ) add(`+${atk[1]} to attack and damage rolls`, null, { enhancementBonus: atk[1], category: "weapon" });
    }

    // --- Other bonuses written as Active Effects: spell attack, spell save DC, skill checks, weapon damage ---
    {
      const ae = (label, name, key, value) => add(label, { type: "utility", effect: "activeEffect", name, activeEffectKey: key, activeEffectMode: "2", activeEffectValue: String(value) });
      if ( (m = s.match(/\+\s*(\d+)\s*(?:bonus )?(?:to |on )?(?:your )?spell attack(?: rolls?)?/)) ) {
        ae(`Spell attack +${m[1]} (melee spells)`, `Spell Attack +${m[1]} (melee)`, "system.bonuses.msak.attack", m[1]);
        ae(`Spell attack +${m[1]} (ranged spells)`, `Spell Attack +${m[1]} (ranged)`, "system.bonuses.rsak.attack", m[1]);
      }
      if ( (m = s.match(/\+\s*(\d+)\s*(?:bonus )?(?:to |on )?(?:your )?(?:spell attack rolls? and (?:your )?)?spell save dc|spell save dc (?:increases by |\+\s*)(\d+)/)) ) {
        ae(`Spell save DC +${m[1] ?? m[2]}`, `Spell Save DC +${m[1] ?? m[2]}`, "system.bonuses.spell.dc", m[1] ?? m[2]);
      }
      // "+2 Perception and Insight", "+5 to Sleight of Hand checks", "Stealth +3"
      const skillBonus = new Map();
      for ( const bm of s.matchAll(/\+\s*(\d+)\s*(?:bonus )?(?:to |on )?(?:your )?([^.;+]*)/g) ) {
        const seg = bm[2].split(/\b(?:ac|armor class|attack|saving throws?|damage|initiative|speed)\b/)[0];
        for ( const k of skillsIn(seg, T) ) if ( !skillBonus.has(k) ) skillBonus.set(k, bm[1]);
      }
      for ( const [k, l] of T.skills ) {
        const sm = s.match(new RegExp(`(?<![a-z])${reEsc(l)}(?: checks?)? \\+\\s*(\\d+)`));
        if ( sm && !skillBonus.has(k) ) skillBonus.set(k, sm[1]);
      }
      for ( const [k, v] of skillBonus ) {
        const label = titled(T.skills.find(([key]) => key === k)[1]);
        ae(`${label} +${v}`, `${label} +${v}`, `system.skills.${k}.bonuses.check`, v);
      }
      // "+2 to Charisma checks"
      for ( const [k, l] of T.abilities ) {
        const cm = s.match(new RegExp(`\\+\\s*(\\d+)\\s*(?:bonus )?(?:to |on )?(?:your )?${reEsc(l)} (?:ability )?checks?`));
        if ( cm ) ae(`+${cm[1]} to ${cap(l)} checks`, `${cap(l)} Checks +${cm[1]}`, `system.abilities.${k}.bonuses.check`, cm[1]);
      }
      if ( (m = s.match(/\+\s*(\d+)\s*(?:bonus )?to (?:your )?damage rolls? (?:with|made with|for|using) (ranged|melee) weapons?/)) ) {
        const k = m[2] === "ranged" ? "rwak" : "mwak";
        ae(`+${m[1]} damage with ${m[2]} weapons`, `${cap(m[2])} Damage +${m[1]}`, `system.bonuses.${k}.damage`, m[1]);
      }
    }

    // --- Extra damage ---
    {
      const dmgWords = T.damage.map(([, l]) => reEsc(l)).join("|") || "fire";
      const re = new RegExp(`(?:(?:extra|additional|bonus)\\s+${formulaRe}|${formulaRe}\\s+(?:extra|additional|bonus))\\s+([a-z]+)(?:\\s+damage\\b|(?<=\\s(?:${dmgWords}))(?![a-z])(?!\\s+(?:resistance|immunity|vulnerability)))`, "g");
      while ( (m = re.exec(s)) ) {
        m = [m[0], m[1] ?? m[2], m[3]];
        const t = damageTypesIn(m[2], T)[0];
        if ( !t ) continue;
        const who = creaturesIn(s, T);
        add(`Extra ${m[1]} ${t} damage${who.length ? ` vs ${who.join(", ")}` : ""}`, { type: "offensive", effect: "extraDamage", name: `Extra ${cap(t)} Damage`, formula: m[1].replace(/\s+/g, " "), damageType: t, targetTypes: who, canCrit: true });
      }
    }

    {
      const re2 = new RegExp(`(?:\\b(adds?|deals?|does|inflicts?)\\s+(?:an? )?|\\+\\s*)${formulaRe}\\s+([a-z]+)\\s+damage`, "g");
      while ( (m = re2.exec(s)) ) {
        const t = damageTypesIn(m[3], T)[0];
        if ( !t || found.some(f => f.component?.effect === "extraDamage" && f.component.damageType === t) ) continue;
        const who = creaturesIn(s, T);
        const extra = !m[1] || /^adds?$/.test(m[1]) || who.length || /\bextra\b|\bon a hit\b|\bwhen you hit\b|\bits attacks\b|\battacks with\b|\bhits\b/.test(s);
        if ( !extra || requirementSentence ) continue;
        add(`Extra ${m[2]} ${t} damage${who.length ? ` vs ${who.join(", ")}` : ""}`, { type: "offensive", effect: "extraDamage", name: `Extra ${cap(t)} Damage`, formula: m[2].replace(/\s+/g, " "), damageType: t, targetTypes: who, canCrit: true });
      }
    }

    // Untyped extra damage ("an additional 3d6 damage against humanoids"): the weapon's own damage type.
    if ( !found.some(f => f.component?.effect === "extraDamage") && !requirementSentence ) {
      const untyped = s.match(new RegExp(`(?:(?:extra|additional|bonus)\\s+${formulaRe}|${formulaRe}\\s+(?:extra|additional|bonus))\\s+damage\\b|\\badds?\\s+(?:an? )?${formulaRe}\\s+damage\\b`));
      if ( untyped ) {
        const f = (untyped[1] ?? untyped[2] ?? untyped[3]).replace(/\s+/g, " ");
        const who = creaturesIn(s, T);
        add(`Extra ${f} damage (the weapon's damage type)${who.length ? ` vs ${who.join(", ")}` : ""}`,
          { type: "offensive", effect: "extraDamage", name: "Extra Damage", formula: f, damageType: "", sameAsWeapon: true, targetTypes: who, canCrit: true });
      }
    }

    // --- Reach and cover ---
    // Only an explicit increase counts: "this glaive has reach" describes the base weapon, which already has it.
    if ( (m = s.match(/reach[^.;]{0,30}?(?:increases|is increased|extends|is extended) by (\d+)|(\d+) (?:additional |extra )?feet (?:of|to) (?:your |its )?reach|\+\s*(\d+) (?:feet )?(?:of |to )?(?:your |its )?reach|(?:increases?|extends?|adds?|improves?|grants?|gives?) (?:\+\s*)?(?:your |its |the |the weapon's |its weapon's |weapon |the wielder's |wielder's )?reach (?:by |of )?\+?(\d+)|reach\s*\+\s*(\d+)/)) ) {
      const v = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
      add(`Reach +${v} ft.`, { type: "offensive", effect: "reachBonus", name: "Increased Reach", formula: v });
    } else if ( (m = s.match(/\breach[^.;]{0,25}?\b(?:to|of|is|becomes|equals|=)\s*(\d+)|(\d+)[- ]feet reach\b/)) && !/\bwithin\b/.test(s) ) {
      const total = Number(m[1] ?? m[2]);
      const baseId = [...findings, ...found].reverse().find(f => f.basics?.baseUuid)?.basics.baseUuid ?? ctx.baseUuid;
      const baseReach = (ctx.weapons ?? []).find(w => w.uuid === baseId)?.reach ? 10 : 5;
      const v = total - baseReach;
      if ( v > 0 ) add(`Reach ${total} ft. (+${v})`, { type: "offensive", effect: "reachBonus", name: "Increased Reach", formula: String(v) });
    }
    if ( /ignores? (?:all |total )cover|ignores? total cover/.test(s) ) add("Ignores all cover", { type: "offensive", effect: "ignoreAllCover", name: "Ignore Cover" });
    else if ( /ignores? (?:half (?:cover )?and )?three-quarters cover/.test(s) ) add("Ignores half and three-quarters cover", { type: "offensive", effect: "ignoreThreeQuartersCover", name: "Ignore Cover" });
    else if ( /ignores? half cover/.test(s) ) add("Ignores half cover", { type: "offensive", effect: "ignoreHalfCover", name: "Ignore Cover" });

    // --- Damage resistance, immunity, vulnerability ---
    const dmgRule = (re, effect, label, category="defensive") => {
      const mm = s.match(re); if ( !mm ) return;
      const types = /\ball (?:types of )?damage\b/.test(mm[0] + s.slice(mm.index + mm[0].length, mm.index + mm[0].length + 20)) ? ["any"] : damageRun(s, mm.index + mm[0].length, T);
      for ( const t of types ) add(`${label} ${t === "any" ? "all damage" : `${t} damage`}`, { type: category, effect, name: `${label} ${t === "any" ? "All" : cap(t)}`.trim(), damageType: t, ...(category === "defensive" ? { trigger: "damage" } : {}) });
    };
    if ( /ignores?/.test(s) ) {
      dmgRule(/ignores? (?:a target's |the target's |any )?(?:resistance and immunity|immunity and resistance) to /, "ignoreResistanceImmunity", "Ignore resistance & immunity:", "offensive");
      if ( !found.some(f => f.component?.effect === "ignoreResistanceImmunity") ) {
        dmgRule(/ignores? (?:a target's |the target's |any )?resistance to /, "ignoreResistance", "Ignore resistance:", "offensive");
        dmgRule(/ignores? (?:a target's |the target's |any )?immunity to /, "ignoreImmunity", "Ignore immunity:", "offensive");
      }
    } else {
      dmgRule(/resistan(?:ce|t) (?:to|against) /, "resistance", "Resistance:");
      dmgRule(/(?:immunity|immune) (?:to|against) /, "immunity", "Immunity:");
      dmgRule(/vulnerab(?:ility|le) (?:to|against) /, "vulnerability", "Vulnerability:");
      if ( !found.some(f => DEFENSE_EFFECTS.has(f.component?.effect)) ) {
        dmgRule(/\bresists? /, "resistance", "Resistance:");
        const pre = s.match(/((?:[a-z]+(?:,? (?:and|or) |, ))*[a-z]+) (resistance|immunity|vulnerability)\b(?! to| against)/);
        if ( pre ) {
          const eff = pre[2] === "resistance" ? "resistance" : pre[2] === "immunity" ? "immunity" : "vulnerability";
          for ( const t of damageTypesIn(pre[1], T) ) add(`${cap(pre[2])}: ${t} damage`, { type: "defensive", effect: eff, name: `${cap(pre[2])}: ${cap(t)}`, damageType: t, trigger: "damage" });
        }
      }
    }

    // --- Condition immunity ---
    if ( /\bimmun(?:e|ity)\b|\bcan't be\b|\bcannot be\b/.test(s) ) {
      for ( const [k, l] of T.conditions ) {
        if ( new RegExp(`(?:immun(?:e|ity) to (?:being |the )?|can't be |cannot be )[a-z, ]*(?<![a-z])${reEsc(l)}(?![a-z])`).test(s) ) {
          add(`Immune to ${l}`, { type: "utility", effect: "activeEffect", name: `Immune: ${cap(l)}`, activeEffectKey: "system.traits.ci.value", activeEffectMode: "2", activeEffectValue: k });
        }
      }
    }

    // --- Size ---
    if ( (m = s.match(/\b(?:grows?|becomes?|turns?|increases?) (?:to |into )?(?:size )?(tiny|small|medium|large|huge|gargantuan)\b(?! creature that)/)) && /\byou\b|\bwielder\b|\bwearer\b|\buser\b/.test(s) ) {
      add(`Size becomes ${cap(m[1])}`, { type: "utility", effect: "sizeChange", name: `Size: ${cap(m[1])}`, sizeMode: "set", size: SIZE_WORDS[m[1]] });
    } else if ( (m = s.match(new RegExp(`\\b(grows?|increases?|shrinks?|decreases?|reduces?)[a-z ]*? by ${NUMBER} size|\\b${NUMBER} sizes? (larger|bigger|smaller)`))) ) {
      const shrink = /shrink|decrease|reduce|smaller/.test(m[0]);
      const n = num(m[2] ?? m[3]) ?? 1;
      add(`${shrink ? "Shrink" : "Grow"} ${n} size${n > 1 ? "s" : ""}`, { type: "utility", effect: "sizeChange", name: shrink ? "Shrink" : "Enlarge", sizeMode: shrink ? "shrink" : "grow", sizeSteps: String(Math.min(3, n)) });
    }

    // --- Healing ---
    if ( (m = s.match(new RegExp(`whenever you regain hit points,? you regain (?:an )?(?:additional|extra) ${formulaRe}`))) ) add(`Healing received +${m[1]}`, { type: "healing", effect: "healingReceived", name: "Improved Healing", formula: m[1] });
    else if ( (m = s.match(new RegExp(`(?:restores?|heals?|regains?) (?:an )?(?:additional|extra) ${formulaRe} hit points`))) && /\byou (?:cast|use|heal|restore)|\bwhen you\b.*\b(?:heal|restore)/.test(s) ) add(`Bonus healing +${m[1]}`, { type: "healing", effect: "bonusHealing", name: "Bonus Healing", formula: m[1] });
    if ( (m = s.match(/(?:spend|roll) (?:a )?hit (?:die|dice)[^.;]*?(?:additional|extra) (\d+)/)) ) add(`Hit Dice recovery +${m[1]}`, { type: "healing", effect: "recoveryBonus", name: "Recovery Bonus", formula: m[1] });

    // "The wand regains 1d6 + 1 expended charges daily at dawn": the recovery for spells using its charges.
    if ( !found.length && /\bregains?\b[^.;]*\bcharges?\b|\bcharges?\b[^.;]*\bregain/.test(s) ) {
      const rec = /\bdawn\b/.test(s) ? "dawn" : /short rest/.test(s) ? "sr" : /long rest/.test(s) ? "lr" : /\bday\b|\bdaily\b/.test(s) ? "day" : "";
      const charged = findings.filter(f => f.component?.type === "spell" && f.fromCharges);
      if ( rec && charged.length ) {
        for ( const f of charged ) { f.component.recovery = rec; f.label = f.label.replace(/ \([^)]*\)$/, "") + usesNote(f.component); f.sentence += " " + original; }
        continue;
      }
    }
    // Charges or uses described for the whole item, picked up by the spells that follow.
    const u = usesIn(s, T);
    if ( !found.length && u && u.usesMode !== "unlimited" && /\bcharges?\b|\buses\b|\bregains?\b/.test(s) ) {
      pendingUses = { u, entry: { text: original, tier } };
      leftovers.push(pendingUses.entry);
      continue;
    }
    if ( pendingUses ) {
      for ( const f of found ) {
        if ( f.component?.type !== "spell" || (f.component.usesMode && !/\bcharges?\b/.test(s)) ) continue;
        Object.assign(f.component, pendingUses.u);
        f.fromCharges = true;
        f.label = f.label.replace(/ \([^)]*\)$/, "") + usesNote(pendingUses.u);
        f.sentence = `${pendingUses.entry.text} ${f.sentence}`;
        const i = leftovers.indexOf(pendingUses.entry);
        if ( i >= 0 ) leftovers.splice(i, 1);
      }
    }
    // "While attuned…" / "while worn…" sets when the suggestion applies.
    const when = /\bwhile (?:you(?:'re| are) )?attuned\b|\bwhile attuned\b|\bwhen attuned\b/.test(s) ? "attuned"
      : /\bwhile (?:you )?(?:wear|wearing|worn|wield|wielding|wielded|hold|holding|held|equipped)\b/.test(s) ? "equipped" : "";
    if ( when ) for ( const f of found ) if ( f.component && f.component.type !== "light" ) f.component.activation = when;
    if ( found.length ) {
      findings.push(...found);
      // A sentence can be part automated: "…, and you can breathe water." Clauses with a rule in them
      // that nothing above turned into a component are kept as Rules Text.
      if ( !ctx._clause && found.some(f => f.component) ) {
        const clauses = original.split(/;\s*|,\s*(?:and\s+)?(?=(?:you|it|its|the|while|when|on a|once|as|if|this|creatures?|targets?|allies)\b)|\s+and\s+(?=(?:you|it|its|the wielder|the wearer|the target)\b)/i)
          .map(c => c.trim()).filter(c => c.split(/\s+/).length >= 4);
        if ( clauses.length > 1 ) for ( const c of clauses ) {
          if ( !CLAUSE_RULE.test(c) ) continue;
          const sub = parseDescription(c, { ...ctx, _clause: true, category });
          if ( !sub.findings.some(f => f.component || f.basics?.enhancementBonus || f.basics?.baseUuid) ) leftovers.push({ text: c, tier, clause: true });
        }
      }
    }
    else leftovers.push({ text: original, tier });
  }

  // No base item and no item noun, but the builder is set to Weapon or Armor (which need a base
  // item): this is most likely a wondrous item.
  if ( !ctx._clause && !inferred && !ctx.baseUuid && findings.some(f => f.component) && !findings.some(f => f.basics?.category) && ["weapon", "armor", "focus"].includes(ctx.category)
    && !findings.some(f => f.basics?.enhancementBonus) && !new RegExp(`(?<![a-z])(?:${ITEM_NOUNS.weapon}|${ITEM_NOUNS.armor}|shield)(?![a-z])`).test(norm(text)) ) {
    inferred = { cat: "equipment", word: "no weapon or armor named" };
  }
  // Item kind from its noun, unless a base item already set it.
  if ( inferred && !findings.some(f => f.basics?.category) && inferred.cat !== ctx.category ) {
    findings.unshift({ label: `Category: ${CATEGORY_LABELS[inferred.cat]} (${/^no /.test(inferred.word) ? inferred.word : `from “${inferred.word}”`})`, tier: 1, sentence: "", basics: { category: inferred.cat } });
  }

  if ( ctx._clause ) return { findings, leftovers };
  // Rule-like sentences nothing could automate become Rules Text, so players still see them.
  const RULEY = /\b(advantage|disadvantage|bonus|resistan|immun|vulnerab|damage|cast|spell|charges?|saving throws?|\bsave\b|speed|darkvision|blindsight|truesight|proficien|expertise|reaction|bonus action|action|hit points|temporary|\bac\b|armor class|score|reach|regain|condition|initiative|teleport|fly|swim|climb|reroll|d20|attack|critical|hits?|breathe|underwater|lets?|allows?|grants?|gives?|you can|you have|can't|cannot|while (?:wearing|holding|attuned)|per (?:day|long rest|short rest)|once)\b/i;
  const rules = new Map();
  for ( const l of [...leftovers] ) {
    if ( !RULEY.test(l.text) || l.text.split(/\s+/).length < 3 ) continue;
    // "The blade deals 1d8 slashing damage." is the weapon's own damage, already on the base item.
    if ( /^(?:the|this|its) (?:blade|weapon|sword|axe|hammer|bow|mace|spear|dagger) deals \d+d\d+ \w+ damage\.?$/i.test(l.text.trim()) ) continue;
    (rules.get(l.tier) ?? rules.set(l.tier, []).get(l.tier)).push(l.text);
    leftovers.splice(leftovers.indexOf(l), 1);
  }
  for ( const [tier, texts] of rules ) {
    const short = texts[0].length > 60 ? texts[0].slice(0, 57) + "…" : texts[0];
    findings.push({ label: `Rules text (not automated): “${short}”${texts.length > 1 ? ` +${texts.length - 1} more` : ""}`, tier, sentence: texts.join(" "),
      component: { type: "reference", name: "Special Rules", text: texts.join(" ") } });
  }

  // "Requires attunement" + an armor/weapon type line is normal; drop duplicate base/enhancement suggestions.
  const seen = new Set();
  const basicsSeen = new Set();
  const unique = findings.filter(f => {
    const key = f.label + "|" + f.tier;
    if ( seen.has(key) ) return false;
    seen.add(key);
    // One value per basic setting: the first mention wins (a table of rarities, a second weapon named later).
    if ( f.basics && !f.basics.tierRarity ) {
      const keys = Object.keys(f.basics).filter(k => !["armorType"].includes(k));
      if ( keys.length && keys.every(k => basicsSeen.has(k === "baseUuid" ? "base" : k)) ) return false;
      for ( const k of keys ) basicsSeen.add(k === "baseUuid" ? "base" : k);
    }
    return true;
  });
  return { findings: unique, leftovers };

  function m2(str) {
    const d = str.match(new RegExp(`${formulaRe} (\\w+) damage`));
    return d ? { f: d[1], t: damageTypesIn(d[2], T)[0] } : null;
  }
}
