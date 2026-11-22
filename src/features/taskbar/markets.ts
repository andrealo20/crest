/*
 * The bar's Exchange rate and Crypto widgets, the rules apart from their drawing (window/MarketFaces.tsx): a rate's figures. Pure, so
 * node tests it.
 */

/** One unit's rate in the language's figures, to five significant digits: 1.1835, 191.23 and 28,762 take about the same room. */
export const rateText = (rate: number, locale: string): string => new Intl.NumberFormat(locale, { minimumSignificantDigits: 5, maximumSignificantDigits: 5 }).format(rate);

