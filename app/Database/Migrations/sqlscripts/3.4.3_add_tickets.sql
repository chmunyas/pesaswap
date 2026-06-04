-- ----------------------------------------------------------------------------
-- QR Ticketing feature (Phase 0)
--
-- Adds product-level ticket definitions, issued ticket instances, redemption
-- audit log, signing key registry, and per-product allowed-location pivot.
--
-- Subtype-specific columns live in 1:1 child tables so the parent table stays
-- lean and per-subtype data can be queried without scanning the parent.
-- ----------------------------------------------------------------------------

CREATE TABLE `ospos_ticket_signing_keys` (
    `signing_key_id`  int(10)         NOT NULL AUTO_INCREMENT,
    `algorithm`       varchar(16)     NOT NULL DEFAULT 'RS256',
    `public_key_pem`  text            NOT NULL,
    `private_key_pem` text            NOT NULL,
    `created_at`      timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `rotated_at`      timestamp       NULL DEFAULT NULL,
    PRIMARY KEY (`signing_key_id`),
    KEY `idx_active` (`rotated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `ospos_ticket_products` (
    `ticket_product_id`         int(10)         NOT NULL AUTO_INCREMENT,
    `item_id`                   int(10)         NOT NULL,
    `subtype`                   enum('meeting','scenic','movie','transport') NOT NULL,
    `code_type`                 enum('text','barcode','qrcode','only_qrcode','only_barcode') NOT NULL DEFAULT 'qrcode',
    `validity_mode`             enum('fixed','relative') NOT NULL DEFAULT 'fixed',
    `begin_ts`                  datetime        DEFAULT NULL,
    `end_ts`                    datetime        DEFAULT NULL,
    `fixed_begin_term_days`     int(10)         DEFAULT NULL,
    `fixed_term_days`           int(10)         DEFAULT NULL,
    `quantity`                  int(10)         DEFAULT NULL,
    `quantity_issued`           int(10)         NOT NULL DEFAULT 0,
    `max_per_customer`          int(10)         DEFAULT NULL,
    `sale_window_from`          datetime        DEFAULT NULL,
    `sale_window_to`            datetime        DEFAULT NULL,
    `bind_customer`             tinyint(1)      NOT NULL DEFAULT 0,
    `transferable`              tinyint(1)      NOT NULL DEFAULT 1,
    `single_use`                tinyint(1)      NOT NULL DEFAULT 1,
    `max_redemptions`           int(10)         NOT NULL DEFAULT 1,
    `refundable`                tinyint(1)      NOT NULL DEFAULT 1,
    `refund_window_hours`       int(10)         DEFAULT NULL,
    `title`                     varchar(255)    NOT NULL,
    `brand_name`                varchar(255)    DEFAULT NULL,
    `color`                     varchar(16)     DEFAULT NULL,
    `notice`                    varchar(255)    DEFAULT NULL,
    `description`               text            DEFAULT NULL,
    `service_phone`             varchar(64)     DEFAULT NULL,
    `source`                    varchar(64)     DEFAULT NULL,
    `custom_url`                varchar(512)    DEFAULT NULL,
    `custom_url_name`           varchar(64)     DEFAULT NULL,
    `custom_url_sub_title`      varchar(128)    DEFAULT NULL,
    `logo_url`                  varchar(512)    DEFAULT NULL,
    `signing_key_id`            int(10)         NOT NULL,
    `deleted`                   tinyint(1)      NOT NULL DEFAULT 0,
    `created_at`                timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`                timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`ticket_product_id`),
    KEY `idx_item` (`item_id`),
    KEY `idx_subtype` (`subtype`),
    KEY `idx_signing_key` (`signing_key_id`),
    CONSTRAINT `fk_tp_item`        FOREIGN KEY (`item_id`)        REFERENCES `ospos_items` (`item_id`)                          ON DELETE CASCADE,
    CONSTRAINT `fk_tp_signing_key` FOREIGN KEY (`signing_key_id`) REFERENCES `ospos_ticket_signing_keys` (`signing_key_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `ospos_ticket_product_locations` (
    `ticket_product_id` int(10) NOT NULL,
    `location_id`       int(11) NOT NULL,
    PRIMARY KEY (`ticket_product_id`, `location_id`),
    KEY `idx_location` (`location_id`),
    CONSTRAINT `fk_tpl_product`  FOREIGN KEY (`ticket_product_id`) REFERENCES `ospos_ticket_products` (`ticket_product_id`) ON DELETE CASCADE,
    CONSTRAINT `fk_tpl_location` FOREIGN KEY (`location_id`)       REFERENCES `ospos_stock_locations` (`location_id`)       ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `ospos_ticket_product_meeting` (
    `ticket_product_id` int(10)         NOT NULL,
    `meeting_detail`    text            DEFAULT NULL,
    `map_url`           varchar(512)    DEFAULT NULL,
    `entrance`          varchar(128)    DEFAULT NULL,
    `zone`              varchar(128)    DEFAULT NULL,
    PRIMARY KEY (`ticket_product_id`),
    CONSTRAINT `fk_tpm_product` FOREIGN KEY (`ticket_product_id`) REFERENCES `ospos_ticket_products` (`ticket_product_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `ospos_ticket_product_scenic` (
    `ticket_product_id` int(10)         NOT NULL,
    `scenic_name`       varchar(255)    DEFAULT NULL,
    `opening_hours`     varchar(128)    DEFAULT NULL,
    `ticket_class`      varchar(64)     DEFAULT NULL,
    `address`           varchar(512)    DEFAULT NULL,
    PRIMARY KEY (`ticket_product_id`),
    CONSTRAINT `fk_tps_product` FOREIGN KEY (`ticket_product_id`) REFERENCES `ospos_ticket_products` (`ticket_product_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `ospos_ticket_product_movie` (
    `ticket_product_id` int(10)         NOT NULL,
    `film_title`        varchar(255)    DEFAULT NULL,
    `hall`              varchar(64)     DEFAULT NULL,
    `screening_ts`      datetime        DEFAULT NULL,
    `seat_map_json`     longtext        DEFAULT NULL,
    PRIMARY KEY (`ticket_product_id`),
    CONSTRAINT `fk_tpmv_product` FOREIGN KEY (`ticket_product_id`) REFERENCES `ospos_ticket_products` (`ticket_product_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `ospos_ticket_product_transport` (
    `ticket_product_id` int(10)         NOT NULL,
    `origin`            varchar(128)    DEFAULT NULL,
    `destination`       varchar(128)    DEFAULT NULL,
    `carrier`           varchar(128)    DEFAULT NULL,
    `departure_ts`      datetime        DEFAULT NULL,
    `arrival_ts`        datetime        DEFAULT NULL,
    `seat_map_json`     longtext        DEFAULT NULL,
    PRIMARY KEY (`ticket_product_id`),
    CONSTRAINT `fk_tpt_product` FOREIGN KEY (`ticket_product_id`) REFERENCES `ospos_ticket_products` (`ticket_product_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `ospos_tickets` (
    `ticket_id`             int(10)         NOT NULL AUTO_INCREMENT,
    `ticket_product_id`     int(10)         NOT NULL,
    `sale_id`               int(10)         DEFAULT NULL,
    `sale_item_seq`         int(10)         DEFAULT NULL,
    `code`                  varchar(64)     NOT NULL,
    `code_hash`             char(64)        NOT NULL,
    `customer_id`           int(10)         DEFAULT NULL,
    `status`                enum('issued','active','redeemed','refunded','revoked','expired') NOT NULL DEFAULT 'issued',
    `valid_from`            datetime        DEFAULT NULL,
    `valid_to`              datetime        DEFAULT NULL,
    `seat_assignment_json`  text            DEFAULT NULL,
    `issued_at`             timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `redeemed_at`           datetime        DEFAULT NULL,
    `redeemed_by_employee`  int(10)         DEFAULT NULL,
    `redeemed_at_location`  int(11)         DEFAULT NULL,
    `redeem_count`          int(10)         NOT NULL DEFAULT 0,
    `transfer_history_json` text            DEFAULT NULL,
    `deleted`               tinyint(1)      NOT NULL DEFAULT 0,
    PRIMARY KEY (`ticket_id`),
    UNIQUE KEY `uniq_code` (`code`),
    UNIQUE KEY `uniq_code_hash` (`code_hash`),
    KEY `idx_product_status` (`ticket_product_id`, `status`),
    KEY `idx_sale` (`sale_id`),
    KEY `idx_customer` (`customer_id`),
    CONSTRAINT `fk_t_product`  FOREIGN KEY (`ticket_product_id`)    REFERENCES `ospos_ticket_products` (`ticket_product_id`),
    CONSTRAINT `fk_t_sale`     FOREIGN KEY (`sale_id`)              REFERENCES `ospos_sales` (`sale_id`)                ON DELETE SET NULL,
    CONSTRAINT `fk_t_customer` FOREIGN KEY (`customer_id`)          REFERENCES `ospos_people` (`person_id`)             ON DELETE SET NULL,
    CONSTRAINT `fk_t_redeemer` FOREIGN KEY (`redeemed_by_employee`) REFERENCES `ospos_people` (`person_id`)             ON DELETE SET NULL,
    CONSTRAINT `fk_t_location` FOREIGN KEY (`redeemed_at_location`) REFERENCES `ospos_stock_locations` (`location_id`)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `ospos_ticket_redemptions` (
    `redemption_id`             int(10)         NOT NULL AUTO_INCREMENT,
    `ticket_id`                 int(10)         NOT NULL,
    `occurred_at`               timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `employee_id`               int(10)         DEFAULT NULL,
    `location_id`               int(11)         DEFAULT NULL,
    `result`                    enum('ok','already_redeemed','expired','revoked','not_yet_valid','wrong_location','invalid_signature','not_found') NOT NULL,
    `client_idempotency_key`    varchar(64)     DEFAULT NULL,
    `notes`                     varchar(255)    DEFAULT NULL,
    PRIMARY KEY (`redemption_id`),
    UNIQUE KEY `uniq_idempotency` (`ticket_id`, `client_idempotency_key`),
    KEY `idx_ticket` (`ticket_id`),
    KEY `idx_occurred` (`occurred_at`),
    CONSTRAINT `fk_tr_ticket`   FOREIGN KEY (`ticket_id`)   REFERENCES `ospos_tickets` (`ticket_id`)            ON DELETE CASCADE,
    CONSTRAINT `fk_tr_employee` FOREIGN KEY (`employee_id`) REFERENCES `ospos_people` (`person_id`)            ON DELETE SET NULL,
    CONSTRAINT `fk_tr_location` FOREIGN KEY (`location_id`) REFERENCES `ospos_stock_locations` (`location_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `ospos_ticket_webhooks` (
    `webhook_id`        int(10)         NOT NULL AUTO_INCREMENT,
    `url`               varchar(512)    NOT NULL,
    `secret`            varchar(128)    NOT NULL,
    `events`            varchar(255)    NOT NULL DEFAULT 'ticket.issued,ticket.redeemed,ticket.refunded',
    `enabled`           tinyint(1)      NOT NULL DEFAULT 1,
    `created_at`        timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`webhook_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `ospos_ticket_webhook_deliveries` (
    `delivery_id`       int(10)         NOT NULL AUTO_INCREMENT,
    `webhook_id`        int(10)         NOT NULL,
    `event_type`        varchar(64)     NOT NULL,
    `payload`           longtext        NOT NULL,
    `attempts`          int(10)         NOT NULL DEFAULT 0,
    `last_status_code`  int(10)         DEFAULT NULL,
    `last_error`        text            DEFAULT NULL,
    `next_attempt_at`   datetime        DEFAULT NULL,
    `delivered_at`      datetime        DEFAULT NULL,
    `created_at`        timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`delivery_id`),
    KEY `idx_pending` (`delivered_at`, `next_attempt_at`),
    CONSTRAINT `fk_twd_webhook` FOREIGN KEY (`webhook_id`) REFERENCES `ospos_ticket_webhooks` (`webhook_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
