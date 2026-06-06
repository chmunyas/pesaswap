-- ----------------------------------------------------------------------------
-- QR Ticketing - MNO refund audit (ent-mno-refund / phase5-refund-mno)
--
-- Adds ticket_refund_payments. One row per reversed tender for each
-- refunded ticket. Mirrors the gift-cards giftcard_history MNO row shape
-- (provider + reference + transaction_id + txn_status) so we can report on
-- refund success rates and replay failed reversals.
--
-- The refund flow looks up the original sale sales_payments rows, splits
-- the ticket value proportionally across each tender, classifies mobile
-- money (mpesa/airtel/mtn_momo) as MNO and triggers a reversal (Phase 5
-- ships the mocked version that returns completed - a future worker can
-- actually call the MNO API), and Cash/Card/Cheque/Other as manual
-- cashout pending.
-- ----------------------------------------------------------------------------

CREATE TABLE `ospos_ticket_refund_payments` (
    `refund_payment_id` int(10)         NOT NULL AUTO_INCREMENT,
    `ticket_id`         int(10)         NOT NULL,
    `sale_id`           int(10)         DEFAULT NULL,
    `payment_type`      varchar(40)     NOT NULL,
    `provider`          varchar(32)     DEFAULT NULL,
    `amount`            decimal(15,2)   NOT NULL DEFAULT '0.00',
    `transaction_id`    varchar(64)     DEFAULT NULL,
    `reference`         varchar(64)     DEFAULT NULL,
    `txn_status`        enum('pending','completed','failed') NOT NULL DEFAULT 'pending',
    `kind`              enum('mno','manual') NOT NULL DEFAULT 'manual',
    `error`             varchar(255)    DEFAULT NULL,
    `employee_id`       int(10)         DEFAULT NULL,
    `created_at`        timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`refund_payment_id`),
    KEY `idx_ticket`     (`ticket_id`, `created_at`),
    KEY `idx_txn_status` (`txn_status`),
    KEY `idx_kind`       (`kind`),
    CONSTRAINT `fk_trp_ticket` FOREIGN KEY (`ticket_id`)
        REFERENCES `ospos_tickets` (`ticket_id`)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
