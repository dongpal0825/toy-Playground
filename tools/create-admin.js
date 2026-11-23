// tools/create-admin.js: 관리자 계정을 만들거나, 이미 있는 계정을 관리자로 바꾸는 도구
// 비밀번호는 코드나 GitHub에 남기지 않도록 실행할 때 입력받음 (화면 입력 또는 파이프)
// 사용법: node tools/create-admin.js <아이디> [닉네임]
//   예) node tools/create-admin.js admin 관리자   -> 비밀번호를 물어봄
require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcrypt');
const pool = require('../db');
const { ensureSchema } = require('../lib/accounts');

const username = process.argv[2];
const nickname = process.argv[3] || '관리자';

// 비밀번호 한 줄 읽기 (키보드 입력이면 안내 문구를 보여 줌)
function readPassword() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    if (process.stdin.isTTY) process.stdout.write('관리자 비밀번호: ');
    rl.once('line', (line) => { rl.close(); resolve(line); });
  });
}

async function main() {
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username || '')) {
    console.log('사용법: node tools/create-admin.js <아이디(영문/숫자/_ 3~20자)> [닉네임]');
    process.exit(1);
  }
  const password = await readPassword();
  if (password.length < 4 || password.length > 72) {
    console.log('비밀번호는 4~72자로 입력해 주세요.');
    process.exit(1);
  }

  await ensureSchema(); // is_admin 컬럼이 없으면 먼저 추가
  const hash = await bcrypt.hash(password, 10);
  const [rows] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
  if (rows.length > 0) {
    await pool.query('UPDATE users SET password_hash = ?, is_admin = 1 WHERE id = ?', [hash, rows[0].id]);
    console.log(`${username} 계정을 관리자로 바꾸고 비밀번호를 새로 설정했어요.`);
  } else {
    await pool.query('INSERT INTO users (username, password_hash, nickname, is_admin) VALUES (?, ?, ?, 1)', [username, hash, nickname]);
    console.log(`관리자 계정 ${username}(${nickname})을 만들었어요.`);
  }
  await pool.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
