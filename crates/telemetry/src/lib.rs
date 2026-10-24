//! Shared structured logging configuration. Never include submitted secrets in fields.
use tracing_subscriber::EnvFilter;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("LOG_FORMAT must be text or json")]
    Format,
    #[error("RUST_LOG contains an invalid logging filter")]
    Filter,
    #[error("logging subscriber could not be initialized")]
    Subscriber,
}

fn json_format(value: &str) -> Result<bool, Error> {
    match value {
        "text" => Ok(false),
        "json" => Ok(true),
        _ => Err(Error::Format),
    }
}

pub fn init() -> Result<(), Error> {
    let format = std::env::var("LOG_FORMAT").unwrap_or_else(|_| {
        if cfg!(debug_assertions) {
            "text"
        } else {
            "json"
        }
        .into()
    });
    let filter = EnvFilter::try_new(std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()))
        .map_err(|_| Error::Filter)?;
    let subscriber = tracing_subscriber::fmt().with_env_filter(filter);
    if json_format(&format)? {
        subscriber
            .json()
            .with_current_span(true)
            .with_span_list(true)
            .try_init()
    } else {
        subscriber.try_init()
    }
    .map_err(|_| Error::Subscriber)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_format_fails_instead_of_silently_changing_log_protocol() {
        assert!(json_format("json").unwrap());
        assert!(!json_format("text").unwrap());
        assert!(matches!(json_format("jsoon"), Err(Error::Format)));
    }
}
