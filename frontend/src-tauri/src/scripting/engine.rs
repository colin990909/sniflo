use std::time::Instant;

use boa_engine::object::builtins::JsArray;
use boa_engine::{Context, JsValue, Source, js_string};

use crate::proxy_core::http::{HttpRequestRecord, HttpResponseRecord};

/// Maximum body size exposed to JS (1 MB). Larger bodies are passed as null.
const MAX_BODY_SIZE: usize = 1_024 * 1_024;

/// Maximum loop iterations allowed before the engine aborts (prevents infinite loops).
const MAX_LOOP_ITERATIONS: u64 = 1_000_000;

/// Result of executing a single script.
pub struct ScriptResult {
    /// Whether any field on the request/response was mutated.
    pub modified: bool,
    /// Whether the script returned "drop".
    pub dropped: bool,
    /// Debug log messages collected via `ctx.log()`.
    pub logs: Vec<String>,
    /// Error message if the script failed.
    pub error: Option<String>,
}

/// JS helper code injected before user scripts.
/// Provides getHeader/setHeader/removeHeader/setBody/setStatus as plain JS functions
/// that manipulate the ctx object's plain properties. No Rust closures needed.
const JS_HELPERS: &str = r#"
var __logs = [];

var ctx = {
    log: function() {
        var parts = [];
        for (var i = 0; i < arguments.length; i++) {
            parts.push(String(arguments[i]));
        }
        __logs.push(parts.join(" "));
    }
};

function __makeHeaderMethods(obj) {
    obj.getHeader = function(name) {
        var lc = name.toLowerCase();
        for (var i = 0; i < obj.headers.length; i++) {
            if (obj.headers[i][0].toLowerCase() === lc) {
                return obj.headers[i][1];
            }
        }
        return null;
    };
    obj.setHeader = function(name, value) {
        var lc = name.toLowerCase();
        for (var i = 0; i < obj.headers.length; i++) {
            if (obj.headers[i][0].toLowerCase() === lc) {
                obj.headers[i][1] = String(value);
                return;
            }
        }
        obj.headers.push([String(name), String(value)]);
    };
    obj.removeHeader = function(name) {
        var lc = name.toLowerCase();
        obj.headers = obj.headers.filter(function(h) {
            return h[0].toLowerCase() !== lc;
        });
    };
    obj.setBody = function(body) {
        obj.body = body;
    };
    return obj;
}
"#;

// ─── Request-Phase Execution ─────────────────────────────

/// Execute a script in request phase. Mutates `request` in-place if the script modifies it.
pub fn execute_request_script(code: &str, request: &mut HttpRequestRecord) -> ScriptResult {
    let _start = Instant::now();
    let mut context = Context::default();
    context
        .runtime_limits_mut()
        .set_loop_iteration_limit(MAX_LOOP_ITERATIONS);

    // Inject helpers and build ctx.request as a plain JS object
    let setup = build_request_setup(request);
    let full_code = format!(
        "{JS_HELPERS}\n{setup}\n{code}\n\
        if (typeof onRequest === \"function\") {{ onRequest(ctx); }}"
    );

    let result = context.eval(Source::from_bytes(&full_code));

    let dropped = match &result {
        Ok(val) => val
            .as_string()
            .is_some_and(|s| s.to_std_string_escaped() == "drop"),
        Err(_) => false,
    };

    let error = result.err().map(|e| e.to_string());
    let logs = read_logs(&mut context);

    // Read back request state and detect modifications
    let modified = if error.is_none() {
        read_back_request(&mut context, request)
    } else {
        false
    };

    ScriptResult {
        modified,
        dropped,
        logs,
        error,
    }
}

// ─── Response-Phase Execution ────────────────────────────

/// Execute a script in response phase. Mutates `response` in-place if the script modifies it.
pub fn execute_response_script(
    code: &str,
    request: &HttpRequestRecord,
    response: &mut HttpResponseRecord,
) -> ScriptResult {
    let mut context = Context::default();
    context
        .runtime_limits_mut()
        .set_loop_iteration_limit(MAX_LOOP_ITERATIONS);

    let setup = build_response_setup(request, response);
    let full_code = format!(
        "{JS_HELPERS}\n{setup}\n{code}\n\
        if (typeof onResponse === \"function\") {{ onResponse(ctx); }}"
    );

    let result = context.eval(Source::from_bytes(&full_code));

    let dropped = match &result {
        Ok(val) => val
            .as_string()
            .is_some_and(|s| s.to_std_string_escaped() == "drop"),
        Err(_) => false,
    };

    let error = result.err().map(|e| e.to_string());
    let logs = read_logs(&mut context);

    let modified = if error.is_none() {
        read_back_response(&mut context, response)
    } else {
        false
    };

    ScriptResult {
        modified,
        dropped,
        logs,
        error,
    }
}

// ─── JS Setup Code Builders ─────────────────────────────

fn build_request_setup(request: &HttpRequestRecord) -> String {
    let method_js = escape_js_string(&request.method);
    let url_js = escape_js_string(&request.url);
    let headers_js = headers_to_js_literal(&request.headers);
    let body_js = body_to_js_literal(&request.body);

    format!(
        "ctx.request = __makeHeaderMethods({{\n  \
            method: {method_js},\n  \
            url: {url_js},\n  \
            headers: {headers_js},\n  \
            body: {body_js}\n\
        }});\n\
        ctx.request.setStatus = function(s) {{ ctx.request.status = s; }};\n"
    )
}

fn build_response_setup(request: &HttpRequestRecord, response: &HttpResponseRecord) -> String {
    let req_method_js = escape_js_string(&request.method);
    let req_url_js = escape_js_string(&request.url);
    let req_headers_js = headers_to_js_literal(&request.headers);
    let req_body_js = body_to_js_literal(&request.body);

    let resp_status = response.status;
    let resp_headers_js = headers_to_js_literal(&response.headers);
    let resp_body_js = body_to_js_literal(&response.body);

    format!(
        "ctx.request = __makeHeaderMethods({{\n  \
            method: {req_method_js},\n  \
            url: {req_url_js},\n  \
            headers: {req_headers_js},\n  \
            body: {req_body_js}\n\
        }});\n\
        ctx.response = __makeHeaderMethods({{\n  \
            status: {resp_status},\n  \
            headers: {resp_headers_js},\n  \
            body: {resp_body_js}\n\
        }});\n\
        ctx.response.setStatus = function(s) {{ ctx.response.status = s; }};\n"
    )
}

// ─── Read Back State ─────────────────────────────────────

/// Read back request fields from JS context. Returns true if any field was modified.
fn read_back_request(context: &mut Context, request: &mut HttpRequestRecord) -> bool {
    let mut modified = false;

    let req_val = eval_expr(context, "ctx.request");
    let Some(req_obj) = req_val.as_object() else {
        return false;
    };

    // method
    if let Ok(val) = req_obj.get(js_string!("method"), context)
        && let Some(s) = val.as_string()
    {
        let new_method = s.to_std_string_escaped();
        if new_method != request.method {
            request.method = new_method;
            modified = true;
        }
    }

    // url
    if let Ok(val) = req_obj.get(js_string!("url"), context)
        && let Some(s) = val.as_string()
    {
        let new_url = s.to_std_string_escaped();
        if new_url != request.url {
            request.url = new_url;
            modified = true;
        }
    }

    // body
    if let Ok(val) = req_obj.get(js_string!("body"), context) {
        let new_body = js_value_to_body(&val);
        if new_body != request.body {
            request.body = new_body;
            modified = true;
        }
    }

    // headers
    if let Ok(val) = req_obj.get(js_string!("headers"), context) {
        let new_headers = js_array_to_headers(&val, context);
        if new_headers != request.headers {
            request.headers = new_headers;
            modified = true;
        }
    }

    modified
}

/// Read back response fields from JS context. Returns true if any field was modified.
fn read_back_response(context: &mut Context, response: &mut HttpResponseRecord) -> bool {
    let mut modified = false;

    let resp_val = eval_expr(context, "ctx.response");
    let Some(resp_obj) = resp_val.as_object() else {
        return false;
    };

    // status
    if let Ok(val) = resp_obj.get(js_string!("status"), context)
        && let Some(n) = val.as_number()
    {
        let new_status = n as u16;
        if new_status != response.status {
            response.status = new_status;
            modified = true;
        }
    }

    // body
    if let Ok(val) = resp_obj.get(js_string!("body"), context) {
        let new_body = js_value_to_body(&val);
        if new_body != response.body {
            response.body = new_body;
            modified = true;
        }
    }

    // headers
    if let Ok(val) = resp_obj.get(js_string!("headers"), context) {
        let new_headers = js_array_to_headers(&val, context);
        if new_headers != response.headers {
            response.headers = new_headers;
            modified = true;
        }
    }

    modified
}

// ─── Helpers ─────────────────────────────────────────────

fn eval_expr(context: &mut Context, expr: &str) -> JsValue {
    context
        .eval(Source::from_bytes(expr))
        .unwrap_or(JsValue::undefined())
}

fn read_logs(context: &mut Context) -> Vec<String> {
    let logs_val = eval_expr(context, "__logs");
    let Some(logs_obj) = logs_val.as_object() else {
        return Vec::new();
    };
    let Ok(arr) = JsArray::from_object(logs_obj.clone()) else {
        return Vec::new();
    };
    let len = arr.length(context).unwrap_or(0);
    let mut logs = Vec::with_capacity(len as usize);
    for i in 0..len {
        if let Ok(val) = arr.get(i, context)
            && let Some(s) = val.as_string()
        {
            logs.push(s.to_std_string_escaped());
        }
    }
    logs
}

fn escape_js_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\0' => out.push_str("\\0"),
            c if c < '\x20' => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn headers_to_js_literal(headers: &[(String, String)]) -> String {
    let mut out = String::from("[");
    for (i, (name, value)) in headers.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push('[');
        out.push_str(&escape_js_string(name));
        out.push(',');
        out.push_str(&escape_js_string(value));
        out.push(']');
    }
    out.push(']');
    out
}

fn body_to_js_literal(body: &[u8]) -> String {
    if body.is_empty() {
        return "null".to_string();
    }
    if body.len() > MAX_BODY_SIZE {
        eprintln!(
            "[script] Body too large ({} bytes > {}), passing null to JS",
            body.len(),
            MAX_BODY_SIZE
        );
        return "null".to_string();
    }
    match std::str::from_utf8(body) {
        Ok(s) => escape_js_string(s),
        Err(_) => "null".to_string(), // binary body → null
    }
}

fn js_value_to_body(val: &JsValue) -> Vec<u8> {
    if val.is_null_or_undefined() {
        return Vec::new();
    }
    if let Some(s) = val.as_string() {
        return s.to_std_string_escaped().into_bytes();
    }
    Vec::new()
}

fn js_array_to_headers(val: &JsValue, context: &mut Context) -> Vec<(String, String)> {
    let Some(obj) = val.as_object() else {
        return Vec::new();
    };
    let Ok(arr) = JsArray::from_object(obj.clone()) else {
        return Vec::new();
    };
    let len = arr.length(context).unwrap_or(0);
    let mut headers = Vec::with_capacity(len as usize);
    for i in 0..len {
        let Ok(entry) = arr.get(i, context) else {
            continue;
        };
        let Some(entry_obj) = entry.as_object() else {
            continue;
        };
        let Ok(entry_arr) = JsArray::from_object(entry_obj.clone()) else {
            continue;
        };
        let name = entry_arr
            .get(0, context)
            .ok()
            .and_then(|v| v.as_string().map(|s| s.to_std_string_escaped()))
            .unwrap_or_default();
        let value = entry_arr
            .get(1, context)
            .ok()
            .and_then(|v| v.as_string().map(|s| s.to_std_string_escaped()))
            .unwrap_or_default();
        if !name.is_empty() {
            headers.push((name, value));
        }
    }
    headers
}

// ─── Tests ───────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_request() -> HttpRequestRecord {
        HttpRequestRecord {
            method: "GET".into(),
            url: "https://example.com/api/users".into(),
            headers: vec![
                ("Host".into(), "example.com".into()),
                ("Accept".into(), "application/json".into()),
            ],
            body: vec![],
        }
    }

    fn make_response() -> HttpResponseRecord {
        HttpResponseRecord {
            status: 200,
            headers: vec![("Content-Type".into(), "application/json".into())],
            body: b"{\"ok\":true}".to_vec(),
        }
    }

    #[test]
    fn test_passthrough_no_modification() {
        let mut req = make_request();
        let original_url = req.url.clone();
        let result = execute_request_script("// no-op script", &mut req);
        assert!(!result.modified);
        assert!(!result.dropped);
        assert!(result.error.is_none());
        assert_eq!(req.url, original_url);
    }

    #[test]
    fn test_modify_request_header() {
        let mut req = make_request();
        let code = r#"
            function onRequest(ctx) {
                ctx.request.setHeader("X-Custom", "hello");
            }
        "#;
        let result = execute_request_script(code, &mut req);
        assert!(result.modified);
        assert!(!result.dropped);
        assert!(result.error.is_none());
        let custom = req.headers.iter().find(|(k, _)| k == "X-Custom");
        assert_eq!(custom, Some(&("X-Custom".to_string(), "hello".to_string())));
    }

    #[test]
    fn test_modify_request_url() {
        let mut req = make_request();
        let code = r#"
            function onRequest(ctx) {
                ctx.request.url = "https://modified.com/new-path";
            }
        "#;
        let result = execute_request_script(code, &mut req);
        assert!(result.modified);
        assert_eq!(req.url, "https://modified.com/new-path");
    }

    #[test]
    fn test_drop_request() {
        let mut req = make_request();
        let code = r#"
            function onRequest(ctx) {
                return "drop";
            }
        "#;
        let result = execute_request_script(code, &mut req);
        assert!(result.dropped);
    }

    #[test]
    fn test_log_collection() {
        let mut req = make_request();
        let code = r#"
            function onRequest(ctx) {
                ctx.log("hello");
                ctx.log("world");
            }
        "#;
        let result = execute_request_script(code, &mut req);
        assert_eq!(result.logs, vec!["hello", "world"]);
    }

    #[test]
    fn test_script_error_returns_error() {
        let mut req = make_request();
        let code = "function onRequest(ctx) { throw new Error('boom'); }";
        let result = execute_request_script(code, &mut req);
        assert!(result.error.is_some());
        assert!(!result.modified);
    }

    #[test]
    fn test_remove_header() {
        let mut req = make_request();
        let code = r#"
            function onRequest(ctx) {
                ctx.request.removeHeader("Accept");
            }
        "#;
        let result = execute_request_script(code, &mut req);
        assert!(result.modified);
        assert!(!req.headers.iter().any(|(k, _)| k == "Accept"));
    }

    #[test]
    fn test_modify_response_status() {
        let req = make_request();
        let mut resp = make_response();
        let code = r#"
            function onResponse(ctx) {
                ctx.response.setStatus(404);
            }
        "#;
        let result = execute_response_script(code, &req, &mut resp);
        assert!(result.modified);
        assert_eq!(resp.status, 404);
    }

    #[test]
    fn test_modify_response_body() {
        let req = make_request();
        let mut resp = make_response();
        let code = r#"
            function onResponse(ctx) {
                ctx.response.setBody('{"modified":true}');
            }
        "#;
        let result = execute_response_script(code, &req, &mut resp);
        assert!(result.modified);
        assert_eq!(String::from_utf8_lossy(&resp.body), "{\"modified\":true}");
    }

    #[test]
    fn test_read_request_in_response_phase() {
        let req = make_request();
        let mut resp = make_response();
        let code = r#"
            function onResponse(ctx) {
                if (ctx.request.method === "GET") {
                    ctx.response.setHeader("X-Was-Get", "true");
                }
            }
        "#;
        let result = execute_response_script(code, &req, &mut resp);
        assert!(result.modified);
        let header = resp.headers.iter().find(|(k, _)| k == "X-Was-Get");
        assert_eq!(header, Some(&("X-Was-Get".to_string(), "true".to_string())));
    }

    #[test]
    fn test_get_header_case_insensitive() {
        let mut req = make_request();
        let code = r#"
            function onRequest(ctx) {
                var val = ctx.request.getHeader("host");
                ctx.request.setHeader("X-Found-Host", val);
            }
        "#;
        let result = execute_request_script(code, &mut req);
        assert!(result.modified);
        let header = req.headers.iter().find(|(k, _)| k == "X-Found-Host");
        assert_eq!(
            header,
            Some(&("X-Found-Host".to_string(), "example.com".to_string()))
        );
    }

    #[test]
    fn test_large_body_passed_as_null() {
        let mut req = HttpRequestRecord {
            method: "POST".into(),
            url: "/upload".into(),
            headers: vec![],
            body: vec![0u8; MAX_BODY_SIZE + 1],
        };
        let code = r#"
            function onRequest(ctx) {
                if (ctx.request.body === null) {
                    ctx.log("body is null");
                }
            }
        "#;
        let result = execute_request_script(code, &mut req);
        assert_eq!(result.logs, vec!["body is null"]);
    }

    #[test]
    fn test_modify_method() {
        let mut req = make_request();
        let code = r#"
            function onRequest(ctx) {
                ctx.request.method = "POST";
            }
        "#;
        let result = execute_request_script(code, &mut req);
        assert!(result.modified);
        assert_eq!(req.method, "POST");
    }

    #[test]
    fn test_set_body_on_request() {
        let mut req = make_request();
        let code = r#"
            function onRequest(ctx) {
                ctx.request.setBody('{"key":"value"}');
            }
        "#;
        let result = execute_request_script(code, &mut req);
        assert!(result.modified);
        assert_eq!(String::from_utf8_lossy(&req.body), "{\"key\":\"value\"}");
    }

    #[test]
    fn test_escape_special_chars_in_body() {
        let mut req = HttpRequestRecord {
            method: "POST".into(),
            url: "/test".into(),
            headers: vec![],
            body: b"line1\nline2\ttab\"quote".to_vec(),
        };
        let code = r#"
            function onRequest(ctx) {
                ctx.log(ctx.request.body);
            }
        "#;
        let result = execute_request_script(code, &mut req);
        assert!(result.error.is_none());
        assert_eq!(result.logs[0], "line1\nline2\ttab\"quote");
    }
}
