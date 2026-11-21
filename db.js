// db.js: MariaDB(MySQL) 연결 풀을 만들어서 다른 파일들이 같이 쓰도록 내보내는 파일
const mysql = require('mysql2/promise');

// 연결 풀: 요청마다 새로 접속하지 않고 미리 만든 연결을 돌려 씀
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'toy_playground',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 5, // t3.micro(메모리 1GiB)라서 연결 수를 적게 유지
});

module.exports = pool;
