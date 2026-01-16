# LeadGen - The Next-Generation School Prefect Attendance Monitor

LeadGen is a modern, real-time school attendance management application built with a futuristic user interface. It provides a comprehensive suite of tools for administrators, moderators, and developers to track student presence, manage data, and analyze attendance trends.

![LeadGen Dashboard](https://i.imgur.com/your-screenshot.png) 

## ✨ Key Features

- **Live Attendance Dashboard**: A real-time overview of student check-ins, with stats for "On Time," "Late," and "Absent" students, powered by a websoket system for instant updates.
- **Real-Time RFID/Fingerprint Simulation**: Simulate student check-ins and see the dashboard update instantly.
- **Detailed Student Profiles**: View and manage student information, including contact details, roles, and a complete attendance history calendar.
- **Robust Backup & Restore System**: Create, restore, download, and delete backups of student and attendance data with secure, role-based authorization checks.
- **Advanced Analytics**: Visualize attendance data with charts breaking down presence by status and grade level.
- **Secure Data Management**: Easily add, edit, and remove students. Bulk upload/download student data and attendance history via CSV, JSON, or PDF, with critical actions protected by server-side password authorization.
- **Manual Attendance Marking**: Manually override or set attendance statuses for any student on any date.
- **Developer Tools**: Includes a "Time Freeze" feature for testing attendance logic on different dates and times, along with other debug actions.
- **Role-Based Access Control**: Pre-configured roles (Admin, Moderator, Dev) with tiered permissions for system management, enforced on both the client and server.

## 🚀 Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **UI Components**: [ShadCN UI](https://ui.shadcn.com/)
- **State Management**: [Zustand](https://github.com/pmndrs/zustand)
- **Charts**: [Recharts](https://recharts.org/)
- **Backend**: Flask (Python) with SQLite databases
- **Real-time**: WebSocket support via Flask-SocketIO

## 🏁 Getting Started

To get a local copy up and running, follow these simple steps.

### Prerequisites

- Node.js (v18 or higher)
- npm
- Python 3.8 or higher
- pip (Python package manager)

### Installation

1. Navigate to the project directory:
   ```sh
   cd /leadgen_server
   ```

2. Install frontend dependencies:
   ```sh
   npm install
   ```

3. Install backend dependencies:
   ```sh
   npm run install-backend
   ```
   Or manually:
   ```sh
   cd backend
   pip install -r requirements.txt
   cd ..
   ```

4. Run both frontend and backend servers:
   ```sh
   npm run dev
   ```
   This will start:
   - Next.js frontend on [http://localhost:9002]
   - Flask backend on [http://localhost:5000]

5. Open [http://localhost:9002](http://localhost:9002) in your browser to see the application.

### Running Servers Separately

If you prefer to run the servers in separate terminals:

**Terminal 1 - Frontend:**
```sh
npm run dev-next
```

**Terminal 2 - Backend:**
```sh
cd backend
python app.py
```

## 🔐 Available Roles & Passwords

The application comes with three pre-configured roles with default passwords:

- **Moderator**: Can manage student profiles and download reports.
  - **Password**: `moderator`
- **Admin**: Has moderator permissions plus the ability to perform destructive actions like deleting all data.
  - **Password**: `admin`
- **Developer**: Has full system access, including debug tools, password management, and backup controls.
  - **Password**: `dev`

You can change these passwords from the Admin or Dev tabs within the application.
