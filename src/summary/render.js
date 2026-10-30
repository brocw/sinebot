import {
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";
import { placeLabel } from "../utils/leaderboard.js";

// The daily summary as a Components V2 message: a heading, a gold card for
// each dethroning, one card per game in that game's colour, and a closing card
// of highlights.
//
// A V2 message caps the text across all its components at 4000 characters and
// the components themselves at 40. Game cards are a few hundred characters
// each and there is one card per game, so the highlights are what gives way:
// they are trimmed from the end, least notable first, until the post fits.

const GOLD = 0xf1c40f;
const GREY = 0x99aab5;
export const TEXT_LIMIT = 4000;

const text = (content) => new TextDisplayBuilder().setContent(content);
const divider = () =>
  new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

function dayBody(day) {
  const podium = day.podium.length
    ? day.podium.map((p) => `${placeLabel(p.place)} **${p.result}**  ${p.names.join(", ")}`)
    : ["Nobody solved it."];
  return [...podium, `-# ${day.stats.join(" · ")}`].join("\n");
}

function dayHead(day) {
  return [`### ${day.title}`, ...day.intro].join("\n");
}

function dethroneText(d) {
  return `## 👑 Dethroned!\n${d.text}\n-# ${d.game.emoji} ${d.game.label}`;
}

function highlightsText(lines) {
  return ["### 📣 Highlights", ...lines].join("\n");
}

/** Highlights, cut from the end until the whole post is within the text cap. */
function fitHighlights(fixed, highlights) {
  const kept = [...highlights];
  while (kept.length && fixed + highlightsText(kept).length > TEXT_LIMIT) kept.pop();
  return kept;
}

/**
 * @param {{ heading: string, days: object[], callouts: object }} summary
 * @param {{ avatars?: Map<string, string> }} opts  avatar URLs by Discord ID,
 *   for the dethroning cards; a winner without one gets a plain card
 * @returns {object} message options for `channel.send`
 */
export function renderDailySummary({ heading, days, callouts }, { avatars = new Map() } = {}) {
  const headingText = `## ${heading}`;
  const fixed =
    headingText.length +
    callouts.dethrones.reduce((n, d) => n + dethroneText(d).length, 0) +
    days.reduce((n, d) => n + dayHead(d).length + dayBody(d).length, 0);

  const components = [text(headingText)];

  for (const d of callouts.dethrones) {
    const card = new ContainerBuilder().setAccentColor(GOLD);
    const avatar = avatars.get(d.who[0].playerKey);
    if (avatar) {
      card.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(text(dethroneText(d)))
          .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar)),
      );
    } else {
      card.addTextDisplayComponents(text(dethroneText(d)));
    }
    components.push(card);
  }

  for (const day of days) {
    components.push(
      new ContainerBuilder()
        .setAccentColor(day.game.color ?? GREY)
        .addTextDisplayComponents(text(dayHead(day)))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(text(dayBody(day))),
    );
  }

  const highlights = fitHighlights(fixed, callouts.highlights);
  if (highlights.length) {
    components.push(
      new ContainerBuilder()
        .setAccentColor(GREY)
        .addTextDisplayComponents(text(highlightsText(highlights))),
    );
  }

  return {
    flags: MessageFlags.IsComponentsV2,
    components,
    // Names render as mentions so they stay readable, but nobody is pinged
    // every morning for something they did yesterday.
    allowedMentions: { parse: [] },
  };
}
