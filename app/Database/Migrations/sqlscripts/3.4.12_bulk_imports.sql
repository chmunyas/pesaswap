-- ---------------------------------------------------------------------------
-- Bulk-import audit log — Slice F.1
--
-- Records every batched POST to /api/{entity}/bulk so operators can:
--   - Inspect what was loaded by whom and when
--   - Re-import the exact same payload without dupes (sha256 dedupe)
--   - Diagnose partial-failure runs via the error_summary JSON column
--
-- One row per BATCH (not per imported row). The result envelope returned
-- to the caller contains the import_id so they can correlate.
-- ---------------------------------------------------------------------------

CREATE TABLE `ospos_bulk_imports` (
    `import_id`        int(10)        NOT NULL AUTO_INCREMENT,
    `entity`           varchar(64)    NOT NULL,
    `operator_id`      int(10)        NOT NULL,
    `total_rows`       int(10)        NOT NULL,
    `imported_count`   int(10)        NOT NULL DEFAULT 0,
    `skipped_count`    int(10)        NOT NULL DEFAULT 0,
    `failed_count`     int(10)        NOT NULL DEFAULT 0,
    `dry_run`          tinyint(1)     NOT NULL DEFAULT 0,
    `skip_on_error`    tinyint(1)     NOT NULL DEFAULT 1,
    `payload_hash`     char(64)       NOT NULL,
    `error_summary`    text           DEFAULT NULL,
    `ip`               varchar(64)    DEFAULT NULL,
    `user_agent`       varchar(255)   DEFAULT NULL,
    `created_at`       timestamp      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`import_id`),
    KEY `idx_entity_created`  (`entity`, `created_at`),
    KEY `idx_operator`        (`operator_id`),
    KEY `idx_payload_hash`    (`payload_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
