-- ----------------------------------------------------------------------------
-- QR Ticketing - Phase 3 (delivery + i18n + wallet)
--
-- Adds the customer-experience layer:
--
--   - ticket_product_translations: per-locale title/notice/description so
--     a single product can show in the holder's preferred language. The
--     public claim page resolves via Accept-Language.
--   - ticket_delivery_attempts: full audit trail of email/SMS/wallet
--     delivery attempts, with attempt count + last_error for retry logic.
--     A single ticket can have many delivery rows (re-sends, multi-channel).
--   - app_config keys for Apple Pass cert, Google Wallet service-account
--     JSON, and an opt-in toggle for auto-delivery at issuance.
--
-- All ADD COLUMN / CREATE TABLE statements are reversible via the
-- migration down() method.
-- ----------------------------------------------------------------------------

CREATE TABLE `ospos_ticket_product_translations` (
    `ticket_product_id` int(10)         NOT NULL,
    `locale`            varchar(16)     NOT NULL,
    `title`             varchar(255)    DEFAULT NULL,
    `notice`            varchar(255)    DEFAULT NULL,
    `description`       text            DEFAULT NULL,
    `updated_at`        timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`ticket_product_id`, `locale`),
    CONSTRAINT `fk_tptrans_product` FOREIGN KEY (`ticket_product_id`)
        REFERENCES `ospos_ticket_products` (`ticket_product_id`)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `ospos_ticket_delivery_attempts` (
    `delivery_id`     int(10)         NOT NULL AUTO_INCREMENT,
    `ticket_id`       int(10)         NOT NULL,
    `channel`         enum('email','sms','apple_wallet','google_wallet') NOT NULL,
    `address`         varchar(255)    DEFAULT NULL,
    `status`          enum('queued','sent','failed','bounced') NOT NULL DEFAULT 'queued',
    `attempts`        int(10)         NOT NULL DEFAULT 0,
    `last_attempt_at` timestamp       NULL DEFAULT NULL,
    `last_error`      text            DEFAULT NULL,
    `created_at`      timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `sent_at`         timestamp       NULL DEFAULT NULL,
    PRIMARY KEY (`delivery_id`),
    KEY `idx_ticket`         (`ticket_id`, `channel`, `status`),
    KEY `idx_retry_queue`    (`status`, `last_attempt_at`),
    CONSTRAINT `fk_tda_ticket` FOREIGN KEY (`ticket_id`)
        REFERENCES `ospos_tickets` (`ticket_id`)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

INSERT IGNORE INTO `ospos_app_config` (`key`, `value`) VALUES
    ('ticket_apple_pass_cert_pem',     ''),
    ('ticket_apple_pass_key_pem',      ''),
    ('ticket_apple_pass_key_password', ''),
    ('ticket_apple_pass_type_id',      ''),
    ('ticket_apple_team_id',           ''),
    ('ticket_apple_wwdr_cert_pem',     ''),
    ('ticket_google_service_account_json', ''),
    ('ticket_google_issuer_id',        ''),
    ('ticket_delivery_email_enabled',  '1'),
    ('ticket_delivery_sms_enabled',    '0'),
    ('ticket_delivery_from_email',     ''),
    ('ticket_delivery_email_subject',  'Your ticket: {{title}}'),
    ('ticket_delivery_sms_template',   'Your ticket {{code}} for {{title}} is ready. View: {{url}}');
