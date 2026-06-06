-- ---------------------------------------------------------------------------
-- Lifecycle nudges + SMS provider config — Phase E.5
--
-- A "nudge" is a single proactive SMS sent to the customer's bound phone
-- when an event window crosses (expiry approaches, card has been idle).
-- We dedupe via UNIQUE(giftcard_id, kind) so a 30-day-expiry nudge only
-- ever fires once per card, but a 7-day nudge can fire after it.
--
-- Kinds:
--   expiry_30     — sent when expires_at is within 30 days
--   expiry_7      — within 7 days
--   expiry_1      — within 24 hours
--   idle_60       — card has had no spend or top-up in 60 days
--
-- The spark command `giftcards:nudge` is the cron entry point. It sweeps
-- all active cards, finds candidates per kind, fires the SMS via the
-- SmsSender library, and inserts a row here on success.
-- ---------------------------------------------------------------------------

CREATE TABLE `ospos_giftcard_nudges` (
    `nudge_id`     int(10)         NOT NULL AUTO_INCREMENT,
    `giftcard_id`  int(11)         NOT NULL,
    `kind`         varchar(32)     NOT NULL,
    `phone_masked` varchar(32)     NOT NULL,
    `provider`     varchar(32)     NOT NULL,
    `message_id`   varchar(128)    DEFAULT NULL,
    `status`       enum('sent','failed','dryrun') NOT NULL DEFAULT 'sent',
    `error`        text            DEFAULT NULL,
    `sent_at`      timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`nudge_id`),
    UNIQUE KEY `uniq_card_kind` (`giftcard_id`, `kind`),
    KEY `idx_card`  (`giftcard_id`),
    KEY `idx_sent`  (`sent_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `ospos_app_config` (`key`, `value`) VALUES
    ('giftcard_nudge_enabled',           '1'),
    ('giftcard_nudge_dryrun',            '0'),
    ('giftcard_nudge_brand',             'PESASWAP'),
    ('giftcard_nudge_max_per_run',       '200'),
    ('receipt_regift_qr_enabled',        '1'),
    ('sms_provider',                     'mock'),
    ('sms_sender_id',                    'PESASWAP'),
    ('sms_at_username',                  ''),
    ('sms_at_api_key',                   ''),
    ('sms_twilio_account_sid',           ''),
    ('sms_twilio_auth_token',            ''),
    ('sms_twilio_from',                  ''),
    ('sms_proxy_url',                    ''),
    ('sms_proxy_auth_header',            '')
    ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);
