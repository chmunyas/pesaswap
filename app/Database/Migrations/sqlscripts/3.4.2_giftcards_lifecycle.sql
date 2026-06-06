-- ----------------------------------------------------------------------------
-- PESASWAP gift cards lifecycle migration (extracted from
-- docs/migrations/2026_06_04_giftcards_lifecycle.sql to a real CI4 migration
-- so the test DB picks it up automatically).
--
-- Combines patterns from:
--   - Maho Commerce gift cards: status, initial_balance, recipient/sender,
--     expires_at, history audit trail with balance_before/balance_after
--     https://mahocommerce.com/maho-for-devs/gift-cards/
--   - WeChat gift cards: recipient + sender + personalised message,
--     "buy to self" semantics, dynamic QR consumption
--     https://developers.weixin.qq.com/doc/service/en/guide/product/card/gift_card.html
--
-- PESASWAP-specific additions:
--   - currency (KES default - store currency may differ from operating currency)
--   - email_status (not_requested / mocked / sent / failed) - never lies about delivery
--   - History rows can carry provider (mpesa/airtel/mtn_momo/cash/card/bank),
--     reference, transaction_id, txn_status (completed/pending/failed) so MNO
--     STK top-ups are first-class events.
-- ----------------------------------------------------------------------------

ALTER TABLE `ospos_giftcards`
    ADD COLUMN `initial_value`    DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER `value`,
    ADD COLUMN `status`           VARCHAR(16)   NOT NULL DEFAULT 'active' AFTER `initial_value`,
    ADD COLUMN `recipient_name`   VARCHAR(255)  NULL AFTER `status`,
    ADD COLUMN `recipient_email`  VARCHAR(255)  NULL AFTER `recipient_name`,
    ADD COLUMN `sender_name`      VARCHAR(255)  NULL AFTER `recipient_email`,
    ADD COLUMN `sender_email`     VARCHAR(255)  NULL AFTER `sender_name`,
    ADD COLUMN `message`          TEXT          NULL AFTER `sender_email`,
    ADD COLUMN `currency`         VARCHAR(8)    NOT NULL DEFAULT 'KES' AFTER `message`,
    ADD COLUMN `expires_at`       DATETIME      NULL AFTER `currency`,
    ADD COLUMN `email_status`     VARCHAR(16)   NOT NULL DEFAULT 'not_requested' AFTER `expires_at`,
    ADD COLUMN `email_sent_at`    DATETIME      NULL AFTER `email_status`,
    ADD COLUMN `updated_at`       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `email_sent_at`,
    ADD INDEX `idx_giftcards_status` (`status`),
    ADD INDEX `idx_giftcards_recipient_email` (`recipient_email`),
    ADD INDEX `idx_giftcards_expires_at` (`expires_at`);

UPDATE `ospos_giftcards` SET `initial_value` = `value` WHERE `initial_value` = 0;
UPDATE `ospos_giftcards` SET `status` = 'used' WHERE `value` <= 0 AND `status` = 'active';
UPDATE `ospos_giftcards` SET `status` = 'disabled' WHERE `deleted` = 1 AND `status` != 'disabled';

CREATE TABLE IF NOT EXISTS `ospos_giftcard_history` (
    `history_id`     INT           NOT NULL AUTO_INCREMENT,
    `giftcard_id`    INT           NOT NULL,
    `action`         VARCHAR(32)   NOT NULL,
    `amount`         DECIMAL(15,2) NOT NULL DEFAULT 0,
    `balance_before` DECIMAL(15,2) NOT NULL DEFAULT 0,
    `balance_after`  DECIMAL(15,2) NOT NULL DEFAULT 0,
    `provider`       VARCHAR(32)   NULL,
    `reference`      VARCHAR(64)   NULL,
    `transaction_id` VARCHAR(64)   NULL,
    `txn_status`     VARCHAR(16)   NOT NULL DEFAULT 'completed',
    `order_id`       INT           NULL,
    `user_id`        INT           NULL,
    `comment`        TEXT          NULL,
    `created_at`     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`history_id`),
    INDEX `idx_gh_giftcard_created` (`giftcard_id`, `created_at`),
    INDEX `idx_gh_action` (`action`),
    INDEX `idx_gh_txn_status` (`txn_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `ospos_giftcard_history` (`giftcard_id`, `action`, `amount`, `balance_before`, `balance_after`, `comment`, `created_at`)
SELECT `giftcard_id`, 'created', `value`, 0, `value`, 'Backfilled from legacy schema', `record_time`
FROM `ospos_giftcards`
WHERE NOT EXISTS (
    SELECT 1 FROM `ospos_giftcard_history`
    WHERE `ospos_giftcard_history`.`giftcard_id` = `ospos_giftcards`.`giftcard_id`
);
