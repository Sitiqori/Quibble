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
const ROUNDS_PER_LEVEL = 5;

function generateCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// ─── AI Question Generator (Gemini) ───────────────────────────────────────────
async function generateQuestion(round) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  
  const difficulty = round <= 3 ? 'easy' : round <= 6 ? 'medium' : 'hard';
  const difficultyDesc = {
    easy: 'simple addition and subtraction with numbers 1-20',
    medium: 'multiplication, division, or multi-step operations with numbers up to 100',
    hard: 'fractions, percentages, exponents, or algebra with complex calculations'
  }[difficulty];

  const prompt = `Generate a math quiz question for a multiplayer game. Difficulty: ${difficulty} (${difficultyDesc}).

Return ONLY valid JSON in this exact format (no markdown, no extra text):
{
  "question": "What is 5 + 7?",
  "correct_answer": "12",
  "wrong_answers": ["10", "13", "14"],
  "equivalent_expressions": ["6+6", "3+9"]
}

Rules:
- question must be clear and unambiguous
- correct_answer must be a number or simple expression
- wrong_answers must have exactly 3 plausible but wrong answers
- equivalent_expressions: 2 different ways to write the same answer (can be empty array if not applicable)
- All answers should be distinct`;

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
    // Fallback questions
    const fallbacks = [
      { question: "What is 8 × 7?", correct_answer: "56", wrong_answers: ["54", "58", "63"], equivalent_expressions: ["7×8"] },
      { question: "What is 144 ÷ 12?", correct_answer: "12", wrong_answers: ["11", "13", "14"], equivalent_expressions: ["12²÷12"] },
      { question: "What is 15% of 200?", correct_answer: "30", wrong_answers: ["25", "35", "40"], equivalent_expressions: [] },
      { question: "What is 2⁵?", correct_answer: "32", wrong_answers: ["25", "16", "64"], equivalent_expressions: ["2×2×2×2×2"] },
      { question: "What is √81?", correct_answer: "9", wrong_answers: ["7", "8", "10"], equivalent_expressions: ["3²"] },
      { question: "What is 13 + 28?", correct_answer: "41", wrong_answers: ["39", "43", "42"], equivalent_expressions: ["28+13"] },
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
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

  room.round += 1;
  room.roundInLevel += 1;
  io.to(code).emit('round_starting', { round: room.round, roundInLevel: room.roundInLevel, level: room.level, totalRoundsPerLevel: ROUNDS_PER_LEVEL });

  const question = await generateQuestion(room.round);
  room.currentQuestion = question;

  // Send question after brief delay
  setTimeout(() => {
    if (rooms[code]?.status !== 'playing') return;
    io.to(code).emit('new_question', {
      round: room.round,
      roundInLevel: room.roundInLevel,
      level: room.level,
      totalRoundsPerLevel: ROUNDS_PER_LEVEL,
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
      if (rooms[code] && rooms[code].roundInLevel >= ROUNDS_PER_LEVEL) {
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

  const alivePlayers = Object.values(room.players).filter(p => p.alive && !p.disconnected);
  
  const totalPlayers = Object.values(room.players).filter(p => !p.disconnected).length;
  // Game berakhir kalau sisa 1 atau 0 pemain hidup (dari minimal 2 total)
  if (alivePlayers.length <= 1) {
    room.status = 'ended';
    clearTimeout(room.questionTimer);

    const allPlayers = Object.values(room.players)
      .sort((a, b) => b.score - a.score);

    const winner = alivePlayers[0] || allPlayers[0];

    io.to(code).emit('game_ended', {
      winner: winner ? { id: winner.id, name: winner.name, score: winner.score } : null,
      leaderboard: allPlayers.map((p, i) => ({
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