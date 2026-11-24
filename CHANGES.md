# Changes

## 0.1.0 2026-11-21

First release of `@seneca/calendar`, for Seneca 4.

* Seneca 4: the peer dependency is `seneca` `^4.0.0` (the unreleased code
  had `>=3.33.0`).
* The entity peer dependency is `@seneca/entity` `^29.0.0` (was
  `seneca-entity` `>=25`). The old peer made npm install `seneca-entity` 28,
  which stops a Seneca 4 process at startup with `plugin_gubu_shape`. Load
  the entity plugin by its full name: `seneca.use('@seneca/entity')`.
* The `seneca-promisify` peer dependency is removed. Seneca 4 has promises
  built in; do not call `use('promisify')` (D4).
* Node.js 24 or later (`engines.node` `>=24`, was `>=16`).
* The tick timer is cleared by a `this.destroy` handler instead of a
  `role:seneca,cmd:close` hook (D4), so closing Seneca no longer prints the
  `SENECA_DEP_LEGACY_CLOSE_HOOK` warning.
* Tests run on Seneca 4 with `@seneca/entity` 29, load it by its full name
  (B14) and no longer use `promisify`. The close test checks that the tick
  timer is cleared. devDependencies: `seneca` `^4.0.0`, `@seneca/entity`
  `^29.0.0` and `@seneca/doc` `^9.0.0`; the unused `seneca-msg-test` and
  `@seneca/maintain` are removed.
* `repository.url` uses `git+https`, `publishConfig` sets public access, and
  the package includes `CHANGES.md`.
