//! Portfolio across brokers and exchanges. Read-only: no provider module calls an order,
//! transfer or any other write endpoint, and the keys should be created read-only.
//!
//! Each provider module turns its API into the same `Account` shape (holdings with optional
//! value and cost, plus trades where the API has no cost basis). Pricing, currency conversion
//! and P&L happen in the frontend (src/features/trading/portfolio.ts), so they are pure and tested.
//!
//! History: the APIs have no value history, so one snapshot per day is stored (the day's last
//! value) plus intraday points every 2 min while the portfolio is open, per scope (all accounts
//! or one account) and base currency.

mod binance;
mod bitpanda;
mod coinbase;
mod etoro;
mod ibkr;
mod kraken;
mod prices;
mod sign;
mod t212;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

pub use prices::Rates;

const KEEP_DAYS: usize = 120;
const INTRADAY_STEP_MS: u64 = 2 * 60 * 1000;

#[derive(Default)]
pub struct TradingState {
    accounts: Mutex<HashMap<String, (Instant, Account)>>,
    prices: Mutex<Option<(Instant, String, Rates)>>,
}

/// One account as the provider reports it. Amounts are in `Holding::currency` (or priced later).
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub holdings: Vec<Holding>,
    /// Only where the API has no cost basis (Kraken): used for average cost.
    pub trades: Vec<Trade>,
    pub realized: Option<Money>,
    /// The trade history is still being loaded, so cost and P&L are incomplete.
    pub partial: bool,
    /// "key-can-trade" when the provider says the key has more than read rights.
    pub warning: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct Money {
    pub amount: f64,
    pub currency: String,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Holding {
    pub symbol: String,
    pub name: String,
    /// "crypto", "fiat" or "stock".
    pub kind: &'static str,
    pub quantity: f64,
    /// Price per unit as the provider shows it (display only).
    pub price: Option<f64>,
    pub price_currency: Option<String>,
    /// Current value and cost basis in `currency`, when the provider computes them.
    pub value: Option<f64>,
    pub cost: Option<f64>,
    pub currency: Option<String>,
}

impl Holding {
    /// A balance of a coin or a currency that the frontend prices.
    pub fn balance(symbol: &str, quantity: f64) -> Self {
        Holding {
            symbol: symbol.to_string(),
            name: String::new(),
            kind: if is_fiat(symbol) { "fiat" } else { "crypto" },
            quantity,
            ..Default::default()
        }
    }

    /// Cash in a currency, valued by the provider.
    pub fn cash(currency: &str, amount: f64) -> Self {
        Holding {
            symbol: currency.to_string(),
            kind: "fiat",
            quantity: amount,
            value: Some(amount),
            currency: Some(currency.to_string()),
            ..Default::default()
        }
    }
}

/// A trade as signed balance changes (net of fees), e.g. [-1002.6 EUR, +0.01 BTC].
#[derive(Clone, Serialize, Deserialize)]
pub struct Trade {
    /// Unix seconds.
    pub time: f64,
    pub legs: Vec<Leg>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Leg {
    pub asset: String,
    pub fiat: bool,
    pub net: f64,
}

/// Currencies treated as cash. Stablecoins are crypto (priced by CoinGecko).
const FIAT: &[&str] = &[
    "EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD", "NZD", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN", "ISK", "TRY", "BRL", "MXN",
    "ZAR", "SGD", "HKD", "KRW", "INR", "ILS", "CNY", "IDR", "MYR", "PHP", "THB", "AED", "ARS", "UAH",
];

pub fn is_fiat(code: &str) -> bool {
    FIAT.contains(&code)
}

/// Cache lifetime per provider (their rate limits and how often the data changes).
fn ttl(provider: &str) -> Duration {
    Duration::from_secs(match provider {
        "t212" => 6,
        "kraken" => 60,
        "ibkr" => 30 * 60,
        _ => 30,
    })
}

/// Errors are short codes the frontend translates: no-key, unauthorized, forbidden, rate,
/// unknown-provider, network:…, api:… (the provider's own message).
#[tauri::command]
pub async fn portfolio_fetch(provider: String, env: String, app: AppHandle, state: State<'_, TradingState>) -> Result<Account, String> {
    let cache_key = format!("{provider}:{env}");
    if let Some((at, account)) = state.accounts.lock().unwrap().get(&cache_key) {
        if at.elapsed() < ttl(&provider) {
            return Ok(account.clone());
        }
    }
    let client = client()?;
    let account = match provider.as_str() {
        "t212" => t212::fetch(&client, &env).await?,
        "kraken" => kraken::fetch(&client, &app).await?,
        "coinbase" => coinbase::fetch(&client).await?,
        "binance" => binance::fetch(&client).await?,
        "bitpanda" => bitpanda::fetch(&client).await?,
        "etoro" => etoro::fetch(&client).await?,
        "ibkr" => ibkr::fetch(&client).await?,
        _ => return Err("unknown-provider".into()),
    };
    state.accounts.lock().unwrap().insert(cache_key, (Instant::now(), account.clone()));
    Ok(account)
}

/// Crypto prices in `base` and FX rates (units of a currency per 1 `base`). Public, no keys.
#[tauri::command]
pub async fn portfolio_prices(base: String, crypto: Vec<String>, fiats: Vec<String>, state: State<'_, TradingState>) -> Result<Rates, String> {
    let key = format!("{base}|{}|{}", crypto.join(","), fiats.join(","));
    if let Some((at, cached_key, rates)) = state.prices.lock().unwrap().as_ref() {
        if at.elapsed() < Duration::from_secs(60) && *cached_key == key {
            return Ok(rates.clone());
        }
    }
    let rates = prices::fetch(&client()?, &base, &crypto, &fiats).await?;
    *state.prices.lock().unwrap() = Some((Instant::now(), key, rates.clone()));
    Ok(rates)
}

pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        // Interactive Brokers rejects requests without a User-Agent.
        .user_agent("Crest")
        .build()
        .map_err(|e| format!("network:{e}"))
}

/// Sends a request and maps the status to the shared error codes.
pub async fn send_json<T: for<'de> Deserialize<'de>>(req: reqwest::RequestBuilder) -> Result<T, String> {
    let res = req.send().await.map_err(|e| format!("network:{e}"))?;
    match res.status().as_u16() {
        200..=299 => res.json::<T>().await.map_err(|e| format!("network:unreadable response ({e})")),
        401 => Err("unauthorized".into()),
        403 => Err("forbidden".into()),
        429 => Err("rate".into()),
        code => Err(format!("network:HTTP {code}")),
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn num(s: &str) -> f64 {
    s.trim().parse().unwrap_or(0.0)
}

// ---------- History ----------

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    /// Unix ms.
    t: u64,
    value: f64,
    pnl: f64,
}

#[derive(Default, Serialize, Deserialize)]
struct Intraday {
    date: String,
    points: Vec<Point>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    date: String,
    /// Value including cash.
    value: f64,
    invested: f64,
    /// Total profit (realized + unrealized). The change vs. yesterday is the daily change,
    /// independent of deposits and purchases.
    #[serde(default)]
    pnl: f64,
}

#[derive(Deserialize)]
pub struct RecordEntry {
    scope: String,
    value: f64,
    pnl: f64,
    invested: f64,
    /// Trading 212 env whose old files (in the account currency) seed this scope once.
    seed: Option<String>,
}

#[derive(Serialize)]
pub struct Recorded {
    history: Vec<Snapshot>,
    intraday: Vec<Point>,
}

/// Records today's value for each scope and returns its history. `today`: local "YYYY-MM-DD".
#[tauri::command]
pub fn portfolio_record(base: String, today: String, entries: Vec<RecordEntry>, app: AppHandle) -> HashMap<String, Recorded> {
    let dir = app.path().app_data_dir().ok().filter(|d| std::fs::create_dir_all(d).is_ok());
    let base: String = base.chars().filter(|c| c.is_ascii_alphabetic()).collect();
    entries
        .into_iter()
        .map(|e| {
            let point = Point { t: now_ms(), value: e.value, pnl: e.pnl };
            let snapshot = Snapshot { date: today.clone(), value: e.value, invested: e.invested, pnl: e.pnl };
            let recorded = match &dir {
                Some(dir) => {
                    let scope: String = e.scope.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
                    let history = dir.join(format!("portfolio-history-{scope}-{base}.json"));
                    let intraday = dir.join(format!("portfolio-intraday-{scope}-{base}.json"));
                    if let Some(env) = e.seed.as_deref().filter(|env| *env == "live" || *env == "demo") {
                        seed(&history, &dir.join(format!("trading-history-{env}.json")));
                        seed(&intraday, &dir.join(format!("trading-intraday-{env}.json")));
                    }
                    Recorded { intraday: record_point(&intraday, &today, point), history: record_snapshot(&history, snapshot) }
                }
                None => Recorded { history: vec![snapshot], intraday: vec![point] },
            };
            (e.scope, recorded)
        })
        .collect()
}

/// Copies the old Trading 212 file once, so the chart keeps its past.
fn seed(target: &PathBuf, legacy: &PathBuf) {
    if !target.exists() && legacy.exists() {
        let _ = std::fs::copy(legacy, target);
    }
}

/// Adds an intraday point (at most every 2 min, otherwise the last one is replaced).
fn record_point(path: &PathBuf, today: &str, point: Point) -> Vec<Point> {
    let mut day: Intraday = std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    if day.date != today {
        day = Intraday { date: today.to_string(), points: vec![] };
    }
    // The last point is always the current value; a new one is only added once the
    // one before it is at least INTRADAY_STEP_MS old.
    let n = day.points.len();
    if n >= 2 && point.t.saturating_sub(day.points[n - 2].t) < INTRADAY_STEP_MS {
        day.points[n - 1] = point;
    } else {
        day.points.push(point);
    }
    let _ = std::fs::write(path, serde_json::to_vec(&day).unwrap_or_default());
    day.points
}

/// Stores today's value (overwrites the day's entry) and returns the history.
fn record_snapshot(path: &PathBuf, snapshot: Snapshot) -> Vec<Snapshot> {
    let mut history: Vec<Snapshot> = std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    match history.last_mut() {
        Some(last) if last.date == snapshot.date => *last = snapshot,
        _ => history.push(snapshot),
    }
    if history.len() > KEEP_DAYS {
        history.drain(..history.len() - KEEP_DAYS);
    }
    let _ = std::fs::write(path, serde_json::to_vec(&history).unwrap_or_default());
    history
}
