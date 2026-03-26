use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ai::tools::ToolOutput;
use crate::ai::types::ToolDefinition;
use crate::storage::db::Database;

/// Metadata from a skill's manifest.json.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SkillManifest {
    pub name: String,
    pub version: String,
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub tools: Vec<SkillToolDef>,
}

/// A tool definition within a skill manifest.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SkillToolDef {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    #[serde(default)]
    pub handler: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct SkillFrontmatter {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    author: String,
    #[serde(default)]
    tools: Vec<SkillToolDef>,
}

/// A loaded skill with its manifest and system prompt.
#[allow(dead_code)]
pub struct LoadedSkill {
    pub manifest: SkillManifest,
    pub system_prompt: String,
    pub base_dir: PathBuf,
}

#[derive(Clone, Debug)]
pub struct ResolvedSkillTool {
    pub base_dir: PathBuf,
    pub handler: String,
}

/// Summary for frontend display.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSummary {
    pub name: String,
    pub version: String,
    pub description: String,
    pub tool_count: i32,
}

/// Manages skill package loading, installation, and uninstallation.
pub struct SkillManager {
    skills_dir: PathBuf,
    loaded_skills: Vec<LoadedSkill>,
}

#[allow(dead_code)]
impl SkillManager {
    pub fn new(skills_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&skills_dir);
        Self {
            skills_dir,
            loaded_skills: Vec::new(),
        }
    }

    /// Load all installed skills from the skills directory.
    pub fn load_all(&mut self) -> Result<(), String> {
        self.loaded_skills.clear();

        let entries = std::fs::read_dir(&self.skills_dir)
            .map_err(|e| format!("Failed to read skills dir: {e}"))?;

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            match self.load_skill_from_dir(&path) {
                Ok(skill) => {
                    eprintln!(
                        "[skill] Loaded: {} v{}",
                        skill.manifest.name, skill.manifest.version
                    );
                    self.loaded_skills.push(skill);
                }
                Err(e) => {
                    eprintln!("[skill] Failed to load {}: {e}", path.display());
                }
            }
        }

        Ok(())
    }

    /// Load a single skill from a directory.
    fn load_skill_from_dir(&self, dir: &Path) -> Result<LoadedSkill, String> {
        let skill_md_path = dir.join("SKILL.md");
        let (frontmatter, system_prompt) = if skill_md_path.exists() {
            let skill_md = std::fs::read_to_string(&skill_md_path)
                .map_err(|e| format!("Cannot read SKILL.md: {e}"))?;
            parse_skill_markdown(&skill_md)?
        } else {
            (None, String::new())
        };

        let fallback_manifest = load_manifest_json(dir)?;
        let manifest = resolve_skill_manifest(frontmatter, fallback_manifest, dir)?;

        Ok(LoadedSkill {
            manifest,
            system_prompt,
            base_dir: dir.to_path_buf(),
        })
    }

    /// Install a skill from a source directory by copying it into skills_dir.
    pub fn install(&mut self, source: &Path, _db: &Database) -> Result<SkillSummary, String> {
        // Load and validate the source
        let skill = self.load_skill_from_dir(source)?;
        let dest = self.skills_dir.join(&skill.manifest.name);

        // Copy the directory
        if dest.exists() {
            std::fs::remove_dir_all(&dest)
                .map_err(|e| format!("Failed to remove existing skill: {e}"))?;
        }
        copy_dir_recursive(source, &dest)?;

        let summary = SkillSummary {
            name: skill.manifest.name.clone(),
            version: skill.manifest.version.clone(),
            description: skill.manifest.description.clone(),
            tool_count: skill.manifest.tools.len() as i32,
        };

        self.load_all()?;

        Ok(summary)
    }

    /// Uninstall a skill by name.
    pub fn uninstall(&mut self, name: &str, _db: &Database) -> Result<(), String> {
        let dir = self.skills_dir.join(name);
        if dir.exists() {
            std::fs::remove_dir_all(&dir)
                .map_err(|e| format!("Failed to remove skill directory: {e}"))?;
        }

        self.load_all()?;
        Ok(())
    }

    /// Get a loaded skill by name.
    pub fn get_skill(&self, name: &str) -> Option<&LoadedSkill> {
        self.loaded_skills.iter().find(|s| s.manifest.name == name)
    }

    /// Get tool definitions from a specific skill.
    pub fn get_tool_definitions(&self, skill_name: &str) -> Vec<ToolDefinition> {
        self.get_skill(skill_name)
            .map(|s| {
                s.manifest
                    .tools
                    .iter()
                    .map(|t| ToolDefinition {
                        name: t.name.clone(),
                        description: t.description.clone(),
                        input_schema: t.input_schema.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get the system prompt from a skill.
    pub fn get_system_prompt(&self, skill_name: &str) -> Option<String> {
        self.get_skill(skill_name).map(|s| s.system_prompt.clone())
    }

    pub fn resolve_tool_execution(
        &self,
        skill_name: &str,
        tool_name: &str,
    ) -> Option<ResolvedSkillTool> {
        let skill = self.get_skill(skill_name)?;
        let tool = skill
            .manifest
            .tools
            .iter()
            .find(|tool| tool.name == tool_name && !tool.handler.trim().is_empty())?;

        Some(ResolvedSkillTool {
            base_dir: skill.base_dir.clone(),
            handler: tool.handler.clone(),
        })
    }

    /// List all loaded skills as summaries.
    pub fn list_summaries(&self) -> Vec<SkillSummary> {
        self.loaded_skills
            .iter()
            .map(|s| SkillSummary {
                name: s.manifest.name.clone(),
                version: s.manifest.version.clone(),
                description: s.manifest.description.clone(),
                tool_count: s.manifest.tools.len() as i32,
            })
            .collect()
    }

    /// Execute a script-based tool handler.
    pub async fn execute_script_tool(
        &self,
        skill_name: &str,
        handler_path: &str,
        input: Value,
    ) -> ToolOutput {
        let Some(skill) = self.get_skill(skill_name) else {
            return ToolOutput {
                content: format!("Skill not found: {skill_name}"),
                is_error: true,
            };
        };

        execute_script_tool_at(&skill.base_dir, handler_path, input).await
    }

    pub async fn execute_tool(
        &self,
        skill_name: &str,
        tool_name: &str,
        input: Value,
    ) -> ToolOutput {
        let Some(resolved) = self.resolve_tool_execution(skill_name, tool_name) else {
            return ToolOutput {
                content: format!("Unknown tool: {tool_name}"),
                is_error: true,
            };
        };

        execute_script_tool_at(&resolved.base_dir, &resolved.handler, input).await
    }
}

pub async fn execute_resolved_tool(resolved: &ResolvedSkillTool, input: Value) -> ToolOutput {
    execute_script_tool_at(&resolved.base_dir, &resolved.handler, input).await
}

async fn execute_script_tool_at(base_dir: &Path, handler_path: &str, input: Value) -> ToolOutput {
    let script_path = base_dir.join(handler_path);
    if !script_path.exists() {
        return ToolOutput {
            content: format!("Script not found: {}", script_path.display()),
            is_error: true,
        };
    }

    let input_json = serde_json::to_string(&input).unwrap_or_default();

    // Execute with timeout and sandboxing
    let result = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        let mut child = tokio::process::Command::new(&script_path)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .current_dir(base_dir)
            .env_clear()
            .env("PATH", "/usr/local/bin:/usr/bin:/bin")
            .kill_on_drop(true)
            .spawn()?;

        // Write input JSON to stdin
        if let Some(mut stdin) = child.stdin.take() {
            use tokio::io::AsyncWriteExt;
            let _ = stdin.write_all(input_json.as_bytes()).await;
            // Drop stdin to signal EOF
        }

        child.wait_with_output().await
    })
    .await;

    match result {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            if output.status.success() {
                ToolOutput {
                    content: stdout,
                    is_error: false,
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                ToolOutput {
                    content: format!("Script failed: {stderr}"),
                    is_error: true,
                }
            }
        }
        Ok(Err(e)) => ToolOutput {
            content: format!("Failed to execute script: {e}"),
            is_error: true,
        },
        Err(_) => ToolOutput {
            content: "Script execution timed out (30s)".to_string(),
            is_error: true,
        },
    }
}

fn load_manifest_json(dir: &Path) -> Result<Option<SkillManifest>, String> {
    let manifest_path = dir.join("manifest.json");
    if !manifest_path.exists() {
        return Ok(None);
    }

    let manifest_str = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Cannot read manifest.json: {e}"))?;
    let manifest: SkillManifest =
        serde_json::from_str(&manifest_str).map_err(|e| format!("Invalid manifest.json: {e}"))?;
    Ok(Some(manifest))
}

fn parse_skill_markdown(content: &str) -> Result<(Option<SkillFrontmatter>, String), String> {
    let normalized = content.replace("\r\n", "\n");
    if !normalized.starts_with("---\n") {
        return Ok((None, normalized));
    }

    let rest = &normalized[4..];
    let Some(end_idx) = rest.find("\n---\n") else {
        return Ok((None, normalized));
    };

    let frontmatter_str = &rest[..end_idx];
    let body = rest[end_idx + 5..].trim_start_matches('\n').to_string();
    let frontmatter: SkillFrontmatter = serde_yaml::from_str(frontmatter_str)
        .map_err(|e| format!("Invalid SKILL.md frontmatter: {e}"))?;

    Ok((Some(frontmatter), body))
}

fn resolve_skill_manifest(
    frontmatter: Option<SkillFrontmatter>,
    fallback_manifest: Option<SkillManifest>,
    dir: &Path,
) -> Result<SkillManifest, String> {
    if let Some(frontmatter) = frontmatter {
        let fallback_name = fallback_manifest.as_ref().map(|m| m.name.clone());
        let fallback_version = fallback_manifest.as_ref().map(|m| m.version.clone());
        let fallback_description = fallback_manifest.as_ref().map(|m| m.description.clone());
        let fallback_author = fallback_manifest.as_ref().map(|m| m.author.clone());
        let fallback_tools = fallback_manifest.map(|m| m.tools).unwrap_or_default();

        let name = frontmatter
            .name
            .or(fallback_name)
            .or_else(|| {
                dir.file_name()
                    .map(|value| value.to_string_lossy().to_string())
            })
            .unwrap_or_default();
        if name.trim().is_empty() {
            return Err("Skill metadata is missing a name".to_string());
        }

        let version = frontmatter
            .version
            .or(fallback_version)
            .unwrap_or_else(|| "0.1.0".to_string());
        let description = frontmatter
            .description
            .or(fallback_description)
            .unwrap_or_default();
        let author = if frontmatter.author.trim().is_empty() {
            fallback_author.unwrap_or_default()
        } else {
            frontmatter.author
        };
        let tools = if frontmatter.tools.is_empty() {
            fallback_tools
        } else {
            frontmatter.tools
        };

        return Ok(SkillManifest {
            name,
            version,
            description,
            author,
            tools,
        });
    }

    fallback_manifest.ok_or_else(|| {
        "Skill package must include SKILL.md frontmatter or a compatible manifest.json".to_string()
    })
}

/// Recursively copy a directory.
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("mkdir failed: {e}"))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("readdir failed: {e}"))? {
        let entry = entry.map_err(|e| format!("entry error: {e}"))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path).map_err(|e| format!("copy failed: {e}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    use serde_json::json;
    use tempfile::TempDir;

    use crate::storage::db::Database;

    fn write_skill_package(dir: &Path, body: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("SKILL.md"), body).unwrap();
    }

    fn test_db() -> (TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(dir.path()).unwrap();
        (dir, db)
    }

    #[test]
    fn loads_skillhub_metadata_from_skill_md_frontmatter() {
        let root = tempfile::tempdir().unwrap();
        let skill_dir = root.path().join("traffic-inspector");
        write_skill_package(
            &skill_dir,
            r#"---
name: traffic-inspector
description: Inspect captured traffic patterns
version: 1.2.3
tools:
  - name: inspect_traffic
    description: Summarize request traffic
    input_schema:
      type: object
      properties:
        host:
          type: string
    handler: tools/inspect.sh
---
# Traffic Inspector

Focus on repeated request patterns.
"#,
        );

        let manager = SkillManager::new(root.path().join("installed"));
        let skill = manager
            .load_skill_from_dir(&skill_dir)
            .expect("skill should load from SKILL.md only");

        assert_eq!(skill.manifest.name, "traffic-inspector");
        assert_eq!(skill.manifest.version, "1.2.3");
        assert_eq!(
            skill.manifest.description,
            "Inspect captured traffic patterns"
        );
        assert_eq!(skill.manifest.tools.len(), 1);
        assert_eq!(skill.manifest.tools[0].name, "inspect_traffic");
        assert_eq!(skill.manifest.tools[0].handler, "tools/inspect.sh");
        assert!(
            skill.system_prompt.starts_with("# Traffic Inspector"),
            "expected system prompt without frontmatter, got: {}",
            skill.system_prompt
        );
    }

    #[test]
    fn installs_skill_from_skill_md_only_package() {
        let source_root = tempfile::tempdir().unwrap();
        let source_dir = source_root.path().join("request-rewriter");
        write_skill_package(
            &source_dir,
            r#"---
name: request-rewriter
description: Rewrite request fields during investigation
version: 0.4.0
---
# Request Rewriter
"#,
        );

        let skills_root = tempfile::tempdir().unwrap();
        let (_db_dir, db) = test_db();
        let mut manager = SkillManager::new(skills_root.path().to_path_buf());

        let summary = manager
            .install(&source_dir, &db)
            .expect("install should accept SKILL.md-only package");

        assert_eq!(summary.name, "request-rewriter");
        assert_eq!(summary.version, "0.4.0");
        assert_eq!(manager.list_summaries().len(), 1);
        assert!(
            skills_root
                .path()
                .join("request-rewriter")
                .join("SKILL.md")
                .exists()
        );
    }

    #[tokio::test]
    async fn executes_script_tool_declared_in_skill_md_frontmatter() {
        let skills_root = tempfile::tempdir().unwrap();
        let skill_dir = skills_root.path().join("echo-skill");
        write_skill_package(
            &skill_dir,
            r#"---
name: echo-skill
description: Echoes structured input
version: 1.0.0
tools:
  - name: echo_payload
    description: Echo JSON payload
    input_schema:
      type: object
    handler: tools/echo.sh
---
# Echo Skill
"#,
        );

        let tools_dir = skill_dir.join("tools");
        fs::create_dir_all(&tools_dir).unwrap();
        let script_path = tools_dir.join("echo.sh");
        fs::write(&script_path, "#!/bin/sh\ncat\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&script_path).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&script_path, perms).unwrap();
        }

        let mut manager = SkillManager::new(skills_root.path().to_path_buf());
        manager.load_all().unwrap();
        let tool_defs = manager.get_tool_definitions("echo-skill");
        assert_eq!(tool_defs.len(), 1);

        let output = manager
            .execute_script_tool("echo-skill", "tools/echo.sh", json!({ "value": "ok" }))
            .await;

        assert!(
            !output.is_error,
            "unexpected tool error: {}",
            output.content
        );
        assert_eq!(output.content.trim(), r#"{"value":"ok"}"#);
    }
}
