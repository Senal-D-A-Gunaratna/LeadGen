# Troubleshooting & Setup Guide

This document outlines solutions for common environment and dependency issues encountered in the project.

## 🚀 Quick Fix (Recommended)

If you are experiencing module errors, the fastest solution is to run the automated fix script. This handles both frontend and backend dependencies.

```bash
cd /home/Senal/leadgen/studio-main
bash fix-setup.sh
```

After running the script, start the development server:

```bash
npm run dev
```

---

## 🛠 Manual Troubleshooting

If you prefer to fix issues individually, follow the steps below for specific errors.

### 1. Frontend Dependency Errors

#### Issue: `concurrently` module not found
**Error:** `Error: Cannot find module '../src/defaults'`

**Fix:**
```bash
rm -rf node_modules/.bin/concurrently node_modules/concurrently
npm install concurrently@^8.2.2 --save-dev
```

#### Issue: `next` module not found
**Error:** `Error: Cannot find module '../server/require-hook'`

**Fix:**
```bash
rm -rf node_modules/.bin/next node_modules/next
npm install next@14.2.4 --save
```

### 2. Backend Dependency Errors

#### Issue: `requirements.txt` not found
**Error:** `[Errno 2] No such file or directory: 'requirements.txt'`

**Fix:**
The backend dependencies must be installed from the `servers/backend/` directory.

```bash
cd servers/backend
pip3 install -r requirements.txt
cd ..
```

Or use the npm script:
```bash
npm run install-backend
```

## Issue 3: Setup Script Not Found

**Error:** `bash: setup.sh: command not found`

**Fix:**
Use `bash` to run the script:
```bash
bash setup.sh
```

Or make it executable first:
```bash
chmod +x setup.sh
./setup.sh
```

## Complete Fix (Run All Steps)

```bash
cd /home/Senal/leadgen/studio-main

# 1. Fix concurrently
rm -rf node_modules/.bin/concurrently node_modules/concurrently
npm install concurrently@^8.2.2 --save-dev

# 2. Fix Next.js
rm -rf node_modules/.bin/next node_modules/next
npm install next@14.2.4 --save

# 3. Install backend dependencies
cd servers/backend
pip3 install -r requirements.txt
cd ..

# 4. Verify everything works
npm run dev
```

## Nuclear Option: Full Clean Reinstall

If multiple modules are corrupted, do a full clean reinstall:

```bash
cd /home/Senal/leadgen/studio-main

# Remove all node modules
rm -rf node_modules package-lock.json

# Reinstall everything
npm install

# Install backend dependencies
cd servers/backend
pip3 install -r requirements.txt
cd ..

# Try running
npm run dev
```

## Alternative: Use the Fix Script

I've created a `fix-setup.sh` script that does all of this automatically:

```bash
cd /home/Senal/leadgen/studio-main
bash fix-setup.sh
```

Then try:
```bash
npm run dev
```
