"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var livesport_helper_exports = {};
__export(livesport_helper_exports, {
  LiveSportHelper: () => LiveSportHelper
});
module.exports = __toCommonJS(livesport_helper_exports);
var cheerio = __toESM(require("cheerio"));
const BASE = "https://www.livesport.com/";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const COUNTRY_CODES = {
  usa: "us",
  cuba: "cu",
  venezuela: "ve",
  italy: "it",
  panama: "pa",
  "united kingdom": "gb",
  uk: "gb",
  canada: "ca",
  japan: "jp",
  "south korea": "kr",
  mexico: "mx",
  dominican: "do",
  "dominican republic": "do",
  puerto: "pr",
  "puerto rico": "pr",
  australia: "au",
  spain: "es",
  france: "fr",
  germany: "de",
  brazil: "br",
  argentina: "ar",
  colombia: "co",
  bahamas: "bs",
  curacao: "cw",
  lithuania: "lt",
  serbia: "rs",
  slovenia: "si",
  greece: "gr",
  latvia: "lv",
  finland: "fi",
  sweden: "se",
  norway: "no",
  denmark: "dk",
  netherlands: "nl",
  belgium: "be",
  switzerland: "ch",
  austria: "at",
  portugal: "pt",
  turkey: "tr",
  russia: "ru",
  ukraine: "ua",
  poland: "pl",
  china: "cn",
  taiwan: "tw",
  czech: "cz",
  "czech republic": "cz",
  nicaragua: "ni",
  aruba: "aw",
  honduras: "hn",
  ecuador: "ec",
  peru: "pe",
  chile: "cl",
  bolivia: "bo",
  paraguay: "py",
  uruguay: "uy"
};
const CACHE_TTL_LIVE_MS = 2e4;
const CACHE_TTL_IDLE_MS = 6e4;
const FEED_SIGN = "SW9D1eZo";
const SPORT_BY_ID = {
  "1": "soccer",
  "3": "basketball",
  "4": "hockey",
  "5": "cfl",
  "6": "baseball",
  "12": "american-football"
};
const SOCCER_RE = /\b(soccer|premier league|la liga|serie a|bundesliga|uefa|fifa)\b/i;
const SUPPORTED_RE = /\b(baseball|mlb|basketball|nba|hockey|nhl|american football|nfl|cfl)\b/i;
const LIVE_RE = /\b(in progress|live|inning|quarter|period|halftime|half time|ht|break|intermission|delay|1st half|2nd half|overtime|ot)\b/i;
class LiveSportHelper {
  static {
    this.cache = { matches: [], cachedAt: 0 };
  }
  static {
    this.cacheMap = /* @__PURE__ */ new Map();
  }
  static {
    this.dynamicFsign = FEED_SIGN;
  }
  static {
    this.soccerClockAnchors = /* @__PURE__ */ new Map();
  }
  static headers(referer = BASE, feed = false) {
    return {
      "User-Agent": USER_AGENT,
      Accept: feed ? "text/plain,*/*;q=0.8" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: referer,
      ...feed ? { "x-fsign": LiveSportHelper.dynamicFsign } : {}
    };
  }
  static cleanText(value) {
    return String(value || "").replace(/[\s\r\n]+/g, " ").trim();
  }
  static stripHeavyHtml(html) {
    return String(html || "").replace(/<svg\b[\s\S]*?<\/svg>/gi, "").replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "").replace(/<footer\b[\s\S]*?<\/footer>/gi, "").replace(/data:image\/[^"']{500,}/gi, "").replace(
      /<script\b(?![^>]*(?:__INITIAL_STATE__|__NEXT_DATA__|environment))[\s\S]*?<\/script>/gi,
      ""
    );
  }
  static absolute(value) {
    const raw = String(value || "").trim();
    if (!raw)
      return "";
    try {
      return new URL(raw, BASE).toString();
    } catch {
      return "";
    }
  }
  static extractEventToken(...values) {
    for (const value of values) {
      const raw = String(value || "").trim();
      if (!raw)
        continue;
      try {
        const url = new URL(raw, BASE);
        const queryHit = url.searchParams.get("mid") || url.searchParams.get("id") || url.searchParams.get("eventId") || "";
        if (/^[A-Za-z0-9]{8}$/.test(queryHit))
          return queryHit;
        const pathHit = url.pathname.match(/(?:^|\/)([A-Za-z0-9]{8})(?:[/?#]|$)/)?.[1];
        if (pathHit)
          return pathHit;
      } catch {
        const inlineHit = raw.match(
          /(?:^|[^A-Za-z0-9])([A-Za-z0-9]{8})(?:[^A-Za-z0-9]|$)/
        )?.[1];
        if (inlineHit)
          return inlineHit;
      }
    }
    return "";
  }
  static pubFeedHeaders(referer = BASE) {
    return {
      "User-Agent": USER_AGENT,
      Accept: "text/plain,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://www.livesport.com",
      Referer: referer,
      "X-Fsb-Id": "300",
      "x-fsign": LiveSportHelper.dynamicFsign
    };
  }
  static splitFeedRecords(text) {
    return String(text || "").split(/\$|\\u0024|~/).map((record) => record.trim()).filter(Boolean);
  }
  static feedAsset(value) {
    const raw = String(value || "").trim();
    if (!raw)
      return "";
    if (/^https?:\/\//i.test(raw))
      return raw;
    return `https://static.flashscore.com/res/image/data/${raw}`;
  }
  static asset($, node) {
    if (!node)
      return "";
    const el = $(node);
    const values = [
      el.attr("src"),
      el.attr("data-src"),
      el.attr("data-original"),
      el.attr("data-lazy"),
      el.attr("srcset")?.split(/\s+/)[0],
      el.attr("data-srcset")?.split(/\s+/)[0]
    ];
    for (const value of values) {
      const resolved = LiveSportHelper.absolute(value);
      if (resolved)
        return resolved;
    }
    return "";
  }
  static inferSport(rowId, rowText, containerText = "") {
    const id = rowId.match(/^g_(\d+)_/i)?.[1] || "";
    if (id === "1")
      return "soccer";
    if (SPORT_BY_ID[id])
      return SPORT_BY_ID[id];
    const text = `${containerText} ${rowText}`.toLowerCase();
    if (SOCCER_RE.test(text) && !/american football|nfl/.test(text))
      return "soccer";
    if (/baseball|mlb/.test(text))
      return "baseball";
    if (/basketball|nba/.test(text))
      return "basketball";
    if (/hockey|nhl/.test(text))
      return "hockey";
    if (/american football|nfl/.test(text))
      return "american-football";
    return SUPPORTED_RE.test(text) ? "other" : null;
  }
  static normalizeName(value) {
    return LiveSportHelper.cleanText(value).replace(
      /\b(in progress|live|halftime|half time|\d+(?:st|nd|rd|th)?\s+(?:inning|quarter|period))\b/gi,
      ""
    ).replace(/\b\d+\b/g, "").replace(/[¢•|]/g, " ").trim();
  }
  static normalizeTitle(value) {
    return LiveSportHelper.cleanText(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }
  static normalizeMlbName(value) {
    const normalized = LiveSportHelper.normalizeTitle(value).replace(/\b(?:at|vs|v)\b/g, " ").replace(/\s+/g, " ").trim();
    const aliases = [
      [/\barizona d backs\b|\bd backs\b|\bdiamond backs\b/g, "arizona diamondbacks"],
      [/\batlanta braves\b|\bbraves\b/g, "atlanta braves"],
      [/\bbaltimore orioles\b|\borioles\b/g, "baltimore orioles"],
      [/\bboston red sox\b|\bred sox\b/g, "boston red sox"],
      [/\bchicago cubs\b|\bcubs\b/g, "chicago cubs"],
      [/\bchicago white sox\b|\bwhite sox\b/g, "chicago white sox"],
      [/\bcincinnati reds\b|\breds\b/g, "cincinnati reds"],
      [/\bcleveland guardians\b|\bguardians\b/g, "cleveland guardians"],
      [/\bcolorado rockies\b|\brockies\b/g, "colorado rockies"],
      [/\bdetroit tigers\b|\btigers\b/g, "detroit tigers"],
      [/\bhouston astros\b|\bastros\b/g, "houston astros"],
      [/\bkansas city royals\b|\broyals\b/g, "kansas city royals"],
      [/\blas angeles angels\b|\bla angels\b|\bangels\b/g, "los angeles angels"],
      [/\blas angeles dodgers\b|\bla dodgers\b|\bdodgers\b/g, "los angeles dodgers"],
      [/\bmiami marlins\b|\bmarlins\b/g, "miami marlins"],
      [/\bmilwaukee brewers\b|\bbrewers\b/g, "milwaukee brewers"],
      [/\bminnesota twins\b|\btwins\b/g, "minnesota twins"],
      [/\bnew york mets\b|\bny mets\b|\bmets\b/g, "new york mets"],
      [/\bnew york yankees\b|\bny yankees\b|\byankees\b/g, "new york yankees"],
      [/\bathletics\b|\boakland athletics\b|\ba s\b/g, "athletics"],
      [/\bphiladelphia phillies\b|\bphillies\b/g, "philadelphia phillies"],
      [/\bpittsburgh pirates\b|\bpirates\b/g, "pittsburgh pirates"],
      [/\bsan diego padres\b|\bpadres\b/g, "san diego padres"],
      [/\bsan francisco giants\b|\bgiants\b/g, "san francisco giants"],
      [/\bseattle mariners\b|\bmariners\b/g, "seattle mariners"],
      [
        /\bst louis cardinals\b|\bsaint louis cardinals\b|\bcardinals\b/g,
        "st louis cardinals"
      ],
      [/\btampa bay rays\b|\brays\b/g, "tampa bay rays"],
      [/\btexas rangers\b|\brangers\b/g, "texas rangers"],
      [/\btoronto blue jays\b|\bblue jays\b/g, "toronto blue jays"],
      [/\bwashington nationals\b|\bnationals\b/g, "washington nationals"]
    ];
    let out = normalized;
    for (const [pattern, replacement] of aliases) {
      out = out.replace(pattern, replacement);
    }
    return out.replace(/\s+/g, " ").trim();
  }
  static normalizeCflName(value) {
    const normalized = LiveSportHelper.normalizeTitle(value).replace(/\b(?:at|vs|v)\b/g, " ").replace(/\s+/g, " ").trim();
    const aliases = [
      [/\bmontreal alouettes\b|\balouettes\b/g, "montreal alouettes"],
      [/\botawa redblacks\b|\bredblacks\b/g, "ottawa redblacks"],
      [/\btoronto argonauts\b|\bargonauts\b/g, "toronto argonauts"],
      [/\bhamilton tiger cats\b|\btiger cats\b|\bticats\b/g, "hamilton tiger-cats"],
      [/\bwinnipeg blue bombers\b|\bblue bombers\b/g, "winnipeg blue bombers"],
      [/\bedmonton elks\b|\belks\b/g, "edmonton elks"],
      [/\bcalgary stampeders\b|\bstampeders\b/g, "calgary stampeders"],
      [/\bsaskatchewan roughriders\b|\broughriders\b/g, "saskatchewan roughriders"],
      [/\bbc lions\b|\blions\b/g, "bc lions"]
    ];
    let out = normalized;
    for (const [pattern, replacement] of aliases) {
      out = out.replace(pattern, replacement);
    }
    return out.replace(/\s+/g, " ").trim();
  }
  static tokens(value) {
    return LiveSportHelper.normalizeName(value).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(
      (token) => token.length > 2 && !["the", "club", "team", "streams", "links", "state", "city", "live"].includes(
        token
      )
    );
  }
  static fuzzyTitleMatch(title, match) {
    const queryParts = LiveSportHelper.normalizeTitle(title).split(/\b(?:vs|v|@)\b/i).flatMap((part) => part.split(/\s-\s+/)).map((p) => p.trim()).filter(Boolean);
    if (queryParts.length < 2)
      return false;
    const [q1, q2] = queryParts.map((p) => p.toLowerCase());
    const m1 = LiveSportHelper.normalizeTitle(match.homeTeam);
    const m2 = LiveSportHelper.normalizeTitle(match.awayTeam);
    const getTokens = (str) => {
      return str.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(
        (w) => w.length > 2 && !["the", "club", "team", "streams", "links", "state", "city"].includes(w)
      );
    };
    const q1Tokens = getTokens(q1);
    const q2Tokens = getTokens(q2);
    if (!q1Tokens.length || !q2Tokens.length)
      return false;
    const directMatch = q1Tokens.some((t) => m1.includes(t)) && q2Tokens.some((t) => m2.includes(t));
    const reversedMatch = q1Tokens.some((t) => m2.includes(t)) && q2Tokens.some((t) => m1.includes(t));
    if (directMatch || reversedMatch)
      return true;
    const queryAllTokens = [...q1Tokens, ...q2Tokens];
    const matchAllText = `${m1} ${m2} ${LiveSportHelper.normalizeTitle(match.title)}`;
    const hitCount = queryAllTokens.filter((t) => matchAllText.includes(t)).length;
    if (hitCount >= Math.min(2, queryAllTokens.length))
      return true;
    if (queryAllTokens.length >= 4) {
      return hitCount >= 1 && (m1.includes(q1Tokens[0]) || m2.includes(q2Tokens[0]) || matchAllText.includes(q1Tokens[0]) || matchAllText.includes(q2Tokens[0]));
    }
    return false;
  }
  static matchScore(title, match) {
    const normalizedTitle = LiveSportHelper.normalizeTitle(title);
    const normalizedHome = LiveSportHelper.normalizeTitle(match.homeTeam);
    const normalizedAway = LiveSportHelper.normalizeTitle(match.awayTeam);
    const normalizedMatchTitle = LiveSportHelper.normalizeTitle(match.title);
    const titleTokens = normalizedTitle.split(/(?:\bvs\b|\bv\b|@|\s-\s|\s+and\s+)/i).join(" ").split(" ").filter(
      (token) => token.length > 2 && !["the", "club", "team", "stream", "streams", "live"].includes(token)
    );
    const matchText = `${normalizedHome} ${normalizedAway} ${normalizedMatchTitle}`;
    const hitCount = titleTokens.filter((token) => matchText.includes(token)).length;
    const direct = normalizedTitle.includes(normalizedHome) && normalizedTitle.includes(normalizedAway);
    const reverse = normalizedTitle.includes(normalizedAway) && normalizedTitle.includes(normalizedHome);
    const statusBoost = /in progress|live|inning|quarter|period|halftime|break|intermission|ot|overtime|\d+:\d+/.test(
      String(match.status || "").toLowerCase()
    ) ? 3 : 0;
    return (direct || reverse ? 100 : 0) + hitCount * 10 + statusBoost;
  }
  static isLiveLike(match) {
    return Boolean(match.liveScoreboard?.isLive) || /progress|live|inning|quarter|period/i.test(match.status);
  }
  static isFinishedStatus(status) {
    return /finished|completed|ft|aet|ap/i.test(String(status || ""));
  }
  static baseballInning(status) {
    const match = String(status || "").match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+inning\b/i);
    return match ? Number(match[1]) : 0;
  }
  static sortLikelyMatches(matches, sportType = "") {
    const isBaseball = /baseball|mlb/i.test(sportType) || matches.some((match) => match.sport === "baseball");
    return [...matches].sort((a, b) => {
      const aLive = LiveSportHelper.isLiveLike(a);
      const bLive = LiveSportHelper.isLiveLike(b);
      if (aLive && !bLive)
        return -1;
      if (!aLive && bLive)
        return 1;
      const aFinished = LiveSportHelper.isFinishedStatus(a.status);
      const bFinished = LiveSportHelper.isFinishedStatus(b.status);
      if (!aFinished && bFinished)
        return -1;
      if (aFinished && !bFinished)
        return 1;
      if (isBaseball && a.sport === "baseball" && b.sport === "baseball" && aLive && bLive) {
        const aStart = Number(a.startTime || 0);
        const bStart = Number(b.startTime || 0);
        if (aStart && bStart && aStart !== bStart) {
          const nowSec = Math.floor(Date.now() / 1e3);
          return Math.abs(aStart - nowSec) - Math.abs(bStart - nowSec);
        }
        const aInning = LiveSportHelper.baseballInning(a.status);
        const bInning = LiveSportHelper.baseballInning(b.status);
        if (aInning && bInning && aInning !== bInning)
          return bInning - aInning;
      }
      const aTime = Number(a.status) || 0;
      const bTime = Number(b.status) || 0;
      if (aTime && bTime) {
        const nowSec = Math.floor(Date.now() / 1e3);
        return Math.abs(aTime - nowSec) - Math.abs(bTime - nowSec);
      }
      return 0;
    });
  }
  static compareLikelyMatches(a, b, sportType = "") {
    return LiveSportHelper.sortLikelyMatches([a, b], sportType)[0] === a ? -1 : 1;
  }
  static findBestLiveMatch(title, sportType) {
    const normalizedSport = String(sportType || "").toLowerCase().trim();
    const candidates = LiveSportHelper.cache.matches.filter((match) => {
      if (!normalizedSport)
        return true;
      if (/baseball|mlb/.test(normalizedSport))
        return match.sport === "baseball";
      if (/basketball|nba/.test(normalizedSport))
        return match.sport === "basketball";
      if (/hockey|nhl/.test(normalizedSport))
        return match.sport === "hockey";
      if (/cfl/.test(normalizedSport))
        return match.sport === "cfl" || match.sport === "american-football";
      if (/american-football|nfl/.test(normalizedSport))
        return match.sport === "american-football" || match.sport === "cfl";
      if (/soccer|football/.test(normalizedSport))
        return match.sport === "soccer";
      return true;
    });
    if (!candidates.length)
      return null;
    const scored = candidates.map((match) => ({ match, score: LiveSportHelper.matchScore(title, match) })).filter(({ score }) => score >= 10).sort(
      (a, b) => b.score - a.score || LiveSportHelper.compareLikelyMatches(a.match, b.match, sportType)
    );
    return scored[0]?.match || null;
  }
  static statusFromText(text) {
    return LiveSportHelper.cleanText(
      text.match(
        /\b(?:IN PROGRESS|LIVE|HALFTIME|HALF TIME|HT|BREAK|INTERMISSION|DELAYED|POSTPONED|CANCELLED|\d+(?:ST|ND|RD|TH)\s+(?:INNING|QUARTER|PERIOD)|\d+['’]|OT|OVERTIME)\b/i
      )?.[0] || ""
    );
  }
  static num(value) {
    const parsed = Number(String(value || "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  static nullableNum(value) {
    const raw = String(value ?? "").trim();
    if (!raw || /^(x|-|null)$/i.test(raw))
      return null;
    const parsed = Number(raw.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  static feedFields(record) {
    const fields = {};
    if (!record)
      return fields;
    const parts = String(record).split(/[¬\u00ac~]/);
    for (const part of parts) {
      if (!part)
        continue;
      const index = part.search(/[÷\u00f7]/);
      if (index > 0) {
        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        if (key)
          fields[key] = value;
      } else {
        const clean = part.replace(/÷/g, "\xF7").replace(/¬/g, "\xAC");
        const idx = clean.indexOf("\xF7");
        if (idx > 0) {
          const key = clean.slice(0, idx).trim();
          const value = clean.slice(idx + 1).trim();
          if (key)
            fields[key] = value;
        }
      }
    }
    return fields;
  }
  static ordinal(value) {
    if (value % 100 >= 11 && value % 100 <= 13)
      return "TH";
    return value % 10 === 1 ? "ST" : value % 10 === 2 ? "ND" : value % 10 === 3 ? "RD" : "TH";
  }
  static feedStatus(fields, sport) {
    const stage = fields.AB || "";
    const note = LiveSportHelper.cleanText(
      fields.AM || fields.AC || fields.AD || fields.AX || ""
    );
    const isFootball = sport === "cfl" || sport === "american-football" || sport === "nfl";
    if (note && /delay|postpon|cancel|intermission|halftime|half\s*time|break|ht/i.test(note)) {
      if (/ht|halftime|half\s*time/i.test(note))
        return isFootball ? "Halftime" : "HT";
      return note;
    }
    const homeKeys = ["BA", "BC", "BE", "BG", "BI", "BK", "BM", "BO", "BQ", "BS", "BU"];
    const awayKeys = ["BB", "BD", "BF", "BH", "BJ", "BL", "BN", "BP", "BR", "BT", "BV"];
    let maxPeriod = 0;
    for (let i = 0; i < homeKeys.length; i++) {
      if (fields[homeKeys[i]] !== void 0 || fields[awayKeys[i]] !== void 0) {
        maxPeriod = i + 1;
      }
    }
    if (maxPeriod > 0) {
      if (stage === "3")
        return "Finished";
      if (sport === "baseball")
        return `${maxPeriod}${LiveSportHelper.ordinal(maxPeriod)} INNING`;
      if (sport === "basketball") {
        if (maxPeriod > 4)
          return "OVERTIME";
        return `${maxPeriod}${LiveSportHelper.ordinal(maxPeriod)} QUARTER`;
      }
      if (sport === "hockey") {
        if (maxPeriod > 3)
          return "OVERTIME";
        return `${maxPeriod}${LiveSportHelper.ordinal(maxPeriod)} PERIOD`;
      }
      if (sport === "cfl" || sport === "american-football" || sport === "nfl") {
        if (maxPeriod === 2 && /ht|halftime|break|intermission|half.?time/i.test(note))
          return "Halftime";
        if (maxPeriod > 4)
          return "Overtime";
        return `${maxPeriod}${LiveSportHelper.ordinal(maxPeriod)} QUARTER`;
      }
    }
    if (stage === "3")
      return "Finished";
    const period = LiveSportHelper.num(fields.AC || "0");
    if (sport === "baseball" && period > 0)
      return `${period}${LiveSportHelper.ordinal(period)} INNING`;
    if (sport === "basketball" && period > 0)
      return `${period}${LiveSportHelper.ordinal(period)} QUARTER`;
    if (sport === "hockey" && period > 0)
      return `${period}${LiveSportHelper.ordinal(period)} PERIOD`;
    if (sport === "cfl" || sport === "american-football" || sport === "nfl") {
      if (/^\d{2}$/.test(note)) {
        const stageChar = note[0];
        const periodChar = note[1];
        if (stageChar === "3")
          return "Finished";
        const q = parseInt(periodChar, 10);
        if (q >= 1 && q <= 4)
          return `${q}${LiveSportHelper.ordinal(q)} QUARTER`;
        if (q === 5)
          return "Halftime";
        return "Overtime";
      }
      if (note.toLowerCase() === "ht")
        return "Halftime";
      if (note.toLowerCase() === "ot")
        return "Overtime";
      if (period > 0 && period <= 4)
        return `${period}${LiveSportHelper.ordinal(period)} QUARTER`;
      if (period === 5)
        return "Halftime";
      if (period > 5)
        return "Overtime";
    }
    if (sport === "soccer" && stage === "2") {
      const ao = LiveSportHelper.num(fields.AO || "0");
      let ax = String(fields.AX || "1").trim();
      if (fields.AC === "13" || fields.BC !== void 0 || fields.BD !== void 0) {
        ax = "2";
      }
      if (ao > 0) {
        const diffSeconds = Math.floor(Date.now() / 1e3) - ao;
        if (diffSeconds > 0) {
          const diffMinutes = Math.floor(diffSeconds / 60);
          if (ax === "2" && diffMinutes > 75)
            return "Finished";
          if (ax === "1" && diffMinutes > 60)
            return "Halftime";
          const m = ax === "2" ? 45 + diffMinutes : diffMinutes;
          const s = diffSeconds % 60;
          return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
        }
      }
    }
    if (sport === "soccer" && period > 0)
      return `${period}'`;
    if (stage === "2")
      return "In Progress";
    if (stage === "1")
      return "Upcoming";
    return note || "Scheduled";
  }
  static carrySoccerClock(matchId, status, isLive) {
    if (!isLive) {
      if (matchId)
        LiveSportHelper.soccerClockAnchors.delete(matchId);
      return status;
    }
    const key = matchId || "";
    if (!key)
      return status;
    const timeMatch = String(status || "").match(/^(\d{1,3}):(\d{2})$/);
    if (timeMatch) {
      LiveSportHelper.soccerClockAnchors.set(key, {
        minute: Number(timeMatch[1]),
        observedAt: Date.now() - Number(timeMatch[2]) * 1e3
      });
      return status;
    }
    const minuteMatch = String(status || "").match(/^(\d{1,3})'$/);
    if (!minuteMatch)
      return status;
    const minute = Number(minuteMatch[1]);
    const now = Date.now();
    const existing = LiveSportHelper.soccerClockAnchors.get(key);
    if (!existing || existing.minute !== minute || now - existing.observedAt > 9e4) {
      LiveSportHelper.soccerClockAnchors.set(key, { minute, observedAt: now });
      return `${String(minute).padStart(2, "0")}:00`;
    }
    const elapsedSeconds = Math.max(0, Math.floor((now - existing.observedAt) / 1e3));
    const totalSeconds = minute * 60 + Math.min(59, elapsedSeconds);
    const displayMinute = Math.floor(totalSeconds / 60);
    const displaySecond = totalSeconds % 60;
    return `${String(displayMinute).padStart(2, "0")}:${String(displaySecond).padStart(2, "0")}`;
  }
  static feedMatrix(fields, sport) {
    const matrix = { home: {}, away: {}, runsByInning: [] };
    const homeKeys = ["BA", "BC", "BE", "BG", "BI", "BK", "BM", "BO", "BQ", "BS", "BU"];
    const awayKeys = ["BB", "BD", "BF", "BH", "BJ", "BL", "BN", "BP", "BR", "BT", "BV"];
    try {
      let homeSum = 0;
      let awaySum = 0;
      let hasInnings = false;
      const isBaseball = sport === "baseball";
      for (let i = 0; i < homeKeys.length; i += 1) {
        const val1 = LiveSportHelper.nullableNum(fields[homeKeys[i]]);
        const val2 = LiveSportHelper.nullableNum(fields[awayKeys[i]]);
        if (val1 === null && val2 === null)
          continue;
        hasInnings = true;
        const isFootball = sport === "cfl" || sport === "american-football" || sport === "nfl";
        const label = isFootball ? `Q${i + 1}` : String(i + 1);
        matrix.home[label] = val1 ?? 0;
        matrix.away[label] = val2 ?? 0;
        matrix.runsByInning.push({ inning: label, home: val1, away: val2 });
        homeSum += val1 ?? 0;
        awaySum += val2 ?? 0;
      }
      matrix.home.T = fields.AG !== void 0 ? LiveSportHelper.num(fields.AG) : hasInnings ? homeSum : 0;
      matrix.away.T = fields.AH !== void 0 ? LiveSportHelper.num(fields.AH) : hasInnings ? awaySum : 0;
      if (isBaseball) {
        if (fields.WF)
          matrix.home.H = LiveSportHelper.num(fields.WF);
        if (fields.WG)
          matrix.away.H = LiveSportHelper.num(fields.WG);
        if (fields.WH)
          matrix.home.E = LiveSportHelper.num(fields.WH);
        if (fields.WI)
          matrix.away.E = LiveSportHelper.num(fields.WI);
      }
    } catch {
    }
    return matrix;
  }
  static parseFeed(text, sport) {
    const matches = [];
    let league = sport;
    const records = String(text || "").split(/Â¬~|~|¬~/);
    for (const record of records) {
      try {
        const fields = LiveSportHelper.feedFields(record);
        if (fields.ZA)
          league = LiveSportHelper.cleanText(fields.ZA).replace(/^\d+\\|/, "") || league;
        if (!fields.AA)
          continue;
        const homeTeam = LiveSportHelper.cleanText(fields.AE || fields.CX || "");
        const awayTeam = LiveSportHelper.cleanText(fields.AF || "");
        if (!homeTeam || !awayTeam)
          continue;
        const status = LiveSportHelper.feedStatus(fields, sport);
        const homeTotal = LiveSportHelper.num(fields.AG || "0");
        const awayTotal = LiveSportHelper.num(fields.AH || "0");
        const matrix = LiveSportHelper.feedMatrix(fields, sport);
        const startTime = LiveSportHelper.num(
          fields.AD || fields.ADE || fields.AJ || "0"
        );
        matches.push({
          matchId: fields.AA,
          sport,
          title: `${homeTeam} vs ${awayTeam}`,
          homeTeam,
          awayTeam,
          status,
          homeTotal,
          awayTotal,
          url: `${BASE}match/${fields.AA}/#/match-summary`,
          rowText: `${league} ${awayTeam} ${homeTeam} ${status}`,
          startTime: startTime || void 0,
          homeLogo: LiveSportHelper.feedAsset(fields.OA),
          awayLogo: LiveSportHelper.feedAsset(fields.OB),
          matrix,
          stage: fields.AB || ""
        });
      } catch {
      }
    }
    return matches;
  }
  static parseDirectoryRow($, row) {
    try {
      const el = $(row);
      const rowId = el.attr("id") || "";
      const rowText = LiveSportHelper.cleanText(el.text());
      const parentText = LiveSportHelper.cleanText(
        el.closest(
          '.sportName, .event, .leagues--static, [class*="sport"], [class*="league"]'
        ).text()
      ).slice(0, 700);
      const sport = LiveSportHelper.inferSport(rowId, rowText, parentText);
      if (!sport)
        return null;
      const fallbackNames = el.find('.event__participant, [class*="participant"], [class*="teamName"]').map((_, item) => LiveSportHelper.normalizeName($(item).text())).get().filter(Boolean);
      const homeTeam = LiveSportHelper.normalizeName(
        el.find(
          '.event__participant--home, [class*="participant--home"], [class*="homeParticipant"], [data-testid*="home"]'
        ).first().text()
      ) || fallbackNames[0] || "";
      const awayTeam = LiveSportHelper.normalizeName(
        el.find(
          '.event__participant--away, [class*="participant--away"], [class*="awayParticipant"], [data-testid*="away"]'
        ).first().text()
      ) || fallbackNames[1] || "";
      if (!homeTeam || !awayTeam)
        return null;
      const scores = el.find('.event__score, [class*="score"], [data-testid*="score"]').map((_, score) => LiveSportHelper.cleanText($(score).text())).get().filter((score) => /^-?\d+$/.test(score));
      const matchId = rowId.replace(/^g_\d+_/i, "") || el.attr("data-id") || el.attr("data-event-id") || "";
      const status = LiveSportHelper.statusFromText(rowText) || LiveSportHelper.cleanText(
        el.find('.event__stage, [class*="stage"], [class*="status"]').first().text()
      );
      const href = el.find("a[href]").first().attr("href") || "";
      const url = LiveSportHelper.absolute(href) || (matchId ? `${BASE}match/${matchId}/#/match-summary` : "");
      return {
        matchId,
        sport,
        title: `${homeTeam} vs ${awayTeam}`,
        homeTeam,
        awayTeam,
        status,
        homeTotal: LiveSportHelper.num(scores[0] || "0"),
        awayTotal: LiveSportHelper.num(scores[1] || "0"),
        url,
        rowText
      };
    } catch {
      return null;
    }
  }
  static discoverMatches(html) {
    const $ = cheerio.load(LiveSportHelper.stripHeavyHtml(html));
    const map = /* @__PURE__ */ new Map();
    $(
      'div[id^="g_"], .event__match, .event__match--live, [data-event-id], [class*="event__match"]'
    ).each((_, row) => {
      const parsed = LiveSportHelper.parseDirectoryRow($, row);
      if (!parsed)
        return;
      if (!LIVE_RE.test(`${parsed.status} ${parsed.rowText}`) && parsed.homeTotal === 0 && parsed.awayTotal === 0)
        return;
      const key = parsed.matchId || `${parsed.sport}:${parsed.homeTeam}:${parsed.awayTeam}`.toLowerCase();
      if (!map.has(key))
        map.set(key, parsed);
    });
    return [...map.values()];
  }
  static parseMatrix($) {
    const matrix = { home: {}, away: {}, runsByInning: [] };
    try {
      const table = $(
        '.smh__part, .detailScorecard__wrapper, [class*="scorecard"], [class*="inning"]'
      ).first();
      if (!table.length)
        return matrix;
      const headers = table.find(
        '.smh__part--header span, thead th, tr:first-child th, tr:first-child td, [class*="header"] [class*="cell"]'
      ).map((_, cell) => LiveSportHelper.cleanText($(cell).text())).get().filter(Boolean);
      const rows = table.find('.smh__participant, .detailScorecard__row, tr, [class*="scorecard__row"]').toArray();
      const parseRow = (row) => $(row).find('.smh__score, td, [class*="score"], [class*="cell"]').map((_, cell) => LiveSportHelper.cleanText($(cell).text())).get().filter((value) => /^-?\d+$/.test(value));
      const numericRows = rows.map(parseRow).filter((cells) => cells.length >= 2);
      if (numericRows.length >= 2) {
        const away = numericRows[0] || [];
        const home = numericRows[1] || [];
        const max = Math.max(away.length, home.length);
        for (let i = 0; i < max; i += 1) {
          const label = headers[i] || String(i + 1);
          const awayValue = away[i] === void 0 ? null : LiveSportHelper.num(away[i]);
          const homeValue = home[i] === void 0 ? null : LiveSportHelper.num(home[i]);
          matrix.away[label] = awayValue ?? 0;
          matrix.home[label] = homeValue ?? 0;
          if (/^\d+$/.test(label)) {
            matrix.runsByInning.push({ inning: label, away: awayValue, home: homeValue });
          }
        }
      }
    } catch {
    }
    return matrix;
  }
  static pqJsonHeaders(referer = BASE) {
    return {
      "User-Agent": USER_AGENT,
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://www.livesport.com",
      Referer: referer,
      "X-Fsb-Id": "300"
    };
  }
  static tryParseJson(text) {
    const raw = String(text || "").trim();
    if (!raw || !raw.startsWith("{") && !raw.startsWith("["))
      return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  static inferSoccerProjectConfig(url) {
    const raw = String(url || "").toLowerCase();
    if (raw.includes("flashscoreusa.com")) {
      return {
        endpoint: "https://130.ds.lsapp.eu/pq_graphql",
        projectId: 130,
        referer: "https://www.flashscoreusa.com/"
      };
    }
    return {
      endpoint: "https://500.ds.lsapp.eu/pq_graphql",
      projectId: 500,
      referer: "https://www.livesport.com/"
    };
  }
  static normalizeSoccerStatLabel(label, type = "") {
    const clean = LiveSportHelper.cleanText(label);
    const token = `${type} ${clean}`.toLowerCase();
    if (!token)
      return "";
    if (token.includes("expected_goals") || token.includes("expected goals"))
      return "Expected Goals (xG)";
    if (token.includes("xgot") || token.includes("expected goals on target"))
      return "Expected Goals on Target (xGOT)";
    if (token.includes("ball_possession") || token.includes("ball possession"))
      return "Ball Possession";
    if (token.includes("goal_attempts") || token.includes("total shots"))
      return "Total Shots";
    if (token.includes("shots_on_target") || token.includes("shots on target"))
      return "Shots on Target";
    if (token.includes("shots_off_target") || token.includes("shots off target"))
      return "Shots off Target";
    if (token.includes("big_chances") || token.includes("big chances"))
      return "Big Chances";
    if (token.includes("corner"))
      return "Corner Kicks";
    if (token.includes("offside"))
      return "Offsides";
    if (token.includes("foul"))
      return "Fouls";
    if (token.includes("yellow"))
      return "Yellow Cards";
    if (token.includes("red"))
      return "Red Cards";
    if (token.includes("passes") && token.includes("completed"))
      return "Completed Passes";
    if (token.includes("passes") && token.includes("attempt"))
      return "Attempted Passes";
    if (token.includes("passes"))
      return "Passes";
    if (token.includes("touches_in_opposition_box") || token.includes("touches in opposition box"))
      return "Touches in Opposition Box";
    return clean;
  }
  static parseSoccerBoxStatsFromJson(payload) {
    const home = {};
    const away = {};
    const participants = payload?.data?.findEventById?.eventParticipants;
    if (!Array.isArray(participants))
      return { home, away };
    for (const participant of participants) {
      try {
        const side = String(participant?.type?.side || "").toUpperCase();
        const target = side === "AWAY" ? away : home;
        const groups = Array.isArray(participant?.stats) ? participant.stats : [];
        for (const group of groups) {
          const values = Array.isArray(group?.values) ? group.values : [];
          for (const entry of values) {
            const label = LiveSportHelper.normalizeSoccerStatLabel(
              entry?.name || entry?.label || "",
              entry?.type || ""
            );
            if (!label)
              continue;
            target[label] = LiveSportHelper.cleanText(entry?.label || entry?.value || "");
          }
        }
      } catch {
      }
    }
    return { home, away };
  }
  static mapSoccerIncidentType(rawType) {
    const type = String(rawType || "").toLowerCase();
    if (type.includes("substitution"))
      return "substitution";
    if (type.includes("yellow"))
      return "yellow";
    if (type.includes("red"))
      return "red";
    return null;
  }
  static buildSoccerPlayer(player, lineupSlotMap) {
    const images = Array.isArray(player?.images) ? player.images : [];
    const teamLogos = Array.isArray(player?.teamLogo) ? player.teamLogo : [];
    const photoPath = images.find((item) => item?.path)?.path || "";
    const logoPath = teamLogos.find((item) => item?.path)?.path || "";
    const incidents = Array.isArray(player?.incidents) ? player.incidents : [];
    const events = incidents.map((item) => {
      const kind = LiveSportHelper.mapSoccerIncidentType(item?.__typename || "");
      if (!kind)
        return null;
      return {
        type: kind,
        minute: LiveSportHelper.cleanText(item?.incident?.minute || ""),
        detail: LiveSportHelper.cleanText((item?.incident?.reasons || []).join(", "))
      };
    }).filter(Boolean);
    return {
      jersey: String(player?.number || ""),
      number: String(player?.number || ""),
      flag: logoPath ? LiveSportHelper.feedAsset(logoPath) : "",
      icon: logoPath ? LiveSportHelper.feedAsset(logoPath) : "",
      name: LiveSportHelper.cleanText(
        player?.fieldName || player?.name || player?.listName || ""
      ),
      photo: photoPath ? LiveSportHelper.feedAsset(photoPath) : "",
      image: photoPath ? LiveSportHelper.feedAsset(photoPath) : "",
      avatar: photoPath ? LiveSportHelper.feedAsset(photoPath) : "",
      playerUrl: player?.participant?.url ? `${BASE}${String(player.participant.url).replace(/^\/+/, "")}` : "",
      playerId: String(player?.participantId || player?.id || ""),
      lineupSlot: lineupSlotMap.get(String(player?.participantId || player?.id || "")) || 0,
      role: Array.isArray(player?.playerRoles) && player.playerRoles.length ? LiveSportHelper.cleanText(
        player.playerRoles.map((role) => role?.title || role?.suffix || "").filter(Boolean).join(", ")
      ) : "player",
      events: events?.length ? events : void 0
    };
  }
  static parseSoccerLineupsFromJson(payload) {
    const empty = {
      batters: [],
      pitchers: [],
      coaches: [],
      starters: [],
      substitutes: [],
      home: [],
      away: [],
      homeStarters: [],
      awayStarters: [],
      homeSubstitutes: [],
      awaySubstitutes: [],
      startingHome: [],
      startingAway: [],
      substitutesHome: [],
      substitutesAway: []
    };
    const participants = payload?.data?.findEventById?.eventParticipants;
    if (!Array.isArray(participants))
      return empty;
    const switchedParticipants = Boolean(
      payload?.data?.findEventById?.tournamentStage?.tournament?.tournamentTemplate?.switchedParticipants
    );
    for (const participant of participants) {
      try {
        const side = String(participant?.type?.side || "").toUpperCase();
        const lineup = participant?.lineup;
        if (!lineup)
          continue;
        const isAway = side === "AWAY";
        const targetHome = switchedParticipants ? isAway : !isAway;
        const players = Array.isArray(lineup?.players) ? lineup.players : [];
        const groups = Array.isArray(lineup?.groups) ? lineup.groups : [];
        const coachesGroup = lineup?.coaches;
        const lineupSlotMap = /* @__PURE__ */ new Map();
        const lines = Array.isArray(lineup?.formation?.lines) ? lineup.formation.lines : [];
        let slotIndex = 1;
        for (const line of lines) {
          for (const row of Array.isArray(line?.rows) ? line.rows : []) {
            for (const playerId of Array.isArray(row?.playerIds) ? row.playerIds : []) {
              lineupSlotMap.set(String(playerId), slotIndex++);
            }
          }
        }
        const playerMap = new Map(
          players.map((player) => [
            String(player?.participantId || player?.id || ""),
            player
          ])
        );
        const buildGroupPlayers = (name) => {
          const group = groups.find(
            (entry) => LiveSportHelper.cleanText(entry?.name || "").toLowerCase() === name.toLowerCase()
          );
          if (!group || !Array.isArray(group.playerIds))
            return [];
          return group.playerIds.map((id) => playerMap.get(String(id))).filter(Boolean).map(
            (player) => LiveSportHelper.buildSoccerPlayer(player, lineupSlotMap)
          );
        };
        const starters = buildGroupPlayers("Starting Lineups");
        const substitutes = buildGroupPlayers("Substitutes");
        const coaches = Array.isArray(coachesGroup?.players) ? coachesGroup.players.map((player) => ({
          ...LiveSportHelper.buildSoccerPlayer(player, lineupSlotMap),
          role: "coach"
        })) : [];
        if (targetHome) {
          empty.home = [...starters, ...substitutes, ...coaches];
          empty.homeStarters = starters;
          empty.startingHome = starters;
          empty.homeSubstitutes = substitutes;
          empty.substitutesHome = substitutes;
        } else {
          empty.away = [...starters, ...substitutes, ...coaches];
          empty.awayStarters = starters;
          empty.startingAway = starters;
          empty.awaySubstitutes = substitutes;
          empty.substitutesAway = substitutes;
        }
        empty.coaches = [...empty.coaches || [], ...coaches];
      } catch {
      }
    }
    empty.starters = [...empty.homeStarters || [], ...empty.awayStarters || []];
    empty.substitutes = [
      ...empty.homeSubstitutes || [],
      ...empty.awaySubstitutes || []
    ];
    empty.batters = [...empty.home || [], ...empty.away || []].filter(
      (player) => player.role !== "coach"
    );
    empty.pitchers = [];
    return empty;
  }
  static parseSoccerLiveStatsFromJson(payload) {
    const eventsTimeline = [];
    const participants = payload?.data?.findEventById?.eventParticipants;
    if (!Array.isArray(participants))
      return { eventsTimeline };
    for (const participant of participants) {
      try {
        const side = String(participant?.type?.side || "").toLowerCase();
        const usedSubs = Array.isArray(participant?.lineup?.usedSubstitutions) ? participant.lineup.usedSubstitutions : [];
        for (const sub of usedSubs) {
          eventsTimeline.push({
            minute: LiveSportHelper.cleanText(sub?.minute || ""),
            type: "substitution",
            player: String(sub?.playerId || ""),
            detail: `${side}: ${String(sub?.playerOutId || "")}`.trim()
          });
        }
      } catch {
      }
    }
    return { eventsTimeline };
  }
  static parseFeedLineups(text) {
    const parsed = LiveSportHelper.tryParseJson(text);
    if (parsed) {
      return LiveSportHelper.parseSoccerLineupsFromJson(parsed);
    }
    const home = [];
    const away = [];
    const allBatters = [];
    const allPitchers = [];
    let currentSection = null;
    let currentType = "player";
    let currentTeam = null;
    let homeFormation = "";
    let awayFormation = "";
    const records = LiveSportHelper.splitFeedRecords(text);
    for (const record of records) {
      if (!record.trim())
        continue;
      const fields = LiveSportHelper.feedFields(record);
      const sectionLabel = LiveSportHelper.cleanText(
        fields.LB || fields.LM || fields.LN || ""
      );
      if (sectionLabel) {
        const sec = sectionLabel.toLowerCase();
        if (sec.includes("starter") || sec.includes("starting lineup") || sec.includes("lineup")) {
          currentSection = "starters";
          currentType = "player";
        } else if (sec.includes("substitute") || sec.includes("bench") || sec.includes("reserve")) {
          currentSection = "substitutes";
          currentType = "player";
        } else if (sec.includes("coach")) {
          currentSection = "coaches";
          currentType = "coach";
        } else if (sec.includes("yellow card") || sec.includes("red card")) {
          currentSection = "substitutes";
          currentType = "player";
        } else if (sec.includes("player")) {
          currentSection = "starters";
          currentType = "player";
        } else if (sec.includes("batter")) {
          currentSection = "starters";
          currentType = "batter";
        } else if (sec.includes("pitcher")) {
          currentSection = "starters";
          currentType = "pitcher";
        }
      }
      if (fields.LC) {
        if (fields.LC === "1")
          currentTeam = "home";
        else if (fields.LC === "2")
          currentTeam = "away";
      }
      if (fields.LD) {
        if (currentTeam === "home")
          homeFormation = fields.LD;
        else if (currentTeam === "away")
          awayFormation = fields.LD;
      }
      if (fields.LH !== void 0 || fields.LI || fields.LJ) {
        const name = LiveSportHelper.cleanText(fields.LI || fields.LJ || fields.LK || "");
        if (!name)
          continue;
        const jersey = fields.LJ || fields.LK || "";
        const photo = LiveSportHelper.feedAsset(
          fields.LPI || fields.LPL || fields.LPX || fields.LPZ || fields.LPY || fields.LPQ
        );
        const countryName = fields.LQ || "";
        let icon = "";
        if (countryName) {
          const norm = countryName.toLowerCase().trim();
          const code = COUNTRY_CODES[norm] || "";
          if (code)
            icon = `https://flagcdn.com/w40/${code}.png`;
        }
        const events = [];
        const minute = LiveSportHelper.cleanText(
          fields.LM || fields.LN || fields.LO || ""
        );
        const detail = LiveSportHelper.cleanText(fields.LP || fields.NU || "");
        if (minute && /sub/i.test(sectionLabel))
          events.push({ type: "substitution", minute, detail });
        if (minute && /yellow/i.test(sectionLabel))
          events.push({ type: "yellow", minute, detail });
        if (minute && /red/i.test(sectionLabel))
          events.push({ type: "red", minute, detail });
        const player = {
          jersey,
          number: jersey,
          flag: icon,
          icon,
          name,
          photo,
          image: photo,
          avatar: photo,
          playerUrl: fields.NU ? LiveSportHelper.absolute(fields.NU) : "",
          playerId: fields.LP || "",
          lineupSlot: LiveSportHelper.num(fields.LL || fields.LH || "0"),
          events: events.length ? events : void 0,
          position: fields.LS || "",
          isGoalkeeper: String(fields.LS || "").toLowerCase().includes("goalkeeper"),
          role: currentSection === "coaches" ? "coach" : currentSection === "substitutes" ? "substitute" : currentType === "pitcher" ? "pitcher" : currentType === "batter" ? "batter" : currentSection === "starters" ? "starter" : "player"
        };
        if (currentTeam === "home")
          home.push(player);
        else if (currentTeam === "away")
          away.push(player);
        if (currentType === "batter")
          allBatters.push(player);
        else if (currentType === "pitcher")
          allPitchers.push(player);
      }
    }
    const starters = [...home, ...away].filter(
      (p) => p.role === "starter" || p.role === "batter" || p.role === "pitcher"
    );
    const substitutes = [...home, ...away].filter((p) => p.role === "substitute");
    const batters = allBatters.length > 0 ? allBatters : [...home, ...away].filter((p) => p.role === "starter" || p.role === "player");
    const pitchers = allPitchers.length > 0 ? allPitchers : [...home, ...away].filter((p) => p.role === "pitcher");
    const coaches = [...home, ...away].filter((p) => p.role === "coach");
    return {
      batters,
      pitchers,
      coaches,
      starters,
      substitutes,
      home,
      away,
      homeFormation,
      awayFormation,
      homeStarters: home.filter(
        (p) => p.role === "starter" || p.role === "batter" || p.role === "pitcher"
      ),
      awayStarters: away.filter(
        (p) => p.role === "starter" || p.role === "batter" || p.role === "pitcher"
      ),
      homeSubstitutes: home.filter((p) => p.role === "substitute"),
      awaySubstitutes: away.filter((p) => p.role === "substitute"),
      startingHome: home.filter(
        (p) => p.role === "starter" || p.role === "batter" || p.role === "pitcher"
      ),
      startingAway: away.filter(
        (p) => p.role === "starter" || p.role === "batter" || p.role === "pitcher"
      ),
      substitutesHome: home.filter((p) => p.role === "substitute"),
      substitutesAway: away.filter((p) => p.role === "substitute")
    };
  }
  static parseFeedBoxStats(text) {
    const parsed = LiveSportHelper.tryParseJson(text);
    if (parsed) {
      return LiveSportHelper.parseSoccerBoxStatsFromJson(parsed);
    }
    const home = {};
    const away = {};
    const records = LiveSportHelper.splitFeedRecords(text);
    let currentLabel = "";
    const mapLabel = (label) => {
      const clean = LiveSportHelper.cleanText(label).toLowerCase();
      if (!clean)
        return "";
      if (clean.includes("ball possession"))
        return "Ball Possession";
      if (clean.includes("shots on goal") || clean.includes("on target"))
        return "Shots on Goal";
      if (clean.includes("shots off goal") || clean.includes("off target"))
        return "Shots off Goal";
      if (clean.includes("goal attempts") || clean === "shots")
        return "Goal Attempts";
      if (clean.includes("corner"))
        return "Corner Kicks";
      if (clean.includes("foul"))
        return "Fouls";
      if (clean.includes("yellow"))
        return "Yellow Cards";
      if (clean.includes("red"))
        return "Red Cards";
      if (clean.includes("offside"))
        return "Offsides";
      if (clean.includes("substitution"))
        return "Substitutions";
      return LiveSportHelper.cleanText(label);
    };
    for (const record of records) {
      if (!record.trim())
        continue;
      const fields = LiveSportHelper.feedFields(record);
      if (fields.SE && fields.SE !== "Match")
        break;
      const label = mapLabel(fields.SG || fields.SA || fields.SB || currentLabel);
      const homeVal = LiveSportHelper.cleanText(
        fields.SH || fields.SD || fields.SF || ""
      );
      const awayVal = LiveSportHelper.cleanText(
        fields.SI || fields.SE || fields.SG || ""
      );
      const value = LiveSportHelper.cleanText(fields.SJ || fields.SK || fields.SL || "");
      if (label)
        currentLabel = label;
      if (!label)
        continue;
      const merged = value || homeVal || awayVal;
      if (/possession/i.test(label) && merged) {
        const pct = merged.match(/(\d{1,3})\s*%/);
        if (pct) {
          home[label] = `${pct[1]}%`;
          away[label] = `${100 - Number(pct[1])}%`;
          continue;
        }
      }
      if (homeVal || awayVal || merged) {
        home[label] = homeVal || merged || "";
        away[label] = awayVal || merged || "";
      }
    }
    return { home, away };
  }
  static latestSoccerClockFromCommentary(text) {
    for (const record of LiveSportHelper.splitFeedRecords(text)) {
      const fields = LiveSportHelper.feedFields(record);
      const detail = LiveSportHelper.cleanText(
        `${fields.MD || ""} ${fields.MC || ""} ${fields.MB || ""}`
      );
      if (/half[-\s]?time|halftime/i.test(detail))
        return "Halftime";
      if (/full[-\s]?time|final whistle|match is over|end of (?:the )?match/i.test(detail))
        return "Finished";
      const clock = LiveSportHelper.cleanText(fields.MK || "");
      if (/^\d{1,3}:\d{2}(?:\s*\+\d{1,2}:\d{2})?$/.test(clock))
        return clock;
      const minute = LiveSportHelper.cleanText(fields.MB || "");
      const minuteMatch = minute.match(/^(\d{1,3})(?:\+\d{1,2})?'$/);
      if (minuteMatch)
        return `${String(Number(minuteMatch[1])).padStart(2, "0")}:00`;
    }
    return "";
  }
  static parseFeedLiveStats(text) {
    const parsed = LiveSportHelper.tryParseJson(text);
    if (parsed) {
      return LiveSportHelper.parseSoccerLiveStatsFromJson(parsed);
    }
    const eventsTimeline = [];
    for (const record of LiveSportHelper.splitFeedRecords(text)) {
      const fields = LiveSportHelper.feedFields(record);
      const minute = LiveSportHelper.cleanText(
        fields.TM || fields.AC || fields.TI || fields.IN || ""
      );
      const type = LiveSportHelper.cleanText(fields.AT || fields.TY || fields.IT || "");
      const player = LiveSportHelper.cleanText(fields.PN || fields.PC || fields.PS || "");
      const detail = LiveSportHelper.cleanText(
        fields.DI || fields.IT || fields.CM || fields.TD || ""
      );
      if (!minute && !type && !player && !detail)
        continue;
      eventsTimeline.push({ minute, type, player, detail });
    }
    return { eventsTimeline };
  }
  static parseFeedH2H(text, homeTeamName, awayTeamName) {
    const homeLastGames = [];
    const awayLastGames = [];
    const directHeadToHead = [];
    let currentMode = null;
    const records = LiveSportHelper.splitFeedRecords(text);
    const parseOutcome = (value) => {
      const token = String(value || "").trim().toLowerCase();
      if (token === "w" || token.includes("win"))
        return "W";
      if (token === "l" || token.includes("loss"))
        return "L";
      return "D";
    };
    for (const record of records) {
      if (!record.trim())
        continue;
      const fields = LiveSportHelper.feedFields(record);
      if (fields.KB) {
        const title = fields.KB.toLowerCase();
        if (title.includes("last matches:")) {
          const teamName = fields.KB.replace(/last matches:\s*/i, "").trim();
          const normTeamName = LiveSportHelper.normalizeTitle(teamName);
          const normHomeTeamName = LiveSportHelper.normalizeTitle(homeTeamName);
          const normAwayTeamName = LiveSportHelper.normalizeTitle(awayTeamName);
          const isHome = normTeamName.includes(normHomeTeamName) || normHomeTeamName.includes(normTeamName);
          const isAway = normTeamName.includes(normAwayTeamName) || normAwayTeamName.includes(normTeamName);
          if (isHome)
            currentMode = "home";
          else if (isAway)
            currentMode = "away";
          else if (!currentMode)
            currentMode = "home";
          else if (currentMode === "home")
            currentMode = "away";
        } else if (title.includes("head-to-head")) {
          currentMode = "h2h";
        }
      }
      if (fields.KC !== void 0 && currentMode !== null) {
        const timestamp = Number(fields.KC) * 1e3;
        let dateStr = "";
        if (Number.isFinite(timestamp)) {
          const date = new Date(timestamp);
          const d = String(date.getDate()).padStart(2, "0");
          const m = String(date.getMonth() + 1).padStart(2, "0");
          const y = String(date.getFullYear()).slice(-2);
          dateStr = `${d}.${m}.${y}`;
        }
        const tournament = LiveSportHelper.cleanText(fields.KF || fields.KD || "");
        const homeName = LiveSportHelper.cleanText(fields.FH || fields.KM || "");
        const awayName = LiveSportHelper.cleanText(fields.FK || fields.KN || "");
        const score = LiveSportHelper.cleanText(fields.KL || fields.KO || "").replace(
          ":",
          " - "
        );
        const outcome = parseOutcome(fields.WIS || fields.KP || fields.KQ || "D");
        const badgeText = LiveSportHelper.cleanText(
          fields.KR || fields.KS || fields.KT || ""
        );
        const normHomeName = LiveSportHelper.normalizeTitle(homeName);
        const normAwayName = LiveSportHelper.normalizeTitle(awayName);
        const normHomeTeamName = LiveSportHelper.normalizeTitle(homeTeamName);
        const normAwayTeamName = LiveSportHelper.normalizeTitle(awayTeamName);
        let opponent = "";
        if (currentMode === "home") {
          opponent = normHomeName.includes(normHomeTeamName) ? awayName : homeName;
        } else if (currentMode === "away") {
          opponent = normAwayName.includes(normAwayTeamName) ? homeName : awayName;
        } else {
          opponent = `${homeName} vs ${awayName}`.trim();
        }
        const hLogo = LiveSportHelper.feedAsset(fields.EC);
        const aLogo = LiveSportHelper.feedAsset(fields.ED);
        let opponentLogo = "";
        if (opponent === homeName)
          opponentLogo = hLogo;
        else if (opponent === awayName)
          opponentLogo = aLogo;
        const game = {
          date: dateStr,
          tournament,
          opponent,
          score,
          outcome,
          opponentLogo
        };
        if (currentMode === "home" && homeLastGames.length < 5)
          homeLastGames.push(game);
        else if (currentMode === "away" && awayLastGames.length < 5)
          awayLastGames.push(game);
        else if (currentMode === "h2h" && directHeadToHead.length < 5)
          directHeadToHead.push({ ...game, tournament: badgeText || tournament });
      }
    }
    return { homeLastGames, awayLastGames, directHeadToHead };
  }
  static fromSeed(seed) {
    const matrix = seed.matrix || { home: {}, away: {}, runsByInning: [] };
    const statusRow = `${seed.status} ${seed.rowText}`;
    let isLive = false;
    if (!/\b(finished|completed|ended|full\s*time|ft\b|final)\b/i.test(statusRow)) {
      isLive = LIVE_RE.test(statusRow) || /^\d+'$/.test(seed.status) || /^Q[1-4]$/i.test(seed.status) || (seed.sport === "soccer" ? seed.stage === "2" && /^\d+:\d+$/.test(seed.status) : /^\d+:\d+$/.test(seed.status));
    }
    const status = seed.sport === "soccer" ? LiveSportHelper.carrySoccerClock(
      seed.matchId,
      seed.status || "Scheduled",
      isLive
    ) : seed.status || "Scheduled";
    const liveScoreboard = {
      homeTotal: seed.homeTotal,
      awayTotal: seed.awayTotal,
      status,
      isLive,
      matrix
    };
    return {
      id: seed.url,
      matchId: seed.matchId,
      sport: seed.sport,
      status: liveScoreboard.status,
      teams: { home: seed.homeTeam, away: seed.awayTeam },
      scores: { homeTotal: seed.homeTotal, awayTotal: seed.awayTotal, matrix },
      homeTeam: seed.homeTeam,
      awayTeam: seed.awayTeam,
      homeLogo: seed.homeLogo || "",
      awayLogo: seed.awayLogo || "",
      url: seed.url,
      title: seed.title,
      startTime: seed.startTime,
      liveScoreboard,
      boxStats: { home: {}, away: {} },
      lineups: { batters: [], pitchers: [], coaches: [], home: [], away: [] },
      h2hHistory: { homeLastGames: [], awayLastGames: [] },
      detailsFetched: false
    };
  }
  static emptyPayload(status = "Upcoming") {
    return {
      liveScoreboard: {
        homeTotal: 0,
        awayTotal: 0,
        status,
        isLive: false,
        matrix: { home: {}, away: {}, runsByInning: [] }
      },
      boxStats: { home: {}, away: {} },
      lineups: {
        batters: [],
        pitchers: [],
        coaches: [],
        home: [],
        away: [],
        startingHome: [],
        startingAway: [],
        substitutesHome: [],
        substitutesAway: [],
        homeStarters: [],
        awayStarters: [],
        homeSubstitutes: [],
        awaySubstitutes: []
      },
      h2hHistory: { homeLastGames: [], awayLastGames: [], directHeadToHead: [] },
      liveStats: { eventsTimeline: [] }
    };
  }
  static makeCacheKeys(home, away) {
    const clean = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const h = clean(home);
    const a = clean(away);
    return [`${h}_${a}`, `${a}_${h}`];
  }
  static isSoccer(title, sport) {
    const combined = `${title} ${sport}`.toLowerCase();
    if (combined.includes("soccer") || combined.includes("football")) {
      if (combined.includes("american football") || combined.includes("nfl")) {
        return false;
      }
      return true;
    }
    if (SOCCER_RE.test(combined))
      return true;
    return false;
  }
  static async refreshFsign(client) {
    try {
      const response = await client.get(BASE, {
        headers: { "User-Agent": USER_AGENT },
        timeout: 8e3
      });
      const mtiRegex = /"MTI"\s*:\s*"([A-Za-z0-9]{8})"/g;
      const mtis = [];
      let mtiMatch;
      while ((mtiMatch = mtiRegex.exec(response.data)) !== null) {
        mtis.push(mtiMatch[1]);
      }
      const mtRegex = /"6_\d+_([A-Za-z0-9]{8})"/g;
      let mtMatch;
      while ((mtMatch = mtRegex.exec(response.data)) !== null) {
        mtis.push(mtMatch[1]);
      }
      const uniqueMtis = Array.from(new Set(mtis));
      const testUrl = `${BASE}x/feed/f_6_0_2_en_1`;
      if (uniqueMtis.includes(LiveSportHelper.dynamicFsign)) {
        const idx = uniqueMtis.indexOf(LiveSportHelper.dynamicFsign);
        uniqueMtis.splice(idx, 1);
        uniqueMtis.unshift(LiveSportHelper.dynamicFsign);
      } else {
        uniqueMtis.unshift(LiveSportHelper.dynamicFsign);
      }
      for (const mti of uniqueMtis) {
        try {
          const testRes = await client.get(testUrl, {
            headers: {
              "User-Agent": USER_AGENT,
              Referer: `${BASE}baseball/`,
              "x-fsign": mti
            },
            timeout: 3e3
          });
          if (testRes.status === 200 && testRes.data) {
            LiveSportHelper.dynamicFsign = mti;
            console.log(`LiveSportHelper: Found working feed fsign: ${mti}`);
            return mti;
          }
        } catch (e) {
        }
      }
    } catch (err) {
      console.warn(
        "LiveSportHelper: Failed to refresh dynamic fsign, using fallback:",
        err
      );
    }
    return LiveSportHelper.dynamicFsign;
  }
  static getCachedMatches() {
    return LiveSportHelper.cache.matches;
  }
  static findCachedMatch(title) {
    const parts = title.split(/\b(?:vs|v|at|-)\b/i).map((p) => p.trim());
    if (parts.length >= 2) {
      const keys = LiveSportHelper.makeCacheKeys(parts[0], parts[1]);
      for (const key of keys) {
        const cachedList = LiveSportHelper.cacheMap.get(key);
        if (cachedList && cachedList.length > 0) {
          const sorted = LiveSportHelper.sortLikelyMatches(cachedList);
          return sorted[0];
        }
      }
    }
    return LiveSportHelper.cache.matches.find(
      (match) => LiveSportHelper.fuzzyTitleMatch(title, match)
    ) || null;
  }
  static async findOrCrawlMatch(client, title, sportType) {
    await LiveSportHelper.getAllLiveStats(client);
    let match = null;
    const parts = title.split(/\b(?:vs|v|at|-)\b/i).map((p) => p.trim());
    if (parts.length >= 2) {
      const keys = LiveSportHelper.makeCacheKeys(parts[0], parts[1]);
      for (const key of keys) {
        const cachedList = LiveSportHelper.cacheMap.get(key);
        if (cachedList && cachedList.length > 0) {
          const sorted = LiveSportHelper.sortLikelyMatches(cachedList, sportType);
          match = sorted[0];
          break;
        }
      }
    }
    if (!match) {
      let canonicalSport = "";
      if (/baseball|mlb/i.test(sportType))
        canonicalSport = "baseball";
      else if (/basketball|nba/i.test(sportType))
        canonicalSport = "basketball";
      else if (/hockey|nhl/i.test(sportType))
        canonicalSport = "hockey";
      else if (/cfl|american-football|nfl/i.test(sportType))
        canonicalSport = "";
      else if (/soccer|football/i.test(sportType))
        canonicalSport = "soccer";
      const scored = LiveSportHelper.cache.matches.filter((c) => !canonicalSport || c.sport === canonicalSport).map((c) => ({ match: c, score: LiveSportHelper.matchScore(title, c) })).filter(
        ({ match: m, score }) => score > 0 || LiveSportHelper.fuzzyTitleMatch(title, m)
      ).sort(
        (a, b) => b.score - a.score || LiveSportHelper.compareLikelyMatches(a.match, b.match, sportType)
      );
      match = scored[0]?.match || null;
    }
    if (!match)
      return null;
    const isLive = match.liveScoreboard.isLive || match.status.toLowerCase().includes("inning") || match.status.toLowerCase().includes("quarter") || match.status.toLowerCase().includes("period") || match.status.toLowerCase().includes("progress") || match.status.toLowerCase().includes("live") || /^\d+:\d+$/.test(match.status) || /ht|halftime|break|intermission/i.test(match.status);
    const shouldFetch = !match.detailsFetched || isLive;
    if (shouldFetch) {
      try {
        console.log(
          `LiveSportHelper: Fetching details for match: ${match.title} (${match.matchId}) (isLive: ${isLive})`
        );
        const matchId = LiveSportHelper.extractEventToken(
          match.matchId,
          match.url,
          match.title
        );
        if (!matchId) {
          match.detailsFetched = true;
          return match;
        }
        const fetchMap = {
          stats: `https://global.flashscore.ninja/2/x/feed/df_st_1_${matchId}`,
          lineups: `https://global.flashscore.ninja/2/x/feed/df_li_1_${matchId}`,
          h2h: `https://global.flashscore.ninja/2/x/feed/df_hh_1_${matchId}`,
          summary: `https://global.flashscore.ninja/2/x/feed/df_sur_1_${matchId}`,
          commentary: `https://global.flashscore.ninja/2/x/feed/df_lc_1_${matchId}`
        };
        const headers = {
          "User-Agent": USER_AGENT,
          Referer: "https://www.flashscore.com/",
          Origin: "https://www.flashscore.com",
          "x-fsign": LiveSportHelper.dynamicFsign,
          Accept: "text/plain,*/*;q=0.8"
        };
        const [stRes, surRes, liRes, hhRes, lcRes] = await Promise.allSettled([
          client.get(fetchMap.stats, { headers, timeout: 7e3 }),
          client.get(fetchMap.summary, { headers, timeout: 7e3 }),
          client.get(fetchMap.lineups, { headers, timeout: 7e3 }),
          client.get(fetchMap.h2h, { headers, timeout: 7e3 }),
          client.get(fetchMap.commentary, { headers, timeout: 7e3 })
        ]);
        if (hhRes.status === "fulfilled" && hhRes.value.data && String(hhRes.value.data).trim() !== "0") {
          try {
            match.h2hHistory = LiveSportHelper.parseFeedH2H(
              String(hhRes.value.data),
              match.homeTeam,
              match.awayTeam
            );
          } catch (e) {
            console.error(
              `LiveSportHelper: Failed to parse H2H for ${match.matchId}:`,
              e
            );
          }
        }
        let detailedReversed = false;
        if (surRes.status === "fulfilled" && surRes.value.data && String(surRes.value.data).trim() !== "0") {
          try {
            const feedText = String(surRes.value.data);
            const mergedFields = {};
            for (const record of LiveSportHelper.splitFeedRecords(feedText)) {
              const fields = LiveSportHelper.feedFields(record);
              Object.assign(mergedFields, fields);
            }
            const detailedHome = mergedFields.AE || mergedFields.CX || "";
            if (detailedHome) {
              const normDetailedHome = LiveSportHelper.normalizeTitle(detailedHome);
              const normAwayTeam = LiveSportHelper.normalizeTitle(match.awayTeam);
              if (normDetailedHome.includes(normAwayTeam) || normAwayTeam.includes(normDetailedHome)) {
                detailedReversed = true;
              }
            }
          } catch (e) {
          }
        }
        if (!detailedReversed && hhRes.status === "fulfilled" && hhRes.value.data && String(hhRes.value.data).trim() !== "0") {
          try {
            const hhRecords = LiveSportHelper.splitFeedRecords(String(hhRes.value.data));
            for (const rec of hhRecords) {
              const fields = LiveSportHelper.feedFields(rec);
              if (fields.KB && fields.KB.toLowerCase().includes("last matches:")) {
                const firstTeamName = fields.KB.replace(/last matches:\s*/i, "").trim();
                const normFirstTeam = LiveSportHelper.normalizeTitle(firstTeamName);
                const normAwayTeam = LiveSportHelper.normalizeTitle(match.awayTeam);
                if (normFirstTeam.includes(normAwayTeam) || normAwayTeam.includes(normFirstTeam)) {
                  detailedReversed = true;
                }
                break;
              }
            }
          } catch (e) {
          }
        }
        match.detailedReversed = detailedReversed;
        const isReversed = match.detailedReversed;
        if (stRes.status === "fulfilled" && stRes.value.data && String(stRes.value.data).trim() !== "0") {
          try {
            const stats = LiveSportHelper.parseFeedBoxStats(String(stRes.value.data));
            match.boxStats = isReversed ? { home: stats.away, away: stats.home } : stats;
          } catch (e) {
            console.error(
              `LiveSportHelper: Failed to parse box stats for ${match.matchId}:`,
              e
            );
          }
        }
        if (surRes.status === "fulfilled" && surRes.value.data && String(surRes.value.data).trim() !== "0") {
          try {
            const feedText = String(surRes.value.data);
            const mergedFields = {};
            for (const record of LiveSportHelper.splitFeedRecords(feedText)) {
              const fields = LiveSportHelper.feedFields(record);
              Object.assign(mergedFields, fields);
            }
            let matrix = LiveSportHelper.feedMatrix(mergedFields, match.sport);
            const hasScoreInSummary = mergedFields.AG !== void 0 || mergedFields.AH !== void 0 || matrix.runsByInning && matrix.runsByInning.length > 0;
            if (hasScoreInSummary) {
              let homeTotal = mergedFields.AG !== void 0 ? LiveSportHelper.num(mergedFields.AG) : matrix.home.T ?? match.liveScoreboard.homeTotal;
              let awayTotal = mergedFields.AH !== void 0 ? LiveSportHelper.num(mergedFields.AH) : matrix.away.T ?? match.liveScoreboard.awayTotal;
              if (isReversed) {
                const tempHome = matrix.home;
                matrix = {
                  home: matrix.away,
                  away: tempHome,
                  runsByInning: matrix.runsByInning?.map((r) => ({
                    inning: r.inning,
                    home: r.away,
                    away: r.home
                  }))
                };
                const tmp = homeTotal;
                homeTotal = awayTotal;
                awayTotal = tmp;
              }
              match.liveScoreboard.matrix = matrix;
              match.scores.matrix = matrix;
              match.liveScoreboard.homeTotal = homeTotal;
              match.liveScoreboard.awayTotal = awayTotal;
              match.scores.homeTotal = homeTotal;
              match.scores.awayTotal = awayTotal;
            }
            const newStatus = LiveSportHelper.feedStatus(mergedFields, match.sport);
            if (newStatus && newStatus !== "Scheduled" && newStatus !== "Upcoming") {
              const carriedStatus = match.sport === "soccer" ? LiveSportHelper.carrySoccerClock(
                match.matchId,
                newStatus,
                match.liveScoreboard.isLive
              ) : newStatus;
              match.status = carriedStatus;
              match.liveScoreboard.status = carriedStatus;
            }
            match.liveStats = LiveSportHelper.parseFeedLiveStats(feedText);
          } catch (e) {
            console.error(
              `LiveSportHelper: Failed to parse summary/score details for ${match.matchId}:`,
              e
            );
          }
        }
        if (match.sport === "soccer" && lcRes.status === "fulfilled" && lcRes.value.data && String(lcRes.value.data).trim() !== "0") {
          try {
            const commentaryClock = LiveSportHelper.latestSoccerClockFromCommentary(
              String(lcRes.value.data)
            );
            if (commentaryClock) {
              match.status = LiveSportHelper.carrySoccerClock(
                match.matchId,
                commentaryClock,
                true
              );
              match.liveScoreboard.status = match.status;
              match.liveScoreboard.isLive = true;
            }
          } catch (e) {
            console.error(
              `LiveSportHelper: Failed to parse live commentary clock for ${match.matchId}:`,
              e
            );
          }
        }
        if (liRes.status === "fulfilled" && liRes.value.data && String(liRes.value.data).trim() !== "0") {
          try {
            let lineups = LiveSportHelper.parseFeedLineups(String(liRes.value.data));
            if (isReversed) {
              const tempHome = lineups.home;
              const tempHomeStarters = lineups.homeStarters || lineups.startingHome;
              const tempHomeSubstitutes = lineups.homeSubstitutes || lineups.substitutesHome;
              const tempFormation = lineups.homeFormation;
              lineups = {
                ...lineups,
                home: lineups.away,
                away: tempHome,
                homeStarters: lineups.awayStarters || lineups.startingAway,
                awayStarters: tempHomeStarters,
                startingHome: lineups.startingAway || lineups.awayStarters,
                startingAway: tempHomeStarters,
                homeSubstitutes: lineups.awaySubstitutes || lineups.substitutesAway,
                awaySubstitutes: tempHomeSubstitutes,
                substitutesHome: lineups.substitutesAway || lineups.awaySubstitutes,
                substitutesAway: tempHomeSubstitutes,
                homeFormation: lineups.awayFormation,
                awayFormation: tempFormation
              };
            }
            match.lineups = lineups;
          } catch (e) {
            console.error(
              `LiveSportHelper: Failed to parse lineups for ${match.matchId}:`,
              e
            );
          }
        }
        match.lineups.startingHome = match.lineups.startingHome || match.lineups.homeStarters || [];
        match.lineups.startingAway = match.lineups.startingAway || match.lineups.awayStarters || [];
        match.lineups.homeStarters = match.lineups.homeStarters || match.lineups.startingHome || [];
        match.lineups.awayStarters = match.lineups.awayStarters || match.lineups.startingAway || [];
        match.lineups.substitutesHome = match.lineups.substitutesHome || match.lineups.homeSubstitutes || [];
        match.lineups.substitutesAway = match.lineups.substitutesAway || match.lineups.awaySubstitutes || [];
        match.lineups.homeSubstitutes = match.lineups.homeSubstitutes || match.lineups.substitutesHome || [];
        match.lineups.awaySubstitutes = match.lineups.awaySubstitutes || match.lineups.substitutesAway || [];
        match.h2hHistory.directHeadToHead = match.h2hHistory.directHeadToHead || [];
        if (!LiveSportHelper.cache.teamLogoMap || !LiveSportHelper.cache.matches.length) {
          const map = {};
          for (const c of LiveSportHelper.cache.matches) {
            const hKey = LiveSportHelper.normalizeTitle(c.homeTeam);
            const aKey = LiveSportHelper.normalizeTitle(c.awayTeam);
            if (c.homeLogo && !map[hKey])
              map[hKey] = c.homeLogo;
            if (c.awayLogo && !map[aKey])
              map[aKey] = c.awayLogo;
          }
          LiveSportHelper.cache.teamLogoMap = map;
        }
        for (const list of [
          match.h2hHistory.homeLastGames,
          match.h2hHistory.awayLastGames
        ]) {
          for (const game of list) {
            if (game.opponent && !game.opponentLogo) {
              const normOpp = LiveSportHelper.normalizeTitle(game.opponent);
              game.opponentLogo = LiveSportHelper.cache.teamLogoMap[normOpp] || "";
            }
          }
        }
        match.liveStats = match.liveStats || { eventsTimeline: [] };
        const hasUsefulScoreboard = Boolean(match.liveScoreboard?.homeTotal || match.liveScoreboard?.awayTotal) || Boolean(
          match.liveScoreboard?.matrix?.runsByInning && match.liveScoreboard.matrix.runsByInning.length > 0
        ) || Boolean(
          match.liveScoreboard?.matrix?.home && Object.keys(match.liveScoreboard.matrix.home).length > 0
        ) || Boolean(
          match.liveScoreboard?.matrix?.away && Object.keys(match.liveScoreboard.matrix.away).length > 0
        );
        const hasUsefulLineups = Boolean((match.lineups?.home || []).length) || Boolean((match.lineups?.away || []).length) || Boolean((match.lineups?.batters || []).length) || Boolean((match.lineups?.pitchers || []).length);
        const hasUsefulDetails = hasUsefulScoreboard || hasUsefulLineups || Boolean((match.h2hHistory?.directHeadToHead || []).length);
        match.detailsFetched = !isLive || hasUsefulDetails;
      } catch (err) {
        console.error(
          `LiveSportHelper: Failed to crawl details for match ${match.matchId}:`,
          err
        );
      }
    }
    if (match && match.lineups) {
      const homeStarters = match.lineups.startingHome || match.lineups.homeStarters || [];
      const awayStarters = match.lineups.startingAway || match.lineups.awayStarters || [];
      match.lineups.startingHome = homeStarters;
      match.lineups.homeStarters = homeStarters;
      match.lineups.startingAway = awayStarters;
      match.lineups.awayStarters = awayStarters;
    }
    return match;
  }
  static async getAllLiveStats(client, forceRefresh = false) {
    const now = Date.now();
    const hasLiveMatches = LiveSportHelper.cache.matches.some(
      (m) => m.liveScoreboard.isLive || /inning|quarter|period|progress|live|ht|halftime|break|intermission/i.test(
        m.status
      ) || /^\d+:\d+$/.test(m.status)
    );
    const ttl = hasLiveMatches ? CACHE_TTL_LIVE_MS : CACHE_TTL_IDLE_MS;
    if (!forceRefresh && now - LiveSportHelper.cache.cachedAt < ttl && LiveSportHelper.cache.matches.length > 0) {
      return LiveSportHelper.cache.matches;
    }
    const seedMap = /* @__PURE__ */ new Map();
    const matches = [];
    LiveSportHelper.cacheMap.clear();
    try {
      const fsign = await LiveSportHelper.refreshFsign(client);
      const sportFeeds = [
        { sport: "soccer", url: `${BASE}x/feed/f_1_0_2_en_1`, referer: `${BASE}` },
        {
          sport: "baseball",
          url: `${BASE}x/feed/f_6_0_2_en_1`,
          referer: `${BASE}baseball/`
        },
        {
          sport: "basketball",
          url: `${BASE}x/feed/f_3_0_2_en_1`,
          referer: `${BASE}basketball/`
        },
        { sport: "hockey", url: `${BASE}x/feed/f_4_0_2_en_1`, referer: `${BASE}hockey/` },
        {
          sport: "cfl",
          url: `${BASE}x/feed/f_5_0_2_en_1`,
          referer: `${BASE}football/canada/cfl/`
        },
        {
          sport: "american-football",
          url: `${BASE}x/feed/f_12_0_2_en_1`,
          referer: `${BASE}american-football/`
        }
      ];
      for (const feed of sportFeeds) {
        try {
          const response = await client.get(feed.url, {
            headers: {
              "User-Agent": USER_AGENT,
              Accept: "text/plain,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
              Referer: feed.referer,
              "x-fsign": fsign
            },
            timeout: 1e4
          });
          const feedMatches = LiveSportHelper.parseFeed(
            String(response.data || ""),
            feed.sport
          );
          for (const seed of feedMatches) {
            const key = seed.matchId || `${seed.sport}:${seed.homeTeam}:${seed.awayTeam}`.toLowerCase();
            if (!seedMap.has(key)) {
              seedMap.set(key, seed);
            }
          }
        } catch (error) {
          console.error(`LiveSport feed failed for ${feed.sport}:`, error);
        }
      }
      if (!seedMap.size) {
        try {
          const homepage = await client.get(BASE, {
            headers: { "User-Agent": USER_AGENT, Referer: BASE },
            timeout: 1e4
          });
          const disc = LiveSportHelper.discoverMatches(String(homepage.data || ""));
          for (const seed of disc) {
            const key = seed.matchId || `${seed.sport}:${seed.homeTeam}:${seed.awayTeam}`.toLowerCase();
            if (!seedMap.has(key)) {
              seedMap.set(key, seed);
            }
          }
        } catch (err) {
          console.error("LiveSport homepage discovery fallback failed:", err);
        }
      }
      const oldMatchesMap = /* @__PURE__ */ new Map();
      if (LiveSportHelper.cache && Array.isArray(LiveSportHelper.cache.matches)) {
        for (const m of LiveSportHelper.cache.matches) {
          if (m && m.matchId) {
            oldMatchesMap.set(m.matchId, m);
          }
        }
      }
      for (const seed of seedMap.values()) {
        let matchObj = LiveSportHelper.fromSeed(seed);
        const oldMatch = oldMatchesMap.get(seed.matchId);
        if (oldMatch) {
          matchObj = {
            ...matchObj,
            detailsFetched: oldMatch.detailsFetched || matchObj.detailsFetched,
            detailedReversed: oldMatch.detailedReversed || matchObj.detailedReversed,
            lineups: oldMatch.lineups || matchObj.lineups,
            boxStats: oldMatch.boxStats || matchObj.boxStats,
            h2hHistory: oldMatch.h2hHistory || matchObj.h2hHistory,
            liveStats: oldMatch.liveStats || matchObj.liveStats,
            teamForm: oldMatch.teamForm || matchObj.teamForm,
            homeLogo: seed.homeLogo || oldMatch.homeLogo || "",
            awayLogo: seed.awayLogo || oldMatch.awayLogo || ""
          };
          if (oldMatch.liveScoreboard) {
            if (oldMatch.liveScoreboard.matrix && Object.keys(oldMatch.liveScoreboard.matrix.home || {}).length > 0) {
              if (!matchObj.liveScoreboard.matrix || Object.keys(matchObj.liveScoreboard.matrix.home || {}).length === 0) {
                matchObj.liveScoreboard.matrix = oldMatch.liveScoreboard.matrix;
              }
            }
            if (oldMatch.detailsFetched && /^(finished|completed|ended)$/i.test(
              String(oldMatch.liveScoreboard.status || "")
            )) {
              matchObj.liveScoreboard.status = oldMatch.liveScoreboard.status;
              matchObj.liveScoreboard.isLive = false;
              matchObj.status = oldMatch.liveScoreboard.status;
            }
          }
        }
        matches.push(matchObj);
        const cacheKeys = LiveSportHelper.makeCacheKeys(seed.homeTeam, seed.awayTeam);
        for (const k of cacheKeys) {
          if (!LiveSportHelper.cacheMap.has(k)) {
            LiveSportHelper.cacheMap.set(k, []);
          }
          LiveSportHelper.cacheMap.get(k).push(matchObj);
        }
      }
      const nowMs = Date.now();
      const existingMatchIds = new Set(
        Array.from(seedMap.values()).map((s) => s.matchId).filter(Boolean)
      );
      if (LiveSportHelper.cache && Array.isArray(LiveSportHelper.cache.matches)) {
        for (const oldMatch of LiveSportHelper.cache.matches) {
          if (oldMatch && oldMatch.matchId && !existingMatchIds.has(oldMatch.matchId)) {
            const ageMs = nowMs - (LiveSportHelper.cache.cachedAt || nowMs);
            if (oldMatch.detailsFetched && ageMs < 6 * 3600 * 1e3) {
              matches.push(oldMatch);
              const cacheKeys = LiveSportHelper.makeCacheKeys(
                oldMatch.homeTeam,
                oldMatch.awayTeam
              );
              for (const k of cacheKeys) {
                if (!LiveSportHelper.cacheMap.has(k)) {
                  LiveSportHelper.cacheMap.set(k, []);
                }
                LiveSportHelper.cacheMap.get(k).push(oldMatch);
              }
            }
          }
        }
      }
      LiveSportHelper.cache = { matches, cachedAt: Date.now() };
    } catch (error) {
      console.error("LiveSport global crawl failed:", error);
      if (!LiveSportHelper.cache.matches.length) {
        LiveSportHelper.cache = { matches: [], cachedAt: Date.now() };
      }
    }
    return LiveSportHelper.cache.matches;
  }
  static async getGlobalDirectory(client) {
    const matches = await LiveSportHelper.getAllLiveStats(client);
    return { matches, cachedAt: LiveSportHelper.cache.cachedAt };
  }
  static async getLiveStats(client, title, sportType) {
    const normalizedSport = String(sportType || "").toLowerCase().trim();
    const isSoccer = LiveSportHelper.isSoccer(title, normalizedSport);
    if (!isSoccer && !/baseball|mlb|basketball|nba|hockey|nhl|american-football|nfl|cfl/.test(
      normalizedSport
    ))
      return null;
    try {
      const titleVariants = Array.from(
        new Set(
          [
            title,
            LiveSportHelper.normalizeTitle(title),
            LiveSportHelper.normalizeName(title),
            title.replace(/\s+/g, " ").replace(/\bvs\.?\b/i, " vs ").trim(),
            title.replace(/\s+/g, " ").replace(/\s-\s/g, " vs ").trim()
          ].filter(Boolean)
        )
      );
      let match = null;
      for (const variant of titleVariants) {
        match = await LiveSportHelper.findOrCrawlMatch(client, variant, normalizedSport) || LiveSportHelper.findBestLiveMatch(variant, normalizedSport);
        if (match)
          break;
      }
      if (!match)
        return LiveSportHelper.emptyPayload("Upcoming");
      const parts = title.split(/\b(?:vs|v|-)\b/i).map((p) => p.trim().toLowerCase());
      let reversed = false;
      if (parts.length >= 2) {
        const streamHome = parts[0];
        const flashscoreAway = match.awayTeam.toLowerCase();
        const streamHomeMlb = LiveSportHelper.normalizeMlbName(streamHome);
        const flashscoreAwayMlb = LiveSportHelper.normalizeMlbName(match.awayTeam);
        const tokens = streamHomeMlb.split(/\s+/).filter((w) => w.length > 2 && !["the", "club", "team"].includes(w));
        if (tokens.length && tokens.every((t) => flashscoreAwayMlb.includes(t))) {
          reversed = true;
        } else if (flashscoreAway.includes(streamHome) || flashscoreAwayMlb.includes(streamHomeMlb)) {
          reversed = true;
        }
      }
      const liveScoreboard = { ...match.liveScoreboard };
      const boxStats = { ...match.boxStats };
      const lineups = { ...match.lineups };
      const h2hHistory = { ...match.h2hHistory };
      let homeLogo = match.homeLogo;
      let awayLogo = match.awayLogo;
      if (reversed) {
        const tempHomeTotal = liveScoreboard.homeTotal;
        liveScoreboard.homeTotal = liveScoreboard.awayTotal;
        liveScoreboard.awayTotal = tempHomeTotal;
        const tempMatrixHome = liveScoreboard.matrix.home;
        liveScoreboard.matrix = {
          home: liveScoreboard.matrix.away,
          away: tempMatrixHome,
          runsByInning: liveScoreboard.matrix.runsByInning?.map((r) => ({
            inning: r.inning,
            home: r.away,
            away: r.home
          }))
        };
        boxStats.home = match.boxStats.away;
        boxStats.away = match.boxStats.home;
        lineups.home = match.lineups.away;
        lineups.away = match.lineups.home;
        lineups.homeStarters = match.lineups.awayStarters;
        lineups.awayStarters = match.lineups.homeStarters;
        lineups.homeSubstitutes = match.lineups.awaySubstitutes;
        lineups.awaySubstitutes = match.lineups.homeSubstitutes;
        lineups.starters = [
          ...lineups.homeStarters || [],
          ...lineups.awayStarters || []
        ];
        lineups.substitutes = [
          ...lineups.homeSubstitutes || [],
          ...lineups.awaySubstitutes || []
        ];
        lineups.batters = [...lineups.home || [], ...lineups.away || []].filter(
          (p) => p.role !== "coach"
        );
        h2hHistory.homeLastGames = match.h2hHistory.awayLastGames;
        h2hHistory.awayLastGames = match.h2hHistory.homeLastGames;
        homeLogo = match.awayLogo;
        awayLogo = match.homeLogo;
      }
      const matchedTeams = reversed ? { home: match.awayTeam, away: match.homeTeam } : { home: match.homeTeam, away: match.awayTeam };
      return {
        liveScoreboard,
        boxStats,
        lineups,
        h2hHistory,
        homeLogo,
        awayLogo,
        teams: matchedTeams
      };
    } catch (error) {
      console.error("LiveSport match lookup failed:", error);
      return LiveSportHelper.emptyPayload("Unavailable");
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LiveSportHelper
});
