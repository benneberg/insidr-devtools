# Quick Start Guide

## For Testing the DevTools Demo

### Option 1: Quick Test (Fastest - 2 minutes)

```bash
# Navigate to frontend
cd frontend

# Install dependencies (first time only)
npm install

# Start development server
npm start
```

Open http://localhost:3000 and click the green toggle button at bottom-right!

---

## For Using DevTools on Your Own Webpage

### Step 1: Build the Standalone Bundle

```bash
cd frontend
npm install  # First time only
npm run build:devtools
```

This creates:
- `frontend/dist/devtools.bundle.js`
- `frontend/dist/devtools.css`

### Step 2: Include in Your HTML

```html
<!DOCTYPE html>
<html>
<head>
    <link rel="stylesheet" href="path/to/devtools.css">
</head>
<body>
    <!-- Your content -->
    
    <script src="path/to/devtools.bundle.js"></script>
    <script>
        window.CustomDevTools.init();
    </script>
</body>
</html>
```

### Step 3: Test with the Example Page

```bash
# After building, open the test page
# Double-click: frontend/test-standalone.html
# Or serve it with a local server
```

---

## NPM Scripts Reference

| Command | Description |
|---------|-------------|
| `npm start` | Start development server (React app with DevTools) |
| `npm run build` | Build production React app |
| `npm run build:devtools` | Build standalone DevTools bundle |
| `npm run build:all` | Build both React app and standalone bundle |
| `npm test` | Run tests |

---

## Backend Setup (Optional)

The backend is **optional** - only needed for demo API features.

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate (Windows PowerShell)
.\venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt

# Copy environment file
copy .env.example .env

# Edit .env with your MongoDB URL

# Run server
uvicorn server:app --reload
```

---

## Troubleshooting

### "npm run build:devtools" fails

```bash
# Make sure you have all dependencies
npm install

# If still fails, install webpack manually
npm install --save-dev webpack webpack-cli babel-loader
```

### DevTools not appearing on standalone page

1. Check browser console for errors
2. Ensure paths to bundle files are correct
3. Make sure you built the bundle: `npm run build:devtools`

### Port 3000 already in use

```bash
# Use different port (PowerShell)
$env:PORT=3001; npm start
```

---

## Next Steps

- ✅ Read [SETUP.md](../SETUP.md) for detailed setup
- ✅ Read [DEVTOOLS_INTEGRATION.md](../DEVTOOLS_INTEGRATION.md) for integration options
- ✅ Check [README.md](../README.md) for features documentation
