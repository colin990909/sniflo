use tokio::sync::Mutex;

// --- Saved Proxy Config (for save/restore on macOS) ---

#[derive(Clone, Debug, Default)]
pub struct ProxyEndpoint {
    pub enabled: bool,
    pub host: String,
    pub port: String,
}

#[derive(Clone, Debug)]
pub struct SavedProxyConfig {
    pub service: String,
    pub web: ProxyEndpoint,
    pub secure: ProxyEndpoint,
    pub socks: ProxyEndpoint,
}

/// Set macOS system HTTP/HTTPS proxy and disable SOCKS.
/// Saves current proxy config so we can restore on stop.
pub async fn set_system_proxy(host: &str, port: u16, saved: &Mutex<Option<SavedProxyConfig>>) {
    #[cfg(target_os = "macos")]
    {
        let service = active_network_service().unwrap_or_else(|| "Wi-Fi".to_string());

        // Save current HTTP/HTTPS/SOCKS proxy settings before overwriting
        let current = SavedProxyConfig {
            service: service.clone(),
            web: query_proxy_setting(&service, "-getwebproxy"),
            secure: query_proxy_setting(&service, "-getsecurewebproxy"),
            socks: query_proxy_setting(&service, "-getsocksfirewallproxy"),
        };
        eprintln!(
            "saving proxy config on {}: web={}:{} ({}), secure={}:{} ({}), socks={}:{} ({})",
            service,
            current.web.host,
            current.web.port,
            current.web.enabled,
            current.secure.host,
            current.secure.port,
            current.secure.enabled,
            current.socks.host,
            current.socks.port,
            current.socks.enabled,
        );
        *saved.lock().await = Some(current);

        let port_str = port.to_string();

        // Set HTTP proxy
        log_networksetup(&["-setwebproxy", &service, host, &port_str]);
        log_networksetup(&["-setwebproxystate", &service, "on"]);

        // Set HTTPS proxy
        log_networksetup(&["-setsecurewebproxy", &service, host, &port_str]);
        log_networksetup(&["-setsecurewebproxystate", &service, "on"]);

        // Disable SOCKS proxy to prevent it from intercepting traffic
        log_networksetup(&["-setsocksfirewallproxystate", &service, "off"]);

        eprintln!("system proxy set to {host}:{port} on {service} (SOCKS disabled)");
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (host, port, saved);
        eprintln!("system proxy configuration not implemented for this platform");
    }
}

/// Restore macOS system proxy from saved config.
pub async fn restore_system_proxy(saved: &Mutex<Option<SavedProxyConfig>>) {
    #[cfg(target_os = "macos")]
    {
        let config = saved.lock().await.take();
        let Some(config) = config else {
            eprintln!("no saved proxy config to restore");
            return;
        };

        let s = &config.service;
        eprintln!("restoring proxy config on {s}");

        // Restore HTTP proxy
        if config.web.enabled && !config.web.host.is_empty() {
            log_networksetup(&["-setwebproxy", s, &config.web.host, &config.web.port]);
            log_networksetup(&["-setwebproxystate", s, "on"]);
        } else {
            log_networksetup(&["-setwebproxystate", s, "off"]);
        }

        // Restore HTTPS proxy
        if config.secure.enabled && !config.secure.host.is_empty() {
            log_networksetup(&[
                "-setsecurewebproxy",
                s,
                &config.secure.host,
                &config.secure.port,
            ]);
            log_networksetup(&["-setsecurewebproxystate", s, "on"]);
        } else {
            log_networksetup(&["-setsecurewebproxystate", s, "off"]);
        }

        // Restore SOCKS proxy
        if config.socks.enabled && !config.socks.host.is_empty() {
            log_networksetup(&[
                "-setsocksfirewallproxy",
                s,
                &config.socks.host,
                &config.socks.port,
            ]);
            log_networksetup(&["-setsocksfirewallproxystate", s, "on"]);
        } else {
            log_networksetup(&["-setsocksfirewallproxystate", s, "off"]);
        }

        eprintln!("system proxy restored on {s}");
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = saved;
    }
}

// --- networksetup Helpers ---

/// Run a networksetup command and log the result.
#[cfg(target_os = "macos")]
fn log_networksetup(args: &[&str]) {
    match std::process::Command::new("/usr/sbin/networksetup")
        .args(args)
        .output()
    {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                eprintln!("networksetup {:?} failed: {stderr}", args);
            }
        }
        Err(e) => {
            eprintln!("networksetup {:?} exec error: {e}", args);
        }
    }
}

/// Query a proxy setting from networksetup.
/// Parses output lines: "Enabled: Yes/No", "Server: ...", "Port: ...".
#[cfg(target_os = "macos")]
fn query_proxy_setting(service: &str, flag: &str) -> ProxyEndpoint {
    let output = std::process::Command::new("/usr/sbin/networksetup")
        .args([flag, service])
        .output();
    let Ok(output) = output else {
        return ProxyEndpoint::default();
    };
    parse_proxy_output(&String::from_utf8_lossy(&output.stdout))
}

/// Parse networksetup proxy output into a ProxyEndpoint.
#[cfg(target_os = "macos")]
fn parse_proxy_output(output: &str) -> ProxyEndpoint {
    let mut endpoint = ProxyEndpoint::default();
    for line in output.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("Enabled:") {
            endpoint.enabled = val.trim().eq_ignore_ascii_case("yes");
        } else if let Some(val) = line.strip_prefix("Server:") {
            endpoint.host = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("Port:") {
            endpoint.port = val.trim().to_string();
        }
    }
    endpoint
}

/// Get the primary active network service name on macOS.
#[cfg(target_os = "macos")]
fn active_network_service() -> Option<String> {
    let output = std::process::Command::new("/usr/sbin/networksetup")
        .args(["-listallnetworkservices"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    // Skip the first line ("An asterisk (*) denotes...")
    for line in text.lines().skip(1) {
        let service = line.trim_start_matches('*').trim();
        if service.is_empty() || service.starts_with("An asterisk") {
            continue;
        }
        // Check if this service has a valid IP address (is active)
        let ip_output = std::process::Command::new("/usr/sbin/networksetup")
            .args(["-getinfo", service])
            .output()
            .ok()?;
        let info = String::from_utf8_lossy(&ip_output.stdout);
        // Check line-by-line to avoid false match on "IPv6 IP address: none"
        let has_ip = info.lines().any(|l| {
            let l = l.trim();
            l.starts_with("IP address:") && !l.ends_with("none")
        });
        if has_ip {
            return Some(service.to_string());
        }
    }
    None
}
