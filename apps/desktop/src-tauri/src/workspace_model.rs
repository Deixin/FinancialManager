use crate::{LocalError, Result, identity};
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Purpose {
    Personal,
    Business,
    Other,
}
impl Purpose {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Personal => "PERSONAL",
            Self::Business => "BUSINESS",
            Self::Other => "OTHER",
        }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateWorkspace {
    pub workspace_id: String,
    pub display_name: String,
    pub purpose: Purpose,
}
impl CreateWorkspace {
    pub fn validate(&self) -> Result<&str> {
        let id =
            identity::resource_id(&self.workspace_id).map_err(|_| LocalError::InvalidWorkspace)?;
        if id.get_version_num() != 7 {
            return Err(LocalError::InvalidWorkspace);
        }
        let name = self
            .display_name
            .trim_matches(|ch: char| ch.is_whitespace() || ch == '\u{feff}');
        if name.is_empty()
            || name.encode_utf16().count() > 120
            || name.chars().any(char::is_control)
        {
            return Err(LocalError::InvalidWorkspace);
        }
        Ok(name)
    }
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Workspace {
    pub id: String,
    pub display_name: String,
    pub purpose: Purpose,
    pub storage_mode: String,
    pub default_currency: String,
    pub created_at: String,
}
