import { CLUB_PROFILE } from "./club-profile.js";

const VOTE_PATTERN = /\b(vote|voting)\b/i;
const AWARDS_PATTERN = /\bawards?\b/i;
const WARM_UP_PATTERN = /\bwarm[-\s]?up\b/i;
const PRESIDENTIAL_OPENING_PATTERN = /\bpresidential\s+opening\b/i;
const TODAYS_PROGRAM_PATTERN = /\btoday'?s\s+program\b/i;

function text(value) {
  return String(value ?? "").trim();
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

function itemSlide({ block, item }, { awardState = null, awardPageUrl = "" } = {}) {
  if (isVoteItem(item)) return { key: `item:${text(item.key) || `${text(block.title)}:${text(item.session)}:${text(item.role)}`}`, ...voteSlide(item) };
  const type = item.kind === "speech" ? "speech" : isAwardsItem(item) ? "awards" : item.kind === "break" ? "break" : "item";
  return {
    key: `item:${text(item.key) || `${text(block.title)}:${text(item.session)}:${text(item.role)}`}`,
    type,
    blockTitle: text(block.title),
    title: text(item.session) || text(item.role) || "Session",
    role: item.kind === "speech" || type === "break" ? "" : text(item.role),
    member: type === "break" ? "" : person(item.member),
    duration: Number(item.duration) || 0,
    evaluator: item.kind === "speech" ? person(item.evaluator) : "",
    objective: item.kind === "speech" ? text(item.speechObjective) : "",
    externalPresentationUrl: text(item.externalPresentationUrl),
    awardPageUrl: type === "awards" ? awardPageUrl : "",
    awardState: type === "awards" ? (awardState || { ready: Boolean(awardPageUrl), url: awardPageUrl, reason: awardPageUrl ? "" : "Award results have not been confirmed." }) : null,
  };
}

function externalContentSlide(slide) {
  return slide.externalPresentationUrl ? [{
    key: `${slide.key}:external`,
    type: "external-content",
    title: slide.title,
    duration: slide.duration,
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

export function derivePresentationSlides(meeting, { awardState = null, awardPageUrl = "", futurePosters = [] } = {}) {
  const items = allItems(meeting);
  const dynamicSlides = items.flatMap((entry) => {
    const slide = itemSlide(entry, { awardState, awardPageUrl });
    return [slide, ...externalContentSlide(slide)];
  });
  if (!dynamicSlides.some((slide) => slide.type === "vote")) {
    const awardsIndex = dynamicSlides.findIndex((slide) => slide.type === "awards");
    dynamicSlides.splice(awardsIndex === -1 ? dynamicSlides.length : awardsIndex, 0, { key: "voting", ...voteSlide() });
  }
  const posters = futurePosters.filter(Boolean);
  if (posters.length) {
    const voteIndex = dynamicSlides.findIndex((slide) => slide.type === "vote");
    const insertIndex = voteIndex + (dynamicSlides[voteIndex + 1]?.type === "external-content" ? 2 : 1);
    dynamicSlides.splice(insertIndex, 0, { key: "future-posters", type: "future-posters", images: posters.slice(0, 2) });
  }
  return [
    {
      key: "cover",
      type: "cover",
      title: CLUB_PROFILE.wordmark,
      subtitle: `No.${text(meeting.meetingNumber)} Regular Meeting`,
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
}
