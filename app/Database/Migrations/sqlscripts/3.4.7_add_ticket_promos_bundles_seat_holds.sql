-- ----------------------------------------------------------------------------
-- QR Ticketing - Phase 5 (promos, bundles, seat-holds, reports)
--
-- Adds the pricing + fraud + scarcity primitives that round out the
-- production feature set.
--
--   - ticket_promo_codes: human-redeemable codes with pct/flat discount,
--     usage cap, expiry, and optional product / tier scope.
--   - ticket_promo_redemptions: per-redemption audit. The (code_id,
--     ticket_id) unique key makes refunds + replays safe.
--   - ticket_product_bundles: parent product references one or more
--     child products with quantity (e.g. Family Pass = 2x Adult + 2x Child).
--   - ticket_seat_holds: short-lived seat reservations during checkout.
--     Cleared on hold_token expiry or explicit release. Issuance consumes
--     the hold under transaction.
-- ----------------------------------------------------------------------------

CREATE TABLE `ospos_ticket_promo_codes` (
    `code_id`            int(10)         NOT NULL AUTO_INCREMENT,
    `code`               varchar(64)     NOT NULL,
    `description`        varchar(255)    DEFAULT NULL,
    `discount_pct`       decimal(5,2)    DEFAULT NULL,
    `discount_flat`      decimal(15,2)   DEFAULT NULL,
    `currency`           varchar(8)      DEFAULT NULL,
    `max_uses`           int(10)         DEFAULT NULL,
    `used_count`         int(10)         NOT NULL DEFAULT 0,
    `starts_at`          datetime        DEFAULT NULL,
    `expires_at`         datetime        DEFAULT NULL,
    `scope_product_ids`  varchar(512)    DEFAULT NULL,
    `scope_tier_ids`     varchar(512)    DEFAULT NULL,
    `min_amount`         decimal(15,2)   DEFAULT NULL,
    `deleted`            tinyint(1)      NOT NULL DEFAULT 0,
    `created_at`         timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`         timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`code_id`),
    UNIQUE KEY `uniq_code` (`code`),
    KEY `idx_active` (`expires_at`, `deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `ospos_ticket_promo_redemptions` (
    `redemption_id`   int(10)         NOT NULL AUTO_INCREMENT,
    `code_id`         int(10)         NOT NULL,
    `ticket_id`       int(10)         NOT NULL,
    `applied_amount`  decimal(15,2)   NOT NULL DEFAULT '0.00',
    `currency`        varchar(8)      DEFAULT NULL,
    `occurred_at`     timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`redemption_id`),
    UNIQUE KEY `uniq_code_ticket` (`code_id`, `ticket_id`),
    KEY `idx_code` (`code_id`),
    KEY `idx_ticket` (`ticket_id`),
    CONSTRAINT `fk_tpr_code`   FOREIGN KEY (`code_id`)   REFERENCES `ospos_ticket_promo_codes` (`code_id`) ON DELETE CASCADE,
    CONSTRAINT `fk_tpr_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `ospos_tickets` (`ticket_id`)         ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `ospos_ticket_product_bundles` (
    `bundle_id`           int(10)         NOT NULL AUTO_INCREMENT,
    `parent_product_id`   int(10)         NOT NULL,
    `child_product_id`    int(10)         NOT NULL,
    `child_tier_id`       int(10)         DEFAULT NULL,
    `child_session_id`    int(10)         DEFAULT NULL,
    `quantity`            int(10)         NOT NULL DEFAULT 1,
    `sort_order`          int(10)         NOT NULL DEFAULT 0,
    `deleted`             tinyint(1)      NOT NULL DEFAULT 0,
    PRIMARY KEY (`bundle_id`),
    KEY `idx_parent` (`parent_product_id`),
    KEY `idx_child`  (`child_product_id`),
    CONSTRAINT `fk_tpb_parent` FOREIGN KEY (`parent_product_id`) REFERENCES `ospos_ticket_products` (`ticket_product_id`) ON DELETE CASCADE,
    CONSTRAINT `fk_tpb_child`  FOREIGN KEY (`child_product_id`)  REFERENCES `ospos_ticket_products` (`ticket_product_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `ospos_ticket_seat_holds` (
    `hold_id`        int(10)         NOT NULL AUTO_INCREMENT,
    `session_id`     int(10)         DEFAULT NULL,
    `product_id`     int(10)         NOT NULL,
    `seat_code`      varchar(64)     NOT NULL,
    `hold_token`     char(64)        NOT NULL,
    `held_until`     datetime        NOT NULL,
    `held_by_ip`     varchar(64)     DEFAULT NULL,
    `consumed_at`    datetime        DEFAULT NULL,
    `consumed_ticket_id` int(10)     DEFAULT NULL,
    `released_at`    datetime        DEFAULT NULL,
    `created_at`     timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`hold_id`),
    UNIQUE KEY `uniq_session_seat_active` (`session_id`, `product_id`, `seat_code`, `consumed_at`, `released_at`),
    KEY `idx_hold_token` (`hold_token`),
    KEY `idx_expiry` (`held_until`),
    CONSTRAINT `fk_tsh_product` FOREIGN KEY (`product_id`) REFERENCES `ospos_ticket_products` (`ticket_product_id`) ON DELETE CASCADE,
    CONSTRAINT `fk_tsh_session` FOREIGN KEY (`session_id`) REFERENCES `ospos_ticket_product_sessions` (`session_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

INSERT IGNORE INTO `ospos_app_config` (`key`, `value`) VALUES
    ('ticket_seat_hold_ttl_min', '10');
