const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE_NAME: &str = "Queuer";

fn run_value(executable: &str) -> String {
    format!("\"{executable}\"")
}

#[cfg(windows)]
fn registry(arguments: &[&str]) -> Result<std::process::ExitStatus, String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("reg")
        .args(arguments)
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|_| "Não foi possível ler o arranque do Windows.".to_string())
}

#[cfg(windows)]
#[tauri::command]
pub fn startup_is_enabled() -> Result<bool, String> {
    let status = registry(&["query", RUN_KEY, "/v", VALUE_NAME])?;
    Ok(status.success())
}

#[cfg(windows)]
#[tauri::command]
pub fn startup_set_enabled(enabled: bool) -> Result<bool, String> {
    if enabled {
        let executable = std::env::current_exe()
            .map_err(|_| "Não foi possível encontrar o executável da app.".to_string())?;
        let value = run_value(&executable.to_string_lossy());
        let status = registry(&[
            "add", RUN_KEY, "/v", VALUE_NAME, "/t", "REG_SZ", "/d", &value, "/f",
        ])?;
        if !status.success() {
            return Err("O Windows não deixou ativar o arranque automático.".into());
        }
        return Ok(true);
    }

    let status = registry(&["delete", RUN_KEY, "/v", VALUE_NAME, "/f"])?;
    let removed = status.success();
    let still_there = startup_is_enabled()?;
    if still_there && !removed {
        return Err("O Windows não deixou desativar o arranque automático.".into());
    }
    Ok(still_there)
}

#[cfg(not(windows))]
#[tauri::command]
pub fn startup_is_enabled() -> Result<bool, String> {
    Ok(false)
}

#[cfg(not(windows))]
#[tauri::command]
pub fn startup_set_enabled(_enabled: bool) -> Result<bool, String> {
    Err("O arranque automático só existe no Windows.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_value_quotes_the_executable_path() {
        assert_eq!(
            run_value(r"C:\Users\Name With Space\Queuer\queuer.exe"),
            "\"C:\\Users\\Name With Space\\Queuer\\queuer.exe\""
        );
    }

    #[test]
    fn registry_names_stay_the_same() {
        assert_eq!(VALUE_NAME, "Queuer");
        assert!(RUN_KEY.ends_with(r"\Run"));
    }
}
