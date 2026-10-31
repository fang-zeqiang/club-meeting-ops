import { timerSignalsForItem } from "./presentation-timer-signals.js";
import { presentationPhaseForItem } from "./presentation-phases.js";
import { CLUB_PROFILE } from "./club-profile.js";

const VOTE_PATTERN = /\b(vote|voting)\b/i;
const AWARDS_PATTERN = /\bawards?\b/i;
const SHARING_MASTER_ROLE_TEXT = "sharing master";
const TABLE_TOPICS_PATTERN = /\bttm\b/i;
const WARM_UP_PATTERN = /\bwarm[-\s]?up\b/i;
const PRESIDENTIAL_OPENING_PATTERN = /\bpresidential\s+opening\b/i;
const TODAYS_PROGRAM_PATTERN = /\btoday'?s\s+program\b/i;
const WORD_REMINDER_EXCLUDED_TYPES = new Set([
  "cover", "practice-intro", "club-intro", "grammarian-intro", "external-content",
  "sharing-master-award", "future-posters", "awards", "award-waiting", "award-certificate", "award-finish",
]);

function text(value) {
  return String(value ?? "").trim();
}

export function supportsWordReminder(slide) {
  return Boolean(slide?.type) && !WORD_REMINDER_EXCLUDED_TYPES.has(slide.type);
}

// WOD 常驻区间：Grammarian Intro 之后直到最后一页；只看位置，翻页方向与跳页方式不影响结果
export function isWordReminderVisible(slides, index) {
  const introIndex = slides.findIndex((slide) => slide.type === "grammarian-intro");
  return introIndex !== -1 && index > introIndex;
}

function person(value) {
  return text(value) || "TBD";
}

function allItems(meeting) {
  return (meeting.blocks || []).flatMap((block) =>
    (block.items || []).map((item) => ({ block, item })),
  );
}

export function isVoteItem(item) {
  return VOTE_PATTERN.test(`${text(item.session)} ${text(item.role)}`);
}

export function isAwardsItem(item) {
  return AWARDS_PATTERN.test(`${text(item.session)} ${text(item.role)}`);
}

export function isTableTopicsItem(item) {
  return item.kind !== "speech" && TABLE_TOPICS_PATTERN.test(text(item.role));
}

export function isSharingMasterItem(item) {
  return item.kind === "role" && text(item.role).toLocaleLowerCase() === SHARING_MASTER_ROLE_TEXT;
}

function itemSlide({ block, item }, { transitionSeconds = 0, contest = false } = {}) {
  if (isVoteItem(item)) return { key: `item:${text(item.key) || `${text(block.title)}:${text(item.session)}:${text(item.role)}`}`, ...voteSlide(item), transitionSeconds };
  const type = item.presentationPhase === "grammarian_intro"
    ? "grammarian-intro"
    : item.presentationPhase === "grammarian_report"
      ? "grammarian-report"
      : item.presentationPhase === "timer_report"
        ? "timer-report"
      : item.kind === "speech" ? "speech" : isAwardsItem(item) ? "awards" : isTableTopicsItem(item) ? "tabletopics" : item.kind === "break" ? "break" : "item";
  return {
    key: `item:${text(item.key) || `${text(block.title)}:${text(item.session)}:${text(item.role)}`}`,
    type,
    blockTitle: text(block.title),
    title: text(item.session) || text(item.role) || "Session",
    role: item.kind === "speech" || type === "break" ? "" : text(item.role),
    member: type === "break" ? "" : person(item.member),
    duration: Number(item.duration) || 0,
    timerSignals: timerSignalsForItem(item),
    transitionSeconds,
    evaluator: item.kind === "speech" ? person(item.evaluator) : "",
    hideEvaluator: item.kind === "speech" && contest,
    objective: item.kind === "speech" ? text(item.speechObjective) : "",
    externalPresentationUrl: text(item.externalPresentationUrl),
    isSharingMaster: isSharingMasterItem(item),
    wordOfDay: ["grammarian-intro", "grammarian-report"].includes(type) && text(item.wordOfDay?.word) ? {
      word: text(item.wordOfDay?.word),
      pronunciation: text(item.wordOfDay?.pronunciation),
      partOfSpeech: text(item.wordOfDay?.partOfSpeech),
      definition: text(item.wordOfDay?.definition),
      usage: text(item.wordOfDay?.usage),
      example: text(item.wordOfDay?.example),
    } : null,
  };
}

function externalContentSlide(slide) {
  return slide.externalPresentationUrl ? [{
    key: `${slide.key}:external`,
    type: "external-content",
    title: slide.title,
    duration: slide.duration,
    timerSignals: slide.timerSignals,
    transitionSeconds: slide.transitionSeconds,
    url: slide.externalPresentationUrl,
  }] : [];
}

function voteSlide(item = {}) {
  return {
    type: "vote",
    title: text(item.session) || "Vote & Announcement",
    role: text(item.role) || "Voting Host",
    member: person(item.member),
    duration: Number(item.duration) || 0,
  };
}

function pullFirst(slides, pattern) {
  const index = slides.findIndex((slide) => pattern.test(slide.title));
  if (index === -1) return [];
  return slides.splice(index, slides[index + 1]?.type === "external-content" ? 2 : 1);
}

export function derivePresentationSlides(meeting, { futurePosters = [], tableTopicsTotal = 0, sharingMasterAward = null } = {}) {
  const items = allItems(meeting);
  const contest = meeting.meetingType === "contest";
  const dynamicSlides = items.flatMap((entry) => {
    const slide = itemSlide({ ...entry, item: { ...entry.item, presentationPhase: presentationPhaseForItem(entry.block, entry.item), wordOfDay: meeting.wordOfDay } }, { transitionSeconds: meeting.enableTransitionTime ? 60 : 0, contest });
    const drawSlide = slide.type === "tabletopics" && tableTopicsTotal > 0 ? [{
      key: `${slide.key}:draw`,
      type: "tabletopics-draw",
      duration: slide.duration,
      transitionSeconds: slide.transitionSeconds,
    }] : [];
    const titleSlide = slide.type === "tabletopics" ? { ...slide, duration: 0, transitionSeconds: 0 } : slide;
    return [titleSlide, ...drawSlide, ...externalContentSlide(slide)];
  });
  // 模拟赛名次由 Ballot Counter 汇总后录入，不设公开投票页
  if (!contest && !dynamicSlides.some((slide) => slide.type === "vote")) {
    const awardsIndex = dynamicSlides.findIndex((slide) => slide.type === "awards");
    dynamicSlides.splice(awardsIndex === -1 ? dynamicSlides.length : awardsIndex, 0, { key: "voting", ...voteSlide() });
  }
  if (!dynamicSlides.some((slide) => slide.type === "awards")) {
    const thanksIndex = dynamicSlides.findIndex((slide) => slide.type === "thanks");
    dynamicSlides.splice(thanksIndex === -1 ? dynamicSlides.length : thanksIndex, 0, {
      key: "awards", type: "awards", title: "Awards", role: "Club President", member: "TBD",
    });
  }
  const posters = futurePosters.filter(Boolean);
  if (posters.length) {
    const voteIndex = dynamicSlides.findIndex((slide) => slide.type === "vote");
    const insertIndex = voteIndex + (dynamicSlides[voteIndex + 1]?.type === "external-content" ? 2 : 1);
    dynamicSlides.splice(insertIndex, 0, { key: "future-posters", type: "future-posters", images: posters.slice(0, 2) });
  }
  if (sharingMasterAward?.award) {
    const sharingIndex = dynamicSlides.findIndex((slide) => slide.isSharingMaster);
    if (sharingIndex !== -1) {
      const insertIndex = sharingIndex + (dynamicSlides[sharingIndex + 1]?.type === "external-content" ? 2 : 1);
      dynamicSlides.splice(insertIndex, 0, {
        key: `${dynamicSlides[sharingIndex].key}:sharing-master-award`,
        type: "sharing-master-award",
        winners: sharingMasterAward.award.winners.map((winner) => winner.name),
        clubName: sharingMasterAward.clubName,
        meetingNumber: sharingMasterAward.meetingNumber,
        meetingDate: sharingMasterAward.meetingDate,
        signatory: sharingMasterAward.signatory,
      });
    }
  }
  const slides = [
    {
      key: "cover",
      type: "cover",
      title: CLUB_PROFILE.wordmark,
      subtitle: `No.${text(meeting.meetingNumber)} ${contest ? "Mock Speech Contest" : "Regular Meeting"}`,
      theme: text(meeting.theme),
      date: text(meeting.date),
    },
    ...pullFirst(dynamicSlides, WARM_UP_PATTERN),
    ...pullFirst(dynamicSlides, PRESIDENTIAL_OPENING_PATTERN),
    { key: "practice-intro", type: "practice-intro" },
    { key: "club-intro", type: "club-intro" },
    ...pullFirst(dynamicSlides, TODAYS_PROGRAM_PATTERN),
    {
      key: "program",
      type: "program",
      blocks: (meeting.blocks || []).map((block) => ({
        title: text(block.title),
        items: (block.items || []).map((item) => {
          const kind = text(item.kind);
          return {
            kind,
            session: text(item.session) || text(item.role) || "Session",
            member: kind === "break" ? "" : person(item.member),
          };
        }),
      })),
    },
    ...dynamicSlides,
    { key: "thanks", type: "thanks" },
  ];
  const word = { word: text(meeting.wordOfDay?.word), definition: text(meeting.wordOfDay?.definition) };
  return word.word ? slides.map((slide) => supportsWordReminder(slide) ? { ...slide, wordReminder: word } : slide) : slides;
}

// 抽题池分三档：先只抽从未出现过的新题；新题用完后，被“换掉”的题回到题库（仍在 Speaker 手上的题继续排除）；
// 若话题已全部分给 Speaker（Speaker 多于话题），只排除当前 Speaker 手上那道，允许与其他人重复。
export function tableTopicsDrawPool({ total = 0, drawnKeys = [], heldKeys = [], ownKey = "" } = {}) {
  const drawn = new Set(drawnKeys);
  if (drawn.size < total) return { excludeKeys: [...drawn], available: total - drawn.size, tier: "fresh" };
  const held = new Set(heldKeys);
  if (held.size < total) return { excludeKeys: [...held], available: total - held.size, tier: "recycled" };
  const excludeKeys = ownKey ? [ownKey] : [];
  return { excludeKeys, available: Math.max(0, total - excludeKeys.length), tier: "shared" };
}

// 话题逐字动画会把每个字符包成 inline-block，浏览器因此可在任意字符间换行。
// 这里把英文单词（含 don't 这类缩写）连同前置开括号、后置标点归成一组，CJK 字也带上紧随的标点，避免标点落到行首。
const TOPIC_TOKEN_PATTERN = /[(\[{【《「『“‘]*(?:[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*|[^\s(\[{【《「『“‘)\]}】》」』”’.,!?;:，。！？；：、…A-Za-z0-9])[)\]}】》」』”’.,!?;:，。！？；：、…]*|\s|./gu;

export function topicTokens(text) {
  return String(text ?? "").match(TOPIC_TOKEN_PATTERN) || [];
}

export function findSlideJumpIndex(slides, jump, order) {
  if (!jump) return null;
  if (jump === "tabletopics") return slides.findIndex((slide) => slide.type === "tabletopics-draw");
  if (jump === "awards") return slides.findIndex((slide) => slide.type === "awards");
  if (jump === "ps") {
    const target = Number(order) || 1;
    let seen = 0;
    for (let i = 0; i < slides.length; i += 1) {
      if (slides[i].type === "speech") {
        seen += 1;
        if (seen === target) return i;
      }
    }
    return -1;
  }
  return -1;
}

