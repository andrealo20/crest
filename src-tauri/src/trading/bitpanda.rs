//! Bitpanda public API (api.public.bitpanda.com, the successor of the legacy api.bitpanda.com
//! that is switched off on 31 January 2027).
//!
//! `GET /v1/portfolio` lists every fiat and asset wallet with balance, current value and
//! invested amount, so no trade history is needed for P&L. Asset and currency ids are resolved
//! through `/v1/assets` and `/v1/currencies`. The key needs only the "Balances" scope.

use std::collections::HashMap;

use serde::Deserialize;

use super::{num, send_json, Account, Holding};
use crate::secrets;

const API: &str = "https://api.public.bitpanda.com/v1";

#[derive(Deserialize)]
struct List<T> {
    #[serde(default = "Vec::new")]
    data: Vec<T>,
    #[serde(default)]
    has_next_page: bool,
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
struct Item {
    asset_id: String,
    currency_id: String,
    balance: Option<Value>,
    invested_amount: Option<Value>,
    currency_balance: Option<Value>,
}

#[derive(Deserialize)]
struct Value {
    value: String,
}

#[derive(Deserialize)]
struct Asset {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    symbol: String,
    #[serde(default, rename = "type")]
    kind: String,
}

#[derive(Deserialize)]
struct Currency {
    id: String,
    symbol: String,
}

pub async fn fetch(client: &reqwest::Client) -> Result<Account, String> {
    let key = secrets::read("bitpanda.key").ok_or("no-key")?;
    let get = |url: String| client.get(url).header("x-api-key", key.trim());

    let portfolio: List<Item> = send_json(get(format!("{API}/portfolio"))).await?;
    let currencies: List<Currency> = send_json(get(format!("{API}/currencies"))).await?;
    let currency: HashMap<String, String> = currencies.data.into_iter().map(|c| (c.id, c.symbol)).collect();

    let mut ids: Vec<&str> = portfolio.data.iter().map(|i| i.asset_id.as_str()).filter(|id| !currency.contains_key(*id)).collect();
    ids.sort();
    ids.dedup();
    let mut assets: HashMap<String, Asset> = HashMap::new();
    for chunk in ids.chunks(50) {
        let mut cursor: Option<String> = None;
        loop {
            let mut url = format!("{API}/assets?page_size=100&id={}", chunk.join(","));
            if let Some(c) = &cursor {
                url.push_str(&format!("&cursor={c}"));
            }
            let page: List<Asset> = send_json(get(url)).await?;
            assets.extend(page.data.into_iter().map(|a| (a.id.clone(), a)));
            match page.next_cursor.filter(|_| page.has_next_page) {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }
    }

    let mut holdings = Vec::new();
    for item in portfolio.data {
        let quantity = item.balance.as_ref().map(|v| num(&v.value)).unwrap_or(0.0);
        if quantity.abs() < 1e-12 {
            continue;
        }
        let money = currency.get(&item.currency_id).cloned();
        if let Some(fiat) = currency.get(&item.asset_id) {
            holdings.push(Holding::cash(fiat, quantity));
            continue;
        }
        let Some(asset) = assets.get(&item.asset_id) else { continue };
        holdings.push(Holding {
            symbol: asset.symbol.clone(),
            name: asset.name.clone(),
            kind: if asset.kind.eq_ignore_ascii_case("CRYPTO") { "crypto" } else { "stock" },
            quantity,
            value: item.currency_balance.as_ref().map(|v| num(&v.value)),
            cost: item.invested_amount.as_ref().map(|v| num(&v.value)),
            currency: money,
            ..Default::default()
        });
    }
    Ok(Account { holdings, ..Default::default() })
}
