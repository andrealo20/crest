//! Public prices without keys: CoinGecko for crypto (by symbol, the coin with the largest
//! market cap wins when a symbol is shared) and Frankfurter (central bank reference rates, the ECB's among them) for currencies.
//! Cached per symbol for a minute, so asking again as accounts arrive only fetches what is new.

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
}
