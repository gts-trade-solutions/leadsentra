-- ---------------------------------------------------------------------
-- Orders (order confirmations)
--
-- The workflow is Offer -> Proforma Invoice -> Order. When a customer confirms,
-- the user marks a proforma invoice as an "order confirmation", which snapshots
-- the invoice's customer + amount into an order row stored in the Orders tab.
-- One order per source invoice (deduped).
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS orders (
  id               CHAR(36)      NOT NULL,
  user_id          CHAR(36)      NOT NULL,
  order_number     VARCHAR(64)   NOT NULL,            -- e.g. ORD-2026-0001
  invoice_id       CHAR(36)      NULL,                -- source proforma invoice
  invoice_number   VARCHAR(64)   NULL,                -- denormalised for display
  offer_id         CHAR(36)      NULL,                -- traceability (optional)

  customer_name    VARCHAR(255)  NULL,
  customer_email   VARCHAR(255)  NULL,
  customer_company VARCHAR(255)  NULL,
  customer_address TEXT          NULL,

  currency         VARCHAR(8)    NOT NULL DEFAULT 'INR',
  total            DECIMAL(14,2) NOT NULL DEFAULT 0,

  status           VARCHAR(24)   NOT NULL DEFAULT 'confirmed', -- confirmed | in_progress | delivered | cancelled
  po_number        VARCHAR(128)  NULL,                -- customer's purchase-order ref
  notes            TEXT          NULL,

  confirmed_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_user_number (user_id, order_number),
  UNIQUE KEY uq_orders_user_invoice (user_id, invoice_id),
  KEY idx_orders_user_created (user_id, created_at),
  KEY idx_orders_status (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-user, per-year order-number counter (row-locked inside the create txn).
CREATE TABLE IF NOT EXISTS order_seq (
  user_id  CHAR(36) NOT NULL,
  yr       INT      NOT NULL,
  last_seq INT      NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, yr)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
