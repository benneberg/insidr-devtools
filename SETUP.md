# Setup Guide - Custom DevTools

Complete setup instructions for the Custom DevTools debugging application.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Frontend Setup](#frontend-setup)
- [Backend Setup (Optional)](#backend-setup-optional)
- [Testing the DevTools](#testing-the-devtools)
- [Building for Production](#building-for-production)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v16 or higher) - [Download](https://nodejs.org/)
- **npm** or **yarn** package manager
- **Python** (v3.8 or higher) - Only if running backend - [Download](https://www.python.org/)
- **MongoDB** - Only if running backend - [Download](https://www.mongodb.com/)

Check your installations:
```bash
node --version
npm --version
python --version
```

---

## Quick Start

### Fastest Way to Test (Frontend Only)

```bash
# 1. Clone the repository
git clone <your-repo-url>
cd insidr-devtools

# 2. Navigate to frontend
cd frontend

# 3. Install dependencies
npm install
# OR using yarn
yarn install

# 4. Start development server
npm start
# OR
yarn start

# 5. Open browser
# Navigate to http://localhost:3000
# Click the toggle button (bottom-right) to open DevTools
```

That's it! The demo page includes sample data, console logs, and network requests.

---

## Frontend Setup

### Step 1: Install Dependencies

```bash
cd frontend
npm install
```

Or if using yarn (recommended for this project):
```bash
yarn install
```

### Step 2: Environment Configuration (Optional)

Create a `.env` file in the `frontend` directory if you need custom configuration:

```bash
# Copy the example file
copy .env.example .env
```

Edit `.env` with your settings:
```env
# API endpoint (only needed if connecting to backend)
REACT_APP_API_URL=http://localhost:8000/api

# Other optional settings
REACT_APP_ENABLE_DEVTOOLS=true
```

### Step 3: Run Development Server

```bash
npm start
```

The app will open at `http://localhost:3000`

### Step 4: Test the DevTools

1. Look for the **green toggle button** at the bottom-right corner
2. Click it to open the DevTools panel
3. Explore the different tabs:
   - **Console**: See captured logs
   - **Elements**: Inspect DOM tree
   - **Network**: View API calls
   - **Storage**: Check localStorage/sessionStorage
   - And 6 more tabs!

---

## Backend Setup (Optional)

The backend is **optional** - DevTools works standalone without it. The backend provides a simple API for demo purposes.

### Step 1: Create Virtual Environment

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows PowerShell:
.\venv\Scripts\Activate.ps1

# On Windows CMD:
venv\Scripts\activate.bat

# On macOS/Linux:
source venv/bin/activate
```

### Step 2: Install Dependencies

```bash
pip install -r requirements.txt
```

### Step 3: Environment Configuration

Create a `.env` file in the `backend` directory:

```bash
# Copy the example file
copy .env.example .env
```

Edit `.env` with your MongoDB credentials:
```env
MONGO_URL=mongodb://localhost:27017/
DB_NAME=devtools_demo
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
```

### Step 4: Start MongoDB

Ensure MongoDB is running:
```bash
# If installed locally
mongod

# Or use MongoDB Atlas cloud service
# Update MONGO_URL in .env with your Atlas connection string
```

### Step 5: Run Backend Server

```bash
uvicorn server:app --reload
```

The API will be available at `http://localhost:8000`

API Documentation: `http://localhost:8000/docs`

---

## Testing the DevTools

### Option 1: Built-in Demo Page

The easiest way - just start the frontend:
```bash
cd frontend
npm start
```

The demo page (`App.js`) includes:
- ✅ Sample console logs (log, warn, error, info)
- ✅ Network requests (fetch to JSONPlaceholder API)
- ✅ localStorage data
- ✅ Interactive buttons to trigger events

### Option 2: Integrate into Your Own React App

Add DevTools to any React component:

```jsx
import DevTools from './components/DevTools';

function App() {
  return (
    <div>
      <YourApp />
      <DevTools />
    </div>
  );
}
```

### Option 3: Use as Standalone Script (Any HTML Page)

First, build the standalone bundle:

```bash
cd frontend
npm run build:devtools
```

Then add to any HTML page:

```html
<!DOCTYPE html>
<html>
<head>
    <title>My Website</title>
    <link rel="stylesheet" href="path/to/devtools.css">
</head>
<body>
    <h1>My Website</h1>
    
    <!-- Include DevTools bundle -->
    <script src="path/to/devtools.bundle.js"></script>
    <script>
        // DevTools will automatically initialize
        window.CustomDevTools.init();
    </script>
</body>
</html>
```

---

## Building for Production

### Build React App

```bash
cd frontend
npm run build
```

Output will be in `frontend/build/` directory.

### Build Standalone DevTools Bundle

```bash
cd frontend
npm run build:devtools
```

Output will be in `frontend/dist/` directory:
- `devtools.bundle.js` - The standalone script
- `devtools.css` - Required styles

### Use the Bundle

Copy files to your project:
```bash
# Copy to your public directory
copy frontend\dist\devtools.bundle.js public\js\
copy frontend\dist\devtools.css public\css\
```

Include in HTML:
```html
<link rel="stylesheet" href="/css/devtools.css">
<script src="/js/devtools.bundle.js"></script>
```

---

## Troubleshooting

### Frontend Issues

**Problem**: `npm install` fails
```bash
# Solution 1: Clear cache
npm cache clean --force
rm -rf node_modules package-lock.json
npm install

# Solution 2: Use yarn instead
yarn install
```

**Problem**: Port 3000 already in use
```bash
# Solution: Use different port
$env:PORT=3001; npm start
```

**Problem**: DevTools toggle button not appearing
- Check browser console for errors
- Ensure `DevTools` component is imported and rendered
- Clear browser cache

**Problem**: Styles not loading correctly
- Ensure `tailwind.config.js` is properly configured
- Run `npm install` again
- Check that all CSS files are imported

### Backend Issues

**Problem**: MongoDB connection fails
```bash
# Check if MongoDB is running
# Windows:
net start MongoDB

# macOS/Linux:
sudo systemctl start mongod
```

**Problem**: CORS errors
- Update `CORS_ORIGINS` in backend `.env`
- Add your frontend URL (e.g., `http://localhost:3000`)

**Problem**: Virtual environment activation fails
```bash
# PowerShell execution policy issue
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Then try again:
.\venv\Scripts\Activate.ps1
```

**Problem**: Import errors after pip install
```bash
# Ensure you're in the virtual environment
# You should see (venv) in your terminal prompt

# Try reinstalling
pip install -r requirements.txt --force-reinstall
```

### General Issues

**Problem**: React version conflicts
```bash
# This project uses React 19
# Ensure package.json has correct version
npm install react@^19.0.0 react-dom@^19.0.0
```

**Problem**: Build fails
```bash
# Clear build cache
rm -rf build dist node_modules/.cache
npm run build
```

---

## Development Tips

### Hot Reloading

Both frontend and backend support hot reloading:
- **Frontend**: Changes auto-refresh in browser
- **Backend**: `--reload` flag auto-restarts server

### Testing Changes

1. Make changes to DevTools components
2. Save file
3. Check browser - should auto-refresh
4. Test in Console, Elements, Network tabs

### Debugging

- Use browser DevTools to debug the DevTools! (Meta debugging 🤯)
- Check Console tab for React errors
- Check Network tab for API call issues

### Code Style

```bash
# Frontend uses ESLint
cd frontend
npm run lint

# Backend uses Black & Flake8
cd backend
black .
flake8 .
```

---

## Next Steps

- ✅ Read [DEVTOOLS_INTEGRATION.md](DEVTOOLS_INTEGRATION.md) for integration methods
- ✅ Check [README.md](README.md) for feature documentation
- ✅ Explore the code in `frontend/src/components/DevTools.jsx`
- ✅ Customize styles in `frontend/src/components/DevTools.css`

---

## Support

For issues or questions:
1. Check [Troubleshooting](#troubleshooting) section
2. Review existing issues on GitHub
3. Create a new issue with details

---

## License

MIT License - See LICENSE file for details
