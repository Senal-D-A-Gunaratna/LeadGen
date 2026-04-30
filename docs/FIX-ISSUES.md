# Troubleshooting & Fixes

This document collects targeted fixes for common problems encountered in the repository. Run any commands from the project root and consult `docs/QUICKSTART.md` for full setup and startup instructions — avoid repeating global install/start steps here.

## Quick Fix (automated)

If you see corrupted node modules or other local issues, run the provided fix script from the project root:

```bash
bash tools/shell_scripts/fix-setup.sh
```

This script attempts to repair frontend/backend dependency issues and common workspace inconsistencies. See `docs/QUICKSTART.md` for prerequisites and how to start servers after fixes.

---

## Targeted Manual Fixes

These are small, safe commands for specific errors. Run them from the repository root or the directory indicated.

### Frontend: `concurrently` module error
**Symptom:** `Error: Cannot find module '../src/defaults'`

**Fix (repair corrupted installation only):**

```bash
# from project root
rm -rf node_modules/.bin/concurrently node_modules/concurrently
npm install --no-audit --no-fund concurrently@^8.2.2 --save-dev
```

### Frontend: `next` module error
**Symptom:** `Error: Cannot find module '../server/require-hook'`

**Fix (repair corrupted installation only):**

```bash
# from project root
rm -rf node_modules/.bin/next node_modules/next
npm install --no-audit --no-fund next@14.2.4 --save
```

### Backend: missing `requirements.txt` or pip errors
**Symptom:** pip cannot find requirements file or dependencies fail to install

**Fix:** install backend dependencies from the backend folder:

```bash
cd servers/backend
pip3 install -r requirements.txt
cd -
```

If you prefer a single command from the project root, use the npm helper defined in `package.json` (see `docs/QUICKSTART.md`).

---

## When to use the full clean reinstall

If multiple modules are corrupted or installs repeatedly fail, try a full reinstall from the project root:

```bash
rm -rf node_modules package-lock.json
npm install
# then reinstall backend deps
cd servers/backend && pip3 install -r requirements.txt && cd -
```

Only use the full clean reinstall if targeted fixes do not work.

## Notes
- Keep `tools/shell_scripts/fix-setup.sh` handy; it automates common repairs.  
- For startup/install instructions and the canonical commands, see `docs/QUICKSTART.md`. This file avoids repeating those commands.

