-- ----------------------------------------------------------------------------
-- QR Ticketing - Phase 4 (operations + scanning)
--
-- Adds:
--   - ticket_scanner_devices: door staff devices each get a long-lived
--     RS256-signed JWT scoped to specific stock_locations. Per-device
--     revocation by setting revoked_at without touching the global
--     signing key.
--
-- ALTER ospos_ticket_redemptions: scanner_device_id (nullable FK) so we
--   can correlate scans back to a specific gate device for fraud /
--   reconciliation reporting.
-- ----------------------------------------------------------------------------

CREATE TABLE `ospos_ticket_scanner_devices` (
    `device_id`              int(10)         NOT NULL AUTO_INCREMENT,
    `label`                  varchar(128)    NOT NULL,
    `jti`                    varchar(64)     NOT NULL,
    `scope_location_ids`     varchar(255)    DEFAULT NULL,
    `scope_product_ids`      varchar(512)    DEFAULT NULL,
    `created_by_employee_id` int(10)         DEFAULT NULL,
    `created_at`             timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `last_seen_at`           timestamp       NULL DEFAULT NULL,
    `last_seen_ip`           varchar(64)     DEFAULT NULL,
    `revoked_at`             timestamp       NULL DEFAULT NULL,
    `revoked_reason`         varchar(255)    DEFAULT NULL,
    PRIMARY KEY (`device_id`),
    UNIQUE KEY `uniq_jti` (`jti`),
    KEY `idx_active` (`revoked_at`),
    CONSTRAINT `fk_tsd_creator` FOREIGN KEY (`created_by_employee_id`)
        REFERENCES `ospos_people` (`person_id`)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

ALTER TABLE `ospos_ticket_redemptions`
    ADD COLUMN `scanner_device_id` int(10) DEFAULT NULL AFTER `employee_id`,
    ADD KEY `idx_scanner_device` (`scanner_device_id`),
    ADD CONSTRAINT `fk_tr_scanner` FOREIGN KEY (`scanner_device_id`)
        REFERENCES `ospos_ticket_scanner_devices` (`device_id`)
        ON DELETE SET NULL;
