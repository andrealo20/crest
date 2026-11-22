//! Public prices without keys: CoinGecko for crypto (by symbol, the coin with the largest
//! market cap wins when a symbol is shared) and Frankfurter (central bank reference rates, the ECB's among them) for currencies.
//! Cached per symbol for a minute, so asking again as accounts arrive only fetches what is new. The bar's crypto widget asks
//! CoinGecko's markets for one coin's day and week (`coin_day`), cached the same way.

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
    /// The crypto widget's coins by upper-case symbol, None for one CoinGecko does not know.
    days: HashMap<String, (Instant, Option<CoinDay>)>,
}

/// One coin as the bar's crypto widget shows it: its price in the base currency, its change over 24 h in percent, and its hourly
/// prices over the last 7 days, oldest first.
#[derive(Clone, Serialize)]
pub struct CoinDay {
    pub price: f64,
    pub change: Option<f64>,
    pub line: Vec<f64>,
}

/// One coin of CoinGecko's /coins/markets, the fields read.
#[derive(Deserialize)]
struct Market {
    current_price: Option<f64>,
    price_change_percentage_24h: Option<f64>,
    sparkline_in_7d: Option<Spark>,
}

#[derive(Deserialize)]
struct Spark {
    price: Vec<Option<f64>>,
}

/// The markets address for one coin by its symbol in `base`, the largest by market cap first (CoinGecko's own order), with its
/// week's hourly line. None unless the base is three letters and the symbol 1 to 10 letters and digits, so nothing else reaches
/// the query.
fn coin_url(base: &str, symbol: &str) -> Option<String> {
    let base_ok = base.len() == 3 && base.bytes().all(|b| b.is_ascii_alphabetic());
    let symbol_ok = (1..=10).contains(&symbol.len()) && symbol.bytes().all(|b| b.is_ascii_alphanumeric());
    (base_ok && symbol_ok).then(|| {
        format!(
            "https://api.coingecko.com/api/v3/coins/markets?vs_currency={}&symbols={}&sparkline=true&per_page=1",
            base.to_lowercase(),
            symbol.to_lowercase()
        )
    })
}

/// The first coin's day: a finite price or nothing, its change only when finite, and every finite hour of its line.
fn day_of(markets: Vec<Market>) -> Option<CoinDay> {
    let m = markets.into_iter().next()?;
    let price = m.current_price.filter(|p| p.is_finite())?;
    let line = m.sparkline_in_7d.map(|s| s.price.into_iter().flatten().filter(|p| p.is_finite()).collect()).unwrap_or_default();
    Some(CoinDay { price, change: m.price_change_percentage_24h.filter(|c| c.is_finite()), line })
}

/// One coin's day in `base` (`day_of`), cached for a minute, and for a while as unknown when CoinGecko has no such coin; a symbol
/// or base `coin_url` refuses is unknown at once. A failed request is an error, so the widget keeps its last value.
pub async fn coin_day(client: &reqwest::Client, cache: &mut Cache, base: &str, symbol: &str) -> Result<Option<CoinDay>, String> {
    let Some(url) = coin_url(base, symbol) else { return Ok(None) };
    let (base, symbol) = (base.to_uppercase(), symbol.to_uppercase());
    if cache.base != base {
        *cache = Cache { base, ..Default::default() };
    }
    if let Some((at, day)) = cache.days.get(&symbol) {
        if at.elapsed() <= if day.is_some() { FRESH } else { MISS } {
            return Ok(day.clone());
        }
    }
    let day = day_of(send_json::<Vec<Market>>(client.get(url)).await?);
    cache.days.insert(symbol, (Instant::now(), day.clone()));
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
        let day = day_of(markets).unwrap();
        assert_eq!(day.price, 84215.5);
        assert_eq!(day.change, Some(2.41));
        assert_eq!(day.line, [82100.0, 82350.25, 84215.5]);
        // Every hour of the week is kept, oldest first.
        let week: Vec<Market> = serde_json::from_str(&format!(
            r#"[{{"current_price":3.0,"price_change_percentage_24h":null,"sparkline_in_7d":{{"price":[{}]}}}}]"#,
            (0..168).map(|i| i.to_string()).collect::<Vec<_>>().join(",")
        ))
        .unwrap();
        let day = day_of(week).unwrap();
        assert_eq!(day.change, None);
        assert_eq!(day.line.len(), 168);
        assert_eq!((day.line[0], day.line[167]), (0.0, 167.0));
        // No coin, or one without a price: nothing to show.
        assert!(day_of(Vec::new()).is_none());
        let unpriced: Vec<Market> = serde_json::from_str(r#"[{"current_price":null,"price_change_percentage_24h":1.0}]"#).unwrap();
        assert!(day_of(unpriced).is_none());
    }

    #[test]
    fn a_coin_is_asked_for_by_a_plain_symbol_in_a_three_letter_currency() {
        assert_eq!(
            coin_url("EUR", "BTC").as_deref(),
            Some("https://api.coingecko.com/api/v3/coins/markets?vs_currency=eur&symbols=btc&sparkline=true&per_page=1")
        );
        assert!(coin_url("eur", "doge").is_some_and(|u| u.contains("vs_currency=eur&symbols=doge&")));
        for (base, symbol) in [("EURO", "BTC"), ("E1R", "BTC"), ("", "BTC"), ("EUR", ""), ("EUR", "BTC&ids=x"), ("EUR", "BTC,ETH"), ("EUR", "ABCDEFGHIJK"), ("EUR", "ÄBC")] {
            assert!(coin_url(base, symbol).is_none(), "{base} {symbol}");
        }
    }
}
