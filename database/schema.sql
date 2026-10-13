-- =====================================================================
-- ThreadAI — An AI-Powered Clothing Reuse and Recycling Management System
-- MySQL 8.0 schema  (database: threadai_db)
--
-- Setup:
--   mysql -u root -p < database/schema.sql
-- or from the MySQL shell:
--   SOURCE database/schema.sql;
-- =====================================================================

CREATE DATABASE IF NOT EXISTS threadai_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE threadai_db;

-- ---------------------------------------------------------------------
-- 1. Users
--    Passwords are never stored in plaintext — only bcrypt hashes.
--    role is constrained so public registration can never create an admin.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name     VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL,
  -- Optional: registration only requires email + password.
  -- The pickup form collects a contact number separately.
  phone         VARCHAR(20)  NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role (role)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. Clothing pickup requests
--    request_code is the human-readable ID shown in the UI (TAI-0001).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clothing_requests (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_code     VARCHAR(20)  NULL,
  user_id          INT UNSIGNED NOT NULL,
  clothing_category VARCHAR(80) NOT NULL,
  clothing_condition ENUM('Like New', 'Good', 'Fair', 'Worn') NOT NULL,
  quantity         INT UNSIGNED NOT NULL,
  request_type     ENUM('donate', 'recycle') NOT NULL,
  description      TEXT NULL,
  pickup_address   VARCHAR(255) NOT NULL,
  pickup_date      DATE NOT NULL,
  contact_phone    VARCHAR(20)  NOT NULL,
  status           ENUM('Pending', 'Accepted', 'Pickup Scheduled', 'Picked Up', 'Completed', 'Rejected')
                   NOT NULL DEFAULT 'Pending',
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_request_code (request_code),
  KEY idx_requests_user (user_id),
  KEY idx_requests_status (status),
  CONSTRAINT fk_requests_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_requests_quantity CHECK (quantity >= 1 AND quantity <= 100)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 3. AI analysis results
--    Phase 2: may hold manually reviewed / demonstration entries only.
--    Fields stay nullable because there is no real model until Phase 3 —
--    the API must never invent predictions.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_analyses (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id            INT UNSIGNED NULL,
  image_path         VARCHAR(255) NULL,
  predicted_category VARCHAR(80)  NULL,
  predicted_condition VARCHAR(80) NULL,
  recommendation     VARCHAR(20)  NULL,
  confidence_score   DECIMAL(5,2) NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_analysis_user (user_id),
  CONSTRAINT fk_analysis_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_confidence CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100))
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 4. Feedback (rating + message), tied to the signed-in user when known
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NULL,
  rating     TINYINT UNSIGNED NOT NULL,
  message    TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_feedback_user (user_id),
  CONSTRAINT fk_feedback_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_feedback_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 5. Request status history (admin audit trail + user-visible timeline)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS request_status_history (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id  INT UNSIGNED NOT NULL,
  old_status  VARCHAR(20) NULL,
  new_status  VARCHAR(20) NOT NULL,
  changed_by  INT UNSIGNED NULL,
  note        VARCHAR(255) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_history_request (request_id),
  CONSTRAINT fk_history_request
    FOREIGN KEY (request_id) REFERENCES clothing_requests (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_history_user
    FOREIGN KEY (changed_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Initial administrator account
--    No password is hardcoded here. Create the admin account with:
--        cd backend && npm run create-admin
--    which reads ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME from backend/.env
--    and stores a bcrypt hash.
-- ---------------------------------------------------------------------
