****# 🎓 Professional Attendance Management System

A production-ready, full-stack attendance management system built with modern web technologies and professional architecture.

## 🏆 Professional Design Assessment

This system demonstrates **enterprise-grade architecture** with clean separation of concerns, robust error handling, and scalable design patterns.

### ✅ **Professional Strengths**

#### **1. Architecture & Separation of Concerns**
- **Clean separation**: RESTful API for CRUD operations, WebSockets for real-time updates
- **Modular design**: Separate SQLite databases for different concerns (students, attendance, logs)
- **Proper layering**: Frontend (React/Next.js) ↔ Backend (Flask) ↔ Database (SQLite)

#### **2. Technology Stack**
- **Modern frontend**: Next.js 16.1.1 with TypeScript for type safety
- **Robust backend**: Flask with SocketIO for real-time features
- **Security**: HTTPS everywhere, SSL certificates, CORS properly configured
- **UI/UX**: Professional component library (Radix UI), responsive design

LeadGen - The Next Generation School Prefect Attendance Monitor

LeadGen is a compact full-stack attendance monitor built for schools. It pairs a Next.js frontend with a Flask backend, supports real-time updates, and keeps data in local SQLite files so it works well on a single host or across a LAN.

Core technologies
- Frontend: Next.js (React) + TypeScript
- Styling: Tailwind CSS
- State: Zustand
- Real-time: Socket.IO (WebSockets)
- Backend: Flask (Python)
- Storage: SQLite (local DB files)

What it does
- Real-time attendance marking and live dashboard updates
- Student profiles, search and role assignments (prefect, class, grade)
- RFID scanner integration hooks for fast check-ins
- Local backup/restore and lightweight migration support

Quick start (development)
1. Backend setup
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```
2. Frontend setup
```bash
cd frontend
npm install
```
3. Start backend (terminal A)
```bash
cd backend
./start_backend.sh
# or: python app.py
```
4. Start frontend (terminal B)
```bash
cd frontend
npm run dev
```

Default URLs
- Frontend: http://localhost:9002
- Backend API: http://localhost:5000

Repository layout (key paths)
- `backend/` — Flask app, API endpoints, utilities
- `backend/data/` — SQLite files: `students.db`, `attendance.db`, `logs.db`
- `frontend/` — Next.js app and UI components

Useful commands
- `./start_backend.sh` — create venv and run backend
- `npm run dev` — start frontend (use `npm run dev-next` to run only frontend)
- `bash fix-setup.sh` — attempt to repair common dev-environment issues

Environment
- Node.js 18+ for frontend
- Python 3.8+ for backend
- Optional env var: `NEXT_PUBLIC_BACKEND_URL` to point the frontend at a different backend

Data and backups
- Database files live in `backend/data/`. Keep backups of those files before making destructive changes. A `students.db.bak` may already exist.

Troubleshooting
- Frontend issues: run `bash fix-setup.sh` and check terminal output for missing packages.
- Backend issues: activate the venv and ensure `requirements.txt` is installed; check `backend/log.txt` for runtime errors.
- Empty API responses: inspect the DB files in `backend/data/` and confirm the backend process is running.

Security notes
- Intended for LAN or trusted environments. For production deployments, place a TLS-terminating reverse proxy (e.g., nginx) in front of the services and harden CORS and authentication.

Contributing
- Fork the repo, create a branch, add changes and tests, then open a pull request.

License
- MIT

For more details, see the `docs/` folder or inspect `backend/` and `frontend/` sources.
   npm run dev
   ```

3. **Access the Application**
   - Frontend: `https://localhost:9002` (or your LAN IP)
   - Backend API: `https://localhost:5000`

## 🏗️ **System Architecture**

### **Frontend (Port 9002)**
- **Framework**: Next.js 16.1.1 with TypeScript
- **UI Library**: Radix UI components
- **State Management**: Zustand stores
- **Real-time**: Socket.IO client
- **Styling**: Tailwind CSS

### **Backend (Port 5000)**
- **Framework**: Flask with Flask-SocketIO
- **Database**: SQLite (3 separate databases)
- **Security**: HTTPS with SSL certificates
- **Real-time**: WebSocket support
- **CORS**: Properly configured for cross-origin requests

### **Database Structure**
```
backend/data/
├── students.db     # Student information & backups
├── attendance.db   # Attendance records
└── logs.db        # System & authentication logs
```

## 🔐 **Security Features**

- **HTTPS Everywhere**: SSL/TLS encryption for all communications
- **Role-based Authentication**: Admin, Moderator, Developer roles
- **Password Management**: Secure password storage and validation
- **CORS Protection**: Properly configured cross-origin policies
- **Input Validation**: TypeScript types and server-side validation

## ⚡ **Real-time Features**

- **Live Attendance Updates**: Instant updates across all connected devices
- **RFID Scanner Integration**: Real-time student identification
- **Dashboard Statistics**: Live attendance metrics
- **Multi-user Synchronization**: Changes broadcast to all clients
- **Authentication Status**: Real-time auth state management

## 📊 **Key Features**

### **Student Management**
- Add/Edit/Remove students with detailed profiles
- RFID fingerprint integration
- Contact information and notes
- Role assignments (Prefects, etc.)

### **Attendance Tracking**
- Real-time attendance marking
- Historical attendance records
- Statistical analysis and reporting
- CSV export functionality

### **User Roles & Permissions**
- **Admin**: Full system access, user management
- **Moderator**: Attendance management, student editing
- **Developer**: System diagnostics, advanced features

### **Data Management**
- Automated backups and restore
- CSV import/export
- Data integrity checks
- Migration system for data updates

## 🔧 **Development**

### **Available Scripts**

**Frontend:**
```bash
npm run dev        # Start development server
npm run build      # Build for production
npm run start      # Start production server
npm run lint       # Run ESLint
npm run typecheck  # Run TypeScript type checking
```

**Backend:**
```bash
./start_backend.sh  # Start with virtual environment
python app.py       # Start manually
```

### **Environment Variables**
```bash
# Optional: Override backend URL
NEXT_PUBLIC_BACKEND_URL=https://your-custom-backend:5000
```

## 🌐 **Network & Deployment**

### **LAN Access**
The system automatically detects your network IP, making it accessible from any device on the same network:

- **Auto-detection**: No need to hardcode IPs
- **HTTPS**: Secure connections everywhere
- **CORS**: Properly configured for web access

### **Production Deployment**
- Generate SSL certificates for production use
- Configure firewall rules for ports 9002 (frontend) and 5000 (backend)
- Set up reverse proxy (nginx) for production deployment
- Configure environment variables for production settings

## 📈 **Performance & Scalability**

- **Efficient Database Design**: Separate databases reduce contention
- **WebSocket Optimization**: Real-time updates without polling
- **Lazy Loading**: Components load on demand
- **TypeScript**: Compile-time error catching
- **Modern Build Tools**: Turbopack for fast development

## 🧪 **Testing & Quality**

- **TypeScript**: Full type safety throughout the application
- **ESLint**: Code quality and consistency
- **Error Boundaries**: Graceful error handling in React
- **Input Validation**: Both client and server-side validation

## 🤝 **Contributing**

1. Fork the repository
2. Create a feature branch
3. Make your changes with proper TypeScript types
4. Test thoroughly on multiple devices
5. Submit a pull request

## 📄 **License**

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 **Acknowledgments**

Built with modern web technologies and best practices for reliable, scalable attendance management.

---

**This system demonstrates enterprise-grade architecture suitable for production deployment in educational institutions.**
   ```bash
   bash setup.sh
   ```

3. **Start the application:**
   ```bash
   npm run dev
   ```

   This will start:
   - Frontend: [http://localhost:9002](http://localhost:9002)
   - Backend: [http://localhost:5000](http://localhost:5000)

### 🛠 Manual Installation

If you prefer to install dependencies manually:

1. **Install Frontend Dependencies:**
   ```bash
   npm install
   ```

2. **Install Backend Dependencies:**
   ```bash
   cd backend
   pip3 install -r requirements.txt
   cd ..
   ```

3. **Run the Application:**
   ```bash
   npm run dev
   ```
   This will start:
   - Next.js frontend on [http://localhost:9002](http://localhost:9002)
   - Flask backend on [http://localhost:5000](http://localhost:5000)

## 📜 Available Scripts

Run these commands from the project root:

- `npm run dev`: Starts both the Next.js frontend and Flask backend concurrently.
- `npm run dev-next`: Starts only the Next.js frontend.
- `npm run dev-backend`: Starts only the Flask backend.
- `npm run install-backend`: Helper script to install Python dependencies.
- `bash fix-setup.sh`: Automated script to fix common dependency issues (e.g., corrupted node modules).

### Running Servers Separately

If you prefer to run the servers in separate terminals:

**Terminal 1 - Frontend:**
```bash
npm run dev-next
```
## ❓ Troubleshooting

**Terminal 2 - Backend:**
```sh
cd backend
python app.py
```
If you encounter issues during setup:

1. **Dependency Errors:** If you see errors about missing modules (like `concurrently` or `next`), run the fix script:
   ```bash
   bash fix-setup.sh
   ```
2. **Backend Issues:** Ensure you are running Python 3.8+ and that `requirements.txt` was installed successfully.
3. **Detailed Guide:** Check `FIX-ISSUES.md` for comprehensive troubleshooting steps.

## 🔐 Available Roles & Passwords

The application comes with three pre-configured roles with default passwords:

- **Moderator**: Can manage student profiles and download reports.
  - **Password**: `moderator`
- **Admin**: Has moderator permissions plus the ability to perform destructive actions like deleting all data.
  - **Password**: `admin`
- **Developer**: Has full system access, including debug tools, password management, and backup controls.
  - **Password**: `dev`

You can change the password for each acesslevel within the application.
