CREATE TABLE IF NOT EXISTS ospos_webhook_subscriptions (
  subscription_id INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  label VARCHAR(128) NOT NULL,
  target_url VARCHAR(512) NOT NULL,
  secret_vault_key VARCHAR(64) NOT NULL,
  event_mask VARCHAR(512) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by_employee_id INT(10) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (subscription_id),
  KEY idx_wsub_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ospos_webhook_deliveries (
  delivery_id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  subscription_id INT(10) UNSIGNED NOT NULL,
  event VARCHAR(64) NOT NULL,
  payload_json LONGTEXT NOT NULL,
  status ENUM('queued','sent','failed','bounced') NOT NULL DEFAULT 'queued',
  attempts INT(10) NOT NULL DEFAULT 0,
  last_response_code INT(10) NULL,
  last_response_body TEXT NULL,
  last_attempt_at TIMESTAMP NULL,
  next_attempt_at TIMESTAMP NULL,
  request_id VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP NULL,
  PRIMARY KEY (delivery_id),
  KEY idx_wdel_status_next (status, next_attempt_at),
  KEY idx_wdel_sub_created (subscription_id, created_at),
  KEY idx_wdel_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
