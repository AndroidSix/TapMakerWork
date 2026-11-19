use napi::{Error, Result};
use napi_derive::napi;

#[napi]
fn maker_cache_entries(directory: String) -> Result<Vec<String>> {
    let mut names = Vec::new();
    for entry in std::fs::read_dir(directory).map_err(Error::from)? {
        let name = entry.map_err(Error::from)?.file_name();
        if name.as_encoded_bytes().starts_with(b"maker-cache") {
            names.push(
                name.into_string()
                    .map_err(|_| Error::from_reason("non-UTF-8 cache name"))?,
            );
        }
    }
    names.sort_unstable();
    Ok(names)
}
