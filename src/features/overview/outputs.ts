/** Which icon an output device gets, guessed from its Windows name (which follows the Windows language). Headphones first, so "Headset Earphone" is not a speaker. */
export function outputIcon(name: string): "headphones" | "speaker-hifi" | "speaker" {
  const n = name.toLowerCase();
  if (/headphone|headset|earphone|earbud|buds|airpods|kopfh|casque|écouteur|cuffie|auricular|fones? de ouvido|наушник|гарнитур|ヘッドホン|ヘッドフォン|イヤホン|ヘッドセット|耳机|耳麦|हेडफ|हेडसेट|ईयरफ|سماعة|سماعات/.test(n)) return "headphones";
  if (/speaker|lautsprecher|haut-parleur|altoparlant|altavo|alto-falante|динамик|колонк|スピーカー|扬声器|喇叭|音箱|स्पीकर|مكبر/.test(n)) return "speaker-hifi";
  return "speaker";
}
