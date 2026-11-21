-- schema.sql: 장난감 놀이터 DB의 테이블을 만들고 기본 데이터(장난감 5종, 서버 3개)를 넣는 파일
-- 실행 방법: mysql -u root -p < schema.sql   (MariaDB / MySQL 8 모두 동작)

-- 이 파일을 UTF-8로 읽게 함 (Windows에서 실행할 때 한글이 깨지는 문제 방지)
SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS toy_playground
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE toy_playground;

-- 장난감 캐릭터 종류 (공룡, 곰인형, 로봇, 고무 오리, 펭귄)
CREATE TABLE IF NOT EXISTS toys (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(30)  NOT NULL,
  model_file  VARCHAR(100) NOT NULL,            -- public/models 폴더의 GLB 파일 이름
  description VARCHAR(200)
);

-- 회원 정보 (비밀번호는 bcrypt 해시로만 저장)
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(30)  NOT NULL UNIQUE,   -- 로그인 아이디
  password_hash VARCHAR(100) NOT NULL,
  nickname      VARCHAR(20)  NOT NULL,          -- 캐릭터 머리 위에 보이는 이름
  toy_id        INT          NOT NULL DEFAULT 1,
  color         VARCHAR(7)   NOT NULL DEFAULT '#4caf50', -- 캐릭터 색 (#RRGGBB)
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_toy FOREIGN KEY (toy_id) REFERENCES toys(id)
);

-- 서버(방) 목록: 서버 1, 2, 3
CREATE TABLE IF NOT EXISTS rooms (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(30) NOT NULL,
  max_players INT         NOT NULL DEFAULT 20
);

-- 채팅 기록 (입장 시 최근 채팅을 불러올 때 사용)
CREATE TABLE IF NOT EXISTS chat_messages (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  room_id    INT          NOT NULL,
  user_id    INT          NOT NULL,
  content    VARCHAR(200) NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_chat_room FOREIGN KEY (room_id) REFERENCES rooms(id),
  CONSTRAINT fk_chat_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_chat_room_time (room_id, created_at)
);

-- 접속/퇴장 기록 + 퇴장할 때의 마지막 위치
CREATE TABLE IF NOT EXISTS play_logs (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  user_id   INT      NOT NULL,
  room_id   INT      NOT NULL,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at   DATETIME NULL,                      -- 아직 접속 중이면 NULL
  last_x    FLOAT    NULL,
  last_z    FLOAT    NULL,
  CONSTRAINT fk_log_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_log_room FOREIGN KEY (room_id) REFERENCES rooms(id)
);

-- 기본 데이터: 장난감 5종 (id를 고정해서, 다시 실행하면 중복 대신 최신 내용으로 덮어씀)
INSERT INTO toys (id, name, model_file, description) VALUES
  (1, '공룡',     'dino.glb',    '꼬리를 흔드는 작은 공룡'),
  (2, '곰인형',   'bear.glb',    '폭신폭신한 곰인형'),
  (3, '로봇',     'robot.glb',   '네모난 태엽 로봇'),
  (4, '고무 오리', 'duck.glb',    '삑삑 소리 나는 고무 오리'),
  (5, '펭귄',     'penguin.glb', '뒤뚱뒤뚱 펭귄')
ON DUPLICATE KEY UPDATE name = VALUES(name), model_file = VALUES(model_file), description = VALUES(description);

-- 기본 데이터: 서버 3개
INSERT INTO rooms (id, name, max_players) VALUES
  (1, '서버 1', 20),
  (2, '서버 2', 20),
  (3, '서버 3', 20)
ON DUPLICATE KEY UPDATE name = VALUES(name), max_players = VALUES(max_players);
