/** Region packs and channel (`?src=`) defaults for LEDRING Play. */

export const PACK_SOURCES = ["x", "hn", "reddit", "v2ex", "xhs", "douyin"] as const;

export type PackSource = (typeof PACK_SOURCES)[number];
export type PackLang = "en" | "zh";
export type PackId = "dev" | "cn";
export type OnboardLength = "full" | "skip";
export type EndingKind = "dev" | "share";

export interface ChannelProfile {
  lang: PackLang;
  pack: PackId;
  onboard: OnboardLength;
  ending: EndingKind;
}

export const PACK_CHANNELS: Record<PackSource, ChannelProfile> = {
  x: { lang: "en", pack: "dev", onboard: "full", ending: "dev" },
  hn: { lang: "en", pack: "dev", onboard: "full", ending: "dev" },
  reddit: { lang: "en", pack: "dev", onboard: "full", ending: "dev" },
  v2ex: { lang: "zh", pack: "cn", onboard: "full", ending: "share" },
  xhs: { lang: "zh", pack: "cn", onboard: "skip", ending: "share" },
  douyin: { lang: "zh", pack: "cn", onboard: "skip", ending: "share" },
};

export const DEV_PRESET_IDS = ["snake", "pomo", "paint", "tip"] as const;
export const CN_PRESET_IDS = ["confess", "slack", "bday", "fortune"] as const;

export interface ChinaPreset {
  id: (typeof CN_PRESET_IDS)[number];
  ico: string;
  en: string;
  zh: string;
  name: { en: string; zh: string };
  desc: { en: string; zh: string };
  risk: "network" | "storage" | "eval" | "popup";
}

export const CN_PRESETS: readonly ChinaPreset[] = [
  {
    id: "confess",
    ico: "💌",
    en: "A confession page: type a name, tap once, and the line appears",
    zh: "做一个告白页，输入名字，点一下亮出那句话",
    name: { en: "Confession", zh: "告白页" },
    desc: {
      en: "Type a name. It wants to remember it on this device.",
      zh: "输入名字。它想在这台设备上记住。",
    },
    risk: "storage",
  },
  {
    id: "slack",
    ico: "🐟",
    en: "A slacking-off mini game: switch back to the spreadsheet when the boss turns around",
    zh: "做一个上班摸鱼小游戏，老板回头就切回表格",
    name: { en: "Slacking off", zh: "摸鱼" },
    desc: {
      en: "Tap to slack. It wants to post the time to a server.",
      zh: "点一下摸鱼。它想把时长发到服务器。",
    },
    risk: "network",
  },
  {
    id: "bday",
    ico: "🎂",
    en: "A birthday card: add a name, then tap to open the wish",
    zh: "做一张生日贺卡，写上名字，点开就是祝福",
    name: { en: "Birthday card", zh: "生日贺卡" },
    desc: {
      en: "A name and a wish. It wants to open a share window.",
      zh: "写名字，给一句祝福。它想打开分享窗口。",
    },
    risk: "popup",
  },
  {
    id: "fortune",
    ico: "🔮",
    en: "A little fortune page: enter a birthday and get one short line",
    zh: "做一个今日运势页，输入生日，给一句短签",
    name: { en: "Fortune", zh: "今日运势" },
    desc: {
      en: "A birthday number. It wants to eval a formula.",
      zh: "输入生日里的数字。它想用 eval 跑公式。",
    },
    risk: "eval",
  },
];

/** Relatable wall memes. Fortune uses the canonical example, AI 删库. */
export const CN_MEMES: Record<(typeof CN_PRESET_IDS)[number], { en: string; zh: string }> = {
  confess: { en: "being left on read", zh: "已读不回" },
  slack: { en: "the boss turning around", zh: "摸鱼被抓" },
  bday: { en: "an @all in the group chat", zh: "群里突然@所有人" },
  fortune: { en: "the AI dropping the database", zh: "AI 删库" },
};

export const CN_WALL: Record<PackLang, string> = {
  en: "Detected: {what}. This one feels like {meme}. Select Block before time runs out, or it will be allowed.",
  zh: "检测到：{what}。这波有点像{meme}。要阻止它，请在倒计时结束前点击「拦截」；超时将放行。",
};

export const ENDING_IDS = ["POLISHED", "SHIPPED", "BUGGY", "FAKE", "COMPROMISED", "BROKEN", "ABANDONED"] as const;

export type EndingId = (typeof ENDING_IDS)[number];

export const CN_VERDICTS: Record<PackLang, Record<EndingId, string>> = {
  en: {
    POLISHED: "It works, and it looks good. Send it.",
    SHIPPED: "It opens. Post it.",
    BUGGY: "There's an error. The screenshot still counts.",
    FAKE: "The tests are green. They might be faking it.",
    COMPROMISED: "You let it through. That's how the database gets dropped.",
    BROKEN: "No page came out. The idea is still here.",
    ABANDONED: "You stopped in time.",
  },
  zh: {
    POLISHED: "能用，而且好看。可以发了。",
    SHIPPED: "能打开。先发朋友圈。",
    BUGGY: "有报错。截图也算交作业。",
    FAKE: "测试全绿，但可能是装的。",
    COMPROMISED: "你放行了。AI 删库，往往从这一下开始。",
    BROKEN: "这页没写出来。想法还在。",
    ABANDONED: "停得挺及时。",
  },
};

export interface ExperienceInput {
  queryLang?: string | null;
  querySrc?: string | null;
  storedLang?: string | null;
  langExplicit?: boolean;
  storedSrc?: string | null;
}

export interface Experience {
  lang: PackLang;
  pack: PackId;
  src: PackSource | null;
  onboard: OnboardLength;
  ending: EndingKind;
  presets: readonly string[];
}

export function isPackSource(value: string | null | undefined): value is PackSource {
  return !!value && Object.prototype.hasOwnProperty.call(PACK_CHANNELS, value);
}

export function resolveExperience(input: ExperienceInput): Experience {
  const queryLang = input.queryLang === "zh" || input.queryLang === "en" ? input.queryLang : null;
  const src = isPackSource(input.querySrc) ? input.querySrc : isPackSource(input.storedSrc) ? input.storedSrc : null;
  const channel = src ? PACK_CHANNELS[src] : null;
  const storedLang = input.storedLang === "zh" || input.storedLang === "en" ? input.storedLang : null;
  const explicit = !!input.langExplicit || !!queryLang;
  let lang: PackLang = "en";
  if (queryLang) lang = queryLang;
  else if (explicit && storedLang) lang = storedLang;
  else if (channel) lang = channel.lang;
  else if (storedLang) lang = storedLang;
  const pack: PackId = channel ? channel.pack : lang === "zh" ? "cn" : "dev";
  const onboard: OnboardLength = channel ? channel.onboard : "full";
  const ending: EndingKind = channel ? channel.ending : pack === "cn" ? "share" : "dev";
  return {
    lang,
    pack,
    src,
    onboard,
    ending,
    presets: pack === "cn" ? CN_PRESET_IDS : DEV_PRESET_IDS,
  };
}

export interface StoredExperience {
  lang?: string | null;
  explicit?: string | null;
  src?: string | null;
}

/** Apply legacy `ledring-lang` (set before the explicit flag existed) and channel defaults. */
export function experienceFromQuery(
  query: { lang?: string | null; src?: string | null },
  storage: StoredExperience,
): Experience {
  const storedLang = storage.lang === "zh" || storage.lang === "en" ? storage.lang : null;
  const legacy = !!storedLang && storage.explicit !== "1" && storage.explicit !== "0";
  return resolveExperience({
    queryLang: query.lang ?? null,
    querySrc: query.src ?? null,
    storedLang,
    langExplicit: storage.explicit === "1" || legacy,
    storedSrc: storage.src ?? null,
  });
}

/** China presets use one short choice so a phone run stays inside 1–2 minutes. */
export function runPacing(preset: string | null | undefined, fast: boolean): { versions: number[]; wallSec: number; qteSec: number } {
  const cn = !!preset && (CN_PRESET_IDS as readonly string[]).includes(preset);
  if (fast) return { versions: cn ? [2] : [2, 3], wallSec: 3, qteSec: 4 };
  if (cn) return { versions: [2], wallSec: 3.6, qteSec: 8 };
  return { versions: [2, 3], wallSec: 4.5, qteSec: 10 };
}

export function wallLine(lang: PackLang, preset: string | null | undefined, what: string): string | null {
  if (!preset || !Object.prototype.hasOwnProperty.call(CN_MEMES, preset)) return null;
  const meme = CN_MEMES[preset as (typeof CN_PRESET_IDS)[number]][lang];
  return CN_WALL[lang].replace("{what}", what).replace("{meme}", meme);
}
