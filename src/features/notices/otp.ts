// One-time codes in a notice's text ("Your code is 482913" gives "482913"). Pure.
import type { Notice } from "./history";

/** A notice's text is short; this bounds the work on a very long one. */
const MAX_TEXT = 1200;
/** Characters allowed between the keyword and the digits. */
const REACH = 40;

/** Full-width, Arabic, Persian and Devanagari digits as ASCII, so "١٢٣٤٥٦" reads like "123456". Nothing else changes: the full-width comma of Chinese text must stay a separator. */
function plain(text: string): string {
  return text.replace(/[０-９٠-٩۰-۹०-९]/g, (c) => {
    const k = c.charCodeAt(0);
    return String(k - (k >= 0xff10 ? 0xff10 : k < 0x6f0 ? 0x660 : k < 0x966 ? 0x6f0 : 0x966));
  });
}

// Keywords. Words of scripts that put spaces between words need a boundary on both sides; Chinese, Japanese,
// Korean, Arabic and Hindi are matched inside the text.
const L = "\\p{L}", LN = "\\p{L}\\p{N}";
const bounded = (alts: string) => `(?<![${LN}])(?:${alts})(?![${LN}])`;

// "code" alone is the commonest word; these are the codes that are not one-time codes (postcode, promo code, error code).
const NOT_BEFORE = "zip|post|postal|area|country|dial|promo|promotional|discount|coupon|voucher|gift|referral|invite|source|error|status|exit|response|tracking|product|qr|bar|colou?r|reward|gutschein|rabatt|aktions";
const NOT_AFTER = `(?!\\s+(?:(?:de|d['’]|di|del|do)\\s*)?(?:postal|postale|promo${L}*|descuento|desconto|sconto|réduction|seguimiento|rastreamento|rastreio|suivi|barras?|barre|erro|error|erreur|errore|client${L}*|pedido|commande|ordine|ordem|spedizione|fiscale|review|base|freeze))`;

const WORDS = [
  `(?<!(?:${NOT_BEFORE})[\\s-])(?:code|codice|c[oó]digo|код${L}{0,2})${NOT_AFTER}`,
  `passcode|pass code|one[- ]?time|verif${L}*|vérif${L}*|authenti${L}*|usage\\s+unique|un\\s+s[oó]lo\\s+uso|uso\\s+[uú]nico|monouso|una\\s+tantum`,
  `einmal-?(?:code|passwort|kennwort)|best\u00e4tigungs${L}*|sicherheits-?code|anmelde-?code|login-?code|zugangscode|freigabecode`,
  `одноразов${L}*|подтвержден${L}*|проверочн${L}*|парол${L}*`,
].map(bounded).join("|");
const SCRIPTS = [
  "验证|驗證|校验|校驗|动态码|動態碼|动态密码|動態密碼|一次性|安全码|安全碼|确认码|確認碼|授权码|授權碼|登录码|登入碼|短信码",
  "認証|検証|確認コード|確認番号|暗証番号|ワンタイム|パスコード|(?<!ソース|クーポン|プロモーション|エラー|ステータス|ギフト)コード",
  "인증|확인\\s?코드|보안\\s?코드|일회용|확인번호",
  "رمز|كود|تحقق|لمرة واحدة",
  "कोड|ओटीपी|सत्यापन|वेरिफिकेशन|पासकोड|वन[- ]?टाइम",
].join("|");
const KEYWORDS = new RegExp(`${WORDS}|${SCRIPTS}`, "giu");
// Upper case only: "PIN" and "TAN" are also short words.
const SHORT_KEYWORDS = new RegExp(bounded("OTP|TOTP|PIN|TAN|2FA|MFA"), "gu");

// A number that is not a code: what comes before it (an order, an invoice, a phone, a currency sign, #) and after it (a currency, %).
const FILLER = `(?:[\\s.:-]*(?:no|nr|nº|num${L}*|number|id|n°))?`;
const NOT_BEFORE_NUMBER = new RegExp(
  "(?:" +
    bounded("totals?|amount|users?|rooms?|at|orders?|invoices?|tracking|track|parcel|shipment|package|ref|reference|tickets?|booking|reservation|receipt|account|acct|iban|card|case|tel|phone|call|fax|mobile|cell|ordine|pedido|commande|bestellung|telefon|teléfono|telefono|téléphone|fattura|factura|facture|rechnung|заказ|телефон") +
    "|订单|訂單|电话|電話|注文|주문|전화|رقم" +
    ")" + FILLER + "[\\s.:#№°：-]*$",
  "iu",
);
// A currency written as a word in front of the amount too, as Indian bank messages do ("Rs 5000", "INR 5000").
const SIGN_BEFORE = /[#№$€£¥₹₩₽+]\s?$|[nN]°\s?$|(?<![\p{L}])(?:rs\.?|inr|usd|eur|gbp|aed|sar)\s?$/iu;
const CURRENCY_AFTER = /^\s?(?:[%‰$€£¥₹₩₽°]|(?:usd|eur|gbp|jpy|cny|rmb|rub|inr|brl|chf|cad|aud|krw|mxn)(?![\p{L}])|(?:euros?|dollars?|pounds?|yen|rupees?|reais|dólares|рубл\p{L}*|руб)(?![\p{L}])|元|块|円|원)/iu;

interface Digits {
  digits: string;
  start: number;
  end: number;
}

const SPACE = /^[   ]$/;
const isRun = (s: string) => /^\d+$/.test(s);

/** What could be a code: 4 to 8 digits in a run, or two groups of 3 or of 4 split by a hyphen or a space. Dates, times, decimals, years and longer numbers are not. */
function numbers(text: string): Digits[] {
  const chains = [...text.matchAll(/\d+(?:[-\u2010\u2011\u2013./:,]\d+)*/gu)].map((m) => ({ s: m[0], start: m.index, end: m.index + m[0].length }));
  const out: Digits[] = [];
  for (let i = 0; i < chains.length; i++) {
    const c = chains[i];
    if (isRun(c.s)) {
      // "123 456" or "1234 5678": two runs of the same length one space apart, not part of a longer row of groups.
      const next = chains[i + 1], prev = chains[i - 1], after = chains[i + 2];
      const apart = (a: { end: number }, b: { start: number }) => SPACE.test(text.slice(a.end, b.start));
      if ((c.s.length === 3 || c.s.length === 4) && next && isRun(next.s) && next.s.length === c.s.length && apart(c, next)
        && !(prev && isRun(prev.s) && apart(prev, c)) && !(after && isRun(after.s) && apart(next, after))) {
        out.push({ digits: c.s + next.s, start: c.start, end: next.end });
        i++;
      } else if (c.s.length >= 4 && c.s.length <= 8 && !/^(?:19|20)\d\d$/.test(c.s)
        // A run beside another of 3 or more digits ("7700 900123") is a phone number or the like; "482913 10 min" is not.
        && !(prev && isRun(prev.s) && prev.s.length >= 3 && apart(prev, c)) && !(next && isRun(next.s) && next.s.length >= 3 && apart(c, next))) out.push({ digits: c.s, start: c.start, end: c.end });
      continue;
    }
    const parts = c.s.split(/[-\u2010\u2011\u2013]/);
    if (parts.length === 2 && isRun(parts[0]) && isRun(parts[1]) && parts[0].length === parts[1].length && (parts[0].length === 3 || parts[0].length === 4))
      out.push({ digits: parts[0] + parts[1], start: c.start, end: c.end });
  }
  return out;
}

function plausible(text: string, n: Digits): boolean {
  const before = text.slice(Math.max(0, n.start - 24), n.start), after = text.slice(n.end, n.end + 12);
  return !/[A-Za-z]$/.test(before) && !/^[A-Za-z]/.test(after) && !SIGN_BEFORE.test(before) && !NOT_BEFORE_NUMBER.test(before) && !CURRENCY_AFTER.test(after);
}

/** The one-time code in `text`, digits only, or null. Needs a keyword (code, OTP, verification, 验证码 ...) within 40 characters; with several numbers the one nearest a keyword wins. */
export function findOtp(text: string): string | null {
  const s = plain(text.slice(0, MAX_TEXT));
  const keys = [...s.matchAll(KEYWORDS), ...s.matchAll(SHORT_KEYWORDS)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  if (!keys.length) return null;
  let best: { digits: string; gap: number } | null = null;
  for (const n of numbers(s)) {
    if (!plausible(s, n)) continue;
    const gap = Math.min(...keys.map((k) => (k.end <= n.start ? n.start - k.end : k.start >= n.end ? k.start - n.end : 0)));
    if (gap <= REACH && (!best || gap < best.gap)) best = { digits: n.digits, gap };
  }
  return best?.digits ?? null;
}

/** The code in a notice's title and text. Not in a `crest-notify run` result, whose text Crest wrote itself. */
export function noticeCode(n: Pick<Notice, "title" | "body" | "exitCode">): string | null {
  return n.exitCode === undefined || n.exitCode === null ? findOtp(`${n.title}\n${n.body}`) : null;
}
