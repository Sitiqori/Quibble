# 🫧 Quibble — Math Bubble Battle

Real-time multiplayer math quiz game. Players pop floating bubbles with correct answers while racing against each other. Screen fills with bubbles → eliminated!

## Quick Start

### Prerequisites
- Node.js 18+
- Gemini API key (optional — fallback questions included)

### Install & Run

```bash
# Install dependencies
npm install

# Run without AI (uses fallback questions)
node server.js

# Run with Gemini AI questions
GEMINI_API_KEY=your_key_here node server.js
```

Server starts at: **http://localhost:3000**

Open the same URL on multiple devices/tabs to play multiplayer!

## How to Get a Gemini API Key

1. Go to https://aistudio.google.com/
2. Click "Get API Key"
3. Create a new key (free tier available)
4. Set it as an env variable: `GEMINI_API_KEY=your_key node server.js`

## How to Play

1. **Create Room** — Enter your name and create a room. Share the 5-letter code.
2. **Join Room** — Others enter the code to join.
3. **Start Game** — Host clicks Start when everyone is ready.
4. **Pop Bubbles** — Click green bubbles (correct answers) to score points.
   - ✅ Correct bubble: **+100 pts**, reduces danger level
   - ❌ Wrong bubble: **-30 pts**, increases danger level
   - ⚪ Empty bubble: nothing (distractor)
5. **Don't get eliminated!** — If bubbles stack up to the danger line, you're out.
6. **Last player standing wins** 🏆

## Tech Stack

- **Backend**: Node.js + Express
- **Real-time**: Socket.IO
- **AI**: Google Gemini API (with fallback)
- **Frontend**: Vanilla HTML/CSS/JS (no build step)

## Deployment

### Render.com (Free)
1. Push to GitHub
2. Create new Web Service on Render
3. Set `GEMINI_API_KEY` environment variable
4. Deploy!

### Railway / Fly.io
Same process — set the env var and deploy.

### Local Network (LAN party)
Run `node server.js` and share your local IP address (e.g., `http://192.168.1.x:3000`)
