//! Decode HTTP response bodies: chunked transfer-encoding de-framing
//! and content-encoding decompression (gzip, deflate, brotli).
//!
//! All decode functions are infallible at the public API level — on failure
//! they silently return the original bytes and log a warning.

use std::io::Read;

/// Maximum decompressed output size (50 MB) to guard against decompression bombs.
const MAX_DECOMPRESSED_SIZE: usize = 50 * 1024 * 1024;

// ─── Public API ──────────────────────────────────────────

/// Decode a captured response body by stripping chunked framing and
/// decompressing content-encoding.  Order: chunked de-frame first, then
/// content-encoding decompress (matching the HTTP spec layering).
pub fn decode_response_body(body: &[u8], headers: &[(String, String)]) -> Vec<u8> {
    if body.is_empty() {
        return Vec::new();
    }

    let is_chunked = get_header(headers, "transfer-encoding")
        .is_some_and(|v| v.to_ascii_lowercase().contains("chunked"));

    let content_encoding =
        get_header(headers, "content-encoding").map(|v| v.trim().to_ascii_lowercase());

    // Step 1: de-chunk
    let unchunked = if is_chunked {
        decode_chunked_body(body)
    } else {
        body.to_vec()
    };

    // Step 2: decompress
    match content_encoding.as_deref() {
        Some(enc) if !enc.is_empty() && enc != "identity" => decompress_body(&unchunked, enc),
        _ => unchunked,
    }
}

// ─── Chunked Transfer-Encoding ───────────────────────────

/// Strip chunked transfer-encoding framing and return the concatenated
/// payload.  Falls back to `raw` unchanged on any parse error.
fn decode_chunked_body(raw: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(raw.len());
    let mut pos = 0;

    loop {
        // Find the CRLF that terminates the chunk-size line.
        let crlf = match find_crlf(&raw[pos..]) {
            Some(offset) => offset,
            None => {
                eprintln!("[decode] chunked: missing CRLF for chunk-size, falling back");
                return raw.to_vec();
            }
        };

        // Parse hex chunk size (ignore optional chunk extensions after `;`).
        let size_line = &raw[pos..pos + crlf];
        let size_str = std::str::from_utf8(size_line).unwrap_or("");
        let size_hex = size_str.split(';').next().unwrap_or("").trim();
        let chunk_size = match usize::from_str_radix(size_hex, 16) {
            Ok(n) => n,
            Err(_) => {
                eprintln!("[decode] chunked: invalid chunk size \"{size_hex}\", falling back");
                return raw.to_vec();
            }
        };

        // Advance past "<size>\r\n"
        pos += crlf + 2;

        if chunk_size == 0 {
            // Terminal chunk — ignore optional trailers.
            break;
        }

        // Extract chunk data.
        if pos + chunk_size > raw.len() {
            eprintln!("[decode] chunked: truncated chunk data, falling back");
            return raw.to_vec();
        }
        out.extend_from_slice(&raw[pos..pos + chunk_size]);
        pos += chunk_size;

        // Expect trailing CRLF after chunk data.
        if raw.get(pos..pos + 2) != Some(b"\r\n") {
            eprintln!("[decode] chunked: missing trailing CRLF after chunk data, falling back");
            return raw.to_vec();
        }
        pos += 2;
    }

    out
}

/// Find the offset of the first `\r\n` in `data`.
fn find_crlf(data: &[u8]) -> Option<usize> {
    data.windows(2).position(|w| w == b"\r\n")
}

// ─── Content-Encoding Decompression ──────────────────────

/// Decompress `body` according to `encoding`.  Falls back to the original
/// bytes on any decompression error.
fn decompress_body(body: &[u8], encoding: &str) -> Vec<u8> {
    let result = match encoding {
        "gzip" | "x-gzip" => decompress_gzip(body),
        "deflate" => decompress_deflate(body),
        "br" => decompress_brotli(body),
        "zstd" => decompress_zstd(body),
        other => {
            eprintln!("[decode] unsupported content-encoding \"{other}\", returning raw body");
            return body.to_vec();
        }
    };

    match result {
        Ok(decompressed) => decompressed,
        Err(e) => {
            eprintln!("[decode] {encoding} decompression failed: {e}, falling back to raw body");
            body.to_vec()
        }
    }
}

fn decompress_gzip(data: &[u8]) -> std::io::Result<Vec<u8>> {
    let mut decoder = flate2::read::GzDecoder::new(data);
    read_limited(&mut decoder)
}

fn decompress_deflate(data: &[u8]) -> std::io::Result<Vec<u8>> {
    // Try zlib-wrapped deflate first (more common), fall back to raw deflate.
    if let Ok(out) = {
        let mut decoder = flate2::read::ZlibDecoder::new(data);
        read_limited(&mut decoder)
    } {
        return Ok(out);
    }

    let mut decoder = flate2::read::DeflateDecoder::new(data);
    read_limited(&mut decoder)
}

fn decompress_brotli(data: &[u8]) -> std::io::Result<Vec<u8>> {
    let mut decoder = brotli::Decompressor::new(data, 4096);
    read_limited(&mut decoder)
}

fn decompress_zstd(data: &[u8]) -> std::io::Result<Vec<u8>> {
    let mut decoder = zstd::stream::read::Decoder::new(data)?;
    read_limited(&mut decoder)
}

/// Read from `reader` up to `MAX_DECOMPRESSED_SIZE` bytes.
fn read_limited(reader: &mut dyn Read) -> std::io::Result<Vec<u8>> {
    let mut buf = Vec::new();
    reader
        .take(MAX_DECOMPRESSED_SIZE as u64)
        .read_to_end(&mut buf)?;
    Ok(buf)
}

// ─── Helpers ─────────────────────────────────────────────

fn get_header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(name))
        .map(|(_, v)| v.as_str())
}

// ─── Tests ───────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    // ── Chunked ──

    #[test]
    fn chunked_single_chunk() {
        let raw = b"5\r\nhello\r\n0\r\n\r\n";
        assert_eq!(decode_chunked_body(raw), b"hello");
    }

    #[test]
    fn chunked_multiple_chunks() {
        let raw = b"5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n";
        assert_eq!(decode_chunked_body(raw), b"hello world");
    }

    #[test]
    fn chunked_empty() {
        let raw = b"0\r\n\r\n";
        assert_eq!(decode_chunked_body(raw), b"");
    }

    #[test]
    fn chunked_with_extension() {
        let raw = b"5;ext=val\r\nhello\r\n0\r\n\r\n";
        assert_eq!(decode_chunked_body(raw), b"hello");
    }

    #[test]
    fn chunked_malformed_falls_back() {
        let raw = b"not-hex\r\ndata\r\n";
        assert_eq!(decode_chunked_body(raw), raw.to_vec());
    }

    #[test]
    fn chunked_truncated_falls_back() {
        let raw = b"ff\r\nshort";
        assert_eq!(decode_chunked_body(raw), raw.to_vec());
    }

    // ── Gzip ──

    #[test]
    fn gzip_roundtrip() {
        let original = b"Hello, gzip world!";
        let compressed = gzip_compress(original);
        let result = decompress_body(&compressed, "gzip");
        assert_eq!(result, original);
    }

    #[test]
    fn gzip_corrupt_falls_back() {
        let garbage = b"\x1f\x8b\x08\x00GARBAGE";
        let result = decompress_body(garbage, "gzip");
        assert_eq!(result, garbage);
    }

    // ── Deflate ──

    #[test]
    fn deflate_zlib_roundtrip() {
        let original = b"Hello, deflate world!";
        let compressed = zlib_compress(original);
        let result = decompress_body(&compressed, "deflate");
        assert_eq!(result, original);
    }

    #[test]
    fn deflate_raw_roundtrip() {
        let original = b"Hello, raw deflate!";
        let compressed = raw_deflate_compress(original);
        let result = decompress_body(&compressed, "deflate");
        assert_eq!(result, original);
    }

    // ── Brotli ──

    #[test]
    fn brotli_roundtrip() {
        let original = b"Hello, brotli world!";
        let compressed = brotli_compress(original);
        let result = decompress_body(&compressed, "br");
        assert_eq!(result, original);
    }

    // ── decode_response_body integration ──

    #[test]
    fn decode_gzip_with_headers() {
        let original = b"{ \"key\": \"value\" }";
        let compressed = gzip_compress(original);
        let headers = vec![
            ("Content-Encoding".to_string(), "gzip".to_string()),
            ("Content-Type".to_string(), "application/json".to_string()),
        ];
        let result = decode_response_body(&compressed, &headers);
        assert_eq!(result, original);
    }

    #[test]
    fn decode_chunked_plus_gzip() {
        let original = b"chunked + gzip combo";
        let compressed = gzip_compress(original);
        let chunked = build_chunked_body(&compressed);
        let headers = vec![
            ("Transfer-Encoding".to_string(), "chunked".to_string()),
            ("Content-Encoding".to_string(), "gzip".to_string()),
        ];
        let result = decode_response_body(&chunked, &headers);
        assert_eq!(result, original);
    }

    #[test]
    fn decode_identity_passthrough() {
        let body = b"plain text body";
        let headers = vec![];
        let result = decode_response_body(body, &headers);
        assert_eq!(result, body);
    }

    #[test]
    fn decode_empty_body() {
        let result = decode_response_body(b"", &[]);
        assert!(result.is_empty());
    }

    #[test]
    fn decode_unknown_encoding_falls_back() {
        let body = b"some data";
        let headers = vec![("Content-Encoding".to_string(), "snappy".to_string())];
        let result = decode_response_body(body, &headers);
        assert_eq!(result, body);
    }

    #[test]
    fn decode_zstd_with_headers() {
        let original = br#"{"channels":[{"id":"1","name":"general"}]}"#;
        let compressed = zstd_compress(original);
        let headers = vec![
            ("Content-Encoding".to_string(), "zstd".to_string()),
            ("Content-Type".to_string(), "application/json".to_string()),
        ];
        let result = decode_response_body(&compressed, &headers);
        assert_eq!(result, original);
    }

    // ── Test Helpers ──

    fn gzip_compress(data: &[u8]) -> Vec<u8> {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(data).unwrap();
        encoder.finish().unwrap()
    }

    fn zlib_compress(data: &[u8]) -> Vec<u8> {
        let mut encoder =
            flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(data).unwrap();
        encoder.finish().unwrap()
    }

    fn raw_deflate_compress(data: &[u8]) -> Vec<u8> {
        let mut encoder =
            flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(data).unwrap();
        encoder.finish().unwrap()
    }

    fn brotli_compress(data: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut writer = brotli::CompressorWriter::new(&mut out, 4096, 6, 22);
            writer.write_all(data).unwrap();
        }
        out
    }

    fn zstd_compress(data: &[u8]) -> Vec<u8> {
        zstd::stream::encode_all(data, 0).unwrap()
    }

    fn build_chunked_body(data: &[u8]) -> Vec<u8> {
        let mut buf = Vec::new();
        write!(buf, "{:x}\r\n", data.len()).unwrap();
        buf.extend_from_slice(data);
        buf.extend_from_slice(b"\r\n0\r\n\r\n");
        buf
    }
}
