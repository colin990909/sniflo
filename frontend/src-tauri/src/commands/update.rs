use serde::Serialize;

/// GitHub owner/repo for update checks.
const GITHUB_OWNER: &str = "colin990909";
const GITHUB_REPO: &str = "sniflo";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    pub tag_name: String,
    pub name: String,
    pub body: String,
    pub html_url: String,
    pub published_at: String,
}

#[tauri::command]
pub async fn check_for_update() -> Result<ReleaseInfo, String> {
    let url = format!(
        "https://api.github.com/repos/{}/{}/releases/latest",
        GITHUB_OWNER, GITHUB_REPO
    );

    let client = reqwest::Client::builder()
        .user_agent(concat!("Sniflo/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("No releases found".to_string());
    }

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned status {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    Ok(ReleaseInfo {
        tag_name: json["tag_name"].as_str().unwrap_or_default().to_string(),
        name: json["name"].as_str().unwrap_or_default().to_string(),
        body: json["body"].as_str().unwrap_or_default().to_string(),
        html_url: json["html_url"].as_str().unwrap_or_default().to_string(),
        published_at: json["published_at"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
    })
}
