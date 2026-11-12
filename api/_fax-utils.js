// 日本時間の日付(YYYY-MM-DD)
export function jstDate(date = new Date()) {
  return new Date(date.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ひらがな/カタカナ・大文字小文字・空白の違いを無視して検索するため
export function normalizeText(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/[\s\u3000]+/g, "");
}

// 1通のFAXの送信元: Claudeが読んだ送信元 → 無ければ各処方箋の医療機関で一番多いもの
export function pickSender(explicitSender, groups) {
  if (explicitSender && String(explicitSender).trim()) return String(explicitSender).trim();
  const counts = {};
  for (const g of groups) {
    const inst = g.extracted?.issuing_institution;
    if (inst) counts[inst] = (counts[inst] || 0) + 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}
