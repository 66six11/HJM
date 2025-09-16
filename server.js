import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import dotenv from 'dotenv';
import helmet from 'helmet';
import morgan from 'morgan';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createOrUpdateUser,
  getUserByGithubId,
  getUserById,
  setUserFaction,
  getFactionByUserId,
  createAnonymousUser,
  getStats
} from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const port = process.env.PORT || 3000;
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
const sessionSecret = process.env.SESSION_SECRET || 'dev_secret_change_me';
const githubClientId = process.env.GITHUB_CLIENT_ID || '';
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET || '';
const githubConfigured = Boolean(githubClientId && githubClientSecret);

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(morgan('dev'));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' }
  })
);

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  done(null, { id: user.id });
});

passport.deserializeUser((serialized, done) => {
  try {
    const user = getUserById(serialized.id);
    done(null, user || false);
  } catch (error) {
    done(error);
  }
});

if (githubConfigured) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: githubClientId,
        clientSecret: githubClientSecret,
        callbackURL: `${baseUrl}/auth/github/callback`,
        scope: ['read:user']
      },
      (accessToken, refreshToken, profile, done) => {
        try {
          const normalizedProfile = {
            id: profile.id,
            username: profile.username || (profile.displayName || 'GitHubUser'),
            avatarUrl: profile.photos && profile.photos[0] ? profile.photos[0].value : null
          };
          const user = createOrUpdateUser(normalizedProfile);
          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );
} else {
  // eslint-disable-next-line no-console
  console.warn('GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env');
}

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

if (githubConfigured) {
  app.get('/auth/github', passport.authenticate('github', { scope: ['read:user'] }));
  app.get(
    '/auth/github/callback',
    passport.authenticate('github', { failureRedirect: '/?auth=failed' }),
    (req, res) => {
      res.redirect('/');
    }
  );
} else {
  app.get('/auth/github', (_req, res) => {
    res.status(501).json({ error: 'GitHub OAuth not configured. Please set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env' });
  });
}

app.post('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    res.status(200).json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    const user = req.user;
    return res.json({ authenticated: true, user: { id: user.id, username: user.username, avatarUrl: user.avatarUrl, faction: user.faction || null } });
  }
  // For guests: ensure there is a session user id
  if (!req.session.guestUserId) {
    const guest = createAnonymousUser('Guest');
    req.session.guestUserId = guest.id;
  }
  const guest = getUserById(req.session.guestUserId);
  return res.json({ authenticated: false, user: { id: guest.id, username: guest.username, avatarUrl: guest.avatarUrl, faction: guest.faction || null } });
});

app.get('/api/config', (_req, res) => {
  res.json({ githubConfigured, baseUrl });
});

app.get('/api/stats', async (_req, res) => {
  try {
    const stats = await getStats();
    res.json({ ok: true, stats });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Failed to get stats' });
  }
});

app.post('/api/faction', (req, res) => {
  const faction = req.body.faction;
  if (!['A', 'B'].includes(faction)) {
    return res.status(400).json({ error: 'Invalid faction. Use A or B.' });
  }
  try {
    let targetUserId;
    if (req.isAuthenticated && req.isAuthenticated()) {
      targetUserId = req.user.id;
    } else {
      if (!req.session.guestUserId) {
        const guest = createAnonymousUser('Guest');
        req.session.guestUserId = guest.id;
      }
      targetUserId = req.session.guestUserId;
    }
    const updated = setUserFaction(targetUserId, faction);
    return res.json({ ok: true, user: { id: updated.id, username: updated.username, avatarUrl: updated.avatarUrl, faction: updated.faction } });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update faction' });
  }
});

function renderBadgeSvg(faction) {
  const factionLabel = faction === 'A' ? '阵营A' : faction === 'B' ? '阵营B' : '未选择';
  const color = faction === 'A' ? '#d65555' : faction === 'B' ? '#4e8dd6' : '#9e9e9e';
  const text = `阵营: ${factionLabel}`;
  const width = 130;
  const height = 20;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-label="${text}">
  <linearGradient id="smooth" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <mask id="round">
    <rect width="${width}" height="${height}" rx="3" fill="#fff"/>
  </mask>
  <g mask="url(#round)">
    <rect width="60" height="${height}" fill="#555"/>
    <rect x="60" width="${width - 60}" height="${height}" fill="${color}"/>
    <rect width="${width}" height="${height}" fill="url(#smooth)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="30" y="14">阵营</text>
    <text x="95" y="14">${factionLabel}</text>
  </g>
</svg>`;
}

function normalizeFaction(input) {
  if (!input) return null;
  const v = String(input).trim().toUpperCase();
  if (v === 'A' || v === '1') return 'A';
  if (v === 'B' || v === '2') return 'B';
  return null;
}

function renderFactionImageSvg(faction) {
  const factionLabel = faction === 'A' ? '阵营A' : faction === 'B' ? '阵营B' : '未选择';
  const color = faction === 'A' ? '#ff6b6b' : faction === 'B' ? '#4dabf7' : '#cbd5e1';
  const bg = faction === 'A' ? '#fff5f5' : faction === 'B' ? '#e7f5ff' : '#f8fafc';
  const width = 400;
  const height = 160;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="${bg}" />
      <stop offset="100%" stop-color="#ffffff" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" rx="16" fill="url(#g)" stroke="${color}" stroke-width="2" />
  <g transform="translate(24, 24)">
    <circle cx="56" cy="56" r="56" fill="${color}" opacity="0.15" />
    <circle cx="56" cy="56" r="40" fill="${color}" />
    <text x="56" y="62" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="28" fill="#ffffff">${faction === 'A' ? 'A' : faction === 'B' ? 'B' : '?'}</text>
  </g>
  <g transform="translate(160, 56)">
    <text x="0" y="0" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="28" fill="#0f172a">我的阵营</text>
    <text x="0" y="40" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="36" fill="${color}">${factionLabel}</text>
  </g>
</svg>`;
}

app.get('/badge/:id.svg', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const faction = Number.isFinite(id) ? await getFactionByUserId(id) : null;
  const svg = renderBadgeSvg(faction);
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(svg);
});

app.get('/badge/faction/:f.svg', (req, res) => {
  const faction = normalizeFaction(req.params.f);
  const svg = renderBadgeSvg(faction);
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(svg);
});

app.get('/badge', async (req, res) => {
  const f = normalizeFaction(req.query.faction || req.query.f);
  let faction = f;
  if (!faction) {
    const id = parseInt(req.query.id, 10);
    faction = Number.isFinite(id) ? await getFactionByUserId(id) : null;
  }
  const svg = renderBadgeSvg(faction);
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(svg);
});

app.get('/image/:id.svg', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const faction = Number.isFinite(id) ? await getFactionByUserId(id) : null;
  const svg = renderFactionImageSvg(faction);
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(svg);
});

app.get('/image/faction/:f.svg', (req, res) => {
  const faction = normalizeFaction(req.params.f);
  const svg = renderFactionImageSvg(faction);
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(svg);
});

app.get('/image', async (req, res) => {
  const f = normalizeFaction(req.query.faction || req.query.f);
  let faction = f;
  if (!faction) {
    const id = parseInt(req.query.id, 10);
    faction = Number.isFinite(id) ? await getFactionByUserId(id) : null;
  }
  const svg = renderFactionImageSvg(faction);
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(svg);
});

// Prevent aggressive caching of the entry HTML
app.get(['/', '/index.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

const isVercel = Boolean(process.env.VERCEL);
if (!isVercel) {
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on ${baseUrl}`);
  });
}

export default app;

