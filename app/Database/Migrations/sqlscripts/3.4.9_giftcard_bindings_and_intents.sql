-- ----------------------------------------------------------------------------
-- Gift cards Phase 6 - NFC bindings, payment intents, customer wallets, OTPs
--
-- Backs the NFC-binding + multi-tender + customer-self-service flow whose UI
-- shipped in c51cebcb1 and e8c8d355e.
--
--   - ospos_giftcard_bindings: NFC-style link from a card code to a customer
--     mobile + MNO provider. Once active, redemptions go through STK push
--     PIN auth rather than the raw bearer code.
--   - ospos_giftcard_payment_intents: async authorization lifecycle for a
--     tender. Card-balance and wallet sources resolve synchronously inside
--     one tx — MNO and Co-op sources go pending then awaiting_pin then are
--     flipped by a webhook or the sweep cron.
--   - ospos_pesaswap_wallets: one row per (person_id, currency). Created
--     lazily on first explicit top-up - never on read - so the wallet does
--     not bloat.
--   - ospos_giftcard_otps: short-lived OTP records for self-service unbind
--     and disable verbs. Stored hashed with attempt counter and consumed_at
--     so fraud can be forensically traced (cache-only would lose this).
--
-- Concurrency invariants enforced at the schema level via generated columns
--   + partial-style unique indexes (MariaDB 10.5+):
--   - At most ONE active binding per card (uniq_active_binding).
--   - At most ONE in-flight intent per card (uniq_inflight_intent).
--   - At most ONE wallet per (person, currency, not-deleted).
--
-- All ALTER and CREATE statements are reversible via the migration down().
-- No FKs (matches OSPOS legacy style). All InnoDB + utf8mb4_unicode_ci.
-- ----------------------------------------------------------------------------

CREATE TABLE `ospos_giftcard_bindings` (
    `binding_id`               int(10)         NOT NULL AUTO_INCREMENT,
    `giftcard_id`              int(11)         NOT NULL,
    `mobile_number`            varchar(32)     NOT NULL,
    `mno_provider`             enum('mpesa','airtel','mtn_momo') NOT NULL,
    `status`                   enum('pending','active','disabled') NOT NULL DEFAULT 'pending',
    `bound_at`                 datetime        DEFAULT NULL,
    `last_used_at`             datetime        DEFAULT NULL,
    `pin_attempts`             int(10)         NOT NULL DEFAULT 0,
    `initiated_by_employee_id` int(10)         DEFAULT NULL,
    `mno_request_id`           varchar(64)     DEFAULT NULL,
    `idempotency_key`          varchar(64)     DEFAULT NULL,
    `expires_at`               datetime        DEFAULT NULL,
    `ip`                       varchar(64)     DEFAULT NULL,
    `user_agent`               varchar(255)    DEFAULT NULL,
    `deleted`                  tinyint(1)      NOT NULL DEFAULT 0,
    `created_at`               timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`               timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `active_card`              int(11) GENERATED ALWAYS AS (CASE WHEN `status`='active' AND `deleted`=0 THEN `giftcard_id` ELSE NULL END) STORED,
    PRIMARY KEY (`binding_id`),
    UNIQUE KEY `uniq_active_binding` (`active_card`),
    UNIQUE KEY `uniq_card_idempotency` (`giftcard_id`, `idempotency_key`),
    KEY `idx_card_status` (`giftcard_id`, `status`, `deleted`),
    KEY `idx_mno_request` (`mno_request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ospos_giftcard_payment_intents` (
    `intent_id`                int(10)         NOT NULL AUTO_INCREMENT,
    `giftcard_id`              int(11)         DEFAULT NULL,
    `sale_id`                  int(11)         DEFAULT NULL,
    `amount`                   decimal(15,2)   NOT NULL,
    `currency`                 varchar(8)      NOT NULL DEFAULT 'KES',
    `source`                   enum('card_balance','mpesa','airtel','mtn_momo','pesaswap_wallet','coop_bank','coop_bnpl','split') NOT NULL,
    `status`                   enum('pending','awaiting_pin','authorised','completed','failed','cancelled','expired') NOT NULL DEFAULT 'pending',
    `mno_request_id`           varchar(64)     DEFAULT NULL,
    `mno_txn_ref`              varchar(64)     DEFAULT NULL,
    `failure_code`             varchar(32)     DEFAULT NULL,
    `failure_reason`           varchar(255)    DEFAULT NULL,
    `initiated_by_employee_id` int(10)         DEFAULT NULL,
    `idempotency_key`          varchar(64)     DEFAULT NULL,
    `ip`                       varchar(64)     DEFAULT NULL,
    `user_agent`               varchar(255)    DEFAULT NULL,
    `created_at`               timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `expires_at`               timestamp       NULL DEFAULT NULL,
    `completed_at`             timestamp       NULL DEFAULT NULL,
    `in_flight_card`           int(11) GENERATED ALWAYS AS (CASE WHEN `status` IN ('pending','awaiting_pin','authorised') AND `giftcard_id` IS NOT NULL THEN `giftcard_id` ELSE NULL END) STORED,
    PRIMARY KEY (`intent_id`),
    UNIQUE KEY `uniq_inflight_intent` (`in_flight_card`),
    UNIQUE KEY `uniq_card_idempotency` (`giftcard_id`, `idempotency_key`),
    KEY `idx_card_status` (`giftcard_id`, `status`),
    KEY `idx_sweep` (`status`, `expires_at`),
    KEY `idx_mno_request` (`mno_request_id`),
    KEY `idx_mno_txn` (`mno_txn_ref`),
    KEY `idx_sale` (`sale_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ospos_pesaswap_wallets` (
    `wallet_id`    int(10)         NOT NULL AUTO_INCREMENT,
    `person_id`    int(10)         NOT NULL,
    `currency`     varchar(8)      NOT NULL DEFAULT 'KES',
    `balance`      decimal(15,2)   NOT NULL DEFAULT 0.00,
    `deleted`      tinyint(1)      NOT NULL DEFAULT 0,
    `created_at`   timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`   timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `active_wallet` varchar(64) GENERATED ALWAYS AS (CASE WHEN `deleted`=0 THEN CONCAT(`person_id`,'|',`currency`) ELSE NULL END) STORED,
    PRIMARY KEY (`wallet_id`),
    UNIQUE KEY `uniq_active_wallet` (`active_wallet`),
    KEY `idx_person` (`person_id`, `deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ospos_giftcard_otps` (
    `otp_id`         int(10)         NOT NULL AUTO_INCREMENT,
    `giftcard_id`    int(11)         NOT NULL,
    `action`         enum('unbind','disable') NOT NULL,
    `code_hash`      char(64)        NOT NULL,
    `attempts`       tinyint(2)      NOT NULL DEFAULT 0,
    `max_attempts`   tinyint(2)      NOT NULL DEFAULT 5,
    `created_at`     timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `expires_at`     datetime        NOT NULL,
    `consumed_at`    datetime        DEFAULT NULL,
    `ip`             varchar(64)     DEFAULT NULL,
    `user_agent`     varchar(255)    DEFAULT NULL,
    `active_otp`     varchar(64) GENERATED ALWAYS AS (CASE WHEN `consumed_at` IS NULL THEN CONCAT(`giftcard_id`,'|',`action`) ELSE NULL END) STORED,
    PRIMARY KEY (`otp_id`),
    UNIQUE KEY `uniq_active_otp` (`active_otp`),
    KEY `idx_card_action` (`giftcard_id`, `action`),
    KEY `idx_expiry` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Seed: app_config entries so the operator can configure secrets without an
-- ALTER. Empty defaults mean "dev mode" - HMAC bypass on webhooks, inline OTP
-- return on send. Production deployments MUST set these.
-- ----------------------------------------------------------------------------
INSERT INTO `ospos_app_config` (`key`, `value`) VALUES
    ('giftcard_mno_webhook_secret',   ''),
    ('giftcard_otp_inline_return',    '1'),
    ('giftcard_otp_ttl_minutes',      '5'),
    ('giftcard_intent_ttl_seconds',   '60'),
    ('giftcard_binding_ttl_minutes',  '15');
