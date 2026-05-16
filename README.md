# Fridge to Thermomix 🍳

## Deploy to Vercel (free, ~2 minutes)

### Step 1 — Push to GitHub
1. Go to github.com → New repository → call it `fridge-recipe-app`
2. Upload this folder (drag the files in, or use git)

### Step 2 — Deploy on Vercel
1. Go to vercel.com → Sign up free (use your GitHub account)
2. Click **Add New Project** → import your `fridge-recipe-app` repo
3. Vercel auto-detects it as a React app — click **Deploy**

### Step 3 — Add your API key
1. In Vercel dashboard → your project → **Settings → Environment Variables**
2. Add: `ANTHROPIC_API_KEY` = your key from console.anthropic.com/settings/keys
3. Click **Redeploy** (Deployments tab → ... → Redeploy)

That's it — you'll get a URL like `https://fridge-recipe-app.vercel.app` that works on any device.

---

## Project structure

```
fridge-vercel/
├── api/
│   └── claude.js       ← Serverless function (keeps API key secure)
├── src/
│   ├── App.js          ← React app
│   └── index.js
├── public/
│   └── index.html
├── package.json
└── vercel.json         ← Routes config
```

## Local development

```bash
npm install
npm install -g vercel
ANTHROPIC_API_KEY=your_key vercel dev
```
