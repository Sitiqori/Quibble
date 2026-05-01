const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ─── State ────────────────────────────────────────────────────────────────────
const rooms = {};
function generateCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// ─── AI Question Generator (Gemini) ───────────────────────────────────────────

// Level descriptions for Gemini prompt
const LEVEL_CONFIG = {
  1: {
    name: 'Pemula',
    desc: 'very easy: addition and subtraction only, numbers 1–20, e.g. "What is 7 + 5?" or "What is 13 − 6?"',
    topics: ['addition 1-20', 'subtraction 1-20'],
    rounds: 3,
  },
  2: {
    name: 'Mudah',
    desc: 'easy: addition and subtraction with numbers 10–99, e.g. "What is 34 + 47?" or "What is 85 − 29?"',
    topics: ['addition 10-99', 'subtraction 10-99'],
    rounds: 4,
  },
  3: {
    name: 'Menengah',
    desc: 'medium: multiplication tables (2–12) and simple division, e.g. "What is 8 × 7?" or "What is 63 ÷ 9?"',
    topics: ['multiplication tables', 'simple division'],
    rounds: 5,
  },
  4: {
    name: 'Sulit',
    desc: 'hard: percentages, fractions, or mixed operations, e.g. "What is 20% of 350?", "What is ¾ of 48?", or "What is (12 + 8) × 3?"',
    topics: ['percentages', 'fractions', 'mixed operations'],
    rounds: 5,
  },
  5: {
    name: 'Expert',
    desc: 'very hard: exponents, square roots, basic algebra, or number sequences, e.g. "What is 3⁴?", "What is √144?", "If 4x = 36, what is x?", "What is the next number: 2, 4, 8, 16, __?"',
    topics: ['exponents', 'square roots', 'algebra', 'sequences'],
    rounds: 6,
  },
};

// Fallback question banks per level
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
    // Validate
    if (!parsed.question || !parsed.correct_answer || !Array.isArray(parsed.wrong_answers)) throw new Error('Invalid shape');
    return parsed;
  } catch (err) {
    console.error(`Gemini error (Level ${level}), using fallback:`, err.message);
    const pool = FALLBACK_QUESTIONS[level] || FALLBACK_QUESTIONS[3];
    return pool[Math.floor(Math.random() * pool.length)];
  }
}

// ─── Socket.IO Events ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // Create Room
  socket.on('create_room', ({ playerName }) => {
    const code = generateCode();
    rooms[code] = {
      code,
      host: socket.id,
      players: {},
      status: 'lobby', // lobby | playing | ended
      round: 0,
      currentQuestion: null,
      questionTimer: null,
    };
    rooms[code].players[socket.id] = {
      id: socket.id,
      name: playerName,
      score: 0,
      alive: true,
      bubbleLevel: 0, // 0-100, elimination at 100
    };
    socket.join(code);
    socket.emit('room_created', { code, player: rooms[code].players[socket.id] });
    emitRoomState(code);
  });

  // Join Room
  socket.on('join_room', ({ code, playerName }) => {
    const room = rooms[code];
    if (!room) return socket.emit('error', { message: 'Room not found' });
    if (room.status !== 'lobby') return socket.emit('error', { message: 'Game already started' });
    if (Object.keys(room.players).length >= 10) return socket.emit('error', { message: 'Room is full' });

    room.players[socket.id] = {
      id: socket.id,
      name: playerName,
      score: 0,
      alive: true,
      bubbleLevel: 0,
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
    room.round = 0;
    room.level = 1;
    room.roundInLevel = 0;
    // Reset players
    Object.values(room.players).forEach(p => {
      p.score = 0;
      p.alive = true;
      p.bubbleLevel = 0;
    });
    
    io.to(code).emit('game_started');
    await startRound(code);
  });

  // Bubble clicked (answer attempt)
  socket.on('bubble_click', ({ code, bubbleId, answer, isCorrect }) => {
    const room = rooms[code];
    if (!room || room.status !== 'playing') return;
    const player = room.players[socket.id];
    if (!player || !player.alive) return;

    if (isCorrect) {
      player.score += 100;
      player.bubbleLevel = Math.max(0, player.bubbleLevel - 15);
      io.to(code).emit('bubble_popped', { playerId: socket.id, bubbleId, correct: true });
    } else {
      player.score = Math.max(0, player.score - 30);
      player.bubbleLevel = Math.min(100, player.bubbleLevel + 10);
      io.to(code).emit('bubble_popped', { playerId: socket.id, bubbleId, correct: false });
    }

    emitLeaderboard(code);
    checkElimination(code, socket.id);
  });

  // Bubble reaches top (level increase)
  socket.on('bubble_overflow', ({ code, amount }) => {
    const room = rooms[code];
    if (!room || room.status !== 'playing') return;
    const player = room.players[socket.id];
    if (!player || !player.alive) return;

    player.bubbleLevel = Math.min(100, player.bubbleLevel + Math.min(amount || 2, 3));
    checkElimination(code, socket.id);
    emitLeaderboard(code);
  });

  // Stop game early (host only) — broadcast game_ended to all players
  socket.on('stop_game', ({ code }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    room.status = 'ended';
    clearTimeout(room.questionTimer);
    const allPlayers = Object.values(room.players).sort((a, b) => b.score - a.score);
    const nonHostPlayers = allPlayers.filter(p => p.id !== room.host);
    const hostPlayer = room.players[room.host];
    const winner = nonHostPlayers.find(p => p.alive) || nonHostPlayers[0];
    io.to(code).emit('game_ended', {
      winner: winner ? { id: winner.id, name: winner.name, score: winner.score } : null,
      host: hostPlayer ? { id: hostPlayer.id, name: hostPlayer.name } : null,
      leaderboard: nonHostPlayers.map((p, i) => ({ rank: i+1, id: p.id, name: p.name, score: p.score, alive: p.alive }))
    });
    setTimeout(() => { delete rooms[code]; }, 60000);
  });

  // Continue to next level (host only)
  socket.on('continue_level', ({ code }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (room.status !== 'level_complete') return;
    room.level += 1;
    room.roundInLevel = 0;
    room.status = 'playing';
    // Reset bubble levels for all alive players
    Object.values(room.players).forEach(p => {
      if (p.alive) p.bubbleLevel = 0;
    });
    io.to(code).emit('level_started', { level: room.level });
    startRound(code);
  });

  // Disconnect
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
        // If host disconnects, assign new host
        if (room.host === socket.id) {
          const others = Object.keys(room.players).filter(id => id !== socket.id && !room.players[id].disconnected);
          if (others.length > 0) {
            room.host = others[0];
            io.to(others[0]).emit('you_are_host');
          }
        }
      }
    }
  });
});

// ─── Game Logic ───────────────────────────────────────────────────────────────
async function startRound(code) {
  const room = rooms[code];
  if (!room || room.status !== 'playing') return;
  
  const alivePlayers = Object.values(room.players).filter(p => p.alive);
  if (alivePlayers.length <= 1) return checkGameEnd(code);

  const currentLevel = room.level || 1;
  const roundsThisLevel = (LEVEL_CONFIG[currentLevel] || LEVEL_CONFIG[3]).rounds;

  room.round += 1;
  room.roundInLevel += 1;
  io.to(code).emit('round_starting', { round: room.round, roundInLevel: room.roundInLevel, level: currentLevel, totalRoundsPerLevel: roundsThisLevel });

  const question = await generateQuestion(currentLevel);
  room.currentQuestion = question;

  // Send question after brief delay
  setTimeout(() => {
    if (rooms[code]?.status !== 'playing') return;
    io.to(code).emit('new_question', {
      round: room.round,
      roundInLevel: room.roundInLevel,
      level: currentLevel,
      totalRoundsPerLevel: roundsThisLevel,
      question: question.question,
      correct_answer: question.correct_answer,
      wrong_answers: question.wrong_answers,
      equivalent_expressions: question.equivalent_expressions,
      duration: 30000
    });

    // Next round after 30 seconds
    room.questionTimer = setTimeout(async () => {
      if (!rooms[code] || rooms[code].status !== 'playing') return;
      io.to(code).emit('round_ended', { round: room.round });
      await new Promise(r => setTimeout(r, 2000));

      // Check if level complete
      if (rooms[code] && rooms[code].roundInLevel >= roundsThisLevel) {
        clearTimeout(rooms[code].questionTimer);
        rooms[code].status = 'level_complete';
        io.to(code).emit('level_complete', {
          level: rooms[code].level,
          nextLevel: rooms[code].level + 1,
          leaderboard: Object.values(rooms[code].players)
            .sort((a, b) => b.score - a.score)
            .map((p, i) => ({ rank: i+1, id: p.id, name: p.name, score: p.score, alive: p.alive }))
        });
      } else {
        await startRound(code);
      }
    }, 30000);

  }, 3000);
}

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
  }
}

function checkGameEnd(code) {
  const room = rooms[code];
  if (!room || room.status !== 'playing') return;

  const alivePlayers = Object.values(room.players).filter(p => p.alive && !p.disconnected && p.id !== room.host);
  
  const totalPlayers = Object.values(room.players).filter(p => !p.disconnected).length;
  // Game berakhir kalau sisa 1 atau 0 pemain hidup (dari minimal 2 total)
  if (alivePlayers.length <= 1) {
    room.status = 'ended';
    clearTimeout(room.questionTimer);

    const allPlayers = Object.values(room.players)
      .sort((a, b) => b.score - a.score);

    const nonHostPlayers = allPlayers.filter(p => p.id !== room.host);
    const hostPlayer = room.players[room.host];
    const winner = alivePlayers[0] || nonHostPlayers[0];

    io.to(code).emit('game_ended', {
      winner: winner ? { id: winner.id, name: winner.name, score: winner.score } : null,
      host: hostPlayer ? { id: hostPlayer.id, name: hostPlayer.name } : null,
      leaderboard: nonHostPlayers.map((p, i) => ({
        rank: i + 1,
        id: p.id,
        name: p.name,
        score: p.score,
        alive: p.alive,
      }))
    });

    // Cleanup after 60s
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
      rank: i + 1,
      id: p.id,
      name: p.name,
      score: p.score,
      alive: p.alive,
      bubbleLevel: p.bubbleLevel,
    }));
  io.to(code).emit('leaderboard_update', { leaderboard });
}

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🫧 Quibble server running at http://localhost:${PORT}`);
  console.log(`   Set GEMINI_API_KEY env variable for AI questions\n`);
});