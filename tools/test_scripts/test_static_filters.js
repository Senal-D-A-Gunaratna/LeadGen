const path = require('path');
let io;
try {
  io = require('socket.io-client');
} catch (err) {
  // Try to load the dependency from the frontend folder's node_modules
  try {
    const fallback = path.join(__dirname, '..', 'frontend', 'node_modules', 'socket.io-client');
    io = require(fallback);
  } catch (err2) {
    console.error('socket.io-client not found. Install it in frontend or at repo root.');
    process.exit(1);
  }
}

(async function(){
  const url = process.env.BACKEND_URL || 'http://localhost:5000';
  console.log('Connecting to', url);
  const socket = io(url, { transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    console.log('connected, sid=', socket.id);
  });

  // Note: push-based 'static_filters_update' is removed server-side.

  socket.on('get_static_filters_response', (data) => {
    console.log('get_static_filters_response:', data);
    socket.disconnect();
    process.exit(0);
  });

  socket.on('connect_error', (err) => {
    console.error('connect_error', err);
    process.exit(1);
  });

  // wait a moment then request
  setTimeout(() => {
    console.log('emitting get_static_filters');
    socket.emit('get_static_filters');
  }, 1000);

  // timeout
  setTimeout(() => {
    console.error('timed out waiting for response');
    socket.disconnect();
    process.exit(2);
  }, 7000);
})();
