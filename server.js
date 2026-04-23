# 💌 Us: The Deck

A real-time multiplayer card game for two — built around your love story.

## How to Deploy (Free, 10 minutes)

We'll deploy this to **Render.com** — free hosting that gives you a public URL
like `us-the-deck.onrender.com` accessible from anywhere in the Philippines.

---

### Step 1 — Create a GitHub Account
Go to https://github.com and sign up (free). Skip if you already have one.

---

### Step 2 — Upload the Game to GitHub

1. Go to https://github.com/new
2. Name the repo: `us-the-deck`
3. Set it to **Public**, click **Create repository**
4. On the next page, click **uploading an existing file**
5. Drag and drop ALL the files from this folder:
   - `server.js`
   - `package.json`
   - `.gitignore`
   - The `public/` folder (with `index.html` inside)
6. Click **Commit changes**

---

### Step 3 — Deploy on Render.com

1. Go to https://render.com and sign up with your GitHub account (free)
2. Click **New +** → **Web Service**
3. Connect your GitHub account and select the `us-the-deck` repo
4. Fill in the settings:
   - **Name:** us-the-deck (or anything you like)
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance Type:** Free
5. Click **Create Web Service**
6. Wait ~2 minutes for it to build and deploy

---

### Step 4 — Play!

Once deployed, Render gives you a URL like:
```
https://us-the-deck.onrender.com
```

Share this URL with your partner — that's it! You can both open it on your
phones from anywhere in the Philippines and play together.

> **Note:** The free tier "sleeps" after 15 minutes of inactivity. The first
> visit after sleeping takes ~30 seconds to wake up. Just refresh if it seems slow.

---

## How to Play

1. **Player 1** opens the URL, enters their name, taps **Create Room**
2. Share the 4-letter room code with **Player 2**
3. **Player 2** opens the same URL, enters name, types the code, taps **Join Room**
4. Both players write **3 secret questions** about themselves
5. Cards are dealt — first to **10 points** wins!
6. The loser picks the next activity 💕

## Card Types

| Card     | Effect |
|----------|--------|
| 💌 Memory  | Answer a question about your partner. Correct = they get 2 pts. Wrong = you get 1 pt. |
| ✊ Duel    | Rock Paper Scissors — winner gets 2 pts |
| ⚡ Speed Duel | Tap a button first — winner gets 2 pts |
| 🎲 Luck    | Roll a die — various effects |
| 🛡️ Shield  | Protect yourself from the next point loss |
| ✨ Wild    | Surprise effects — swap hands, peek, extra turn, and more |

## Running Locally

```bash
npm install
node server.js
# Open http://localhost:3000 in two browser tabs
```
