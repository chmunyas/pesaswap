-- ---------------------------------------------------------------------------
-- Gift Drops (hongbao-style) — Phase E.4
--
-- A "drop" is a single shareable link that hands out N slices of a parent
-- gift card to the first N people who claim it. Modelled on WeChat's red
-- packet (hongbao):
--
--   * Sender picks total amount + number of slots + distribution (equal
--     or random) + optional message + expiry.
--   * Backend deducts the total from the parent card (atomic, FOR UPDATE)
--     and stores it on the drop row. Funds are "frozen" until claimed
--     or refunded.
--   * Each claim is one row in giftcard_drop_claims and mints a fresh
--     gift card carrying that slice's amount. Idempotent on (drop_id,
--     claimer_phone) when phone is provided.
--   * On expiry, unfunded slots refund the residual back to the parent
--     card via a cron (`spark giftcards:expire-drops`).
--
-- Concurrency invariants:
--   * One claim per (drop_id, slot_index) — UNIQUE.
--   * slots_claimed monotonic increment under row lock.
--   * Distribution math runs inside the claim transaction so two
--     concurrent claimers can't oversell the drop.
-- ---------------------------------------------------------------------------

CREATE TABLE `ospos_giftcard_drops` (
    `drop_id`              int(10)         NOT NULL AUTO_INCREMENT,
    `parent_giftcard_id`   int(11)         NOT NULL,
    `creator_employee_id`  int(10)         DEFAULT NULL,
    `total_amount`         decimal(15,2)   NOT NULL,
    `currency`             varchar(8)      NOT NULL DEFAULT 'KES',
    `slot_count`           int(10)         NOT NULL,
    `slots_claimed`        int(10)         NOT NULL DEFAULT 0,
    `amount_remaining`     decimal(15,2)   NOT NULL,
    `distribution`         enum('equal','random') NOT NULL DEFAULT 'equal',
    `message`              text            DEFAULT NULL,
    `share_token_hash`     char(64)        NOT NULL,
    `expires_at`           datetime        NOT NULL,
    `cancelled_at`         datetime        DEFAULT NULL,
    `cancelled_reason`     varchar(64)     DEFAULT NULL,
    `refunded_at`          datetime        DEFAULT NULL,
    `ip`                   varchar(64)     DEFAULT NULL,
    `user_agent`           varchar(255)    DEFAULT NULL,
    `created_at`           timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`           timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`drop_id`),
    UNIQUE KEY `uniq_share_token` (`share_token_hash`),
    KEY `idx_parent`  (`parent_giftcard_id`),
    KEY `idx_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ospos_giftcard_drop_claims` (
    `claim_id`             int(10)         NOT NULL AUTO_INCREMENT,
    `drop_id`              int(10)         NOT NULL,
    `slot_index`           int(10)         NOT NULL,
    `claimed_giftcard_id`  int(11)         DEFAULT NULL,
    `claimed_amount`       decimal(15,2)   NOT NULL,
    `claimer_name`         varchar(255)    DEFAULT NULL,
    `claimer_phone`        varchar(64)     DEFAULT NULL,
    `ip`                   varchar(64)     DEFAULT NULL,
    `user_agent`           varchar(255)    DEFAULT NULL,
    `claimed_at`           timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`claim_id`),
    UNIQUE KEY `uniq_drop_slot`  (`drop_id`, `slot_index`),
    KEY        `idx_drop_phone`  (`drop_id`, `claimer_phone`),
    KEY        `idx_drop`        (`drop_id`),
    CONSTRAINT `fk_drop_claim` FOREIGN KEY (`drop_id`) REFERENCES `ospos_giftcard_drops` (`drop_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- App config defaults
INSERT INTO `ospos_app_config` (`key`, `value`) VALUES
    ('giftcard_drop_default_ttl_hours', '24'),
    ('giftcard_drop_max_slots',         '50'),
    ('giftcard_drop_min_slice',         '1.00')
    ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);
