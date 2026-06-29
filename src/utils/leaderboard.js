export function crownCount(user) {
  return (user.scores ?? []).filter((s) => s.isCrown).length;
}

// Splits leaderboard lines into <=1024-char chunks for embed fields.
function chunkLines(lines) {
  const chunks = [];
  let current = [];
  for (const line of lines) {
    if ([...current, line].join("\n").length > 1024) {
      chunks.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export function leaderboardFields(lines, heading) {
  return chunkLines(lines).map((chunk, i) => ({
    name: i === 0 ? heading : "​",
    value: chunk.join("\n"),
  }));
}
