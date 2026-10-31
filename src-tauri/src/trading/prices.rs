//! Public prices without keys: CoinGecko for crypto (by symbol, the coin with the largest
//! market cap wins when a symbol is shared) and Frankfurter (ECB reference rates) for currencies.

use std::collections::HashMap;

use serde::Serialize;

use super::send_json;

#[derive(Clone, Default, Serialize)]
pub struct Rates {
    pub base: String,
    /// Price of one coin in `base`, by upper-case symbol.
    pub crypto: HashMap<String, f64>,
    /// Units of a currency per one `base` (as the ECB publishes them).
    pub fx: HashMap<String, f64>,
    /// Sources that failed ("coingecko", "frankfurter"); the rest is still returned.
    pub failed: Vec<String>,
}

pub async fn fetch(client: &reqwest::Client, base: &str, crypto: &[String], fiats: &[String]) -> Result<Rates, String> {
    let base = base.to_uppercase();
    let mut rates = Rates { base: base.clone(), ..Default::default() };

    let symbols: Vec<String> = crypto.iter().map(|s| s.to_lowercase()).filter(|s| s.chars().all(|c| c.is_ascii_alphanumeric())).collect();
    for chunk in symbols.chunks(80) {
        let url = format!("https://api.coingecko.com/api/v3/simple/price?symbols={}&vs_currencies={}", chunk.join(","), base.to_lowercase());
        match send_json::<HashMap<String, HashMap<String, f64>>>(client.get(url)).await {
            Ok(map) => {
                for (symbol, prices) in map {
                    if let Some(p) = prices.get(&base.to_lowercase()) {
                        rates.crypto.insert(symbol.to_uppercase(), *p);
                    }
                }
            }
            Err(_) => rates.failed.push("coingecko".into()),
        }
    }

    if fiats.iter().any(|f| !f.eq_ignore_ascii_case(&base)) {
        #[derive(serde::Deserialize)]
        struct Latest {
            rates: HashMap<String, f64>,
        }
        match send_json::<Latest>(client.get(format!("https://api.frankfurter.dev/v1/latest?base={base}"))).await {
            Ok(latest) => rates.fx = latest.rates,
            Err(_) => rates.failed.push("frankfurter".into()),
        }
    }
    Ok(rates)
}
