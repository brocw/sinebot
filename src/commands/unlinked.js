import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { listUnlinked } from "../data/aggregateStore.js";
import { requireAdmin } from "../utils/permissions.js";
import { GAMES } from "../games/registry.js";

// Discord rejects an embed field value over 1024 characters, and caps a whole
// embed at 6000. A server that has never run /link-user can easily exceed
// both, so the list is packed into fields and then cut — four fields leaves
// comfortable room for the title and the instructions above them.
const FIELD_LIMIT = 1024;
const MAX_FIELDS = 4;

// A display name arrives from an upstream message, so its length is not ours
// to trust; one pathological name must not blow the field it sits in.
const BLOCK_LIMIT = 300;

const label = (id) => GAMES.find((g) => g.id === id)?.label ?? id;

/** "2025-09-05" — a bare date, since only the day a result landed matters. */
const day = (ts) => new Date(ts).toISOString().slice(0, 10);

function describe(entry) {
  const when =
    entry.firstTs === null
      ? "no results"
      : entry.firstTs === entry.lastTs
        ? day(entry.firstTs)
        : `${day(entry.firstTs)} → ${day(entry.lastTs)}`;

  const games = entry.games.map(label).join(", ");
  const crowns = entry.crowns > 0 ? `  👑 ${entry.crowns}` : "";

  const block = [
    `**${entry.displayName}** — ${entry.results} result${entry.results === 1 ? "" : "s"}${crowns}`,
    `\`${entry.nameKey}\`${games ? `  ·  ${games}` : ""}  ·  ${when}`,
  ].join("\n");

  return block.length > BLOCK_LIMIT ? `${block.slice(0, BLOCK_LIMIT - 1)}…` : block;
}

/**
 * Packs descriptions into embed fields, splitting before Discord would and
 * stopping at MAX_FIELDS.
 *
 * @returns {{ fields: object[], shown: number }} how many entries made it in
 */
function fields(entries) {
  const out = [];
  let buffer = [];
  let size = 0;
  let shown = 0;

  for (const entry of entries) {
    const block = describe(entry);

    if (size + block.length + 2 > FIELD_LIMIT && buffer.length) {
      out.push(buffer.join("\n\n"));
      if (out.length === MAX_FIELDS) break;
      buffer = [];
      size = 0;
    }
    buffer.push(block);
    size += block.length + 2;
    shown++;
  }
  if (buffer.length && out.length < MAX_FIELDS) out.push(buffer.join("\n\n"));

  return {
    shown,
    fields: out.map((value, i) => ({
      name: i === 0 ? "Unresolved names" : "​",
      value,
    })),
  };
}

export default {
  data: new SlashCommandBuilder()
    .setName("unlinked")
    .setDescription(
      "List players the upstream bot never resolved to a Discord account",
    ),

  async execute(interaction) {
    if (!(await requireAdmin(interaction))) return;

    const entries = listUnlinked(interaction.guildId);

    if (entries.length === 0) {
      await interaction.reply({
        content:
          "Every player in this server is linked to a Discord account. Nothing to do.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const results = entries.reduce((a, e) => a + e.results, 0);
    const crowns = entries.reduce((a, e) => a + e.crowns, 0);
    const { fields: packed, shown } = fields(entries);

    const embed = new EmbedBuilder()
      .setTitle("🔗 Unlinked players")
      .setDescription(
        [
          `**${entries.length}** name${entries.length === 1 ? "" : "s"} holding **${results}** result${results === 1 ? "" : "s"}` +
            (crowns > 0 ? ` and **${crowns}** crown${crowns === 1 ? "" : "s"}` : ""),
          "",
          "These results sit under the name the upstream bot posted rather than",
          "under anyone's account, so they are missing from that person's stats,",
          "streak and crown count. Claim one with:",
          "```/link-user name:<the name below> user:@them```",
          "Pass the name as it appears in the results post — the role suffix is",
          "optional, since it is stripped either way.",
          shown < entries.length
            ? `\nShowing the ${shown} busiest; **${entries.length - shown}** more not listed.`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .setColor(0xe67e22)
      .addFields(...packed);

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
