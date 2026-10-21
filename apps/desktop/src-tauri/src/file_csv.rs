use crate::file_model::{Budget, Check, MAX_COLUMNS, MAX_FIELD, MAX_RECORD, MAX_RECORDS, trim};
#[derive(PartialEq)]
enum State {
    Start,
    Text,
    Quoted,
    Closed,
}
pub fn inspect<F: Fn() -> bool>(
    text: &str,
    delimiter: &str,
    budget: &Budget<F>,
) -> Check<(usize, usize)> {
    if trim(text).starts_with(['<', '[', '{']) {
        return Err("TYPE_MISMATCH");
    }
    let delimiter = delimiter.chars().next().ok_or("INVALID_REQUEST")?;
    let mut state = State::Start;
    let (mut field, mut record, mut columns, mut maximum, mut records) = (0, 0, 1, 0, 0);
    let mut chars = text.chars().peekable();
    let mut index = 0;
    while let Some(c) = chars.next() {
        if index % 4096 == 0 {
            budget.check()?;
        }
        index += 1;
        let terminator = state != State::Quoted && ['\r', '\n'].contains(&c);
        if !terminator {
            record += c.len_utf16();
            if record > MAX_RECORD {
                return Err("RECORD_LIMIT");
            }
        }
        if state == State::Quoted {
            if c == '"' {
                state = State::Closed;
            } else {
                field += c.len_utf16();
            }
        } else if c == '"' {
            match state {
                State::Start => state = State::Quoted,
                State::Closed => {
                    state = State::Quoted;
                    field += 1;
                }
                _ => return Err("INVALID_CSV"),
            }
        } else if c == delimiter {
            field = 0;
            columns += 1;
            if columns > MAX_COLUMNS {
                return Err("COLUMN_LIMIT");
            }
            state = State::Start;
        } else if terminator {
            if c == '\r' && chars.peek() == Some(&'\n') {
                chars.next();
            }
            finish(&mut records, columns, &mut maximum)?;
            field = 0;
            record = 0;
            columns = 1;
            state = State::Start;
        } else {
            if state == State::Closed {
                return Err("INVALID_CSV");
            }
            state = State::Text;
            field += c.len_utf16();
        }
        if field > MAX_FIELD {
            return Err("FIELD_LIMIT");
        }
    }
    if state == State::Quoted {
        return Err("INVALID_CSV");
    }
    if record > 0 {
        finish(&mut records, columns, &mut maximum)?;
    }
    if records < 2 {
        return Err("EMPTY_FILE");
    }
    Ok((records - 1, maximum))
}
fn finish(records: &mut usize, columns: usize, maximum: &mut usize) -> Check<()> {
    if *records == 0 && columns < 2 {
        return Err("TYPE_MISMATCH");
    }
    *maximum = (*maximum).max(columns);
    *records += 1;
    if *records > MAX_RECORDS + 1 {
        return Err("ROW_LIMIT");
    }
    Ok(())
}
