pub mod breakpoint_tools;
pub mod cert_tools;
pub mod export_tools;
pub mod proxy_tools;
pub mod script_tools;
pub mod selected_sessions_tool;
pub mod session_tools;

use async_trait::async_trait;
use serde_json::Value;

use super::types::ToolDefinition;

/// Output from executing a tool.
pub struct ToolOutput {
    pub content: String,
    pub is_error: bool,
}

/// Trait for a callable tool.
#[async_trait]
pub trait Tool: Send + Sync {
    fn definition(&self) -> ToolDefinition;
    async fn execute(&self, input: Value) -> ToolOutput;
}

/// Registry holding all available tools (builtin + skill-provided).
pub struct ToolRegistry {
    tools: Vec<Box<dyn Tool>>,
    /// Extra definitions from skills (visible to AI but not executable).
    extra_definitions: Vec<ToolDefinition>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: Vec::new(),
            extra_definitions: Vec::new(),
        }
    }

    pub fn register(&mut self, tool: Box<dyn Tool>) {
        self.tools.push(tool);
    }

    /// Register a tool definition only (no executor). Used for skill-defined
    /// tools that are prompt-only or map to builtins by a different name.
    pub fn register_definition_only(&mut self, def: ToolDefinition) {
        self.extra_definitions.push(def);
    }

    /// Check if a tool with the given name is already registered.
    pub fn has_tool(&self, name: &str) -> bool {
        self.tools.iter().any(|t| t.definition().name == name)
            || self.extra_definitions.iter().any(|d| d.name == name)
    }

    pub fn list_definitions(&self) -> Vec<ToolDefinition> {
        let mut defs: Vec<ToolDefinition> = self.tools.iter().map(|t| t.definition()).collect();
        defs.extend(self.extra_definitions.iter().cloned());
        defs
    }

    pub async fn execute(&self, name: &str, input: Value) -> Option<ToolOutput> {
        for tool in &self.tools {
            if tool.definition().name == name {
                return Some(tool.execute(input).await);
            }
        }
        None
    }
}
