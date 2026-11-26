//! Public prices without keys: CoinGecko for crypto (by symbol, the coin with the largest
//! market cap wins when a symbol is shared) and Frankfurter (central bank reference rates, the ECB's among them) for currencies.
//! Cached per symbol for a minute, so asking again as accounts arrive only fetches what is new. The bar's crypto widget asks
//! CoinGecko's markets for one coin's day and week (`coin_day`), and Yahoo Finance's chart for one stock's last 5 days
//! (`stock_day`), cached the same way.

use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::send_json;

const FRESH: Duration = Duration::from_secs(60);
/// Symbols CoinGecko does not know are not asked for again for a while.
const MISS: Duration = Duration::from_secs(15 * 60);

#[derive(Clone, Default, Serialize)]
pub struct Rates {
    pub base: String,
    /// Price of one coin in `base`, by upper-case symbol.
    pub crypto: HashMap<String, f64>,
    /// Units of a currency per one `base` (as the central banks publish them).
    pub fx: HashMap<String, f64>,
    /// The day each rate in `fx` is from ("2026-10-31"): the banks behind them publish on different days.
    pub dates: HashMap<String, String>,
    /// Sources that failed ("coingecko", "frankfurter"); the rest is still returned.
    pub failed: Vec<String>,
}

/// Units per one base by currency, and the day of each rate.
type Fx = (HashMap<String, f64>, HashMap<String, String>);

#[derive(Default)]
pub struct Cache {
    base: String,
    crypto: HashMap<String, (Instant, Option<f64>)>,
    fx: Option<(Instant, Fx)>,
    /// Frankfurter's currency codes, asked for once: its rates also list coins and metals.
    fiat: Option<HashSet<String>>,
    /// The crypto widget's coins by upper-case symbol and range ("BTC:1d"), None for one CoinGecko does not know.
    days: HashMap<String, (Instant, Option<CoinDay>)>,
    /// Its stocks by upper-case symbol and range, None for one Yahoo Finance does not know.
    stocks: HashMap<String, (Instant, Option<StockDay>)>,
}

/// The crypto widget's ranges: a day, a week, a month, a year.
pub const RANGES: [&str; 4] = ["1d", "1w", "1m", "1y"];

/// One coin as the bar's crypto widget shows it over its range: its price in the base currency, its change over the range in
/// percent, its line, oldest first (the week's hours for a day and a week, the month's hours, the year's days), and how many of the
/// line's last points the bar draws (the last 24 hours for a day, all of them otherwise).
#[derive(Clone, Serialize)]
pub struct CoinDay {
    pub price: f64,
    pub change: Option<f64>,
    pub line: Vec<f64>,
    pub day: usize,
}

/// One coin of CoinGecko's /coins/markets, the fields read.
#[derive(Deserialize)]
struct Market {
    id: Option<String>,
    current_price: Option<f64>,
    price_change_percentage_24h: Option<f64>,
    price_change_percentage_7d_in_currency: Option<f64>,
    price_change_percentage_30d_in_currency: Option<f64>,
    price_change_percentage_1y_in_currency: Option<f64>,
    sparkline_in_7d: Option<Spark>,
}

#[derive(Deserialize)]
struct Spark {
    price: Vec<Option<f64>>,
}

/// CoinGecko's /coins/{id}/market_chart, its prices as [ms, price].
#[derive(Deserialize)]
struct CoinChart {
    prices: Vec<(f64, Option<f64>)>,
}

/// The markets address for one coin by its symbol in `base`, the largest by market cap first (CoinGecko's own order), with its
/// week's hourly line and its change over a week, a month and a year. None unless the base is three letters and the symbol 1 to 10
/// letters and digits, so nothing else reaches the query.
fn coin_url(base: &str, symbol: &str) -> Option<String> {
    let base_ok = base.len() == 3 && base.bytes().all(|b| b.is_ascii_alphabetic());
    let symbol_ok = (1..=10).contains(&symbol.len()) && symbol.bytes().all(|b| b.is_ascii_alphanumeric());
    (base_ok && symbol_ok).then(|| {
        format!(
            "https://api.coingecko.com/api/v3/coins/markets?vs_currency={}&symbols={}&sparkline=true&per_page=1&price_change_percentage=7d,30d,1y",
            base.to_lowercase(),
            symbol.to_lowercase()
        )
    })
}

/// A coin's chart over `days` by its CoinGecko id (hourly up to 90 days, then daily), only for an id of lower-case letters, digits
/// and hyphens, as CoinGecko's ids are, and a three-letter base.
fn chart_url(id: &str, base: &str, days: u32) -> Option<String> {
    let id_ok = (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    let base_ok = base.len() == 3 && base.bytes().all(|b| b.is_ascii_alphabetic());
    (id_ok && base_ok).then(|| format!("https://api.coingecko.com/api/v3/coins/{id}/market_chart?vs_currency={}&days={days}", base.to_lowercase()))
}

/// The first coin over `range`, with its id for a month's or a year's chart: a finite price or nothing, its change over the range
/// only when finite, and every finite hour of its week, of which a day draws the last 24 and a week all.
fn day_of(markets: Vec<Market>, range: &str) -> Option<(CoinDay, Option<String>)> {
    let m = markets.into_iter().next()?;
    let price = m.current_price.filter(|p| p.is_finite())?;
    let line: Vec<f64> = m.sparkline_in_7d.map(|s| s.price.into_iter().flatten().filter(|p| p.is_finite()).collect()).unwrap_or_default();
    let change = match range {
        "1w" => m.price_change_percentage_7d_in_currency,
        "1m" => m.price_change_percentage_30d_in_currency,
        "1y" => m.price_change_percentage_1y_in_currency,
        _ => m.price_change_percentage_24h,
    }
    .filter(|c| c.is_finite());
    let day = if range == "1d" { line.len().min(25) } else { line.len() };
    Some((CoinDay { price, change, line, day }, m.id))
}

/// One coin over `range` in `base` (`day_of`; a month or a year then reads its chart too), cached for a minute, and for a while as
/// unknown when CoinGecko has no such coin; a symbol, base or range refused is unknown at once. A failed request is an error, so
/// the widget keeps its last value.
pub async fn coin_day(client: &reqwest::Client, cache: &mut Cache, base: &str, symbol: &str, range: &str) -> Result<Option<CoinDay>, String> {
    let Some(url) = coin_url(base, symbol).filter(|_| RANGES.contains(&range)) else { return Ok(None) };
    let (base, key) = (base.to_uppercase(), format!("{}:{range}", symbol.to_uppercase()));
    if cache.base != base {
        *cache = Cache { base: base.clone(), ..Default::default() };
    }
    if let Some((at, day)) = cache.days.get(&key) {
        if at.elapsed() <= if day.is_some() { FRESH } else { MISS } {
            return Ok(day.clone());
        }
    }
    let day = match day_of(send_json::<Vec<Market>>(client.get(url)).await?, range) {
        Some((mut day, Some(id))) if matches!(range, "1m" | "1y") => {
            if let Some(url) = chart_url(&id, &base, if range == "1m" { 30 } else { 365 }) {
                day.line = send_json::<CoinChart>(client.get(url)).await?.prices.into_iter().filter_map(|(_, p)| p.filter(|p| p.is_finite())).collect();
                day.day = day.line.len();
            }
            Some(day)
        }
        found => found.map(|(day, _)| day),
    };
    cache.days.insert(key, (Instant::now(), day.clone()));
    Ok(day)
}

pub async fn fetch(client: &reqwest::Client, cache: &mut Cache, base: &str, crypto: &[String], fiats: &[String]) -> Result<Rates, String> {
    let base = base.to_uppercase();
    if cache.base != base {
        *cache = Cache { base: base.clone(), ..Default::default() };
    }
    let mut failed = Vec::new();

    let wanted: Vec<String> = crypto.iter().map(|s| s.to_uppercase()).filter(|s| s.chars().all(|c| c.is_ascii_alphanumeric())).collect();
    let stale: Vec<String> = wanted
        .iter()
        .filter(|s| match cache.crypto.get(*s) {
            Some((at, Some(_))) => at.elapsed() > FRESH,
            Some((at, None)) => at.elapsed() > MISS,
            None => true,
        })
        .cloned()
        .collect();
    let vs = base.to_lowercase();
    for chunk in stale.chunks(80) {
        let symbols: Vec<String> = chunk.iter().map(|s| s.to_lowercase()).collect();
        let url = format!("https://api.coingecko.com/api/v3/simple/price?symbols={}&vs_currencies={vs}", symbols.join(","));
        match send_json::<HashMap<String, HashMap<String, f64>>>(client.get(url)).await {
            Ok(map) => {
                let now = Instant::now();
                for s in chunk {
                    let price = map.get(&s.to_lowercase()).and_then(|p| p.get(&vs)).copied();
                    cache.crypto.insert(s.clone(), (now, price));
                }
            }
            Err(_) => failed.push("coingecko".to_string()),
        }
    }

    let needs_fx = fiats.iter().any(|f| !f.eq_ignore_ascii_case(&base));
    if needs_fx && cache.fx.as_ref().is_none_or(|(at, _)| at.elapsed() > FRESH) {
        match fiat_rates(client, &base, &mut cache.fiat).await {
            Ok(fx) => cache.fx = Some((Instant::now(), fx)),
            Err(_) => failed.push("frankfurter".to_string()),
        }
    }

    // On failure the older cached values still answer.
    Ok(Rates {
        crypto: wanted.iter().filter_map(|s| cache.crypto.get(s).and_then(|(_, p)| *p).map(|p| (s.clone(), p))).collect(),
        fx: cache.fx.as_ref().map(|(_, (fx, _))| fx.clone()).unwrap_or_default(),
        dates: cache.fx.as_ref().map(|(_, (_, dates))| dates.clone()).unwrap_or_default(),
        base,
        failed,
    })
}

#[derive(Deserialize)]
struct Currency {
    iso_code: String,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Deserialize)]
struct Row {
    date: String,
    quote: String,
    rate: f64,
}

/// Units of every currency per one `base`, and the day of each. v2 covers about 160 currencies (v1 only the ECB's 30,
/// without the dong: issue #25).
async fn fiat_rates(client: &reqwest::Client, base: &str, fiat: &mut Option<HashSet<String>>) -> Result<Fx, String> {
    if fiat.is_none() {
        let list = send_json::<Vec<Currency>>(client.get("https://api.frankfurter.dev/v2/currencies")).await?;
        *fiat = Some(list.into_iter().filter(|c| c.kind == "currency").map(|c| c.iso_code).collect());
    }
    let rows = send_json::<Vec<Row>>(client.get(format!("https://api.frankfurter.dev/v2/rates?base={base}"))).await?;
    Ok(keep_fiat(rows, fiat.as_ref().unwrap()))
}

/// Coins and metals out (coins come from CoinGecko), and rates that could not convert anything.
fn keep_fiat(rows: Vec<Row>, fiat: &HashSet<String>) -> Fx {
    let rows: Vec<Row> = rows.into_iter().filter(|r| fiat.contains(&r.quote) && r.rate > 0.0).collect();
    let dates = rows.iter().map(|r| (r.quote.clone(), r.date.clone())).collect();
    (rows.into_iter().map(|r| (r.quote, r.rate)).collect(), dates)
}

/// A stock, fund or index as the bar's crypto widget shows it over its range: its price in its own currency (London's pence,
/// Johannesburg's cents and Tel Aviv's agorot in the main unit), its change over the range in percent (a day's since the last
/// close), its line, oldest first (5 days in quarter hours for a day and a week, a month in hours, a year in days), how many of the
/// line's last points the bar draws (a day its last trading session, the others all), and its short name.
#[derive(Clone, Serialize)]
pub struct StockDay {
    pub price: f64,
    pub currency: String,
    pub change: Option<f64>,
    pub line: Vec<f64>,
    pub day: usize,
    pub name: Option<String>,
}

/// Yahoo Finance's /v8/finance/chart, the fields read.
#[derive(Deserialize)]
struct Chart {
    chart: ChartBody,
}

#[derive(Deserialize)]
struct ChartBody {
    result: Option<Vec<ChartResult>>,
}

#[derive(Deserialize)]
struct ChartResult {
    meta: ChartMeta,
    #[serde(default)]
    timestamp: Vec<i64>,
    indicators: Indicators,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChartMeta {
    currency: Option<String>,
    regular_market_price: Option<f64>,
    regular_market_change_percent: Option<f64>,
    previous_close: Option<f64>,
    /// The close before the chart's first point, what a week's, a month's or a year's change is against.
    chart_previous_close: Option<f64>,
    short_name: Option<String>,
    /// A list of days, each a list of periods, or for a single day an object of pre, regular and post periods: read loosely.
    #[serde(default)]
    trading_periods: serde_json::Value,
}

#[derive(Deserialize)]
struct Indicators {
    #[serde(default)]
    quote: Vec<Quote>,
}

#[derive(Deserialize)]
struct Quote {
    #[serde(default)]
    close: Vec<Option<f64>>,
}

/// Yahoo's span and step for each of the widget's ranges: a day and a week from 5 days in quarter hours, a month in hours, a
/// year in days.
fn stock_span(range: &str) -> Option<(&'static str, &'static str)> {
    match range {
        "1d" | "1w" => Some(("5d", "15m")),
        "1m" => Some(("1mo", "1h")),
        "1y" => Some(("1y", "1d")),
        _ => None,
    }
}

/// The chart of one symbol over its range (stock_span). None unless the symbol is 1 to 15 of the letters, digits and marks
/// Yahoo's symbols use ("AAPL", "VWCE.DE", "BRK-B", "^GSPC", "EURUSD=X") with a letter or digit among them, so nothing else
/// reaches the address; ^ and = go escaped.
fn stock_url(symbol: &str, range: &str) -> Option<String> {
    let (span, step) = stock_span(range)?;
    let ok = (1..=15).contains(&symbol.len())
        && symbol.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-^=".contains(&b))
        && symbol.bytes().any(|b| b.is_ascii_alphanumeric());
    ok.then(|| {
        format!(
            "https://query1.finance.yahoo.com/v8/finance/chart/{}?range={span}&interval={step}",
            symbol.to_uppercase().replace('^', "%5E").replace('=', "%3D")
        )
    })
}

/// When each trading session in the chart starts: the regular hours of each day, however the chart lists them.
fn session_starts(periods: &serde_json::Value) -> Vec<i64> {
    let days = periods.get("regular").unwrap_or(periods);
    let list = days.as_array().map(Vec::as_slice).unwrap_or_default();
    list.iter().flat_map(|day| day.as_array().map_or_else(|| vec![day], |p| p.iter().collect())).filter_map(|p| p.get("start")?.as_i64()).collect()
}

/// The chart over `range`: a finite price or nothing, every finite step of the line, a day's change as Yahoo gives it or else from
/// the last close and the points from the start of its last session with a price in it, or a longer range's change from the close
/// before the chart and all its points.
fn stock_of(chart: Chart, range: &str) -> Option<StockDay> {
    let r = chart.chart.result?.into_iter().next()?;
    let m = r.meta;
    let mut price = m.regular_market_price.filter(|p| p.is_finite())?;
    let (currency, minor) = match m.currency.as_deref()? {
        "GBp" => ("GBP".to_owned(), true),
        "ZAc" => ("ZAR".to_owned(), true),
        "ILA" => ("ILS".to_owned(), true),
        c => (c.to_uppercase(), false),
    };
    let closes = r.indicators.quote.into_iter().next().map(|q| q.close).unwrap_or_default();
    let points: Vec<(i64, f64)> = r.timestamp.iter().zip(closes).filter_map(|(t, c)| c.filter(|c| c.is_finite()).map(|c| (*t, c))).collect();
    let since = |close: Option<f64>| close.filter(|c| c.is_finite() && *c > 0.0).map(|c| (price / c - 1.0) * 100.0);
    let (change, day) = if range == "1d" {
        let start = points.last().and_then(|&(last, _)| session_starts(&m.trading_periods).into_iter().filter(|s| *s <= last).max());
        let day = start.map_or(points.len(), |s| points.iter().filter(|p| p.0 >= s).count());
        (m.regular_market_change_percent.filter(|c| c.is_finite()).or_else(|| since(m.previous_close)), day)
    } else {
        (since(m.chart_previous_close).or_else(|| since(points.first().map(|p| p.1))), points.len())
    };
    let mut line: Vec<f64> = points.into_iter().map(|p| p.1).collect();
    if minor {
        price /= 100.0;
        line.iter_mut().for_each(|v| *v /= 100.0);
    }
    Some(StockDay { price, currency, change, line, day, name: m.short_name })
}

/// One symbol over `range` (`stock_of`), cached for a minute, and for a while as unknown when Yahoo Finance has no such symbol (its
/// 404); a symbol or range `stock_url` refuses is unknown at once. A failed request is an error, so the widget keeps its last value.
pub async fn stock_day(client: &reqwest::Client, cache: &mut Cache, symbol: &str, range: &str) -> Result<Option<StockDay>, String> {
    let Some(url) = stock_url(symbol, range) else { return Ok(None) };
    let key = format!("{}:{range}", symbol.to_uppercase());
    if let Some((at, day)) = cache.stocks.get(&key) {
        if at.elapsed() <= if day.is_some() { FRESH } else { MISS } {
            return Ok(day.clone());
        }
    }
    let res = client.get(url).send().await.map_err(super::net)?;
    let day = match res.status().as_u16() {
        200..=299 => stock_of(res.json::<Chart>().await.map_err(|e| format!("network:unreadable response ({})", e.without_url()))?, range),
        404 => None,
        429 => return Err("rate".into()),
        code => return Err(format!("network:HTTP {code}")),
    };
    cache.stocks.insert(key, (Instant::now(), day.clone()));
    Ok(day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_currencies_with_a_rate_and_their_day() {
        let rows: Vec<Row> = serde_json::from_str(
            r#"[{"date":"2026-11-09","base":"EUR","quote":"VND","rate":28762},
                {"date":"2026-11-06","base":"EUR","quote":"USD","rate":1.1165},
                {"date":"2026-11-08","base":"EUR","quote":"BTC","rate":0.0000102},
                {"date":"2026-11-09","base":"EUR","quote":"XAU","rate":0.0003},
                {"date":"2026-11-09","base":"EUR","quote":"ZWG","rate":0}]"#,
        )
        .unwrap();
        let fiat: HashSet<String> = ["VND", "USD", "ZWG"].map(String::from).into();
        let (fx, dates) = keep_fiat(rows, &fiat);
        assert_eq!(fx.len(), 2);
        assert_eq!(fx["VND"], 28762.0);
        assert_eq!(dates["USD"], "2026-11-06");
        assert!(!dates.contains_key("BTC") && !dates.contains_key("ZWG"));
    }

    #[test]
    fn a_coins_day_is_its_price_its_change_and_its_hours_over_7_days() {
        // CoinGecko's /coins/markets as documented, cut to the fields read; a gap in the line is null.
        let markets: Vec<Market> = serde_json::from_str(
            r#"[{"id":"bitcoin","symbol":"btc","current_price":84215.5,"price_change_percentage_24h":2.41,
                 "sparkline_in_7d":{"price":[82100.0,null,82350.25,84215.5]}},
                {"id":"other","symbol":"btc","current_price":1.0,"price_change_percentage_24h":0.0,"sparkline_in_7d":{"price":[1.0]}}]"#,
        )
        .unwrap();
        let (day, id) = day_of(markets, "1d").unwrap();
        assert_eq!(day.price, 84215.5);
        assert_eq!(day.change, Some(2.41));
        assert_eq!(day.line, [82100.0, 82350.25, 84215.5]);
        assert_eq!((day.day, id.as_deref()), (3, Some("bitcoin")));
        // Every hour of the week is kept, oldest first.
        let week: Vec<Market> = serde_json::from_str(&format!(
            r#"[{{"current_price":3.0,"price_change_percentage_24h":null,"sparkline_in_7d":{{"price":[{}]}}}}]"#,
            (0..168).map(|i| i.to_string()).collect::<Vec<_>>().join(",")
        ))
        .unwrap();
        let (day, _) = day_of(week, "1d").unwrap();
        assert_eq!(day.change, None);
        assert_eq!(day.line.len(), 168);
        assert_eq!((day.line[0], day.line[167]), (0.0, 167.0));
        // A day draws the last 24 hours and the 24 h change.
        assert_eq!(day.day, 25);
        // No coin, or one without a price: nothing to show.
        assert!(day_of(Vec::new(), "1d").is_none());
        let unpriced: Vec<Market> = serde_json::from_str(r#"[{"current_price":null,"price_change_percentage_24h":1.0}]"#).unwrap();
        assert!(day_of(unpriced, "1d").is_none());
    }

    #[test]
    fn a_coin_is_asked_for_by_a_plain_symbol_in_a_three_letter_currency() {
        assert_eq!(
            coin_url("EUR", "BTC").as_deref(),
            Some("https://api.coingecko.com/api/v3/coins/markets?vs_currency=eur&symbols=btc&sparkline=true&per_page=1&price_change_percentage=7d,30d,1y")
        );
        assert!(coin_url("eur", "doge").is_some_and(|u| u.contains("vs_currency=eur&symbols=doge&")));
        for (base, symbol) in [("EURO", "BTC"), ("E1R", "BTC"), ("", "BTC"), ("EUR", ""), ("EUR", "BTC&ids=x"), ("EUR", "BTC,ETH"), ("EUR", "ABCDEFGHIJK"), ("EUR", "ÄBC")] {
            assert!(coin_url(base, symbol).is_none(), "{base} {symbol}");
        }
    }

    #[test]
    fn a_coins_month_and_year_come_from_its_chart_by_a_plain_id() {
        // A week, a month and a year take CoinGecko's change over each; a week draws all its hours.
        let markets = || -> Vec<Market> {
            serde_json::from_str(
                r#"[{"id":"bitcoin","current_price":3.0,"price_change_percentage_24h":1.0,"price_change_percentage_7d_in_currency":-4.4,
                     "price_change_percentage_30d_in_currency":-23.7,"price_change_percentage_1y_in_currency":-30.4,
                     "sparkline_in_7d":{"price":[1.0,2.0,3.0]}}]"#,
            )
            .unwrap()
        };
        let (week, _) = day_of(markets(), "1w").unwrap();
        assert_eq!((week.change, week.day), (Some(-4.4), 3));
        assert_eq!(day_of(markets(), "1m").unwrap().0.change, Some(-23.7));
        assert_eq!(day_of(markets(), "1y").unwrap().0.change, Some(-30.4));
        assert_eq!(chart_url("bitcoin", "EUR", 30).as_deref(), Some("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=eur&days=30"));
        assert!(chart_url("usd-coin", "usd", 365).is_some_and(|u| u.ends_with("vs_currency=usd&days=365")));
        for (id, base) in [("Bitcoin", "EUR"), ("bit coin", "EUR"), ("bitcoin/../x", "EUR"), ("", "EUR"), ("bitcoin", "EURO")] {
            assert!(chart_url(id, base, 30).is_none(), "{id} {base}");
        }
        let chart: CoinChart = serde_json::from_str(r#"{"prices":[[1793098800000,71622.8],[1793102400000,null]],"market_caps":[]}"#).unwrap();
        assert_eq!(chart.prices.len(), 2);
    }

    #[test]
    fn a_stock_is_asked_for_by_its_yahoo_symbol_and_range_and_nothing_else_reaches_the_address() {
        assert_eq!(stock_url("aapl", "1d").as_deref(), Some("https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=15m"));
        assert!(stock_url("AAPL", "1w").is_some_and(|u| u.ends_with("?range=5d&interval=15m")));
        assert!(stock_url("AAPL", "1m").is_some_and(|u| u.ends_with("?range=1mo&interval=1h")));
        assert!(stock_url("AAPL", "1y").is_some_and(|u| u.ends_with("?range=1y&interval=1d")));
        assert!(stock_url("AAPL", "max").is_none());
        assert!(stock_url("VWCE.DE", "1d").is_some_and(|u| u.contains("/chart/VWCE.DE?")));
        assert!(stock_url("BRK-B", "1d").is_some_and(|u| u.contains("/chart/BRK-B?")));
        assert!(stock_url("^GSPC", "1d").is_some_and(|u| u.contains("/chart/%5EGSPC?")));
        assert!(stock_url("EURUSD=X", "1d").is_some_and(|u| u.contains("/chart/EURUSD%3DX?")));
        for symbol in ["", "..", "AAPL/../X", "AAPL?x=1", "A B", "AAPL#", "ÄPPL", "ABCDEFGHIJKLMNOP"] {
            assert!(stock_url(symbol, "1d").is_none(), "{symbol}");
        }
    }

    #[test]
    fn a_stocks_day_is_its_price_its_change_and_its_last_session_in_the_main_currency_unit() {
        // Yahoo's chart cut to the fields read: two sessions, a gap (null) in the second.
        let chart = |currency: &str, change: &str| -> Chart {
            serde_json::from_str(&format!(
                r#"{{"chart":{{"result":[{{"meta":{{"currency":"{currency}","regularMarketPrice":102.4,{change}"previousClose":101.9,"chartPreviousClose":96.0,
                    "shortName":"Vodafone","tradingPeriods":[[{{"start":100,"end":150}}],[{{"start":200,"end":250}}]]}},
                    "timestamp":[100,110,120,200,210,220],
                    "indicators":{{"quote":[{{"close":[99.0,100.0,101.0,101.5,null,102.4]}}]}}}}],"error":null}}}}"#
            ))
            .unwrap()
        };
        let day = stock_of(chart("USD", r#""regularMarketChangePercent":0.491,"#), "1d").unwrap();
        assert_eq!((day.price, day.currency.as_str(), day.change), (102.4, "USD", Some(0.491)));
        assert_eq!(day.line, [99.0, 100.0, 101.0, 101.5, 102.4]);
        // The last session's points, the gap left out.
        assert_eq!(day.day, 2);
        assert_eq!(day.name.as_deref(), Some("Vodafone"));
        // London in pence: pounds, the change unchanged; without Yahoo's change, from the last close.
        let day = stock_of(chart("GBp", ""), "1d").unwrap();
        assert_eq!((day.currency.as_str(), day.price), ("GBP", 1.024));
        assert_eq!(day.line.first(), Some(&0.99));
        assert!(day.change.is_some_and(|c| (c - (102.4 / 101.9 - 1.0) * 100.0).abs() < 1e-9));
        // A single day lists its periods by kind: the regular hours count.
        let periods: serde_json::Value = serde_json::from_str(r#"{"pre":[[{"start":50}]],"regular":[[{"start":100}]],"post":[[{"start":160}]]}"#).unwrap();
        assert_eq!(session_starts(&periods), [100]);
        // An unknown symbol, or one without a price or a currency: nothing to show.
        let none: Chart = serde_json::from_str(r#"{"chart":{"result":null,"error":{"code":"Not Found"}}}"#).unwrap();
        assert!(stock_of(none, "1d").is_none());
        let unpriced: Chart = serde_json::from_str(r#"{"chart":{"result":[{"meta":{"currency":"USD"},"indicators":{"quote":[]}}]}}"#).unwrap();
        assert!(stock_of(unpriced, "1d").is_none());
        let no_currency: Chart = serde_json::from_str(r#"{"chart":{"result":[{"meta":{"regularMarketPrice":1.0},"indicators":{"quote":[]}}]}}"#).unwrap();
        assert!(stock_of(no_currency, "1d").is_none());
        // A longer range: the change from the close before the chart, every point drawn.
        let week = stock_of(chart("USD", r#""regularMarketChangePercent":0.491,"#), "1w").unwrap();
        assert!(week.change.is_some_and(|c| (c - (102.4 / 96.0 - 1.0) * 100.0).abs() < 1e-9));
        assert_eq!(week.day, week.line.len());
    }
}
