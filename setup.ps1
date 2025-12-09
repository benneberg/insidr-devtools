# DevTools Setup Script for Windows PowerShell
# Run this script to set up the DevTools environment

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  Custom DevTools Setup Script" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Check if Node.js is installed
Write-Host "[1/5] Checking Node.js installation..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "  ✓ Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Node.js not found!" -ForegroundColor Red
    Write-Host "  Please install Node.js from: https://nodejs.org/" -ForegroundColor Red
    exit 1
}

# Navigate to frontend directory
Write-Host ""
Write-Host "[2/5] Navigating to frontend directory..." -ForegroundColor Yellow
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendPath = Join-Path $scriptPath "frontend"

if (Test-Path $frontendPath) {
    Set-Location $frontendPath
    Write-Host "  ✓ Changed to: $frontendPath" -ForegroundColor Green
} else {
    Write-Host "  ✗ Frontend directory not found!" -ForegroundColor Red
    exit 1
}

# Install dependencies
Write-Host ""
Write-Host "[3/5] Installing npm dependencies..." -ForegroundColor Yellow
Write-Host "  This may take a few minutes..." -ForegroundColor Gray
npm install
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Dependencies installed successfully" -ForegroundColor Green
} else {
    Write-Host "  ✗ Failed to install dependencies" -ForegroundColor Red
    exit 1
}

# Create .env file if it doesn't exist
Write-Host ""
Write-Host "[4/5] Setting up environment file..." -ForegroundColor Yellow
if (Test-Path ".env") {
    Write-Host "  ℹ .env file already exists, skipping..." -ForegroundColor Gray
} else {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "  ✓ Created .env from .env.example" -ForegroundColor Green
    } else {
        Write-Host "  ℹ No .env.example found, skipping..." -ForegroundColor Gray
    }
}

# Ask user what they want to do
Write-Host ""
Write-Host "[5/5] Setup complete! What would you like to do?" -ForegroundColor Yellow
Write-Host ""
Write-Host "  1) Start development server (npm start)" -ForegroundColor Cyan
Write-Host "  2) Build standalone bundle (npm run build:devtools)" -ForegroundColor Cyan
Write-Host "  3) Build everything (npm run build:all)" -ForegroundColor Cyan
Write-Host "  4) Exit" -ForegroundColor Cyan
Write-Host ""

$choice = Read-Host "Enter your choice (1-4)"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "Starting development server..." -ForegroundColor Green
        Write-Host "Open http://localhost:3000 in your browser" -ForegroundColor Cyan
        Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
        Write-Host ""
        npm start
    }
    "2" {
        Write-Host ""
        Write-Host "Building standalone bundle..." -ForegroundColor Green
        npm run build:devtools
        if ($LASTEXITCODE -eq 0) {
            Write-Host ""
            Write-Host "✓ Build complete!" -ForegroundColor Green
            Write-Host "  Files created in: frontend/dist/" -ForegroundColor Cyan
            Write-Host "  - devtools.bundle.js" -ForegroundColor Gray
            Write-Host "  - devtools.css" -ForegroundColor Gray
            Write-Host ""
            Write-Host "Test the bundle by opening: frontend/test-standalone.html" -ForegroundColor Cyan
        }
    }
    "3" {
        Write-Host ""
        Write-Host "Building everything..." -ForegroundColor Green
        npm run build:all
        if ($LASTEXITCODE -eq 0) {
            Write-Host ""
            Write-Host "✓ Build complete!" -ForegroundColor Green
            Write-Host "  React app in: frontend/build/" -ForegroundColor Cyan
            Write-Host "  Standalone in: frontend/dist/" -ForegroundColor Cyan
        }
    }
    "4" {
        Write-Host ""
        Write-Host "Setup complete! You can now:" -ForegroundColor Green
        Write-Host "  • Run 'npm start' to start dev server" -ForegroundColor Cyan
        Write-Host "  • Run 'npm run build:devtools' to build standalone bundle" -ForegroundColor Cyan
        Write-Host "  • Check QUICKSTART.md for more info" -ForegroundColor Cyan
        Write-Host ""
        exit 0
    }
    default {
        Write-Host ""
        Write-Host "Invalid choice. Exiting..." -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  Setup Complete!" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
