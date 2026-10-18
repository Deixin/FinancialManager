//! Pure US-044 category policy, compared with the shared TypeScript service.
use crate::{LocalError, Result, identity};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use unicode_normalization::UnicodeNormalization;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Category {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub category_scope: String,
    pub sort_order: i32,
    pub status: String,
    pub is_seeded: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum Command {
    Seed {
        profile_version: u8,
        purpose: String,
        ids: Vec<String>,
    },
    Create {
        id: String,
        name: String,
        category_scope: String,
        sort_order: i32,
    },
    Update {
        base: Category,
        name: String,
        sort_order: i32,
        status: String,
    },
    Reorder {
        bases: Vec<Category>,
        ids: Vec<String>,
    },
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    pub before: Option<Category>,
    pub after: Category,
}
pub fn js_space(c: char) -> bool {
    matches!(c,'\u{0009}'..='\u{000d}'|'\u{0020}'|'\u{00a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}')
}
pub fn name_key(s: &str) -> String {
    s.nfkc()
        .collect::<String>()
        .split(js_space)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
fn label(s: String) -> Result<String> {
    let value = s.trim_matches(js_space);
    if value.is_empty() || value.encode_utf16().count() > 120 || s.chars().any(char::is_control) {
        return Err(LocalError::InvalidCategoryChange);
    }
    Ok(value.to_string())
}
fn scope(s: &str) -> bool {
    matches!(s, "EXPENSE" | "INCOME" | "BOTH")
}
fn status(s: &str) -> bool {
    matches!(s, "ACTIVE" | "ARCHIVED")
}
pub fn defaults(p: &str) -> Result<Vec<(&'static str, &'static str)>> {
    Ok(match p {
        "PERSONAL" => vec![
            ("Alimentação", "EXPENSE"),
            ("Moradia", "EXPENSE"),
            ("Transporte", "EXPENSE"),
            ("Saúde", "EXPENSE"),
            ("Educação", "EXPENSE"),
            ("Lazer", "EXPENSE"),
            ("Outras despesas", "EXPENSE"),
            ("Salário", "INCOME"),
            ("Outras receitas", "INCOME"),
        ],
        "BUSINESS" => vec![
            ("Despesas operacionais", "EXPENSE"),
            ("Fornecedores", "EXPENSE"),
            ("Pessoal", "EXPENSE"),
            ("Tributos", "EXPENSE"),
            ("Tarifas e juros", "EXPENSE"),
            ("Outras despesas", "EXPENSE"),
            ("Vendas", "INCOME"),
            ("Prestação de serviços", "INCOME"),
            ("Outras receitas", "INCOME"),
        ],
        "OTHER" => vec![("Receitas", "INCOME"), ("Despesas", "EXPENSE")],
        _ => return Err(LocalError::InvalidCategoryChange),
    })
}
impl Category {
    pub fn validate(&self, w: &str) -> Result<()> {
        if identity::resource_id(&self.id).is_err()
            || identity::resource_id(w).is_err()
            || self.workspace_id != w
            || name_key(&self.name).is_empty()
            || !scope(&self.category_scope)
            || !status(&self.status)
        {
            return Err(LocalError::InvalidCategoryState);
        }
        Ok(())
    }
}
pub fn capture_rows(mut rows: Vec<Category>, w: &str) -> Result<Vec<Category>> {
    if rows.len() > 10000
        || serde_json::to_string(&rows)
            .map_err(|_| LocalError::InvalidCategoryState)?
            .encode_utf16()
            .count()
            > 4 * 1024 * 1024
    {
        return Err(LocalError::CategoryLimit);
    }
    let mut seen = BTreeSet::new();
    for r in &rows {
        r.validate(w)?;
        if !seen.insert(&r.id) {
            return Err(LocalError::InvalidCategoryState);
        }
    }
    rows.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(rows)
}
fn ids(values: &[String], v7: bool) -> Result<()> {
    let mut seen = BTreeSet::new();
    if values.len() > 10000 {
        return Err(LocalError::InvalidCategoryChange);
    }
    for s in values {
        let id = identity::resource_id(s).map_err(|_| LocalError::InvalidCategoryChange)?;
        if (v7 && id.get_version_num() != 7) || !seen.insert(s) {
            return Err(LocalError::InvalidCategoryChange);
        }
    }
    Ok(())
}
impl Command {
    pub fn capture(self, w: &str) -> Result<Self> {
        identity::resource_id(w).map_err(|_| LocalError::InvalidCategoryChange)?;
        Ok(match self {
            Self::Seed {
                profile_version,
                purpose,
                ids: values,
            } => {
                ids(&values, true)?;
                if profile_version != 1 || values.len() != defaults(&purpose)?.len() {
                    return Err(LocalError::InvalidCategoryChange);
                }
                Self::Seed {
                    profile_version,
                    purpose,
                    ids: values,
                }
            }
            Self::Create {
                id,
                name,
                category_scope,
                sort_order,
            } => {
                ids(std::slice::from_ref(&id), true)?;
                if !scope(&category_scope) {
                    return Err(LocalError::InvalidCategoryChange);
                }
                Self::Create {
                    id,
                    name: label(name)?,
                    category_scope,
                    sort_order,
                }
            }
            Self::Update {
                base,
                name,
                sort_order,
                status: s,
            } => {
                base.validate(w)
                    .map_err(|_| LocalError::InvalidCategoryChange)?;
                if !status(&s) {
                    return Err(LocalError::InvalidCategoryChange);
                }
                let name = if name == base.name {
                    name
                } else {
                    label(name)?
                };
                Self::Update {
                    base,
                    name,
                    sort_order,
                    status: s,
                }
            }
            Self::Reorder { bases, ids: values } => {
                let bases = capture_rows(bases, w).map_err(|e| {
                    if e == LocalError::CategoryLimit {
                        e
                    } else {
                        LocalError::InvalidCategoryChange
                    }
                })?;
                ids(&values, false)?;
                if bases.len() != values.len()
                    || bases.iter().any(|r| r.status != "ACTIVE")
                    || values.iter().any(|id| !bases.iter().any(|r| &r.id == id))
                {
                    return Err(LocalError::InvalidCategoryChange);
                }
                Self::Reorder { bases, ids: values }
            }
        })
    }
}
pub fn plan(w: &str, purpose: &str, current: Vec<Category>, input: Command) -> Result<Vec<Plan>> {
    let current = capture_rows(current, w)?;
    let command = input.capture(w)?;
    defaults(purpose).map_err(|_| LocalError::InvalidCategoryState)?;
    let mut plans = Vec::new();
    match command {
        Command::Seed {
            purpose: p, ids, ..
        } => {
            if p != purpose {
                return Err(LocalError::CategorySeedConflict);
            }
            let mut expected = defaults(purpose)?
                .into_iter()
                .enumerate()
                .map(|(i, (name, scope))| Category {
                    id: ids[i].clone(),
                    workspace_id: w.into(),
                    name: name.into(),
                    category_scope: scope.into(),
                    sort_order: i as i32,
                    status: "ACTIVE".into(),
                    is_seeded: true,
                })
                .collect::<Vec<_>>();
            expected.sort_by(|a, b| a.id.cmp(&b.id));
            if !current.is_empty() {
                if current == expected {
                    return Ok(vec![]);
                }
                return Err(LocalError::CategorySeedConflict);
            }
            for after in expected {
                plans.push(Plan {
                    before: None,
                    after,
                })
            }
        }
        Command::Create {
            id,
            name,
            category_scope,
            sort_order,
        } => {
            let after = Category {
                id,
                workspace_id: w.into(),
                name,
                category_scope,
                sort_order,
                status: "ACTIVE".into(),
                is_seeded: false,
            };
            if let Some(before) = current.iter().find(|r| r.id == after.id) {
                if before == &after {
                    return Ok(vec![]);
                }
                return Err(LocalError::CategoryBaseConflict);
            }
            plans.push(Plan {
                before: None,
                after,
            });
        }
        Command::Update {
            base,
            name,
            sort_order,
            status,
        } => {
            let before = current
                .iter()
                .find(|r| r.id == base.id)
                .ok_or(LocalError::CategoryNotFound)?;
            if before != &base {
                return Err(LocalError::CategoryBaseConflict);
            }
            let after = Category {
                name,
                sort_order,
                status,
                ..before.clone()
            };
            if &after != before {
                plans.push(Plan {
                    before: Some(before.clone()),
                    after,
                })
            }
        }
        Command::Reorder { bases, ids } => {
            let active = current
                .iter()
                .filter(|r| r.status == "ACTIVE")
                .cloned()
                .collect::<Vec<_>>();
            if active != bases {
                return Err(LocalError::CategoryBaseConflict);
            }
            for (i, id) in ids.iter().enumerate() {
                let before = active
                    .iter()
                    .find(|r| &r.id == id)
                    .ok_or(LocalError::InvalidCategoryChange)?;
                let after = Category {
                    sort_order: i as i32,
                    ..before.clone()
                };
                if &after != before {
                    plans.push(Plan {
                        before: Some(before.clone()),
                        after,
                    })
                }
            }
        }
    }
    let mut next = current
        .into_iter()
        .filter(|r| !plans.iter().any(|p| p.after.id == r.id))
        .collect::<Vec<_>>();
    next.extend(plans.iter().map(|p| p.after.clone()));
    if next.len() > 10000 {
        return Err(LocalError::CategoryLimit);
    }
    let mut names = BTreeSet::new();
    for r in next.iter().filter(|r| r.status == "ACTIVE") {
        if !names.insert(name_key(&r.name)) {
            return Err(LocalError::CategoryNameConflict);
        }
    }
    plans.sort_by(|a, b| a.after.id.cmp(&b.after.id));
    Ok(plans)
}
