# LA Art Openings Backend

Self-hosted backend API for the LA Art Openings mobile app.

## Deployment to Railway

### Prerequisites

- GitHub account
- Railway account (free tier available at railway.app)
- MySQL database (Railway provides this)

### Setup Instructions

1. **Create a new GitHub repository**
   - Go to https://github.com/new
   - Name: `la-art-openings-backend`
   - Make it public or private (your choice)
   - Don't initialize with README (we already have one)

2. **Push this code to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/la-art-openings-backend.git
   git push -u origin main
   ```

3. **Deploy to Railway**
   - Go to https://railway.app
   - Sign in with GitHub
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose `la-art-openings-backend`
   - Railway will auto-detect the Node.js app

4. **Add MySQL Database**
   - In Railway project dashboard, click "Add"
   - Select "MySQL"
   - Railway will provision a database and set environment variables

5. **Configure Environment Variables**
   - In Railway project settings, add:
     - `NODE_ENV`: `production`
     - `ADMIN_PASSWORD`: Your admin password (e.g., `laartadmin2024`)
     - `PORT`: `3000` (Railway will override this)

6. **Run Database Migrations**
   - Once deployed, SSH into the Railway container or use the Railway CLI to run:
     ```bash
     npm run db:push
     ```

7. **Get Your API URL**
   - Railway assigns a URL like `https://la-art-openings-backend-prod.up.railway.app`
   - Use this in your DNS CNAME record and app configuration

## Environment Variables

- `DATABASE_URL`: Set automatically by Railway MySQL plugin
- `NODE_ENV`: Set to `production`
- `ADMIN_PASSWORD`: Password for admin panel (default: `laartadmin2024`)
- `PORT`: Server port (default: 3000)

## API Endpoints

- `POST /api/trpc/events.list` - Get all events
- `POST /api/trpc/events.create` - Create an event
- `POST /api/trpc/events.delete` - Delete an event
- `POST /api/trpc/geocode.coordinates` - Geocode an address

## Local Development

```bash
npm install
npm run dev
```

Server runs on `http://localhost:3000`

## Production Build

```bash
npm run build
npm start
```
