// lib/realtime.js: socket.io 서버를 다른 파일(라우트 등)에서도 쓸 수 있게 보관하는 곳
// 예) 게시판에 새 글이 올라오면 모든 서버의 접속자에게 알림, 계정 삭제 시 접속 끊기
let io = null;

function setIo(server) {
  io = server;
}
function getIo() {
  return io;
}

module.exports = { setIo, getIo };
