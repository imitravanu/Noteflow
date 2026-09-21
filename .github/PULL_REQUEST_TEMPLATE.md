# Pull Request

## What
- [ ] Bug fix (non-breaking)
- [ ] Feature
- [ ] Docs / CI

## Why
Link issue / describe user impact:

## Safety
- [ ] Notes backup verified (`sqlite3 noteflow.db "SELECT COUNT(*) FROM notes;"` before/after)
- [ ] No migration (or migration + rollback tested)
- [ ] `npm run typecheck` clean
- [ ] `npm test` 27+ pass
- [ ] `cargo fmt --check` clean
- [ ] `cargo clippy -- -D warnings` clean
- [ ] `cargo test` 24+ pass

## Test
Commands run + results:
