const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ─── Constants ────────────────────────────────────────────────────────────────
const QUESTIONS_PER_LEVEL = 3;
const TOTAL_LEVELS = 5;
const QUESTION_DURATION = 25000; // 25 detik per soal

// ─── State ────────────────────────────────────────────────────────────────────
const rooms = {};

function generateCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// ─── AI Question Generator ────────────────────────────────────────────────────
async function generateQuestion(level) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  const difficultyDesc = {
    1: 'very easy: addition and subtraction with numbers 1–20',
    2: 'easy: addition and subtraction with numbers up to 50',
    3: 'medium: multiplication and division with numbers up to 100',
    4: 'hard: fractions, percentages, or multi-step operations',
    5: 'very hard: exponents, square roots, or algebra',
  }[level] || 'medium difficulty math';

  const prompt = `Generate a math quiz question. Level ${level}/5 difficulty: ${difficultyDesc}.
Return ONLY valid JSON (no markdown):
{
  "question": "What is 5 + 7?",
  "correct_answer": "12",
  "wrong_answers": ["10", "13", "14"],
  "equivalent_expressions": ["6+6", "3+9"]
}
Rules: wrong_answers must have exactly 3 plausible but wrong values. equivalent_expressions can be empty [].`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 256 }
        })
      }
    );
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('Gemini error, using fallback:', err.message);
    const fallbacks = {
      1: [
        { question: "What is 7 + 5?", correct_answer: "12", wrong_answers: ["10", "13", "11"], equivalent_expressions: ["5+7"] },
        { question: "What is 15 − 8?", correct_answer: "7", wrong_answers: ["6", "8", "9"], equivalent_expressions: [] },
        { question: "What is 9 + 4?", correct_answer: "13", wrong_answers: ["12", "14", "11"], equivalent_expressions: ["4+9"] },
      ],
      2: [
        { question: "What is 34 + 19?", correct_answer: "53", wrong_answers: ["51", "55", "52"], equivalent_expressions: ["19+34"] },
        { question: "What is 47 − 23?", correct_answer: "24", wrong_answers: ["22", "26", "25"], equivalent_expressions: [] },
        { question: "What is 28 + 35?", correct_answer: "63", wrong_answers: ["61", "65", "60"], equivalent_expressions: [] },
      ],
      3: [
        { question: "What is 8 × 7?", correct_answer: "56", wrong_answers: ["54", "58", "63"], equivalent_expressions: ["7×8"] },
        { question: "What is 144 ÷ 12?", correct_answer: "12", wrong_answers: ["11", "13", "14"], equivalent_expressions: [] },
        { question: "What is 9 × 6?", correct_answer: "54", wrong_answers: ["52", "56", "48"], equivalent_expressions: ["6×9"] },
      ],
      4: [
        { question: "What is 15% of 200?", correct_answer: "30", wrong_answers: ["25", "35", "40"], equivalent_expressions: [] },
        { question: "What is ½ of 84?", correct_answer: "42", wrong_answers: ["40", "44", "48"], equivalent_expressions: [] },
        { question: "What is 25% of 160?", correct_answer: "40", wrong_answers: ["35", "45", "32"], equivalent_expressions: [] },
      ],
      5: [
        { question: "What is 2⁵?", correct_answer: "32", wrong_answers: ["25", "16", "64"], equivalent_expressions: ["2×2×2×2×2"] },
        { question: "What is √81?", correct_answer: "9", wrong_answers: ["7", "8", "10"], equivalent_expressions: ["3²"] },
        { question: "If 3x = 24, what is x?", correct_answer: "8", wrong_answers: ["6", "9", "7"], equivalent_expressions: [] },
      ],
    };
    const pool = fallbacks[level] || fallbacks[3];
    return pool[Math.floor(Math.random() * pool.length)];
  }
}

// ─── Socket.IO Events ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('create_room', ({ playerName }) => {
    const code = generateCode();
    rooms[code] = {
      code, host: socket.id, players: {},
      status: 'lobby',
      level: 0,        // current level (1–5)
      questionInLevel: 0,  // soal ke-berapa dalam level ini (1–3)
      currentQuestion: null,
      questionTimer: null,
    };
    rooms[code].players[socket.id] = { id: socket.id, name: playerName, score: 0, alive: true, bubbleLevel: 0 };
    socket.join(code);
    socket.emit('room_created', { code, player: rooms[code].players[socket.id] });
    emitRoomState(code);
  });

  socket.on('join_room', ({ code, playerName }) => {
    const room = rooms[code];
    if (!room) return socket.emit('error', { message: 'Room not found' });
    if (room.status !== 'lobby') return socket.emit('error', { message: 'Game already started' });
    if (Object.keys(room.players).length >= 10) return socket.emit('error', { message: 'Room is full' });
    room.players[socket.id] = { id: socket.id, name: playerName, score: 0, alive: true, bubbleLevel: 0 };
    socket.join(code);
    socket.emit('room_joined', { code, player: room.players[socket.id] });
    emitRoomState(code);
  });

  socket.on('start_game', async ({ code }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    room.status = 'playing';
    room.level = 0;
    room.questionInLevel = 0;
    Object.values(room.players).forEach(p => { p.score = 0; p.alive = true; p.bubbleLevel = 0; });
    io.to(code).emit('game_started');
    await advanceQuestion(code);
  });

  socket.on('bubble_click', ({ code, bubbleId, answer, isCorrect }) => {
    const room = rooms[code];
    if (!room || room.status !== 'playing') return;
    const player = room.players[socket.id];
    if (!player || !player.alive) return;
    if (isCorrect) {
      player.score += 100;
      player.bubbleLevel = Math.max(0, player.bubbleLevel - 15);
    } else {
      player.score = Math.max(0, player.score - 30);
      player.bubbleLevel = Math.min(100, player.bubbleLevel + 10);
    }
    io.to(code).emit('bubble_popped', { playerId: socket.id, bubbleId, correct: isCorrect });
    emitLeaderboard(code);
    checkElimination(code, socket.id);
  });

  socket.on('bubble_overflow', ({ code, amount }) => {
    const room = rooms[code];
    if (!room || room.status !== 'playing') return;
    const player = room.players[socket.id];
    if (!player || !player.alive) return;
    player.bubbleLevel = Math.min(100, player.bubbleLevel + Math.min(amount || 2, 3));
    checkElimination(code, socket.id);
    emitLeaderboard(code);
  });

  socket.on('disconnect', () => {
    for (const code in rooms) {
      const room = rooms[code];
      if (room.players[socket.id]) {
        room.players[socket.id].alive = false;
        room.players[socket.id].disconnected = true;
        io.to(code).emit('player_disconnected', { playerId: socket.id, name: room.players[socket.id].name });
        emitRoomState(code);
        emitLeaderboard(code);
        if (room.status === 'playing') checkGameEnd(code);
        if (room.host === socket.id) {
          const others = Object.keys(room.players).filter(id => id !== socket.id && !room.players[id].disconnected);
          if (others.length > 0) { room.host = others[0]; io.to(others[0]).emit('you_are_host'); }
        }
      }
    }
  });
});

// ─── Game Logic ───────────────────────────────────────────────────────────────

// Maju ke soal berikutnya, atau level baru, atau game selesai
async function advanceQuestion(code) {
  const room = rooms[code];
  if (!room || room.status !== 'playing') return;

  const alivePlayers = Object.values(room.players).filter(p => p.alive);
  if (alivePlayers.length <= 1) return checkGameEnd(code);

  room.questionInLevel += 1;

  // Kalau soal dalam level sudah habis, naik level
  if (room.questionInLevel > QUESTIONS_PER_LEVEL) {
    room.level += 1;
    room.questionInLevel = 1;

    // Kalau semua level sudah selesai, game berakhir
    if (room.level > TOTAL_LEVELS) {
      io.to(code).emit('round_ended', { round: room.level * QUESTIONS_PER_LEVEL });
      await new Promise(r => setTimeout(r, 2000));
      return checkGameEnd(code);
    }

    // Announce new level
    io.to(code).emit('level_up', { level: room.level, totalLevels: TOTAL_LEVELS });
    await new Promise(r => setTimeout(r, 3000));
  } else if (room.level === 0) {
    // First question ever — set level to 1
    room.level = 1;
    room.questionInLevel = 1;
    io.to(code).emit('level_up', { level: room.level, totalLevels: TOTAL_LEVELS });
    await new Promise(r => setTimeout(r, 3000));
  }

  // Emit round_starting (reuse for "question starting" UI)
  const roundNum = (room.level - 1) * QUESTIONS_PER_LEVEL + room.questionInLevel;
  io.to(code).emit('round_starting', {
    round: roundNum,
    level: room.level,
    questionInLevel: room.questionInLevel,
    questionsPerLevel: QUESTIONS_PER_LEVEL,
    totalLevels: TOTAL_LEVELS,
  });

  const question = await generateQuestion(room.level);
  room.currentQuestion = question;

  setTimeout(() => {
    if (rooms[code]?.status !== 'playing') return;
    io.to(code).emit('new_question', {
      round: roundNum,
      level: room.level,
      questionInLevel: room.questionInLevel,
      questionsPerLevel: QUESTIONS_PER_LEVEL,
      question: question.question,
      correct_answer: question.correct_answer,
      wrong_answers: question.wrong_answers,
      equivalent_expressions: question.equivalent_expressions,
      duration: QUESTION_DURATION,
    });

    room.questionTimer = setTimeout(async () => {
      if (!rooms[code] || rooms[code].status !== 'playing') return;
      io.to(code).emit('round_ended', { round: roundNum, level: room.level });
      await new Promise(r => setTimeout(r, 2500));
      await advanceQuestion(code);
    }, QUESTION_DURATION);

  }, 2000);
}

function checkElimination(code, playerId) {
  const room = rooms[code];
  if (!room) return;
  const player = room.players[playerId];
  if (!player || !player.alive) return;
  if (player.bubbleLevel >= 100) {
    player.alive = false;
    player.bubbleLevel = 100;
    io.to(code).emit('player_eliminated', { playerId, name: player.name, finalScore: player.score });
    emitLeaderboard(code);
    checkGameEnd(code);
  }
}

function checkGameEnd(code) {
  const room = rooms[code];
  if (!room || room.status !== 'playing') return;
  const alivePlayers = Object.values(room.players).filter(p => p.alive && !p.disconnected);
  if (alivePlayers.length <= 1) {
    room.status = 'ended';
    clearTimeout(room.questionTimer);
    const allPlayers = Object.values(room.players).sort((a, b) => b.score - a.score);
    const winner = alivePlayers[0] || allPlayers[0];
    io.to(code).emit('game_ended', {
      winner: winner ? { id: winner.id, name: winner.name, score: winner.score } : null,
      leaderboard: allPlayers.map((p, i) => ({ rank: i+1, id: p.id, name: p.name, score: p.score, alive: p.alive }))
    });
    setTimeout(() => { delete rooms[code]; }, 60000);
  }
}

function emitRoomState(code) {
  const room = rooms[code];
  if (!room) return;
  io.to(code).emit('room_state', { code: room.code, host: room.host, status: room.status, players: Object.values(room.players) });
}

function emitLeaderboard(code) {
  const room = rooms[code];
  if (!room) return;
  const leaderboard = Object.values(room.players)
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ rank: i+1, id: p.id, name: p.name, score: p.score, alive: p.alive, bubbleLevel: p.bubbleLevel }));
  io.to(code).emit('leaderboard_update', { leaderboard });
}

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🫧 Quibble server running at http://localhost:${PORT}`);
  console.log(`   Levels: ${TOTAL_LEVELS} levels × ${QUESTIONS_PER_LEVEL} questions = ${TOTAL_LEVELS * QUESTIONS_PER_LEVEL} total questions`);
  console.log(`   Set GEMINI_API_KEY env variable for AI questions\n`);
});