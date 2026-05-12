const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const Datastore = require('nedb-promises');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ─── Auth Database ────────────────────────────────────────────────────────────
const usersDb = new Datastore({ filename: path.join(__dirname, 'data', 'users.db'), autoload: true });
usersDb.ensureIndex({ fieldName: 'username', unique: true });

// ─── Auth Routes ──────────────────────────────────────────────────────────────

app.post('/api/register', async (req, res) => {
  const { username, password, displayName } = req.body;
  if (!username || !password || !displayName)
    return res.status(400).json({ error: 'Username, password, dan nama lengkap wajib diisi.' });
  if (username.length < 3 || username.length > 20)
    return res.status(400).json({ error: 'Username harus 3–20 karakter.' });
  if (!/^[a-zA-Z0-9_]+$/.test(username))
    return res.status(400).json({ error: 'Username hanya boleh huruf, angka, dan underscore.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password minimal 6 karakter.' });
  if (displayName.length < 2 || displayName.length > 20)
    return res.status(400).json({ error: 'Nama tampil harus 2–20 karakter.' });

  try {
    const existing = await usersDb.findOne({ username: username.toLowerCase() });
    if (existing) return res.status(409).json({ error: 'Username sudah digunakan.' });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await usersDb.insert({
      username: username.toLowerCase(), displayName, passwordHash,
      createdAt: new Date().toISOString(), gamesPlayed: 0, totalScore: 0,
    });
    res.status(201).json({ message: 'Registrasi berhasil!', user: { username: user.username, displayName: user.displayName } });
  } catch (err) {
    if (err.errorType === 'uniqueViolated') return res.status(409).json({ error: 'Username sudah digunakan.' });
    console.error('Register error:', err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username dan password wajib diisi.' });
  try {
    const user = await usersDb.findOne({ username: username.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Username atau password salah.' });
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Username atau password salah.' });
    res.json({ message: 'Login berhasil!', user: { username: user.username, displayName: user.displayName } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// ─── State ────────────────────────────────────────────────────────────────────
const rooms = {};
function generateCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// ─── Level Config ─────────────────────────────────────────────────────────────
const LEVEL_CONFIG = {
  1: { name: 'Pemula',   desc: 'very easy: addition and subtraction only, numbers 1–20', topics: ['addition 1-20', 'subtraction 1-20'], rounds: 5 },
  2: { name: 'Mudah',    desc: 'easy: addition and subtraction with numbers 10–99',       topics: ['addition 10-99', 'subtraction 10-99'], rounds: 5 },
  3: { name: 'Menengah', desc: 'medium: multiplication tables (2–12) and simple division', topics: ['multiplication tables', 'simple division'], rounds: 5 },
  4: { name: 'Sulit',    desc: 'hard: percentages, fractions, or mixed operations',        topics: ['percentages', 'fractions', 'mixed operations'], rounds: 5 },
  5: { name: 'Expert',   desc: 'very hard: exponents, square roots, basic algebra, or number sequences', topics: ['exponents', 'square roots', 'algebra', 'sequences'], rounds: 5 },
};

// ─── Total Rounds (level) yang harus diselesaikan sebelum game berakhir ────────
const TOTAL_ROUNDS = 3;

const FALLBACK_QUESTIONS = {
  1: [
    { question: "What is 7 + 5?",   correct_answer: "12", wrong_answers: ["10","11","13"], equivalent_expressions: ["5+7","6+6"] },
    { question: "What is 14 − 6?",  correct_answer: "8",  wrong_answers: ["6","7","9"],   equivalent_expressions: [] },
    { question: "What is 9 + 8?",   correct_answer: "17", wrong_answers: ["15","16","18"], equivalent_expressions: ["8+9"] },
    { question: "What is 18 − 9?",  correct_answer: "9",  wrong_answers: ["7","8","10"],  equivalent_expressions: [] },
    { question: "What is 6 + 7?",   correct_answer: "13", wrong_answers: ["11","12","14"], equivalent_expressions: ["7+6"] },
    { question: "What is 15 − 8?",  correct_answer: "7",  wrong_answers: ["5","6","8"],   equivalent_expressions: [] },
    { question: "What is 4 + 9?",   correct_answer: "13", wrong_answers: ["11","12","14"], equivalent_expressions: ["9+4"] },
    { question: "What is 20 − 7?",  correct_answer: "13", wrong_answers: ["11","12","14"], equivalent_expressions: [] },
  ],
  2: [
    { question: "What is 34 + 47?", correct_answer: "81", wrong_answers: ["79","80","82"], equivalent_expressions: ["47+34"] },
    { question: "What is 85 − 29?", correct_answer: "56", wrong_answers: ["54","55","57"], equivalent_expressions: [] },
    { question: "What is 63 + 28?", correct_answer: "91", wrong_answers: ["89","90","92"], equivalent_expressions: ["28+63"] },
    { question: "What is 72 − 35?", correct_answer: "37", wrong_answers: ["35","36","38"], equivalent_expressions: [] },
    { question: "What is 46 + 55?", correct_answer: "101",wrong_answers: ["99","100","102"],equivalent_expressions: [] },
    { question: "What is 90 − 43?", correct_answer: "47", wrong_answers: ["45","46","48"], equivalent_expressions: [] },
    { question: "What is 57 + 38?", correct_answer: "95", wrong_answers: ["93","94","96"], equivalent_expressions: ["38+57"] },
    { question: "What is 66 − 27?", correct_answer: "39", wrong_answers: ["37","38","40"], equivalent_expressions: [] },
  ],
  3: [
    { question: "What is 8 × 7?",   correct_answer: "56", wrong_answers: ["54","58","63"], equivalent_expressions: ["7×8"] },
    { question: "What is 63 ÷ 9?",  correct_answer: "7",  wrong_answers: ["6","8","9"],   equivalent_expressions: [] },
    { question: "What is 9 × 6?",   correct_answer: "54", wrong_answers: ["48","52","56"], equivalent_expressions: ["6×9"] },
    { question: "What is 144 ÷ 12?",correct_answer: "12", wrong_answers: ["11","13","14"], equivalent_expressions: [] },
    { question: "What is 7 × 11?",  correct_answer: "77", wrong_answers: ["74","75","78"], equivalent_expressions: ["11×7"] },
    { question: "What is 96 ÷ 8?",  correct_answer: "12", wrong_answers: ["10","11","13"], equivalent_expressions: [] },
    { question: "What is 12 × 9?",  correct_answer: "108",wrong_answers: ["104","106","110"],equivalent_expressions: ["9×12"] },
    { question: "What is 72 ÷ 6?",  correct_answer: "12", wrong_answers: ["10","11","13"], equivalent_expressions: [] },
  ],
  4: [
    { question: "What is 20% of 350?",      correct_answer: "70",  wrong_answers: ["60","65","75"],   equivalent_expressions: [] },
    { question: "What is ¾ of 48?",          correct_answer: "36",  wrong_answers: ["32","34","40"],   equivalent_expressions: [] },
    { question: "What is (12 + 8) × 3?",    correct_answer: "60",  wrong_answers: ["56","58","64"],   equivalent_expressions: ["20×3"] },
    { question: "What is 15% of 120?",       correct_answer: "18",  wrong_answers: ["15","20","24"],   equivalent_expressions: [] },
    { question: "What is ½ of 74?",          correct_answer: "37",  wrong_answers: ["34","35","38"],   equivalent_expressions: [] },
    { question: "What is (25 − 10) × 4?",   correct_answer: "60",  wrong_answers: ["56","58","64"],   equivalent_expressions: ["15×4"] },
    { question: "What is 40% of 90?",        correct_answer: "36",  wrong_answers: ["32","34","40"],   equivalent_expressions: [] },
    { question: "What is ⅔ of 60?",          correct_answer: "40",  wrong_answers: ["36","38","42"],   equivalent_expressions: [] },
  ],
  5: [
    { question: "What is 2⁵?",                            correct_answer: "32",  wrong_answers: ["16","25","64"],   equivalent_expressions: ["2×2×2×2×2"] },
    { question: "What is √144?",                          correct_answer: "12",  wrong_answers: ["11","13","14"],   equivalent_expressions: ["12²=144"] },
    { question: "If 4x = 36, what is x?",                 correct_answer: "9",   wrong_answers: ["7","8","10"],    equivalent_expressions: [] },
    { question: "What is 3⁴?",                            correct_answer: "81",  wrong_answers: ["64","72","91"],   equivalent_expressions: ["3×3×3×3"] },
    { question: "What is √225?",                          correct_answer: "15",  wrong_answers: ["13","14","16"],   equivalent_expressions: ["15²=225"] },
    { question: "If 3x + 5 = 20, what is x?",            correct_answer: "5",   wrong_answers: ["4","6","7"],     equivalent_expressions: [] },
    { question: "What is the next: 2, 4, 8, 16, __?",    correct_answer: "32",  wrong_answers: ["18","20","24"],   equivalent_expressions: [] },
    { question: "What is the next: 1, 4, 9, 16, __?",    correct_answer: "25",  wrong_answers: ["20","22","24"],   equivalent_expressions: ["5²"] },
  ],
};

async function generateQuestion(level) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const cfg = LEVEL_CONFIG[level] || LEVEL_CONFIG[3];

  const prompt = `Generate a math quiz question for a classroom multiplayer game.
Level ${level}/5 — ${cfg.name}: ${cfg.desc}

Return ONLY valid JSON (no markdown, no extra text):
{
  "question": "What is 5 + 7?",
  "correct_answer": "12",
  "wrong_answers": ["10", "13", "14"],
  "equivalent_expressions": ["6+6", "3+9"]
}

Rules:
- question must be short, clear, and unambiguous
- correct_answer must be a single number or short expression
- wrong_answers: exactly 3 plausible but incorrect values
- equivalent_expressions: 0–2 different ways to express the same answer (empty [] if not applicable)
- All 4 answer choices must be distinct
- Match difficulty strictly: Level ${level} means ${cfg.topics.join(', ')}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.9, maxOutputTokens: 256 }
        })
      }
    );
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.question || !parsed.correct_answer || !Array.isArray(parsed.wrong_answers)) throw new Error('Invalid shape');
    return parsed;
  } catch (err) {
    console.error(`Gemini error (Level ${level}), using fallback:`, err.message);
    const pool = FALLBACK_QUESTIONS[level] || FALLBACK_QUESTIONS[3];
    return pool[Math.floor(Math.random() * pool.length)];
  }
}

// ─── Helper: kirim soal baru ke satu player ───────────────────────────────────
async function sendNextQuestion(room, player) {
  if (!room || room.status !== 'playing') return;
  if (!player || !player.alive || player.disconnected) return;

  const level = room.level || 1;
  const cfg = LEVEL_CONFIG[level] || LEVEL_CONFIG[3];
  const roundsPerLevel = cfg.rounds;

  // Naikkan roundInLevel player ini
  player.roundInLevel = (player.roundInLevel || 0) + 1;

  // Kalau sudah selesai semua round di level ini
  if (player.roundInLevel > roundsPerLevel) {
    player.finishedLevel = true;
    // Kirim sinyal "kamu selesai level ini, tunggu yang lain"
    const playerSocket = io.sockets.sockets.get(player.id);
    if (playerSocket) {
      playerSocket.emit('waiting_others', {
        level,
        message: 'Kamu sudah selesai level ini! Menunggu pemain lain...'
      });
    }
    // Cek apakah semua non-host player sudah selesai level ini
    checkLevelComplete(room);
    return;
  }

  // Pakai soal yang sama untuk semua player di round yang sama
  const roundKey = `${level}_${player.roundInLevel}`;
  if (!room.sharedQuestions) room.sharedQuestions = {};
  if (!room.sharedQuestions[roundKey]) {
    room.sharedQuestions[roundKey] = await generateQuestion(level);
  }
  const question = room.sharedQuestions[roundKey];
  player.currentQuestion = question;
  player.questionStartTime = Date.now();

  // Simpan correct_slot di sharedQuestions biar sama untuk semua player
  if (!room.sharedQuestions[roundKey].correct_slot) {
    room.sharedQuestions[roundKey].correct_slot = Math.floor(Math.random() * 3) + 2;
  }

  const playerSocket = io.sockets.sockets.get(player.id);
  if (playerSocket) {
   
    playerSocket.emit('new_question', {
      correct_slot: room.sharedQuestions[roundKey].correct_slot,
      round: room.round,
      roundInLevel: player.roundInLevel,
      level,
      totalRoundsPerLevel: roundsPerLevel,
      question: question.question,
      correct_answer: question.correct_answer,
      wrong_answers: question.wrong_answers,
      equivalent_expressions: question.equivalent_expressions,
      duration: 30000
    });
  }
}

// ─── Cek apakah semua player sudah selesai level ──────────────────────────────
function checkLevelComplete(room) {
  if (!room || room.status !== 'playing') return;

  const activePlayers = Object.values(room.players).filter(
    p => p.id !== room.host && p.alive && !p.disconnected
  );

  // Kalau tidak ada player aktif sama sekali → game over
  if (activePlayers.length === 0) {
    checkGameEnd(room.code);
    return;
  }

  const allDone = activePlayers.every(p => p.finishedLevel === true);
  if (!allDone) return;

  // Semua selesai → level complete!
  room.status = 'level_complete';
  if (room.questionTimer) { clearTimeout(room.questionTimer); room.questionTimer = null; }

  const leaderboard = activePlayers
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, score: p.score, alive: p.alive }));

  // Kalau sudah selesai semua round → langsung game over
  if (room.level >= TOTAL_ROUNDS) {
    room.status = 'ended';
    const winner = leaderboard[0] || null;
    const hostPlayer = room.players[room.host];
    io.to(room.code).emit('game_ended', {
      winner: winner ? { id: winner.id, name: winner.name, score: winner.score } : null,
      host: hostPlayer ? { id: hostPlayer.id, name: hostPlayer.name } : null,
      leaderboard,
      allRoundsComplete: true,
    });
    setTimeout(() => { delete rooms[room.code]; }, 60000);
    return;
  }

  io.to(room.code).emit('level_complete', {
    level: room.level,
    nextLevel: room.level + 1,
    totalRounds: TOTAL_ROUNDS,
    leaderboard
  });
}

// ─── Socket.IO Events ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // Chat lobby
  socket.on('lobby_chat', ({ code, username, message }, callback) => {
    if (callback) callback('received');
    if (!message || !message.trim() || !code) return;
    const msg = {
      username,
      message: message.trim().substring(0, 200),
      time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    };
    io.emit('lobby_chat_message', msg);
  });

  // Create Room
  socket.on('create_room', ({ playerName }) => {
    const code = generateCode();
    rooms[code] = {
      code,
      host: socket.id,
      players: {},
      status: 'lobby',
      round: 0,
      level: 1,
      currentQuestion: null,
      questionTimer: null,
    };
    rooms[code].players[socket.id] = {
      id: socket.id, name: playerName, score: 0, alive: true,
      bubbleLevel: 0, online: true, roundInLevel: 0, finishedLevel: false,
      questionStartTime: null,
    };
    socket.join(code);
    socket.emit('room_created', { code, player: rooms[code].players[socket.id] });
    emitRoomState(code);
  });

  // Join Room
  socket.on('join_room', ({ code, playerName }) => {
    const room = rooms[code];
    if (!room) return socket.emit('error', { message: 'Room not found' });
    if (room.status !== 'lobby') return socket.emit('error', { message: 'Permainan sudah dimulai' });
    if (Object.keys(room.players).length >= 10) return socket.emit('error', { message: 'Ruangan sudah penuh' });

    room.players[socket.id] = {
      id: socket.id, name: playerName, score: 0, alive: true,
      bubbleLevel: 0, online: true, roundInLevel: 0, finishedLevel: false,
      questionStartTime: null,
    };
    socket.join(code);
    socket.emit('room_joined', { code, player: room.players[socket.id] });
    emitRoomState(code);
  });

  // Start Game
  socket.on('start_game', async ({ code }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (Object.keys(room.players).length < 1) return;

    room.status = 'playing';
    room.round = 1;
    room.level = 1;

    // Reset semua player
    Object.values(room.players).forEach(p => {
      p.score = 0;
      p.alive = true;
      p.bubbleLevel = 0;
      p.roundInLevel = 0;
      p.finishedLevel = false;
      p.questionStartTime = null;
    });

    io.to(code).emit('game_started');

    const nonHostPlayers = Object.values(room.players).filter(p => p.id !== room.host && !p.disconnected);
    for (const p of nonHostPlayers) {
      setTimeout(async () => {
        const pSocket = io.sockets.sockets.get(p.id);
        if (pSocket) {
          pSocket.emit('round_starting', {
            round: room.round,
            roundInLevel: 1,
            level: room.level,
            totalRoundsPerLevel: (LEVEL_CONFIG[room.level] || LEVEL_CONFIG[1]).rounds,
          });
        }
        await sendNextQuestion(room, p);
      }, 800);
    }

    // Timer 30 detik per soal — kalau habis, player yang belum jawab langsung dapat soal baru
    startRoundTimer(code);
  });

  // ─── BUBBLE CLICK: inti logika per-player ────────────────────────────────
  socket.on('bubble_click', async ({ code, bubbleId, answer, isCorrect }) => {
    const room = rooms[code];
    if (!room || room.status !== 'playing') return;
    const player = room.players[socket.id];
    if (!player || !player.alive) return;

    if (isCorrect) {
      // ── Skor berbasis urutan jawab ───────────────────────────────────────
      // Pertama jawab → 100, kedua → 95, ketiga → 90, dst. (minimum 40)
      const MAX_SCORE = 100;
      const SCORE_DECREMENT = 5;
      const MIN_SCORE = 40;

      // Track berapa player yang sudah jawab benar untuk soal ini
      const roundKey = `${room.level}_${player.roundInLevel}`;
      if (!room.sharedQuestions) room.sharedQuestions = {};
      if (!room.sharedQuestions[roundKey]) room.sharedQuestions[roundKey] = {};
      if (!room.sharedQuestions[roundKey].answerCount) {
        room.sharedQuestions[roundKey].answerCount = 0;
      }
      room.sharedQuestions[roundKey].answerCount += 1;
      const order = room.sharedQuestions[roundKey].answerCount; // 1=pertama, 2=kedua, dst

      const scoreGiven = Math.max(MIN_SCORE, MAX_SCORE - (order - 1) * SCORE_DECREMENT);

      player.score += scoreGiven;
      player.bubbleLevel = Math.max(0, player.bubbleLevel - 15);

      io.to(code).emit('bubble_popped', { playerId: socket.id, bubbleId, correct: true });

      // Kirim score info ke player yang bersangkutan (biar tau dapat berapa)
      socket.emit('score_gained', { score: scoreGiven, total: player.score });

      emitLeaderboard(code);

      // ── Langsung kirimkan soal berikutnya HANYA ke player ini ────────────
      await sendNextQuestion(room, player);

    } else {
      // Jawaban salah
      player.score = Math.max(0, player.score - 30);
      player.bubbleLevel = Math.min(100, player.bubbleLevel + 10);

      io.to(code).emit('bubble_popped', { playerId: socket.id, bubbleId, correct: false });
      socket.emit('wrong_answer_penalty');

      emitLeaderboard(code);
      checkElimination(code, socket.id);
    }
  });

  // Bubble reaches top (danger level increase)
  socket.on('bubble_overflow', ({ code, amount }) => {
    const room = rooms[code];
    if (!room || room.status !== 'playing') return;
    const player = room.players[socket.id];
    if (!player || !player.alive) return;

    // Kalau amount besar (100) → eliminasi langsung
    if (amount >= 100) {
      player.bubbleLevel = 100;
      player.alive = false;
      io.to(code).emit('player_eliminated', {
        playerId: socket.id,
        name: player.name,
        finalScore: player.score,
      });
      emitLeaderboard(code);
      checkGameEnd(code);
      const room2 = rooms[code];
      if (room2) checkLevelComplete(room2);
      return;
    }

    player.bubbleLevel = Math.min(100, player.bubbleLevel + Math.min(amount || 2, 3));
    checkElimination(code, socket.id);
    emitLeaderboard(code);
  });

  // Stop game early (host only)
  socket.on('stop_game', ({ code }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    room.status = 'ended';
    if (room.questionTimer) clearTimeout(room.questionTimer);
    const allPlayers = Object.values(room.players).sort((a, b) => b.score - a.score);
    const nonHostPlayers = allPlayers.filter(p => p.id !== room.host);
    const hostPlayer = room.players[room.host];
    const winner = nonHostPlayers.find(p => p.alive) || nonHostPlayers[0];
    io.to(code).emit('game_ended', {
      winner: winner ? { id: winner.id, name: winner.name, score: winner.score } : null,
      host: hostPlayer ? { id: hostPlayer.id, name: hostPlayer.name } : null,
      leaderboard: nonHostPlayers.map((p, i) => ({
        rank: i + 1, id: p.id, name: p.name, score: p.score,
        alive: p.alive, online: p.online !== false
      }))
    });
    setTimeout(() => { delete rooms[code]; }, 60000);
  });

  // Continue to next level (host only)
  socket.on('continue_level', async ({ code }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (room.status !== 'level_complete') return;
    if (room.level >= TOTAL_ROUNDS) return; // sudah selesai semua round, jangan lanjut

    room.level += 1;
    room.round += 1;
    room.status = 'playing';

    // Reset per-player state untuk level baru (bubble level TIDAK direset — akumulasi)
    Object.values(room.players).forEach(p => {
      p.roundInLevel = 0;
      p.finishedLevel = false;
      p.questionStartTime = null;
    });

    io.to(code).emit('level_started', { level: room.level });

    const activePlayers = Object.values(room.players).filter(
      p => p.id !== room.host && p.alive && !p.disconnected
    );
    for (const p of activePlayers) {
      setTimeout(async () => {
        const pSocket = io.sockets.sockets.get(p.id);
        if (pSocket) {
          pSocket.emit('round_starting', {
            round: room.round,
            roundInLevel: 1,
            level: room.level,
            totalRoundsPerLevel: (LEVEL_CONFIG[room.level] || LEVEL_CONFIG[1]).rounds,
          });
        }
        await sendNextQuestion(room, p);
      }, 500);
    }

    startRoundTimer(code);
  });

  // Disconnect
  socket.on('disconnect', () => {
    for (const code in rooms) {
      const room = rooms[code];
      if (!room.players[socket.id]) continue;

      const player = room.players[socket.id];
      player.online = false;
      player.disconnected = true;
      io.to(code).emit('player_disconnected', { playerId: socket.id, name: player.name });
      emitRoomState(code);
      emitLeaderboard(code);

      if (room.status === 'playing') {
        const onlinePlayers = Object.values(room.players).filter(
          p => p.id !== room.host && !p.disconnected
        );
        if (onlinePlayers.length === 0) {
          checkGameEnd(code);
        } else {
          // Kalau player yang DC sudah selesai level atau belum, cek apakah level complete
          checkLevelComplete(room);
        }
      }

      if (room.host === socket.id) {
        const others = Object.keys(room.players).filter(id => id !== socket.id && !room.players[id].disconnected);
        if (others.length > 0) {
          room.host = others[0];
          io.to(others[0]).emit('you_are_host');
        }
      }
    }
  });
});

// ─── Round Timer (30 detik per soal) ─────────────────────────────────────────
// Timer ini berfungsi sebagai "nudge" — kalau habis, player yang belum jawab
// dapat soal baru otomatis (dianggap skip/timeout)
function startRoundTimer(code) {
  const room = rooms[code];
  if (!room) return;
  if (room.questionTimer) clearTimeout(room.questionTimer);

  room.questionTimer = setTimeout(async () => {
    if (!rooms[code] || rooms[code].status !== 'playing') return;
    const room = rooms[code];

    // Cari player yang belum jawab soal mereka saat ini (roundInLevel belum naik)
    // Kita track dengan questionStartTime — kalau masih ada dan udah > 30 detik → timeout
    const now = Date.now();
    const playersToAdvance = Object.values(room.players).filter(p => {
      if (p.id === room.host || !p.alive || p.disconnected || p.finishedLevel) return false;
      if (!p.questionStartTime) return false;
      return (now - p.questionStartTime) >= 30000; // sudah 30 detik belum jawab
    });

    for (const p of playersToAdvance) {
      // Penalti timeout: bubble naik, skor tidak bertambah
      p.bubbleLevel = Math.min(100, p.bubbleLevel + 8);
      checkElimination(code, p.id);

      // Kirim soal berikutnya ke player ini
      if (p.alive && !p.disconnected) {
        await sendNextQuestion(room, p);
      }
    }

    emitLeaderboard(code);

    // Jadwalkan timer berikutnya kalau game masih jalan
    if (rooms[code] && rooms[code].status === 'playing') {
      startRoundTimer(code);
    }
  }, 30000);
}

// ─── Game Logic ───────────────────────────────────────────────────────────────
function checkElimination(code, playerId) {
  const room = rooms[code];
  if (!room) return;
  const player = room.players[playerId];
  if (!player || !player.alive) return;

  if (player.bubbleLevel >= 100) {
    player.alive = false;
    player.bubbleLevel = 100;
    io.to(code).emit('player_eliminated', {
      playerId,
      name: player.name,
      finalScore: player.score,
    });
    emitLeaderboard(code);
    checkGameEnd(code);

    // Kalau player yang ke-eliminate sudah belum selesai level → cek level complete
    const room2 = rooms[code];
    if (room2) checkLevelComplete(room2);
  }
}

function checkGameEnd(code) {
  const room = rooms[code];
  if (!room || room.status === 'ended') return;

  const alivePlayers = Object.values(room.players).filter(p => p.alive && p.id !== room.host);
  if (alivePlayers.length <= 1) {
    room.status = 'ended';
    if (room.questionTimer) clearTimeout(room.questionTimer);

    const nonHostPlayers = Object.values(room.players)
      .filter(p => p.id !== room.host)
      .sort((a, b) => b.score - a.score);
    const hostPlayer = room.players[room.host];
    const winner = alivePlayers[0] || nonHostPlayers[0];

    io.to(code).emit('game_ended', {
      winner: winner ? { id: winner.id, name: winner.name, score: winner.score } : null,
      host: hostPlayer ? { id: hostPlayer.id, name: hostPlayer.name } : null,
      leaderboard: nonHostPlayers.map((p, i) => ({
        rank: i + 1, id: p.id, name: p.name, score: p.score,
        alive: p.alive, online: p.online !== false,
      }))
    });

    setTimeout(() => { delete rooms[code]; }, 60000);
  }
}

function emitRoomState(code) {
  const room = rooms[code];
  if (!room) return;
  io.to(code).emit('room_state', {
    code: room.code,
    host: room.host,
    status: room.status,
    players: Object.values(room.players),
  });
}

function emitLeaderboard(code) {
  const room = rooms[code];
  if (!room) return;
  const leaderboard = Object.values(room.players)
    .filter(p => p.id !== room.host)
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({
      rank: i + 1, id: p.id, name: p.name,
      score: p.score, alive: p.alive,
      bubbleLevel: p.bubbleLevel,
      online: p.online !== false,
      roundInLevel: p.roundInLevel,
      finishedLevel: p.finishedLevel || false,
    }));
  io.to(code).emit('leaderboard_update', { leaderboard });
}

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🫧 Quibble server running at http://localhost:${PORT}`);
  console.log(`   Set GEMINI_API_KEY env variable for AI questions\n`);
});