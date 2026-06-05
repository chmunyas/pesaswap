-- ----------------------------------------------------------------------------
-- QR Ticketing - Phase 2 (sessions, tiers, transfers)
--
-- Brings the schema toward WeChat Special Ticket parity plus best-of-breed
-- event ticketing.
--
--   - ticket_product_sessions: recurring/dated instances of a product so a
--     single ticket_product can model a multi-night concert, daily museum
--     entry, festival days, movie showtimes or transport departures.
--   - ticket_product_tiers: multiple SKUs per product (Adult/Child/VIP/Early
--     Bird) each with its own price, quantity cap and quantity_issued
--     counter. WeChat models sku as a JSON object - we keep it as a table so
--     the issuance path can apply a conditional UPDATE per tier.
--   - ticket_transfers: audit trail for the customer-initiated transfer
--     flow. PII (email/phone) is stored hashed - only the last 4 chars are
--     plaintext for operator support.
--   - ALTER ospos_tickets adds nullable session_id and tier_id columns.
--     Existing Phase 0/1 tickets keep NULL - no migration churn, NULL means
--     "legacy / product-level validity only".
--
-- All ADD COLUMN and CREATE TABLE statements are reversible via the
-- migration's down() method.
-- ----------------------------------------------------------------------------

CREATE TABLE `ospos_ticket_product_sessions` (
    `session_id`        int(10)         NOT NULL AUTO_INCREMENT,
    `ticket_product_id` int(10)         NOT NULL,
    `label`             varchar(255)    DEFAULT NULL,
    `starts_at`         datetime        NOT NULL,
    `ends_at`           datetime        DEFAULT NULL,
    `quantity`          int(10)         DEFAULT NULL,
    `quantity_issued`   int(10)         NOT NULL DEFAULT 0,
    `hall`              varchar(128)    DEFAULT NULL,
    `gate`              varchar(128)    DEFAULT NULL,
    `status`            enum('scheduled','live','ended','cancelled') NOT NULL DEFAULT 'scheduled',
    `seat_map_json`     longtext        DEFAULT NULL,
    `deleted`           tinyint(1)      NOT NULL DEFAULT 0,
    `created_at`        timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`        timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`session_id`),
    KEY `idx_product_starts`  (`ticket_product_id`, `starts_at`),
    KEY `idx_status` (`status`),
    CONSTRAINT `fk_tpsess_product` FOREIGN KEY (`ticket_product_id`)
        REFERENCES `ospos_ticket_products` (`ticket_product_id`)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `ospos_ticket_product_tiers` (
    `tier_id`           int(10)         NOT NULL AUTO_INCREMENT,
    `ticket_product_id` int(10)         NOT NULL,
    `name`              varchar(128)    NOT NULL,
    `price`             decimal(15,2)   NOT NULL DEFAULT '0.00',
    `quantity`          int(10)         DEFAULT NULL,
    `quantity_issued`   int(10)         NOT NULL DEFAULT 0,
    `sort_order`        int(10)         NOT NULL DEFAULT 0,
    `color`             varchar(16)     DEFAULT NULL,
    `description`       varchar(255)    DEFAULT NULL,
    `deleted`           tinyint(1)      NOT NULL DEFAULT 0,
    `created_at`        timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`        timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`tier_id`),
    KEY `idx_product_sort` (`ticket_product_id`, `sort_order`),
    CONSTRAINT `fk_tptier_product` FOREIGN KEY (`ticket_product_id`)
        REFERENCES `ospos_ticket_products` (`ticket_product_id`)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `ospos_ticket_transfers` (
    `transfer_id`            int(10)         NOT NULL AUTO_INCREMENT,
    `ticket_id`              int(10)         NOT NULL,
    `from_contact_hash`      char(64)        DEFAULT NULL,
    `to_contact_hash`        char(64)        NOT NULL,
    `to_contact_last4`       varchar(8)      DEFAULT NULL,
    `channel`                enum('email','sms') NOT NULL,
    `verification_token_hash` char(64)       DEFAULT NULL,
    `verification_sent_at`   datetime        DEFAULT NULL,
    `verification_expires_at` datetime       DEFAULT NULL,
    `verified_at`            datetime        DEFAULT NULL,
    `occurred_at`            timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `ip`                     varchar(64)     DEFAULT NULL,
    `user_agent`             varchar(255)    DEFAULT NULL,
    `client_idempotency_key` varchar(64)     DEFAULT NULL,
    PRIMARY KEY (`transfer_id`),
    UNIQUE KEY `uniq_ticket_idempotency` (`ticket_id`, `client_idempotency_key`),
    KEY `idx_ticket`  (`ticket_id`, `occurred_at`),
    KEY `idx_pending` (`ticket_id`, `verified_at`, `verification_expires_at`),
    CONSTRAINT `fk_txfer_ticket` FOREIGN KEY (`ticket_id`)
        REFERENCES `ospos_tickets` (`ticket_id`)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

-- Extend the issued-ticket table with optional session+tier FKs. NULL means
-- the ticket predates Phase 2 (legacy) and is validated against the product
-- validity window only.
ALTER TABLE `ospos_tickets`
    ADD COLUMN `session_id` int(10) DEFAULT NULL AFTER `ticket_product_id`,
    ADD COLUMN `tier_id`    int(10) DEFAULT NULL AFTER `session_id`,
    ADD KEY `idx_session` (`session_id`),
    ADD KEY `idx_tier`    (`tier_id`),
    ADD CONSTRAINT `fk_tk_session` FOREIGN KEY (`session_id`)
        REFERENCES `ospos_ticket_product_sessions` (`session_id`)
        ON DELETE SET NULL,
    ADD CONSTRAINT `fk_tk_tier` FOREIGN KEY (`tier_id`)
        REFERENCES `ospos_ticket_product_tiers` (`tier_id`)
        ON DELETE SET NULL;

-- Phase 2 also adds new app_config defaults: the HMAC secret used to hash
-- contact PII in ticket_transfers, and the transfer verification window.
INSERT IGNORE INTO `ospos_app_config` (`key`, `value`) VALUES
    ('ticket_transfer_hmac_secret',     ''),
    ('ticket_transfer_verify_ttl_min',  '15'),
    ('ticket_transfer_max_per_ticket',  '5');
