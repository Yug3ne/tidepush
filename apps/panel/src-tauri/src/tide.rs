//! Everything the panel does goes through the `tidepush` CLI (or `npx expo-updates`
//! for the runtime version), run in the app's directory with the credentials from
//! the Tidepush `.env`. The panel only adds buttons; the CLI does the work.

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

pub type Res<T> = Result<T, String>;

/// This repo's root (apps/panel/src-tauri → ../../..), fixed at build time.
const REPO_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../..");

/// Directories never worth descending into when looking for Expo apps.
const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", "vendor", "dist", "build", "venv", "__pycache__", "android", "ios", "Pods",
];
const DISCOVER_DEPTH: usize = 5;

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

fn repo_root() -> PathBuf {
    let p = PathBuf::from(REPO_ROOT);
    p.canonicalize().unwrap_or(p)
}

// ---------------------------------------------------------------- settings

/// The `.env` holding TIDEPUSH_SERVER_URL / TIDEPUSH_TOKEN: `$TIDEPANEL_ENV`, else this repo's `.env`.
pub fn env_file() -> PathBuf {
    std::env::var_os("TIDEPANEL_ENV").map(PathBuf::from).unwrap_or_else(|| repo_root().join(".env"))
}

/// KEY=VALUE lines of a dotenv file (comments, `export ` and quotes handled).
fn read_env_file(path: &Path) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Ok(text) = std::fs::read_to_string(path) else { return out };
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((k, v)) = line.split_once('=') else { continue };
        let mut v = v.trim();
        if v.len() >= 2 && ((v.starts_with('"') && v.ends_with('"')) || (v.starts_with('\'') && v.ends_with('\''))) {
            v = &v[1..v.len() - 1];
        }
        out.insert(k.trim().to_string(), v.to_string());
    }
    out
}

/// PATH as the user's interactive shell sets it (nvm, bun, mise…), since a panel
/// started from the app launcher doesn't get it. Computed once.
fn shell_path() -> &'static str {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        let base = std::env::var("PATH").unwrap_or_default();
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        let from_shell = Command::new(&shell)
            .args(["-ic", "printf '__TP__%s__TP__' \"$PATH\""])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()
            .and_then(|o| {
                let s = String::from_utf8_lossy(&o.stdout).into_owned();
                let start = s.find("__TP__")? + 6;
                let end = s[start..].find("__TP__")? + start;
                Some(s[start..end].to_string())
            })
            .unwrap_or_default();
        let h = home();
        let extra = [h.join(".bun/bin"), h.join(".local/bin")];
        let mut parts: Vec<String> = Vec::new();
        for p in from_shell.split(':').chain(base.split(':')) {
            if !p.is_empty() && !parts.iter().any(|x| x == p) {
                parts.push(p.to_string());
            }
        }
        for p in extra {
            let p = p.to_string_lossy().into_owned();
            if !parts.contains(&p) {
                parts.push(p);
            }
        }
        parts.join(":")
    })
}

/// How the CLI is started: `$TIDEPANEL_CLI` (a command line), this repo's CLI
/// source under bun, or `npx -y tidepush`.
fn cli_command() -> Vec<String> {
    if let Ok(cmd) = std::env::var("TIDEPANEL_CLI") {
        let parts: Vec<String> = cmd.split_whitespace().map(String::from).collect();
        if !parts.is_empty() {
            return parts;
        }
    }
    let src = repo_root().join("packages/cli/src/index.ts");
    if src.exists() {
        return vec!["bun".into(), src.to_string_lossy().into_owned()];
    }
    vec!["npx".into(), "-y".into(), "tidepush".into()]
}

#[derive(Serialize, Clone)]
pub struct Settings {
    env_file: String,
    env_found: bool,
    server: String,
    /// "token" (from the env file), "login" (`tidepush login`) or "none".
    auth: String,
    cli: String,
}

pub fn settings() -> Settings {
    let file = env_file();
    let vars = read_env_file(&file);
    let has_token = vars.contains_key("TIDEPUSH_TOKEN") || vars.contains_key("TIDEPUSH_API_TOKEN");
    let login = home().join(".config/tidepush/credentials.json").exists();
    Settings {
        env_file: file.to_string_lossy().into_owned(),
        env_found: file.exists(),
        server: vars.get("TIDEPUSH_SERVER_URL").cloned().unwrap_or_else(|| "hosted (default)".into()),
        auth: if has_token { "token" } else if login { "login" } else { "none" }.into(),
        cli: cli_command().join(" "),
    }
}

/// A command run in the app dir with the Tidepush env applied.
pub fn command(app_dir: &str, program: &str, args: &[String], channel: Option<&str>) -> Command {
    let mut cmd = Command::new(program);
    cmd.args(args).current_dir(app_dir).stdin(Stdio::null()).env("PATH", shell_path());
    for (k, v) in read_env_file(&env_file()) {
        cmd.env(k, v);
    }
    // The panel always says which app; a TIDEPUSH_APP_DIR in .env would point elsewhere.
    cmd.env_remove("TIDEPUSH_APP_DIR");
    cmd.env("CI", "1").env("NO_COLOR", "1").env("FORCE_COLOR", "0");
    if let Some(c) = channel {
        cmd.env("TIDEPUSH_CHANNEL", c);
    }
    cmd
}

/// The CLI with `args`, plus `--app-dir <app>`.
pub fn cli(app_dir: &str, args: &[String]) -> Command {
    let base = cli_command();
    let mut all: Vec<String> = base[1..].to_vec();
    all.extend(args.iter().cloned());
    all.push("--app-dir".into());
    all.push(app_dir.into());
    let channel = args.iter().position(|a| a == "--channel").and_then(|i| args.get(i + 1)).map(String::as_str);
    command(app_dir, &base[0], &all, channel)
}

fn output(mut cmd: Command) -> Res<String> {
    let out = cmd.stderr(Stdio::piped()).stdout(Stdio::piped()).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let msg = if err.is_empty() { String::from_utf8_lossy(&out.stdout).trim().to_string() } else { err };
        Err(if msg.is_empty() { format!("exited with {}", out.status) } else { msg })
    }
}

/// The JSON value starting at the first `start` char (npx may print notices first).
fn json_from(stdout: &str, start: char) -> Res<serde_json::Value> {
    let i = stdout.find(start).ok_or_else(|| format!("Expected JSON, got: {}", stdout.trim()))?;
    serde_json::from_str(&stdout[i..]).map_err(|e| format!("Bad JSON from the CLI: {e}"))
}

pub fn list_updates(app_dir: &str, limit: u32) -> Res<serde_json::Value> {
    let out = output(cli(app_dir, &["list".into(), "--json".into(), "--limit".into(), limit.to_string()]))?;
    if out.trim() == "No updates." {
        return Ok(serde_json::Value::Array(vec![]));
    }
    json_from(&out, '[')
}

pub fn runtime_version(app_dir: &str, platform: &str, channel: &str) -> Res<String> {
    let args: Vec<String> =
        ["expo-updates", "runtimeversion:resolve", "--platform", platform].iter().map(|s| s.to_string()).collect();
    let v = json_from(&output(command(app_dir, "npx", &args, Some(channel)))?, '{')?;
    v.get("runtimeVersion")
        .and_then(|r| r.as_str())
        .map(String::from)
        .ok_or_else(|| format!("No runtime version for {platform}"))
}

// ---------------------------------------------------------------- the app

#[derive(Serialize, Clone)]
pub struct AppInfo {
    dir: String,
    name: String,
    branch: String,
    sha: String,
    dirty: bool,
    subject: String,
    updates_url: String,
}

fn has_expo_updates(dir: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(dir.join("package.json")) else { return false };
    let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&text) else { return false };
    ["dependencies", "devDependencies"].iter().any(|k| pkg.get(k).and_then(|d| d.get("expo-updates")).is_some())
}

/// The Expo app (a folder whose package.json depends on expo-updates) at or above `path`.
pub fn find_app(path: &str) -> Res<PathBuf> {
    let p = PathBuf::from(path);
    let p = p.canonicalize().map_err(|e| format!("{path}: {e}"))?;
    p.ancestors()
        .find(|d| has_expo_updates(d))
        .map(Path::to_path_buf)
        .ok_or_else(|| format!("{} is not inside an Expo app with expo-updates", p.display()))
}

fn git(dir: &str, args: &[&str]) -> String {
    Command::new("git")
        .args(args)
        .current_dir(dir)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

pub fn app_info(dir: &str) -> AppInfo {
    let read = |f: &str| std::fs::read_to_string(Path::new(dir).join(f)).ok();
    let pkg: serde_json::Value = read("package.json").and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let app: serde_json::Value = read("app.json").and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let expo = app.get("expo").unwrap_or(&app);
    let name = expo
        .get("name")
        .or_else(|| pkg.get("name"))
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| Path::new(dir).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
    AppInfo {
        dir: dir.to_string(),
        name,
        branch: git(dir, &["branch", "--show-current"]),
        sha: git(dir, &["rev-parse", "--short=7", "HEAD"]),
        dirty: !git(dir, &["status", "--porcelain"]).is_empty(),
        subject: git(dir, &["log", "-1", "--format=%s"]),
        updates_url: expo.pointer("/updates/url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
    }
}

#[derive(Serialize)]
pub struct AppEntry {
    path: String,
    name: String,
    /// Last git activity (or package.json mtime), unix seconds.
    active: u64,
}

/// Expo apps with expo-updates under `$TIDEPANEL_ROOTS` (colon-separated) or `$HOME`, most recently active first.
pub fn discover_apps() -> Vec<AppEntry> {
    let roots: Vec<PathBuf> = match std::env::var_os("TIDEPANEL_ROOTS") {
        Some(v) => std::env::split_paths(&v).collect(),
        None => vec![home()],
    };
    let mut out = Vec::new();
    for root in roots {
        walk(&root, 0, &mut out);
    }
    out.sort_by(|a, b| b.active.cmp(&a.active));
    out
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<AppEntry>) {
    if depth > 0 && has_expo_updates(dir) {
        let mtime = |p: PathBuf| {
            std::fs::metadata(p)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
        };
        let active = ["package.json", ".git/index", ".git/HEAD", ".git/logs/HEAD"]
            .iter()
            .filter_map(|f| mtime(dir.join(f)))
            .max()
            .unwrap_or(0);
        out.push(AppEntry {
            path: dir.to_string_lossy().into_owned(),
            name: dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            active,
        });
        return;
    }
    if depth >= DISCOVER_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        // file_type() doesn't follow symlinks, so link loops are impossible.
        if !e.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let name = e.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || SKIP_DIRS.contains(&name.as_ref()) {
            continue;
        }
        walk(&e.path(), depth + 1, out);
    }
}

/// Last opened app, kept in ~/.config/tidepanel/last-app.
fn state_file() -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".config")).join("tidepanel/last-app")
}

pub fn last_app() -> Option<String> {
    std::fs::read_to_string(state_file()).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

pub fn remember_app(dir: &str) {
    let f = state_file();
    if let Some(p) = f.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    let _ = std::fs::write(f, dir);
}
