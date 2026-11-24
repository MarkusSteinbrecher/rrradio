/**
 * Wire-schema generation of `public/stations.json`, published as the
 * envelope's `schemaVersion`.
 *
 * The rule (docs/spec/contracts/catalog-schema.md, "Versioning & evolution"):
 * additive changes — a new optional field with a safe default — do NOT bump
 * it. Bump it only for a change an older client cannot read: a renamed
 * field, a changed meaning, or a field that becomes required. A bump needs
 * every client to ship a decoder branch for the new number first.
 */
export const CATALOG_SCHEMA_VERSION = 1;
