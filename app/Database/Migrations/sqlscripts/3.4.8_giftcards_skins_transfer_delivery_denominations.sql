-- ----------------------------------------------------------------------------
-- Gift Cards — WeChat-parity Phase: skins, denominations, transfer, schedule
--
-- Brings the gift-card feature toward WeChat Gift Card + Maho parity:
--
--   - giftcard_designs: visual skins (gradient colors + icon + optional image)
--     pickable when issuing a card. WeChat ships a similar template gallery.
--   - giftcard_denominations: preset amounts per currency (KES 500/1k/2.5k/5k/10k)
--     so cashiers can issue with one tap instead of typing.
--   - giftcard_transfers: send-as-gift flow. Mirror of ticket_transfers, but
--     adapted for the BEARER nature of gift cards:
--       * verification_token_hash = SHA-256 of a 128-bit URL token (16 bytes,
--         32 hex chars) — the plaintext token never lives in the DB.
--       * on accept the giftcard_number is ROTATED (new unique code) so the
--         sender's copy of the old code stops working — this is the only way
--         to make ownership transfer real on a bearer instrument that the
--         legacy POS redeems by code alone.
--       * audit snapshots: balance_at_request / balance_at_accept and
--         old/new_code_masked so the ownership chain is forensically clear.
--   - ALTER ospos_giftcards adds: design_id (nullable, no FK — matches OSPOS
--     legacy style), deliver_at / delivered_at + delivery_status enum for
--     scheduled-delivery cards, and denomination_amount/label snapshots so
--     later admin edits to a denomination don't rewrite history.
--
-- All ADD COLUMN and CREATE TABLE statements are reversible via the
-- migration's down() method. No foreign keys are introduced — OSPOS does not
-- generally use FKs (see initial_schema.sql) so dropping in app-side validation
-- avoids cross-table delete-cascade surprises.
-- ----------------------------------------------------------------------------

CREATE TABLE `ospos_giftcard_designs` (
    `design_id`        int(10)         NOT NULL AUTO_INCREMENT,
    `name`             varchar(64)     NOT NULL,
    `background_from`  varchar(16)     NOT NULL DEFAULT '#3B82F6',
    `background_to`    varchar(16)     NOT NULL DEFAULT '#8B5CF6',
    `accent_color`     varchar(16)     NOT NULL DEFAULT '#FFFFFF',
    `text_color`       varchar(16)     NOT NULL DEFAULT '#FFFFFF',
    `image_url`        varchar(512)    DEFAULT NULL,
    `icon`             varchar(32)     DEFAULT NULL,
    `active`           tinyint(1)      NOT NULL DEFAULT 1,
    `sort_order`       int(10)         NOT NULL DEFAULT 0,
    `created_at`       timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`       timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted`          tinyint(1)      NOT NULL DEFAULT 0,
    PRIMARY KEY (`design_id`),
    KEY `idx_active_sort` (`active`, `sort_order`, `deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ospos_giftcard_denominations` (
    `denomination_id`  int(10)         NOT NULL AUTO_INCREMENT,
    `currency`         varchar(8)      NOT NULL DEFAULT 'KES',
    `amount`           decimal(15,2)   NOT NULL,
    `label`            varchar(64)     DEFAULT NULL,
    `description`      varchar(255)    DEFAULT NULL,
    `active`           tinyint(1)      NOT NULL DEFAULT 1,
    `sort_order`       int(10)         NOT NULL DEFAULT 0,
    `created_at`       timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`       timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted`          tinyint(1)      NOT NULL DEFAULT 0,
    PRIMARY KEY (`denomination_id`),
    KEY `idx_currency_active` (`currency`, `active`, `sort_order`, `deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ospos_giftcard_transfers` (
    `transfer_id`                int(10)         NOT NULL AUTO_INCREMENT,
    `giftcard_id`                int(11)         NOT NULL,
    `initiated_by_employee_id`   int(10)         DEFAULT NULL,
    `channel`                    enum('email','sms','link') NOT NULL DEFAULT 'link',
    `to_recipient_name`          varchar(255)    DEFAULT NULL,
    `to_recipient_email`         varchar(255)    DEFAULT NULL,
    `to_recipient_phone`         varchar(64)     DEFAULT NULL,
    `message`                    text            DEFAULT NULL,
    `verification_token_hash`    char(64)        NOT NULL,
    `verification_expires_at`    datetime        DEFAULT NULL,
    `accepted_at`                datetime        DEFAULT NULL,
    `cancelled_at`               datetime        DEFAULT NULL,
    `cancelled_reason`           varchar(64)     DEFAULT NULL,
    `balance_at_request`         decimal(15,2)   DEFAULT NULL,
    `balance_at_accept`          decimal(15,2)   DEFAULT NULL,
    `old_code_masked`            varchar(32)     DEFAULT NULL,
    `new_code_masked`            varchar(32)     DEFAULT NULL,
    `accepted_recipient_name`    varchar(255)    DEFAULT NULL,
    `accepted_recipient_email`   varchar(255)    DEFAULT NULL,
    `accepted_recipient_phone`   varchar(64)     DEFAULT NULL,
    `ip`                         varchar(64)     DEFAULT NULL,
    `user_agent`                 varchar(255)    DEFAULT NULL,
    `client_idempotency_key`     varchar(64)     DEFAULT NULL,
    `created_at`                 timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`transfer_id`),
    UNIQUE KEY `uniq_card_idempotency` (`giftcard_id`, `client_idempotency_key`),
    KEY `idx_token` (`verification_token_hash`),
    KEY `idx_card_state` (`giftcard_id`, `accepted_at`, `cancelled_at`, `verification_expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `ospos_giftcards`
    ADD COLUMN `design_id`                    int(10)       DEFAULT NULL AFTER `currency`,
    ADD COLUMN `denomination_amount_snapshot` decimal(15,2) DEFAULT NULL AFTER `design_id`,
    ADD COLUMN `denomination_label_snapshot`  varchar(64)   DEFAULT NULL AFTER `denomination_amount_snapshot`,
    ADD COLUMN `deliver_at`                   datetime      DEFAULT NULL AFTER `denomination_label_snapshot`,
    ADD COLUMN `delivered_at`                 datetime      DEFAULT NULL AFTER `deliver_at`,
    ADD COLUMN `delivery_status`              varchar(16)   NOT NULL DEFAULT 'immediate' AFTER `delivered_at`,
    ADD KEY `idx_delivery_due` (`delivery_status`, `deliver_at`),
    ADD KEY `idx_design` (`design_id`);

-- ----------------------------------------------------------------------------
-- Seed: 6 default card designs (gradient + lucide icon name). Names are stable
-- so app code can reference them — colors/icons can be edited freely.
-- ----------------------------------------------------------------------------
INSERT INTO `ospos_giftcard_designs`
    (`name`, `background_from`, `background_to`, `accent_color`, `text_color`, `icon`, `sort_order`) VALUES
    ('Classic',  '#3B82F6', '#8B5CF6', '#FFFFFF', '#FFFFFF', 'Gift',     1),
    ('Sunset',   '#F59E0B', '#EF4444', '#FFF7ED', '#FFFFFF', 'Sparkles', 2),
    ('Forest',   '#10B981', '#047857', '#ECFDF5', '#FFFFFF', 'TreePine', 3),
    ('Birthday', '#EC4899', '#F97316', '#FFF1F2', '#FFFFFF', 'Cake',     4),
    ('Holiday',  '#DC2626', '#16A34A', '#FFFBEB', '#FFFFFF', 'Star',     5),
    ('Wedding',  '#D946EF', '#F472B6', '#FDF2F8', '#FFFFFF', 'Heart',    6);

-- ----------------------------------------------------------------------------
-- Seed: 5 default KES denominations. Add more (or other currencies) via the
-- admin UI after install.
-- ----------------------------------------------------------------------------
INSERT INTO `ospos_giftcard_denominations`
    (`currency`, `amount`, `label`, `sort_order`) VALUES
    ('KES',    500.00, 'KES 500',     1),
    ('KES',   1000.00, 'KES 1,000',   2),
    ('KES',   2500.00, 'KES 2,500',   3),
    ('KES',   5000.00, 'KES 5,000',   4),
    ('KES',  10000.00, 'KES 10,000',  5);
