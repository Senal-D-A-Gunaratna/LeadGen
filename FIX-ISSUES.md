# Fixing Current Issues

Based on the errors you're seeing, here's how to fix them:

## Issue 1: Concurrently Module Error

**Error:** `Error: Cannot find module '../src/defaults'` from concurrently

**Fix:**
```bash
cd /home/Senal/leadgen/studio-main

# Remove corrupted concurrently installation
rm -rf node_modules/.bin/concurrently
rm -rf node_modules/concurrently

# Reinstall it
npm install concurrently@^8.2.2 --save-dev

# Or use the fix script:
bash fix-setup.sh
```

## Issue 1b: Next.js Module Error

**Error:** `Error: Cannot find module '../server/require-hook'` from next

**Fix:**
```bash
cd /home/Senal/leadgen/studio-main

# Remove corrupted Next.js installation
rm -rf node_modules/.bin/next
rm -rf node_modules/next

# Reinstall Next.js
npm install next@14.2.4 --save

# Or use the fix script:
bash fix-nextjs.sh
```

## Issue 2: Requirements.txt Not Found

**Error:** `ERROR: Could not open requirements file: [Errno 2] No such file or directory: 'requirements.txt'`

**Fix:**
The `requirements.txt` file is in the `backend/` directory, not the root. Run:

```bash
cd /home/Senal/leadgen/studio-main/backend
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
cd backend
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
cd backend
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
