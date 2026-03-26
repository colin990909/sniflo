use std::path::PathBuf;
use std::sync::Arc;

use rcgen::{
    BasicConstraints, CertificateParams, DistinguishedName, DnType, IsCa, KeyPair, KeyUsagePurpose,
};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CertStatus {
    pub has_ca: bool,
    pub is_installed: bool,
    pub ca_path: Option<String>,
}

pub struct CertState {
    pub storage_dir: PathBuf,
    pub has_ca: Arc<Mutex<bool>>,
    pub is_installed: Arc<Mutex<bool>>,
}

impl CertState {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let storage_dir = app_data_dir.join("certificates");
        let _ = std::fs::create_dir_all(&storage_dir);
        let has_ca = storage_dir.join("ca.crt").exists() && storage_dir.join("ca.key").exists();
        let is_installed = if has_ca {
            check_system_trust(&storage_dir.join("ca.crt"))
        } else {
            false
        };
        Self {
            storage_dir,
            has_ca: Arc::new(Mutex::new(has_ca)),
            is_installed: Arc::new(Mutex::new(is_installed)),
        }
    }

    /// Load CA certificate and key PEM material from disk.
    pub fn load_ca_material(&self) -> Result<(String, String), String> {
        let cert_pem = std::fs::read_to_string(self.storage_dir.join("ca.crt"))
            .map_err(|e| format!("Failed to read ca.crt: {e}"))?;
        let key_pem = std::fs::read_to_string(self.storage_dir.join("ca.key"))
            .map_err(|e| format!("Failed to read ca.key: {e}"))?;
        Ok((cert_pem, key_pem))
    }

    fn cert_path(&self) -> PathBuf {
        self.storage_dir.join("ca.crt")
    }

    fn key_path(&self) -> PathBuf {
        self.storage_dir.join("ca.key")
    }

    pub async fn refresh_status_from_disk(&self) -> CertStatus {
        let has_ca = self.cert_path().exists() && self.key_path().exists();
        *self.has_ca.lock().await = has_ca;

        let is_installed = if has_ca {
            check_system_trust(&self.cert_path())
        } else {
            false
        };
        *self.is_installed.lock().await = is_installed;

        CertStatus {
            has_ca,
            is_installed,
            ca_path: has_ca.then(|| self.cert_path().to_string_lossy().to_string()),
        }
    }
}

/// Check if the CA certificate is trusted by the system keychain.
fn check_system_trust(cert_path: &std::path::Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("/usr/bin/security")
            .args(["verify-cert", "-c", &cert_path.to_string_lossy()])
            .output();
        match output {
            Ok(o) => o.status.success(),
            Err(_) => false,
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = cert_path;
        false
    }
}

#[tauri::command]
pub async fn generate_ca(state: tauri::State<'_, CertState>) -> Result<CertStatus, String> {
    let mut params = CertificateParams::default();
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    let mut dn = DistinguishedName::new();
    dn.push(DnType::CommonName, "Sniflo CA");
    dn.push(DnType::OrganizationName, "Sniflo Dev");
    params.distinguished_name = dn;

    let key_pair = KeyPair::generate().map_err(|e| format!("Failed to generate key pair: {e}"))?;
    let ca_cert = params
        .self_signed(&key_pair)
        .map_err(|e| format!("Failed to self-sign CA: {e}"))?;

    let cert_pem = ca_cert.pem();
    let key_pem = key_pair.serialize_pem();

    let cert_path = state.cert_path();
    let key_path = state.key_path();

    std::fs::write(&cert_path, &cert_pem).map_err(|e| format!("Failed to write cert: {e}"))?;
    std::fs::write(&key_path, &key_pem).map_err(|e| format!("Failed to write key: {e}"))?;

    *state.has_ca.lock().await = true;
    // New CA is not yet installed
    *state.is_installed.lock().await = false;

    Ok(CertStatus {
        has_ca: true,
        is_installed: false,
        ca_path: Some(cert_path.to_string_lossy().to_string()),
    })
}

#[tauri::command]
pub async fn install_ca(state: tauri::State<'_, CertState>) -> Result<(), String> {
    let cert_path = state.cert_path();
    if !cert_path.exists() {
        return Err("CA certificate not generated".to_string());
    }

    // macOS: use security command to add trusted cert
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let keychain = format!("{home}/Library/Keychains/login.keychain-db");
        let output = std::process::Command::new("/usr/bin/security")
            .args([
                "add-trusted-cert",
                "-r",
                "trustRoot",
                "-k",
                &keychain,
                &cert_path.to_string_lossy(),
            ])
            .output()
            .map_err(|e| format!("Failed to run security: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "security command failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
    }

    // Verify trust and update state
    let trusted = check_system_trust(&cert_path);
    *state.is_installed.lock().await = trusted;

    if !trusted {
        return Err("Certificate was added but could not be verified as trusted".to_string());
    }

    Ok(())
}

#[tauri::command]
pub async fn get_cert_status(state: tauri::State<'_, CertState>) -> Result<CertStatus, String> {
    Ok(state.refresh_status_from_disk().await)
}

#[tauri::command]
pub fn show_cert_in_finder(state: tauri::State<'_, CertState>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("-R")
            .arg(state.storage_dir.join("ca.crt"))
            .spawn();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn refreshes_has_ca_from_disk_when_files_appear_after_startup() {
        let dir = tempfile::tempdir().unwrap();
        let state = CertState::new(dir.path().to_path_buf());

        assert!(!*state.has_ca.lock().await);

        let cert_dir = dir.path().join("certificates");
        std::fs::write(cert_dir.join("ca.crt"), "test cert").unwrap();
        std::fs::write(cert_dir.join("ca.key"), "test key").unwrap();

        let status = state.refresh_status_from_disk().await;
        assert!(
            status.has_ca,
            "expected certificate status to refresh from disk"
        );
        assert!(*state.has_ca.lock().await);
    }
}
