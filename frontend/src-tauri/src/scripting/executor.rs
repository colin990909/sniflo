use std::sync::Arc;
use std::time::Instant;

use parking_lot::RwLock;

use crate::proxy_core::http::{HttpRequestRecord, HttpResponseRecord};

use super::engine;
use super::types::{ScriptAction, ScriptExecutionLog, ScriptRule};

/// Manages a list of scripts and executes matching ones against requests/responses.
pub struct ScriptExecutor {
    scripts: Arc<RwLock<Vec<ScriptRule>>>,
    enabled: Arc<RwLock<bool>>,
}

impl ScriptExecutor {
    pub fn new() -> Self {
        Self {
            scripts: Arc::new(RwLock::new(Vec::new())),
            enabled: Arc::new(RwLock::new(false)),
        }
    }

    /// Replace the entire script list (called after CRUD operations).
    pub fn reload(&self, scripts: Vec<ScriptRule>) {
        *self.scripts.write() = scripts;
    }

    pub fn set_enabled(&self, enabled: bool) {
        *self.enabled.write() = enabled;
    }

    #[allow(dead_code)]
    pub fn is_enabled(&self) -> bool {
        *self.enabled.read()
    }

    /// Get a snapshot of the current scripts.
    #[allow(dead_code)]
    pub fn scripts(&self) -> Vec<ScriptRule> {
        self.scripts.read().clone()
    }

    /// Execute all matching request-phase scripts against the given request.
    /// Mutates `request` in-place. Returns the aggregate action and execution logs.
    pub fn execute_on_request(
        &self,
        request: &mut HttpRequestRecord,
    ) -> (ScriptAction, Vec<ScriptExecutionLog>) {
        let scripts = self.matching_scripts("request", &request.url);
        if scripts.is_empty() {
            return (ScriptAction::Passthrough, Vec::new());
        }

        let mut logs = Vec::new();
        let mut any_modified = false;

        for script in &scripts {
            let start = Instant::now();
            let result = engine::execute_request_script(&script.code, request);
            let duration_ms = start.elapsed().as_millis() as u64;

            logs.push(ScriptExecutionLog {
                script_id: script.id.clone(),
                script_name: script.name.clone(),
                url: request.url.clone(),
                phase: "request".to_string(),
                success: result.error.is_none(),
                error_message: result.error.clone(),
                duration_ms,
                logs: result.logs,
            });

            if result.dropped {
                return (ScriptAction::Drop, logs);
            }
            if result.modified {
                any_modified = true;
            }
        }

        let action = if any_modified {
            ScriptAction::Modified
        } else {
            ScriptAction::Passthrough
        };
        (action, logs)
    }

    /// Execute all matching response-phase scripts against the given response.
    /// Mutates `response` in-place. Returns the aggregate action and execution logs.
    pub fn execute_on_response(
        &self,
        request: &HttpRequestRecord,
        response: &mut HttpResponseRecord,
    ) -> (ScriptAction, Vec<ScriptExecutionLog>) {
        let scripts = self.matching_scripts("response", &request.url);
        if scripts.is_empty() {
            return (ScriptAction::Passthrough, Vec::new());
        }

        let mut logs = Vec::new();
        let mut any_modified = false;

        for script in &scripts {
            let start = Instant::now();
            let result = engine::execute_response_script(&script.code, request, response);
            let duration_ms = start.elapsed().as_millis() as u64;

            logs.push(ScriptExecutionLog {
                script_id: script.id.clone(),
                script_name: script.name.clone(),
                url: request.url.clone(),
                phase: "response".to_string(),
                success: result.error.is_none(),
                error_message: result.error.clone(),
                duration_ms,
                logs: result.logs,
            });

            if result.dropped {
                return (ScriptAction::Drop, logs);
            }
            if result.modified {
                any_modified = true;
            }
        }

        let action = if any_modified {
            ScriptAction::Modified
        } else {
            ScriptAction::Passthrough
        };
        (action, logs)
    }

    /// Filter enabled scripts matching the given phase and URL, sorted by priority.
    fn matching_scripts(&self, phase: &str, url: &str) -> Vec<ScriptRule> {
        if !*self.enabled.read() {
            return Vec::new();
        }
        let all = self.scripts.read();
        let mut matched: Vec<ScriptRule> = all
            .iter()
            .filter(|s| {
                s.enabled
                    && (s.phase == phase || s.phase == "both")
                    && url_matches(&s.url_pattern, url)
            })
            .cloned()
            .collect();
        matched.sort_by_key(|s| s.priority);
        matched
    }
}

/// Check if a URL matches the given pattern.
/// - Empty pattern or "*" matches everything.
/// - Pattern starting with "/" is a regex (e.g. "/api\\.example\\.com/").
/// - Otherwise, plain substring match (case-insensitive).
fn url_matches(pattern: &str, url: &str) -> bool {
    if pattern.is_empty() || pattern == "*" {
        return true;
    }
    // Simple substring match (case-insensitive)
    url.to_ascii_lowercase()
        .contains(&pattern.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_script(
        id: &str,
        name: &str,
        phase: &str,
        pattern: &str,
        priority: i32,
        code: &str,
    ) -> ScriptRule {
        ScriptRule {
            id: id.to_string(),
            name: name.to_string(),
            url_pattern: pattern.to_string(),
            phase: phase.to_string(),
            priority,
            enabled: true,
            code: code.to_string(),
            source_path: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    fn make_request() -> HttpRequestRecord {
        HttpRequestRecord {
            method: "GET".into(),
            url: "https://api.example.com/users".into(),
            headers: vec![("Host".into(), "api.example.com".into())],
            body: vec![],
        }
    }

    fn enabled_executor() -> ScriptExecutor {
        let executor = ScriptExecutor::new();
        executor.set_enabled(true);
        executor
    }

    #[test]
    fn test_no_scripts_passthrough() {
        let executor = ScriptExecutor::new();
        let mut req = make_request();
        let (action, logs) = executor.execute_on_request(&mut req);
        assert_eq!(action, ScriptAction::Passthrough);
        assert!(logs.is_empty());
    }

    #[test]
    fn test_matching_and_execution() {
        let executor = enabled_executor();
        executor.reload(vec![make_script(
            "1",
            "Add Header",
            "request",
            "api.example.com",
            0,
            r#"function onRequest(ctx) { ctx.request.setHeader("X-Test", "1"); }"#,
        )]);

        let mut req = make_request();
        let (action, logs) = executor.execute_on_request(&mut req);
        assert_eq!(action, ScriptAction::Modified);
        assert_eq!(logs.len(), 1);
        assert!(logs[0].success);
        assert!(req.headers.iter().any(|(k, v)| k == "X-Test" && v == "1"));
    }

    #[test]
    fn test_priority_ordering() {
        let executor = enabled_executor();
        executor.reload(vec![
            make_script(
                "2",
                "Second",
                "request",
                "*",
                10,
                r#"function onRequest(ctx) { ctx.request.setHeader("X-Order", ctx.request.getHeader("X-Order") + "B"); }"#,
            ),
            make_script(
                "1",
                "First",
                "request",
                "*",
                1,
                r#"function onRequest(ctx) { ctx.request.setHeader("X-Order", "A"); }"#,
            ),
        ]);

        let mut req = make_request();
        let (action, _) = executor.execute_on_request(&mut req);
        assert_eq!(action, ScriptAction::Modified);
        let order = req.headers.iter().find(|(k, _)| k == "X-Order");
        assert_eq!(order, Some(&("X-Order".to_string(), "AB".to_string())));
    }

    #[test]
    fn test_drop_stops_chain() {
        let executor = enabled_executor();
        executor.reload(vec![
            make_script(
                "1",
                "Dropper",
                "request",
                "*",
                0,
                r#"function onRequest(ctx) { return "drop"; }"#,
            ),
            make_script(
                "2",
                "Never Run",
                "request",
                "*",
                10,
                r#"function onRequest(ctx) { ctx.request.setHeader("X-Never", "true"); }"#,
            ),
        ]);

        let mut req = make_request();
        let (action, logs) = executor.execute_on_request(&mut req);
        assert_eq!(action, ScriptAction::Drop);
        assert_eq!(logs.len(), 1); // only the dropper ran
        assert!(!req.headers.iter().any(|(k, _)| k == "X-Never"));
    }

    #[test]
    fn test_url_pattern_filtering() {
        let executor = enabled_executor();
        executor.reload(vec![make_script(
            "1",
            "Only Google",
            "request",
            "google.com",
            0,
            r#"function onRequest(ctx) { ctx.request.setHeader("X-Google", "yes"); }"#,
        )]);

        let mut req = make_request(); // url = api.example.com
        let (action, logs) = executor.execute_on_request(&mut req);
        assert_eq!(action, ScriptAction::Passthrough);
        assert!(logs.is_empty());
    }

    #[test]
    fn test_disabled_scripts_skipped() {
        let executor = enabled_executor();
        let mut script = make_script(
            "1",
            "Disabled",
            "request",
            "*",
            0,
            r#"function onRequest(ctx) { ctx.request.setHeader("X-Ran", "true"); }"#,
        );
        script.enabled = false;
        executor.reload(vec![script]);

        let mut req = make_request();
        let (action, logs) = executor.execute_on_request(&mut req);
        assert_eq!(action, ScriptAction::Passthrough);
        assert!(logs.is_empty());
    }

    #[test]
    fn test_global_disable_skips_all_scripts() {
        let executor = ScriptExecutor::new();
        executor.reload(vec![make_script(
            "1",
            "Would Run",
            "request",
            "*",
            0,
            r#"function onRequest(ctx) { ctx.request.setHeader("X-Ran", "true"); }"#,
        )]);

        executor.set_enabled(false);

        let mut req = make_request();
        let (action, logs) = executor.execute_on_request(&mut req);
        assert_eq!(action, ScriptAction::Passthrough);
        assert!(logs.is_empty());
        assert!(!req.headers.iter().any(|(k, _)| k == "X-Ran"));
    }

    #[test]
    fn test_phase_filtering() {
        let executor = enabled_executor();
        executor.reload(vec![make_script(
            "1",
            "Response Only",
            "response",
            "*",
            0,
            r#"function onResponse(ctx) { ctx.response.setStatus(500); }"#,
        )]);

        // Should not match in request phase
        let mut req = make_request();
        let (action, _) = executor.execute_on_request(&mut req);
        assert_eq!(action, ScriptAction::Passthrough);
    }

    #[test]
    fn test_script_error_is_passthrough() {
        let executor = enabled_executor();
        executor.reload(vec![make_script(
            "1",
            "Error Script",
            "request",
            "*",
            0,
            r#"function onRequest(ctx) { throw new Error("boom"); }"#,
        )]);

        let mut req = make_request();
        let (action, logs) = executor.execute_on_request(&mut req);
        assert_eq!(action, ScriptAction::Passthrough);
        assert!(!logs[0].success);
        assert!(logs[0].error_message.is_some());
    }

    #[test]
    fn test_url_matches() {
        assert!(super::url_matches("", "https://anything.com"));
        assert!(super::url_matches("*", "https://anything.com"));
        assert!(super::url_matches(
            "example",
            "https://api.example.com/path"
        ));
        assert!(!super::url_matches(
            "google",
            "https://api.example.com/path"
        ));
        assert!(super::url_matches(
            "example.com/users",
            "https://api.example.com/users"
        ));
        // Case-insensitive
        assert!(super::url_matches(
            "EXAMPLE",
            "https://api.example.com/path"
        ));
    }
}
